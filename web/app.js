/*
 * A interface.
 *
 * Não faz conta nenhuma: toda a matemática está no WebAssembly, dentro do
 * worker. Aqui só existe o que é de interface — trocar de aba, formatar
 * número, guardar o progresso e conversar com o worker.
 *
 * ## O ciclo de vida da busca
 *
 * A tela sempre diz em qual destes pontos ela está. Isso não é enfeite: entre
 * tocar em "Iniciar" e o primeiro número aparecer há dois trabalhos demorados
 * — baixar e instanciar o WebAssembly, e construir a solução inicial. Sem
 * anunciar cada um, o usuário fica olhando para uma tela parada sem saber se o
 * aparelho está trabalhando ou se travou.
 *
 *   ocioso → carregando → preparando → buscando ⇄ pausado
 *                                          ↓
 *                                      concluida
 */

import * as historico from './historico.js';
import * as biblioteca from './biblioteca.js';
import * as lotinha from './lotinha.js';

const $ = (id) => document.getElementById(id);

/* ─────────── estado da página ─────────── */

let trabalhador = null;
let fase = 'ocioso';
let recordes = [];
let melhorCartelas = [];
let travaDeTela = null;

/*
 * A sessão do histórico que esta busca está escrevendo.
 *
 * Ao iniciar do zero, nasce quando a primeira solução existe. Ao continuar um
 * trabalho salvo, é a sessão daquele trabalho — de modo que continuar melhora o
 * registro em vez de criar um segundo, quase igual, ao lado.
 */
let sessaoAtual = null;

/* A configuração da busca em curso, guardada porque a tela pode ser editada
   enquanto o motor trabalha e o registro precisa refletir o que está rodando. */
let configuracaoDaBusca = null;

/* O relógio é da interface, não do motor: mede o que o usuário esperou. */
let inicioDoTrecho = 0;
let tempoAcumulado = 0;
let cronometro = null;


/* ─────────── formatação ─────────── */

const milhares = (n) => Math.round(n).toLocaleString('pt-BR');
const porcento = (f) => `${(f * 100).toFixed(1).replace('.', ',')}%`;

/**
 * Tempo decorrido, na precisão que faz sentido para a escala.
 *
 * Um relógio fixo em `HH:MM:SS` mostra `00:00:00` numa busca que termina em
 * setecentos milissegundos — e um zero parado é exatamente o que faz o usuário
 * achar que nada aconteceu. Abaixo de um minuto, décimos de segundo mostram
 * que o tempo correu de verdade.
 */
function duracao(ms) {
  const segundos = ms / 1000;
  if (segundos < 60) {
    return `${segundos.toFixed(1).replace('.', ',')} s`;
  }

  const total = Math.floor(segundos);
  const doisDigitos = (n) => String(Math.floor(n)).padStart(2, '0');
  const partes = [(total % 3600) / 60, total % 60];
  if (total >= 3600) partes.unshift(total / 3600);
  return partes.map(doisDigitos).join(':');
}

/** `C(n, k)` em ponto flutuante — só para estimar o tamanho do problema. */
function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < k; i++) total = (total * (n - i)) / (i + 1);
  return total;
}

/* ─────────── situação e relógio ─────────── */

const SITUACOES = {
  ocioso: { classe: '', texto: 'parado' },
  carregando: { classe: 'trabalhando', texto: 'carregando o motor…' },
  preparando: { classe: 'trabalhando', texto: 'montando a primeira solução…' },
  buscando: { classe: 'trabalhando', texto: 'procurando soluções melhores' },
  pausado: { classe: 'pausada', texto: 'pausado' },
  concluida: { classe: 'concluida', texto: 'ótimo provado — não há melhor' },
  falhou: { classe: 'falhou', texto: 'algo deu errado' },
};

function definirFase(nova, textoExtra = null) {
  fase = nova;
  const { classe, texto } = SITUACOES[nova] ?? SITUACOES.ocioso;

  const faixa = $('situacao');
  faixa.className = `situacao ${classe}`;
  $('texto-situacao').textContent = textoExtra ?? texto;

  // O relógio corre enquanto há trabalho acontecendo — inclusive durante o
  // carregamento e a construção inicial, que é justamente quando o usuário
  // mais precisa ver que algo se move.
  const trabalhando = ['carregando', 'preparando', 'buscando'].includes(nova);
  if (trabalhando) iniciarCronometro();
  else pararCronometro();

  $('pausar').textContent = nova === 'pausado' ? 'Continuar' : 'Pausar';
  $('pausar').disabled = ['ocioso', 'carregando', 'preparando', 'concluida', 'falhou'].includes(nova);
}

function iniciarCronometro() {
  if (cronometro) return;
  inicioDoTrecho = performance.now();
  const tique = () => {
    $('relogio').textContent = duracao(tempoAcumulado + (performance.now() - inicioDoTrecho));
  };
  tique();
  // Cinco vezes por segundo: barato (é uma atribuição de texto) e suficiente
  // para os décimos se moverem visivelmente numa busca curta.
  cronometro = setInterval(tique, 200);
}

function pararCronometro() {
  if (!cronometro) return;
  clearInterval(cronometro);
  cronometro = null;
  tempoAcumulado += performance.now() - inicioDoTrecho;
  $('relogio').textContent = duracao(tempoAcumulado);
}

function zerarCronometro() {
  pararCronometro();
  tempoAcumulado = 0;
  $('relogio').textContent = duracao(0);
}

/* ─────────── abas ─────────── */

document.querySelectorAll('.aba').forEach((aba) => {
  aba.addEventListener('click', () => mostrarPainel(aba.dataset.painel));
});

function mostrarPainel(nome) {
  document.querySelectorAll('.aba').forEach((a) => {
    a.classList.toggle('ativa', a.dataset.painel === nome);
  });
  document.querySelectorAll('.painel').forEach((p) => {
    p.classList.toggle('ativo', p.id === nome);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─────────── escolha da regra ─────────── */

let tipoDeRegra = 'cobrir';

document.querySelectorAll('#tipo-regra .opcao').forEach((botao) => {
  botao.addEventListener('click', () => {
    tipoDeRegra = botao.dataset.regra;
    document.querySelectorAll('#tipo-regra .opcao').forEach((b) => {
      b.classList.toggle('ativa', b === botao);
    });
    $('regra-cobrir').hidden = tipoDeRegra !== 'cobrir';
    $('regra-garantir').hidden = tipoDeRegra !== 'garantir';
    atualizarPrevisao();
  });
});

/** Lê a tela e devolve a configuração no formato que o motor espera. */
function lerConfiguracao() {
  const universo = Number($('universo').value);
  const tamanhoPool = Number($('pool').value);
  const cartela = Number($('cartela').value);

  const alvo = tipoDeRegra === 'cobrir' ? Number($('cobrir').value) : Number($('alvo').value);
  const intersecao =
    tipoDeRegra === 'cobrir' ? Number($('cobrir').value) : Number($('intersecao').value);

  const orcamentoBruto = $('orcamento').value.trim();

  return {
    universo,
    pool: Array.from({ length: tamanhoPool }, (_, i) => i + 1),
    cartela,
    alvo,
    intersecao,
    orcamento: orcamentoBruto === '' ? null : Number(orcamentoBruto),
    semente: Number($('semente').value) || 1,
  };
}

/* ─────────── previsão antes de começar ─────────── */

/*
 * Um celular tem muito menos memória que um computador, e o Safari do iOS não
 * avisa quando estoura: ele simplesmente recarrega a página. Por isso a conta é
 * feita aqui, na interface, antes de o motor ser criado.
 */
const ALVOS_CONFORTAVEIS = 2_000_000;
const ALVOS_ARRISCADOS = 8_000_000;

['universo', 'pool', 'cartela', 'cobrir', 'alvo', 'intersecao', 'orcamento'].forEach((id) => {
  $(id).addEventListener('input', atualizarPrevisao);
});

function atualizarPrevisao() {
  const c = lerConfiguracao();
  const destino = $('texto-previsao');
  const explicacao = tipoDeRegra === 'cobrir' ? $('explicacao-cobrir') : $('explicacao-garantir');

  if (tipoDeRegra === 'cobrir') {
    explicacao.textContent =
      `Toda combinação de ${c.alvo} números dentro do seu pool de ${c.pool.length} ` +
      `vai aparecer inteira em alguma cartela.`;
  } else {
    explicacao.textContent =
      `Se ${c.alvo} dos seus ${c.pool.length} números forem sorteados, ` +
      `alguma cartela terá pelo menos ${c.intersecao} deles.`;
  }

  const problemas = validar(c);
  if (problemas) {
    destino.innerHTML = `<strong style="color:var(--vermelho)">${problemas}</strong>`;
    $('iniciar').disabled = true;
    return;
  }

  const alvos = combinacoes(c.pool.length, c.alvo);
  const memoria = (alvos * 12) / 1e6;

  let recado;
  if (alvos > ALVOS_ARRISCADOS) {
    recado =
      `<strong style="color:var(--vermelho)">Pesado demais para um celular.</strong> ` +
      `São ${milhares(alvos)} combinações a cobrir (cerca de ${Math.round(memoria)} MB). ` +
      `Diminua o pool ou o tamanho do grupo a cobrir.`;
    $('iniciar').disabled = true;
  } else {
    if (alvos > ALVOS_CONFORTAVEIS) {
      recado =
        `<strong style="color:var(--ouro)">Vai puxar o aparelho.</strong> ` +
        `${milhares(alvos)} combinações a cobrir, cerca de ${Math.round(memoria)} MB. ` +
        `Deve funcionar, mas devagar.`;
    } else {
      recado = `${milhares(alvos)} combinações a cobrir. Tamanho tranquilo para o aparelho.`;
    }
    $('iniciar').disabled = false;
  }

  destino.innerHTML = recado;
}

function validar(c) {
  if (!(c.universo >= 1)) return 'O universo precisa ser pelo menos 1.';
  if (!(c.pool.length >= 1)) return 'O pool precisa ter pelo menos 1 número.';
  if (c.pool.length > c.universo) return 'O pool não pode ser maior que o universo.';
  if (c.pool.length > 128) return 'O pool máximo suportado é 128 números.';
  if (!(c.cartela >= 1)) return 'A cartela precisa ter pelo menos 1 número.';
  if (c.cartela > c.pool.length) return 'A cartela não pode ser maior que o pool.';
  if (!(c.alvo >= 1) || c.alvo > c.pool.length) return 'O grupo a cobrir precisa caber no pool.';
  if (!(c.intersecao >= 1) || c.intersecao > Math.min(c.alvo, c.cartela)) {
    return 'Os acertos garantidos precisam caber no grupo e na cartela.';
  }
  if (c.orcamento !== null && !(c.orcamento >= 1)) return 'O teto de cartelas precisa ser positivo.';
  return null;
}

/* ─────────── conversa com o worker ─────────── */

function garantirTrabalhador() {
  if (trabalhador) return trabalhador;

  trabalhador = new Worker('./trabalhador.js', { type: 'module' });

  trabalhador.onmessage = ({ data }) => {
    switch (data.tipo) {
      // O WebAssembly terminou de carregar. Ainda não há solução nenhuma.
      case 'pronto':
        definirFase('preparando');
        break;

      // A configuração foi aceita; a construção inicial vem a seguir.
      case 'criado':
        definirFase('preparando');
        break;

      // Existe uma primeira solução. É o momento em que a tela deixa de estar
      // vazia — e a partir daqui o número só pode cair.
      case 'preparado':
        aplicarMensagem(data);
        if (data.estado.encerrado) {
          definirFase('concluida');
          avisar('Ótimo provado já na primeira tentativa.', true);
        } else {
          trabalhador.postMessage({ tipo: 'rodar' });
          definirFase('buscando');
        }
        break;

      case 'estado':
        aplicarMensagem(data);
        if (fase === 'buscando') {
          $('texto-situacao').textContent = `procurando algo menor que ${data.estado.melhor_cartelas}`;
        }
        break;

      case 'otimo':
        aplicarMensagem(data);
        definirFase('concluida');
        soltarTelaLigada();
        avisar('Ótimo provado — não existe solução melhor.', true);
        break;

      case 'pausado':
        aplicarMensagem(data);
        definirFase('pausado');
        break;

      // O usuário mandou encerrar. O worker já devolveu tudo e liberou a
      // memória; aqui só resta desmontá-lo e voltar à configuração.
      case 'encerrado':
        aplicarMensagem(data);
        desmontarTrabalhador();
        definirFase('ocioso');
        zerarCronometro();
        soltarTelaLigada();
        atualizarAtalhoDoHistorico();
        mostrarPainel('configurar');
        avisar('Busca encerrada. O resultado ficou salvo.', true);
        break;

      case 'erro':
        definirFase('falhou', data.mensagem);
        soltarTelaLigada();
        avisar(data.mensagem);
        // Erro de fechamento é erro de digitação, e a correção é na caixa de
        // texto. Deixar o usuário parado na tela de busca, diante de um aviso
        // que some sozinho, esconderia justamente o campo que ele precisa
        // consertar.
        if (ehErroDeFechamento(data.mensagem)) {
          desmontarTrabalhador();
          definirFase('ocioso');
          zerarCronometro();
          mostrarPainel('configurar');
          mostrarErroDoFechamento(data.mensagem);
        }
        break;

      default:
        break;
    }
  };

  trabalhador.onerror = (erro) => {
    definirFase('falhou');
    avisar(`Falha no motor: ${erro.message || 'erro desconhecido'}`);
  };

  return trabalhador;
}

function desmontarTrabalhador() {
  if (!trabalhador) return;
  trabalhador.terminate();
  trabalhador = null;
}

/* ─────────── pintar a tela ─────────── */

/**
 * Registra o progresso desta busca no histórico.
 *
 * A sessão nasce quando existe a primeira solução — não ao tocar em iniciar.
 * Uma busca abandonada antes de produzir qualquer coisa não é um trabalho, e
 * encheria a lista de linhas vazias.
 *
 * Daí em diante cada melhoria atualiza a mesma sessão. É isso que faz continuar
 * um trabalho aprimorar o registro existente, em vez de espalhar cópias quase
 * idênticas pelo histórico.
 */
function salvarNoHistorico(estado) {
  if (!melhorCartelas.length || !estado) return;

  const dados = {
    melhor: melhorCartelas,
    iteracoes: estado.iteracoes ?? 0,
    avaliacao: {
      cartelas: estado.melhor_cartelas,
      cobertura: estado.melhor_cobertura,
      redundancia: estado.melhor_redundancia,
      limiteInferior: estado.limite_inferior,
      otimo: Boolean(estado.optimalidade_provada),
    },
  };

  if (sessaoAtual) {
    // A sessão pode ter sido excluída pelo usuário enquanto a busca corria.
    // Nesse caso o trabalho continua, mas passa a registrar-se numa nova.
    const atualizada = historico.atualizar(sessaoAtual, dados);
    if (!atualizada) sessaoAtual = historico.criar(configuracaoDaBusca, dados).id;
  } else {
    sessaoAtual = historico.criar(configuracaoDaBusca, dados).id;
  }

  pintarHistorico();
}

/**
 * Atualiza a tela a partir de uma mensagem do worker.
 *
 * `cartelas` vem preenchido sempre que a solução mudou. Pintar a partir daqui
 * — e não de uma leitura posterior do armazenamento — é o que garante que a
 * aba Resultado mostre o que o painel de busca acabou de anunciar.
 */
function aplicarMensagem({ estado, cartelas }) {
  const mudou = Array.isArray(cartelas);
  if (mudou) {
    melhorCartelas = cartelas;
    pintarCartelas();
  }
  if (estado) aplicarEstado(estado);
  // Grava logo após pintar: o que está na tela e o que está no histórico saem
  // do mesmo dado, no mesmo instante.
  if (mudou) salvarNoHistorico(estado);
}

function aplicarEstado(estado) {
  pintarPartida(estado);
  $('melhor-cartelas').textContent = estado.melhor_cartelas || '—';
  $('limite-inferior').textContent = estado.limite_inferior || '—';
  $('gap').textContent = estado.gap === null ? '—' : porcento(estado.gap);
  $('cobertura').textContent = porcento(estado.melhor_cobertura);

  $('atual-cartelas').textContent = estado.atual_cartelas;
  $('atual-descobertos').textContent = milhares(estado.atual_descobertos);
  $('meta').textContent = estado.meta_cartelas > 1e9 ? '—' : estado.meta_cartelas;
  $('elites').textContent = estado.elites;
  $('iteracoes').textContent = milhares(estado.iteracoes);
  $('velocidade').textContent = estado.velocidade ? milhares(estado.velocidade) : '—';
  $('recordes').textContent = estado.recordes;

  $('selo-otimo').hidden = !estado.optimalidade_provada;
  $('res-selo-otimo').hidden = !estado.optimalidade_provada;

  pintarReferencia(estado);

  if (estado.novos_recordes?.length) {
    recordes = [...estado.novos_recordes.reverse(), ...recordes].slice(0, 40);
    pintarRecordes();
  }

  $('res-cartelas').textContent = estado.melhor_cartelas || '—';
  $('res-cobertura').textContent = porcento(estado.melhor_cobertura);
  $('res-redundancia').textContent = milhares(estado.melhor_redundancia);
}

/**
 * Diz de onde a busca partiu — e, quando o usuário trouxe um fechamento, o que
 * aconteceu com ele.
 *
 * Sem isto, o aproveitamento fica invisível. Quem cola 26 cartelas e vê o motor
 * começar em 21 não tem como saber se as suas foram usadas, podadas ou
 * ignoradas — e a diferença importa: as três coisas acontecem, cada uma por um
 * motivo diferente.
 */
function pintarPartida(estado) {
  const destino = $('partida');
  const origem = estado.origem_do_inicio || '';
  const trazidas = estado.cartelas_trazidas || 0;

  if (!origem) {
    destino.hidden = true;
    return;
  }

  let texto;
  if (trazidas === 0) {
    texto = `Partiu de: <b>${escapar(origem)}</b>`;
  } else if (origem === 'cobertura do mundo') {
    const podadas = trazidas - (estado.melhor_cartelas || trazidas);
    texto =
      `Partiu da <b>cobertura do mundo</b> guardada neste aparelho ` +
      (podadas > 0
        ? `<em>— ${trazidas} cartelas, das quais ${podadas} eram dispensáveis.</em>`
        : `<em>— ${trazidas} cartelas prontas, sem reconstruir nada.</em>`);
  } else if (origem === 'fechamento importado') {
    const podadas = trazidas - (estado.melhor_cartelas || trazidas);
    texto =
      `Partiu do <b>seu fechamento</b> ` +
      (podadas > 0
        ? `<em>— das ${trazidas} cartelas que você trouxe, ${podadas} eram ` +
          `dispensáveis e saíram de graça.</em>`
        : `<em>— as ${trazidas} cartelas que você trouxe, aproveitadas ` +
          `inteiras.</em>`);
  } else {
    texto =
      `Partiu de: <b>${escapar(origem)}</b> <em>— melhor que as ${trazidas} ` +
      `cartelas que você trouxe, então o motor começou daqui. Seu fechamento ` +
      `não foi perdido: ele só não era o melhor ponto de partida disponível.</em>`;
  }

  destino.hidden = false;
  destino.innerHTML = texto;
}

/**
 * Situa o resultado do usuário diante do melhor que o mundo já obteve.
 *
 * O número sozinho não diz nada. "27 cartelas" é excelente numa configuração e
 * medíocre em outra, e sem referência o usuário não tem como saber em qual das
 * duas está — nem quando vale a pena continuar procurando.
 *
 * Os quatro estados possíveis dizem coisas diferentes, e a redação de cada um
 * importa:
 *
 * - **sem referência** — garantia parcial ou fora da faixa catalogada. Dizer
 *   isso é mais honesto que esconder a linha, que sugeriria que o resultado é
 *   bom por não ter comparação.
 * - **atrás** — quantas cartelas faltam. É a informação acionável.
 * - **empatado** — chegou ao melhor conhecido no mundo.
 * - **à frente** — superou o recorde mundial. Merece destaque próprio e a
 *   instrução do que fazer com isso.
 */
function pintarReferencia(estado) {
  const alvos = ['referencia-busca', 'referencia-resultado'];
  const nossas = estado.melhor_cartelas || 0;
  const mundo = estado.melhor_conhecido ?? null;

  // Só faz sentido comparar contagens de cartelas entre soluções que cobrem
  // tudo. Com teto de cartelas o objetivo é outro — cobrir o máximo possível
  // dentro do teto — e a solução tem cobertura parcial de propósito. Comparar
  // ali anunciaria "acima do melhor conhecido no mundo" para um fechamento
  // furado, que é a pior mentira que esta tela poderia contar.
  const completo = estado.melhor_cobertura >= 1;

  // `referencia_exata` separa dois números muito diferentes:
  //
  // - **exata** — o problema é a cobertura completa catalogada, e o número é o
  //   melhor que o mundo já obteve *nela*. Ficar abaixo é recorde mundial.
  // - **teto** — garantia parcial. Cobrir todas as t-uplas resolve o problema
  //   com folga, então o número é um teto válido e nada mais. Ficar bem abaixo
  //   é o esperado, não façanha — anunciar recorde ali seria falso.
  const exata = estado.referencia_exata === true;
  const superou = mundo !== null && exata && completo && nossas > 0 && nossas < mundo;

  $('selo-recorde').hidden = !superou;
  $('res-selo-recorde').hidden = !superou;

  const cabecalho = `Melhor conhecido no mundo: <b>${mundo}</b>`;

  let texto;
  if (mundo === null) {
    texto =
      'Sem referência publicada para esta configuração <em>— a tabela mundial ' +
      'vai até 99 números no pool, 25 por cartela e grupos de até 8.</em>';
  } else if (!exata) {
    // O caso do fechamento de loteria, que é o uso mais comum do aplicativo.
    const acertos = estado.melhor_cartelas > 0 && completo ? `Você está com <b>${nossas}</b>. ` : '';
    texto =
      `Cobrir <b>todos</b> os grupos garantiria seu resultado com ` +
      `<b>${mundo}</b> cartelas <em>— é o melhor conhecido no mundo para a ` +
      `cobertura completa, e serve de teto. ${acertos}Como sua garantia é ` +
      `parcial, dá para usar bem menos: é exatamente o que o motor procura.</em>`;
  } else if (nossas > 0 && !completo) {
    texto =
      `${cabecalho} <em>— com ${nossas} cartelas e cobertura completa. Esta ` +
      `busca está limitada pelo teto que você definiu, então os números não se ` +
      `comparam diretamente.</em>`;
  } else if (superou) {
    texto =
      `${cabecalho} <em>— você chegou a ${nossas}. Vale conferir e submeter à ` +
      `La Jolla Covering Repository: seria um recorde novo.</em>`;
  } else if (nossas === mundo) {
    texto = `${cabecalho} <em>— seu resultado empatou com ele.</em>`;
  } else if (nossas > 0) {
    const faltam = nossas - mundo;
    const quantas = faltam === 1 ? 'falta 1 cartela' : `faltam ${faltam} cartelas`;
    texto = `${cabecalho} <em>— ${quantas}.</em>`;
  } else {
    texto = cabecalho;
  }

  alvos.forEach((id) => {
    const destino = $(id);
    destino.hidden = false;
    destino.innerHTML = texto;
  });
}

function pintarRecordes() {
  if (!recordes.length) {
    $('lista-recordes').innerHTML =
      '<li class="ajuda">as melhorias vão aparecer aqui conforme forem encontradas</li>';
    return;
  }
  $('lista-recordes').innerHTML = recordes
    .map(
      (r) => `
      <li>
        <span class="quantia">${r.cartelas}</span>
        <span class="via">${r.operador}<br>iteração ${milhares(r.iteracao)}</span>
      </li>`
    )
    .join('');
}

function pintarCartelas() {
  const destino = $('lista-cartelas');
  if (!melhorCartelas.length) {
    destino.innerHTML = '<p class="ajuda">Nenhuma solução ainda. Inicie uma busca.</p>';
    return;
  }
  destino.innerHTML = melhorCartelas
    .map(
      (cartela, i) => `
      <div class="cartela">
        <span class="indice">${String(i + 1).padStart(2, '0')}</span>
        <span>${cartela.map((n) => String(n).padStart(2, '0')).join(' ')}</span>
      </div>`
    )
    .join('');
}

/* ─────────── botões ─────────── */

$('iniciar').addEventListener('click', () => {
  const configuracao = lerConfiguracao();
  const problema = validar(configuracao);
  if (problema) {
    avisar(problema);
    return;
  }

  // O texto vai cru para o motor: quem interpreta é o mesmo código Rust que a
  // linha de comando usa, então o que o celular aceita é exatamente o que o
  // terminal aceita. Um interpretador em JavaScript aqui divergiria daquele
  // com o tempo, e a divergência apareceria como cartela aceita num lado e
  // recusada no outro.
  const fechamento = $('texto-fechamento').value.trim();
  iniciarBusca(configuracao, fechamento || null);
});

/**
 * Dá a partida, consultando antes a biblioteca guardada no aparelho.
 *
 * Se existir uma cobertura do mundo para esta configuração, ela entra como
 * ponto de partida. Não substitui o que o usuário colou nem manda no motor: as
 * duas coisas viram candidatas, e `escolher_partida`, do lado do Rust, fica com
 * a melhor depois de podar todas. O que a biblioteca faz é garantir que o
 * melhor resultado já produzido no mundo esteja entre os candidatos, em vez de
 * o motor ter de reconstruí-lo do zero.
 */
async function iniciarBusca(configuracao, fechamentoColado) {
  let doMundo = null;
  try {
    // A biblioteca cataloga coberturas completas de t-uplas. Numa garantia
    // parcial isso continua servindo: cobrir todas as t-uplas resolve a
    // garantia com folga — é o mesmo argumento do teto mostrado na tela.
    const blocos = await biblioteca.obter(
      configuracao.pool.length,
      configuracao.cartela,
      configuracao.intersecao
    );
    if (blocos) {
      // Os blocos vêm em 1..v; o pool pode ter rótulos quaisquer.
      doMundo = blocos.map((bloco) => bloco.map((n) => configuracao.pool[n - 1]));
    }
  } catch {
    /* sem biblioteca a busca começa igual, só sem o atalho */
  }

  comecar({ configuracao, fechamento: fechamentoColado, doMundo });
}

/* ─────────── Lotinha ─────────── */

/*
 * A modalidade inteira, numa tela só.
 *
 * Escolhem-se de 17 a 23 dezenas entre 25; ganha-se quando as 15 sorteadas caem
 * todas dentro do conjunto escolhido. São 28 combinações de (pool, tamanho do
 * jogo), e o fechamento de cada uma já vem pronto no aplicativo — conferido
 * sorteio a sorteio antes de ser gravado.
 *
 * A tela não recalcula nada ao abrir: consulta o banco, valida, mostra. O motor
 * entra depois, para tentar superar o que já existe. Nos dez casos em que o
 * mínimo é problema aberto na matemática, é aí que ele tem trabalho de verdade.
 */

let lotPool = 18;
let lotJogo = 17;
let lotDezenas = new Set();
let lotFechamento = null;

const lotCotacao = {};

function lotMontar() {
  // Tamanho do pool.
  const alvoPool = $('lot-pool');
  alvoPool.innerHTML = '';
  for (let p = lotinha.MENOR_POOL; p <= lotinha.MAIOR_POOL; p++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(p);
    b.dataset.pool = String(p);
    b.addEventListener('click', () => {
      lotPool = p;
      // A seleção que sobra vira inválida se o pool encolheu.
      if (lotDezenas.size > p) lotDezenas = new Set([...lotDezenas].slice(0, p));
      if (lotJogo > p) lotJogo = p;
      lotPintarTudo();
    });
    alvoPool.appendChild(b);
  }

  // Grade das 25 dezenas.
  const grade = $('lot-grade');
  grade.innerHTML = '';
  for (let n = 1; n <= lotinha.UNIVERSO; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'numero';
    b.textContent = String(n).padStart(2, '0');
    b.dataset.n = String(n);
    b.addEventListener('click', () => lotAlternar(n));
    grade.appendChild(b);
  }

  // Cotação: um campo por tamanho de jogo, vazio de propósito.
  const cot = $('lot-cotacao');
  cot.innerHTML = '';
  for (let k = lotinha.MENOR_POOL; k <= lotinha.MAIOR_POOL; k++) {
    const rotulo = document.createElement('label');
    rotulo.className = 'campo linha';
    rotulo.innerHTML =
      `<span>${k} dezenas <em>— chance 1 em ` +
      `${milhares(1 / lotinha.chanceDe(k))}</em></span>`;
    const campo = document.createElement('input');
    campo.type = 'number';
    campo.min = '0';
    campo.step = '0.01';
    campo.inputMode = 'decimal';
    campo.placeholder = 'quanto paga';
    campo.addEventListener('input', () => {
      const v = Number(campo.value);
      if (v > 0) lotCotacao[k] = v;
      else delete lotCotacao[k];
      lotPintarEconomia();
    });
    rotulo.appendChild(campo);
    cot.appendChild(rotulo);
  }

  lotMontarMatriz();
  lotPintarTudo();
}

function lotAlternar(n) {
  if (lotDezenas.has(n)) lotDezenas.delete(n);
  else if (lotDezenas.size < lotPool) lotDezenas.add(n);
  else {
    avisar(`Já são ${lotPool} dezenas. Desmarque uma antes de trocar.`);
    return;
  }
  lotPintarTudo();
}

function lotPintarTudo() {
  document.querySelectorAll('#lot-pool .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.pool) === lotPool);
  });
  document.querySelectorAll('#lot-grade .numero').forEach((b) => {
    b.classList.toggle('escolhido', lotDezenas.has(Number(b.dataset.n)));
  });

  const faltam = lotPool - lotDezenas.size;
  $('lot-contagem').innerHTML =
    faltam === 0
      ? `<b>${lotPool} de ${lotPool} escolhidas</b> <em>— ` +
        `${milhares(lotinha.combinacoes(lotPool, 15))} sorteios possíveis dentro delas, ` +
        `e chance de 1 em ${milhares(1 / lotinha.chanceDe(lotPool))} de o sorteio cair aqui.</em>`
      : `<b>${lotDezenas.size} de ${lotPool} escolhidas</b> <em>— ${
          faltam === 1 ? 'falta 1 dezena' : `faltam ${faltam} dezenas`
        }.</em>`;

  lotMontarOpcoesDeJogo();
  // Um botão desabilitado que não diz o que falta parece quebrado: a pessoa
  // toca, nada acontece, e nada na tela explica. O rótulo passa a ser a
  // instrução enquanto a seleção não está completa.
  const botao = $('lot-iniciar');
  botao.disabled = faltam !== 0;
  botao.textContent =
    faltam === 0
      ? 'Carregar fechamento'
      : `Escolha ${faltam === lotPool ? lotPool : `mais ${faltam}`} dezena${
          faltam === 1 ? '' : 's'
        }`;
}

function lotMontarOpcoesDeJogo() {
  const alvo = $('lot-jogo');
  alvo.innerHTML = '';
  for (let k = lotinha.MENOR_POOL; k <= lotPool; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(k);
    b.dataset.jogo = String(k);
    b.addEventListener('click', () => {
      lotJogo = k;
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvo.appendChild(b);
  }
  if (lotJogo > lotPool) lotJogo = lotPool;
  lotPintarExplicacao();
  lotPintarEconomia();
}

function lotPintarExplicacao() {
  document.querySelectorAll('#lot-jogo .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.jogo) === lotJogo);
  });

  const { jogos, exato, piso } = lotinha.minimo(lotPool, lotJogo);
  const destino = $('lot-explicacao');

  if (lotJogo === lotPool) {
    destino.innerHTML =
      `<b>Um jogo só.</b> <em>Jogar as ${lotPool} dezenas de uma vez é uma aposta ` +
      `única: ou as 15 caem dentro, ou não. Não há fechamento a fazer — para ` +
      `fechar, o jogo precisa ser menor que o pool.</em>`;
  } else if (exato) {
    destino.innerHTML =
      `<b>${milhares(jogos)} jogos</b> fecham o seu pool. <em>Este número é o ` +
      `mínimo comprovado — não existe fechamento menor. ` +
      (lotPool - lotJogo === 1
        ? 'Curiosamente são sempre 16 quando o jogo tem uma dezena a menos que o pool, seja qual for o pool.'
        : 'Vem do teorema de Turán.') +
      `</em>`;
  } else {
    destino.innerHTML =
      `<b>Mínimo desconhecido.</b> <em>Ninguém no mundo sabe quantos jogos bastam ` +
      `aqui — é problema em aberto. O que se sabe é que não dá com menos de ` +
      `<b>${milhares(piso)}</b>. O aplicativo traz o melhor fechamento que o ` +
      `motor já encontrou, e você pode deixá-lo procurando um menor.</em>`;
  }
}

/**
 * A economia do fechamento — com os dois ramos sempre juntos.
 *
 * O ramo vencedor é sedutor: dezesseis jogos de 17 dezenas custam R$16 e pagam
 * no mínimo alguns milhares. Mostrá-lo sozinho seria enganoso, porque o outro
 * ramo acontece em mais de 99% das vezes e devolve zero. Os dois aparecem lado
 * a lado, e o retorno esperado fecha a conta.
 */
function lotPintarEconomia() {
  const destino = $('lot-economia');
  const cartao = $('lot-economia-cartao');
  const { jogos, exato, piso } = lotinha.minimo(lotPool, lotJogo);
  const quantidade = lotFechamento?.length ?? jogos ?? piso;

  if (!quantidade) {
    cartao.hidden = true;
    return;
  }

  const valor = Number($('lot-valor').value) || 1;
  const e = lotinha.economia({
    pool: lotPool,
    jogo: lotJogo,
    quantidade,
    cotacao: lotCotacao,
    valorDoJogo: valor,
  });

  cartao.hidden = false;

  const dinheiro = (v) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (e.multiplicador === null) {
    destino.innerHTML =
      `<div class="linha-economia"><span>Custo do fechamento</span>` +
      `<b>${dinheiro(e.custo)}</b></div>` +
      `<div class="linha-economia"><span>Chance de o sorteio cair no seu pool</span>` +
      `<b>1 em ${milhares(1 / e.chanceDoPool)}</b></div>` +
      `<p class="ajuda">Informe a cotação da sua banca acima para ver quanto ` +
      `isso pagaria e qual o retorno esperado.</p>`;
    return;
  }

  const lucro = e.premioMinimo - e.custo;
  destino.innerHTML =
    `<div class="linha-economia"><span>Custo do fechamento</span>` +
    `<b>${dinheiro(e.custo)}</b> <em>${milhares(quantidade)} jogos</em></div>` +

    `<div class="linha-economia ganha"><span>Se o sorteio cair no seu pool ` +
    `<em>(1 em ${milhares(1 / e.chanceDoPool)})</em></span>` +
    `<b>${dinheiro(e.premioMinimo)}</b> no mínimo, ` +
    `<em>${dinheiro(e.premioMedioQuandoGanha)} em média — saldo ` +
    `${lucro >= 0 ? '+' : ''}${dinheiro(lucro)}</em></div>` +

    `<div class="linha-economia perde"><span>Se não cair ` +
    `<em>(${porcento(e.chanceDePerder)} das vezes)</em></span>` +
    `<b>−${dinheiro(e.perdaQuandoPerde)}</b> <em>nada volta</em></div>` +

    `<div class="linha-economia total"><span>Retorno esperado</span>` +
    `<b>${dinheiro(e.retornoEsperado)}</b> <em>por real apostado</em></div>` +

    `<p class="ajuda">O retorno esperado é fixo por jogo e apenas soma: ` +
    `<b>nenhum arranjo de fechamento o altera</b>. Fechar muda quando você ganha ` +
    `— com que frequência e quanto de cada vez — nunca a média.</p>`;
}

function lotMontarMatriz() {
  const linhas = lotinha
    .matriz()
    .map((l) => {
      const quantos = l.exato ? milhares(l.jogos) : `≥ ${milhares(l.piso)}`;
      const situacao = l.jogo === l.pool ? 'aposta única' : l.exato ? 'exato' : 'em aberto';
      return (
        `<tr><td>${l.pool}</td><td>${l.jogo}</td><td>${quantos}</td>` +
        `<td class="${l.exato ? '' : 'aberto'}">${situacao}</td>` +
        `<td>1 em ${milhares(1 / lotinha.chanceDe(l.jogo))}</td></tr>`
      );
    })
    .join('');

  $('lot-matriz').innerHTML =
    '<thead><tr><th>pool</th><th>jogo</th><th>jogos</th><th>mínimo</th>' +
    '<th>chance de 1 jogo</th></tr></thead><tbody>' + linhas + '</tbody>';
}

$('lot-limpar').addEventListener('click', () => {
  lotDezenas.clear();
  lotPintarTudo();
});

$('lot-sortear').addEventListener('click', () => {
  const todas = Array.from({ length: lotinha.UNIVERSO }, (_, i) => i + 1);
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  lotDezenas = new Set(todas.slice(0, lotPool).sort((a, b) => a - b));
  lotPintarTudo();
});

$('lot-valor').addEventListener('input', lotPintarEconomia);

/**
 * Carrega o fechamento pronto, confere, mostra — e só então oferece o motor.
 *
 * A ordem importa. O banco entrega a solução na hora, sem cálculo; o validador
 * independente confirma a cobertura sem consultar quem a produziu; e a
 * otimização é um passo separado, que o usuário decide se quer.
 */
$('lot-iniciar').addEventListener('click', async () => {
  if (lotDezenas.size !== lotPool) return;

  const dezenas = [...lotDezenas].sort((a, b) => a - b);
  const cartao = $('lot-resultado-cartao');
  const destino = $('lot-conferencia');
  cartao.hidden = false;
  destino.textContent = 'carregando o fechamento…';

  try {
    lotFechamento = await lotinha.fechamentoPara(lotPool, lotJogo, dezenas);
    if (!lotFechamento) {
      destino.innerHTML = '<b>Combinação sem fechamento no banco.</b>';
      return;
    }

    destino.textContent = `conferindo ${milhares(
      lotinha.combinacoes(lotPool, 15)
    )} sorteios, um a um…`;

    // Cede um quadro à tela antes da conferência, que pode levar segundos no
    // pool 23 — sem isto a mensagem acima nunca chegaria a aparecer.
    await new Promise((r) => setTimeout(r, 0));
    const { total, cobertos, falha } = lotinha.conferirCobertura(dezenas, lotFechamento);

    destino.innerHTML =
      cobertos === total
        ? `<b>Cobertura comprovada: 100%</b> <em>— ${milhares(total)} sorteios ` +
          `conferidos um a um, e todos caem em algum dos ${milhares(lotFechamento.length)} ` +
          `jogos. A conferência não consultou o motor que produziu o fechamento.</em>`
        : `<b>Cobertura: ${porcento(cobertos / total)}</b> <em>— ${milhares(
            total - cobertos
          )} sorteios ficaram de fora. O primeiro deles: ${falha.join(' ')}.</em>`;

    lotPintarEconomia();

    // E agora o motor, para tentar superar o que o banco entregou.
    const configuracao = {
      universo: lotinha.UNIVERSO,
      pool: dezenas,
      cartela: lotJogo,
      alvo: lotinha.SORTEIO,
      intersecao: lotinha.SORTEIO,
      orcamento: null,
      semente: Number($('semente').value) || 1,
    };
    // O fechamento vai duas vezes de propósito: como semente para o motor, e
    // como cartelas já na tela. Sem o segundo argumento, `comecar` zera a lista
    // exibida — e a aba Resultado ficaria vazia entre carregar o fechamento e o
    // motor devolver o primeiro estado, que é justamente quando o usuário vai
    // olhar.
    comecar({ configuracao, doMundo: lotFechamento }, lotFechamento);
  } catch (erro) {
    destino.innerHTML = `<b>Falhou:</b> ${escapar(String(erro?.message ?? erro))}`;
  }
});

$('lot-simular').addEventListener('click', () => {
  if (!lotFechamento) return;

  const numeros = ($('lot-resultado').value.match(/\d+/g) ?? []).map(Number);
  const destino = $('lot-simulacao');
  destino.hidden = false;

  if (numeros.length !== lotinha.SORTEIO) {
    destino.innerHTML = `<b>Digite exatamente 15 dezenas.</b> <em>Você digitou ${numeros.length}.</em>`;
    return;
  }

  const { distribuicao, premiados } = lotinha.simular(lotFechamento, numeros);
  const faixas = [...distribuicao.entries()].sort((a, b) => b[0] - a[0]);

  destino.innerHTML =
    (premiados.length
      ? `<b>${premiados.length} jogo${premiados.length > 1 ? 's' : ''} com 15 acertos.</b> ` +
        `<em>Jogo ${premiados.map((p) => p.indice).join(', ')}.</em>`
      : `<b>Nenhum jogo com 15.</b> <em>Nesta modalidade só 15 paga — as faixas ` +
        `abaixo mostram o quão perto se chegou, não prêmio.</em>`) +
    '<div class="faixas">' +
    faixas
      .map(([acertos, quantos]) => `<span><b>${quantos}</b> com ${acertos}</span>`)
      .join('') +
    '</div>';
});

/* ─────────── a biblioteca de coberturas do mundo ─────────── */

async function pintarBiblioteca() {
  const { designs, blocos } = await biblioteca.resumo();
  $('resumo-biblioteca').innerHTML = designs
    ? `<b>${milhares(designs)}</b> coberturas guardadas neste aparelho ` +
      `<em>— ${milhares(blocos)} cartelas prontas, disponíveis sem internet.</em>`
    : 'nenhuma cobertura guardada ainda';
  $('limpar-biblioteca').hidden = designs === 0;
}

$('importar-biblioteca').addEventListener('click', () => $('arquivo-biblioteca').click());

$('arquivo-biblioteca').addEventListener('change', async (evento) => {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;

  const erro = $('erro-biblioteca');
  erro.hidden = true;
  $('biblioteca').open = true;

  try {
    $('resumo-biblioteca').textContent = 'lendo o arquivo…';
    const texto = await arquivo.text();

    // Guardar dezenas de megabytes leva segundos, e sem notícia disso a tela
    // parece travada — o mesmo defeito que já apareceu na busca.
    const guardados = await biblioteca.importar(texto, (feitos, total) => {
      $('resumo-biblioteca').textContent = `guardando ${milhares(feitos)} de ${milhares(total)}…`;
    });

    await biblioteca.pedirPersistencia();
    await pintarBiblioteca();
    avisar(`${milhares(guardados)} coberturas do mundo guardadas no aparelho.`, true);
  } catch (falha) {
    erro.hidden = false;
    erro.textContent = String(falha?.message ?? falha);
    await pintarBiblioteca();
  }
});

$('limpar-biblioteca').addEventListener('click', async () => {
  await biblioteca.limpar();
  await pintarBiblioteca();
  avisar('Biblioteca apagada.', true);
});

pintarBiblioteca();
lotMontar();

/* ─────────── importar um fechamento pronto ─────────── */

$('escolher-arquivo').addEventListener('click', () => $('arquivo-fechamento').click());

$('arquivo-fechamento').addEventListener('change', async (evento) => {
  const arquivo = evento.target.files?.[0];
  if (!arquivo) return;
  try {
    $('texto-fechamento').value = await arquivo.text();
    mostrarErroDoFechamento(null);
    $('importar').open = true;
  } catch {
    mostrarErroDoFechamento('Não consegui ler esse arquivo.');
  }
  // Permite escolher o mesmo arquivo de novo depois de editá-lo.
  evento.target.value = '';
});

$('limpar-fechamento').addEventListener('click', () => {
  $('texto-fechamento').value = '';
  mostrarErroDoFechamento(null);
});

$('texto-fechamento').addEventListener('input', () => mostrarErroDoFechamento(null));

/**
 * Mostra o erro do fechamento onde ele foi digitado.
 *
 * A mensagem do motor cita a linha ("linha 7: ..."), e o aviso flutuante some
 * sozinho — cedo demais para quem precisa procurar essa linha numa colagem de
 * trinta. Por isso ela fica fixa junto da caixa de texto.
 */
/**
 * Reconhece as mensagens que o interpretador de fechamento produz.
 *
 * São as únicas que o usuário conserta editando o texto colado; qualquer outra
 * falha do motor é problema de configuração ou de memória, e mandá-lo mexer nas
 * cartelas seria apontar para o lugar errado.
 */
function ehErroDeFechamento(mensagem) {
  return /^(linha \d+|cartela \d+|nenhuma cartela)/.test(String(mensagem ?? ''));
}

function mostrarErroDoFechamento(mensagem) {
  const destino = $('erro-fechamento');
  destino.hidden = !mensagem;
  destino.textContent = mensagem ?? '';
  if (mensagem) $('importar').open = true;
}

$('ir-para-historico').addEventListener('click', () => mostrarPainel('historico'));

/**
 * Retoma um trabalho do histórico exatamente de onde parou.
 *
 * A sessão continua sendo a mesma: o motor recebe a solução já alcançada e a
 * contagem de iterações anterior, e cada melhoria daqui em diante atualiza
 * aquele mesmo registro. É o que diferencia continuar um trabalho de começar
 * outro parecido.
 */
function continuarSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) {
    avisar('Esse trabalho não está mais no histórico.');
    pintarHistorico();
    return;
  }

  comecar(
    {
      configuracao: sessao.configuracao,
      salvo: historico.paraRetomada(sessao),
      sessaoId: sessao.id,
    },
    sessao.melhor
  );
}

/**
 * Dá a partida, mostrando a tela de busca **antes** de qualquer trabalho
 * pesado.
 *
 * A ordem importa mais do que parece. Criar o worker e instanciar o
 * WebAssembly leva de centenas de milissegundos a alguns segundos num celular.
 * Trocar de tela só ao fim disso deixava o toque no botão sem resposta
 * nenhuma — o usuário tocava e nada acontecia, o que parece um aplicativo
 * quebrado. Trocando primeiro, o carregamento acontece com o relógio correndo
 * e o ponto pulsando à vista.
 */
function comecar(
  { configuracao, salvo, fechamento = null, doMundo = null, sessaoId = null },
  cartelasIniciais = []
) {
  // Um motor antigo ainda vivo continuaria consumindo processador e memória.
  desmontarTrabalhador();

  recordes = [];
  melhorCartelas = cartelasIniciais;
  configuracaoDaBusca = configuracao;
  // Continuar um trabalho escreve na sessão dele; começar do zero abre outra
  // quando a primeira solução aparecer.
  sessaoAtual = sessaoId;
  pintarRecordes();
  pintarCartelas();

  ['melhor-cartelas', 'limite-inferior', 'gap', 'cobertura'].forEach((id) => {
    $(id).textContent = '—';
  });
  ['atual-cartelas', 'atual-descobertos', 'meta', 'elites', 'iteracoes', 'velocidade', 'recordes']
    .forEach((id) => {
      $(id).textContent = '—';
    });
  $('selo-otimo').hidden = true;
  $('selo-recorde').hidden = true;
  $('res-selo-otimo').hidden = true;
  $('res-selo-recorde').hidden = true;
  $('referencia-busca').hidden = true;
  $('referencia-resultado').hidden = true;

  zerarCronometro();
  mostrarPainel('buscar');
  definirFase('carregando');

  garantirTrabalhador().postMessage({ tipo: 'criar', configuracao, salvo, fechamento, doMundo });
  segurarTelaLigada();
}

$('pausar').addEventListener('click', () => {
  if (!trabalhador) return;

  if (fase === 'buscando') {
    trabalhador.postMessage({ tipo: 'pausar' });
    soltarTelaLigada();
  } else if (fase === 'pausado') {
    trabalhador.postMessage({ tipo: 'rodar' });
    definirFase('buscando');
    segurarTelaLigada();
  }
});

$('encerrar').addEventListener('click', () => {
  if (!trabalhador) {
    definirFase('ocioso');
    mostrarPainel('configurar');
    return;
  }
  // O worker devolve o estado final e libera a memória; a resposta 'encerrado'
  // é quem desmonta tudo e traz o usuário de volta à configuração.
  definirFase('ocioso', 'encerrando…');
  trabalhador.postMessage({ tipo: 'encerrar' });
});

$('copiar').addEventListener('click', async () => {
  if (!melhorCartelas.length) return avisar('Nenhuma solução para copiar ainda.');
  try {
    await navigator.clipboard.writeText(textoDoFechamento());
    avisar('Cartelas copiadas.', true);
  } catch {
    avisar('O navegador não deixou copiar. Segure o dedo sobre as cartelas para selecionar.');
  }
});

$('compartilhar').addEventListener('click', async () => {
  if (!melhorCartelas.length) return avisar('Nenhuma solução para compartilhar ainda.');

  const texto = textoDoFechamento();
  // `navigator.share` abre a folha nativa do iOS — o caminho para mandar por
  // mensagem, salvar em Arquivos ou imprimir.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Fechamento — Sonho Lúcido', text: texto });
    } catch {
      /* o usuário cancelou */
    }
  } else {
    await navigator.clipboard.writeText(texto);
    avisar('Compartilhamento indisponível aqui; as cartelas foram copiadas.', true);
  }
});

function textoDoFechamento() {
  // A configuração da busca em curso, e não o que está no formulário: a
  // tela Configurar pode ter sido editada durante a busca, e a ferramenta
  // 18 de 25 nem passa por ela. O cabeçalho tem de descrever o que produziu
  // estas cartelas.
  const c = configuracaoDaBusca ?? lerConfiguracao();
  const cabecalho =
    `# Sonho Lúcido — ${melhorCartelas.length} cartelas\n` +
    `# universo ${c.universo}, pool ${c.pool.length}, ${c.cartela} por cartela\n`;
  const corpo = melhorCartelas
    .map((cartela) => cartela.map((n) => String(n).padStart(2, '0')).join(' '))
    .join('\n');
  return `${cabecalho}${corpo}\n`;
}

/* ─────────── a tela do histórico ─────────── */

/**
 * Desenha a lista de trabalhos salvos.
 *
 * A quantidade de cartelas vem grande e primeiro porque é por ela que o usuário
 * reconhece o trabalho. A configuração e a data ficam logo abaixo, para separar
 * buscas parecidas — sem elas, dois trabalhos com o mesmo número de cartelas
 * ficariam indistinguíveis.
 */
function pintarHistorico() {
  const sessoes = historico.listar();
  const destino = $('lista-historico');
  $('limpar-historico').hidden = sessoes.length === 0;
  atualizarAtalhoDoHistorico(sessoes.length);

  if (!sessoes.length) {
    destino.innerHTML =
      '<p class="historico-vazio">Nenhum trabalho salvo ainda.<br>' +
      'Toda busca que você iniciar aparece aqui automaticamente.</p>';
    return;
  }

  destino.innerHTML = sessoes.map(cartaoDaSessao).join('');

  destino.querySelectorAll('[data-acao]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const { acao, id } = botao.dataset;
      if (acao === 'continuar') continuarSessao(id);
      else if (acao === 'ver') verSessao(id);
      else if (acao === 'excluir') excluirSessao(id);
    });
  });
}

function cartaoDaSessao(sessao) {
  const avaliacao = sessao.avaliacao ?? {};
  const emAndamento = sessao.id === sessaoAtual;

  const marca = avaliacao.otimo
    ? '<span class="sessao-marca otima">★ ótimo provado</span>'
    : emAndamento
      ? '<span class="sessao-marca viva">em andamento</span>'
      : avaliacao.limiteInferior
        ? `<span class="sessao-marca">mínimo ${avaliacao.limiteInferior}</span>`
        : '';

  const cobertura =
    typeof avaliacao.cobertura === 'number' ? ` · cobertura ${porcento(avaliacao.cobertura)}` : '';

  return `
    <div class="sessao${emAndamento ? ' em-andamento' : ''}">
      <div class="sessao-topo">
        <span class="sessao-quantia">${avaliacao.cartelas ?? sessao.melhor.length}</span>
        <span class="sessao-unidade">cartelas</span>
        ${marca}
      </div>
      <div class="sessao-config">
        ${escapar(historico.descrever(sessao.configuracao))}<br>
        ${historico.quando(sessao.atualizadaEm)} ·
        ${milhares(sessao.iteracoes ?? 0)} iterações${cobertura}
      </div>
      <div class="sessao-acoes">
        <button class="continuar" data-acao="continuar" data-id="${sessao.id}">Continuar</button>
        <button data-acao="ver" data-id="${sessao.id}">Ver cartelas</button>
        <button class="excluir" data-acao="excluir" data-id="${sessao.id}"
                aria-label="Excluir este trabalho">✕</button>
      </div>
    </div>`;
}

/** Impede que um valor gravado acabe interpretado como marcação. */
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function verSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;

  melhorCartelas = sessao.melhor;
  pintarCartelas();

  const avaliacao = sessao.avaliacao ?? {};
  $('res-cartelas').textContent = avaliacao.cartelas ?? sessao.melhor.length;
  $('res-cobertura').textContent =
    typeof avaliacao.cobertura === 'number' ? porcento(avaliacao.cobertura) : '—';
  $('res-redundancia').textContent =
    typeof avaliacao.redundancia === 'number' ? milhares(avaliacao.redundancia) : '—';

  mostrarPainel('resultado');
}

function excluirSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;

  const quantas = sessao.avaliacao?.cartelas ?? sessao.melhor.length;
  if (!confirm(`Excluir este trabalho de ${quantas} cartelas? Não dá para desfazer.`)) return;

  historico.remover(id);
  if (sessaoAtual === id) sessaoAtual = null;
  pintarHistorico();
  avisar('Trabalho excluído.', true);
}

$('limpar-historico').addEventListener('click', () => {
  const total = historico.quantidade();
  if (!total) return;
  if (!confirm(`Apagar todos os ${total} trabalhos do histórico? Não dá para desfazer.`)) return;

  historico.limpar();
  sessaoAtual = null;
  pintarHistorico();
  avisar('Histórico apagado.', true);
});

/** Mostra o atalho da tela inicial só quando há o que continuar. */
function atualizarAtalhoDoHistorico(total = historico.quantidade()) {
  $('ir-para-historico').hidden = total === 0;
}

/* ─────────── manter a tela ligada ─────────── */

/*
 * Quando a tela do iPhone apaga, o Safari congela a página e a busca para.
 * A API de Wake Lock (Safari 16.4 em diante) evita isso enquanto o usuário
 * quiser. O sistema solta a trava sozinho se a aba sair de foco, então é
 * preciso repedi-la ao voltar.
 */
async function segurarTelaLigada() {
  if (!$('manter-tela').checked || !('wakeLock' in navigator)) return;
  try {
    travaDeTela = await navigator.wakeLock.request('screen');
  } catch {
    /* o sistema pode recusar, por exemplo com bateria baixa */
  }
}

function soltarTelaLigada() {
  travaDeTela?.release?.();
  travaDeTela = null;
}

$('manter-tela').addEventListener('change', () => {
  if ($('manter-tela').checked && fase === 'buscando') segurarTelaLigada();
  else soltarTelaLigada();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && fase === 'buscando') segurarTelaLigada();
});

if (!('wakeLock' in navigator)) {
  $('manter-tela').disabled = true;
  $('aviso-tela').textContent =
    'Este navegador não permite manter a tela ligada. A busca pausa quando a tela apaga e continua quando você volta — o progresso fica salvo.';
}

/* ─────────── avisos ─────────── */

let tempoDoAviso = null;

function avisar(mensagem, bom = false) {
  const caixa = $('aviso');
  caixa.textContent = mensagem;
  caixa.classList.toggle('bom', bom);
  caixa.hidden = false;
  clearTimeout(tempoDoAviso);
  tempoDoAviso = setTimeout(() => (caixa.hidden = true), 5000);
}

/* ─────────── partida ─────────── */

atualizarPrevisao();
pintarRecordes();
definirFase('ocioso');

// Traz a busca única da versão anterior para dentro do histórico, para quem
// já usava o aplicativo não perder o trabalho em andamento na atualização.
historico.migrarDaVersaoAntiga();
pintarHistorico();

/* ─────────── atualização do aplicativo ─────────── */

/*
 * O service worker faz o aplicativo abrir sem internet — e, mal configurado,
 * faz o usuário ficar preso numa versão antiga para sempre. Foi o que
 * aconteceu: uma correção era publicada, chegava ao servidor, e o aparelho
 * continuava servindo a cópia guardada, sem sinal nenhum de que havia algo
 * novo.
 *
 * Três medidas fecham essa porta, e nenhuma depende de o usuário fazer nada:
 *
 * - `updateViaCache: 'none'` impede que o próprio `sw.js` venha do cache do
 *   navegador. Se ele viesse, a atualização nunca seria percebida.
 * - `update()` a cada abertura força a verificação, em vez de esperar a
 *   heurística do navegador.
 * - Quando a versão nova assume o controle, a página recarrega uma vez
 *   sozinha. Sem isso, o usuário veria o código antigo até fechar e abrir de
 *   novo por conta própria — e não teria como saber que precisava.
 */
if ('serviceWorker' in navigator) {
  // Guardado antes de qualquer registro: numa primeira visita não existe
  // controlador, e a tomada de controle inicial não deve provocar recarga.
  const jaEraControlada = Boolean(navigator.serviceWorker.controller);
  let recarregando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaEraControlada || recarregando) return;
    recarregando = true;
    location.reload();
  });

  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.tipo === 'versao') mostrarVersao(data.versao);
  });

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registro) => {
      registro.update().catch(() => {});
      perguntarVersao();
    })
    .catch(() => {});

  // A versão é perguntada de novo a cada troca de controlador, para o número
  // na tela acompanhar a atualização em vez de ficar mostrando a anterior.
  navigator.serviceWorker.addEventListener('controllerchange', perguntarVersao);
} else {
  mostrarVersao(null);
}

/**
 * Pergunta ao service worker em que versão ele está.
 *
 * Espera por `ready` de propósito: numa primeira visita ainda não existe
 * controlador, e perguntar naquele instante seria falar com ninguém — o número
 * simplesmente nunca apareceria. `ready` resolve quando há um service worker
 * ativo, controlando esta página ou não.
 */
async function perguntarVersao() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registro = await navigator.serviceWorker.ready;
    (navigator.serviceWorker.controller ?? registro.active)?.postMessage({ tipo: 'versao' });
  } catch {
    /* sem service worker: a versão fica em branco, e nada mais é afetado */
  }
}

/**
 * Mostra qual versão está de fato rodando no aparelho.
 *
 * Serve para responder, sem adivinhação, à pergunta "a correção chegou aqui?".
 * Sem esse número, a única forma de saber era comparar comportamentos — que é
 * exatamente o que falha quando o cache serve código velho.
 */
function mostrarVersao(versao) {
  const destino = $('versao');
  if (!destino) return;
  destino.textContent = versao ? `versão ${versao.replace('sonho-lucido-', '')}` : '';
}
