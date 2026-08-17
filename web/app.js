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

/* ─────────── fechamento 18 de 25 ─────────── */

/*
 * Uma ferramenta fechada em torno de um cenário só.
 *
 * Todo o resto do aplicativo é deliberadamente geral: o motor não conhece
 * modalidade nenhuma, e a tela Configurar expõe os sete números que definem
 * qualquer problema. Isso é força, e também é o problema — para quem sempre
 * resolve o mesmo cenário, são sete oportunidades de errar, e um erro produz um
 * problema diferente do pretendido sem nenhum aviso, porque todos os valores
 * são configurações legítimas.
 *
 * Aqui os números do cenário são fixos, e a escolha que sobra é a que pertence
 * ao usuário: quais 18 números jogar, e qual garantia perseguir.
 *
 * ## A matemática que a tela precisa explicar
 *
 * Jogo e grupo vivem dentro dos mesmos 18 números, então qualquer jogo de `k`
 * números já acerta pelo menos `k + 15 − 18` de qualquer grupo de 15, sem
 * esforço nenhum. Um jogo de 15 sempre acerta 12; um de 18 sempre acerta os 15.
 *
 * Isso muda o que faz sentido pedir: garantir 12 com jogos de 15 é gratuito — um
 * jogo só — e garantir 15 exige os 816 grupos inteiros, porque só o próprio
 * grupo contém o grupo. O trabalho de verdade fica no meio, e a tela precisa
 * dizer isso, em vez de deixar alguém pedir o gratuito achando que otimizou.
 */

const UNIVERSO_18 = 25;
const ESCOLHER = 18;
const GRUPO = 15;

let escolhidos = new Set();
let tamanhoJogo = 15;
let acertosPedidos = 13;

function montarGrade25() {
  const grade = $('grade-25');
  grade.innerHTML = '';
  for (let n = 1; n <= UNIVERSO_18; n++) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'numero';
    botao.textContent = String(n).padStart(2, '0');
    botao.dataset.n = String(n);
    botao.addEventListener('click', () => alternarNumero(n));
    grade.appendChild(botao);
  }
  pintarSelecao18();
}

function alternarNumero(n) {
  if (escolhidos.has(n)) {
    escolhidos.delete(n);
  } else if (escolhidos.size < ESCOLHER) {
    escolhidos.add(n);
  } else {
    avisar(`Já são ${ESCOLHER} números. Desmarque um antes de trocar.`);
    return;
  }
  pintarSelecao18();
}

function pintarSelecao18() {
  document.querySelectorAll('#grade-25 .numero').forEach((b) => {
    b.classList.toggle('escolhido', escolhidos.has(Number(b.dataset.n)));
  });

  const faltam = ESCOLHER - escolhidos.size;
  $('contagem-18').innerHTML =
    faltam === 0
      ? `<b>18 de 18 escolhidos</b> <em>— ${milhares(
          combinacoes(ESCOLHER, GRUPO)
        )} grupos de ${GRUPO} a cobrir.</em>`
      : `<b>${escolhidos.size} de 18 escolhidos</b> <em>— ${
          faltam === 1 ? 'falta 1 número' : `faltam ${faltam} números`
        }.</em>`;

  $('iniciar-18').disabled = faltam !== 0;
}

/**
 * As opções de garantia que fazem sentido para o tamanho de jogo escolhido.
 *
 * Abaixo do mínimo automático não há o que pedir, e no topo está o caso em que
 * só o próprio grupo serve. Mostrar os dois extremos, dizendo o que cada um
 * custa, evita que alguém escolha o gratuito imaginando ter otimizado algo.
 */
function montarOpcoesDeAcerto() {
  const minimoAutomatico = tamanhoJogo + GRUPO - ESCOLHER;
  const destino = $('acertos-garantidos');
  destino.innerHTML = '';

  for (let acertos = minimoAutomatico; acertos <= GRUPO; acertos++) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'opcao';
    botao.textContent = String(acertos);
    botao.dataset.acertos = String(acertos);
    botao.addEventListener('click', () => {
      acertosPedidos = acertos;
      pintarOpcoesDeAcerto();
    });
    destino.appendChild(botao);
  }

  // Começa uma casa acima do gratuito, que é onde o motor tem trabalho a fazer.
  if (acertosPedidos <= minimoAutomatico || acertosPedidos > GRUPO) {
    acertosPedidos = Math.min(minimoAutomatico + 1, GRUPO);
  }
  pintarOpcoesDeAcerto();
}

function pintarOpcoesDeAcerto() {
  document.querySelectorAll('#acertos-garantidos .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.acertos) === acertosPedidos);
  });

  const minimoAutomatico = tamanhoJogo + GRUPO - ESCOLHER;
  const destino = $('explicacao-18');

  if (acertosPedidos <= minimoAutomatico) {
    destino.innerHTML =
      `<b>Um jogo só resolve.</b> <em>Como o jogo e o grupo saem dos mesmos 18 ` +
      `números, qualquer jogo de ${tamanhoJogo} já acerta ${minimoAutomatico} de ` +
      `qualquer grupo de 15. Não há o que otimizar aqui — suba a garantia para o ` +
      `motor ter trabalho.</em>`;
  } else if (acertosPedidos === GRUPO && tamanhoJogo === GRUPO) {
    destino.innerHTML =
      `<b>Exige os 816 jogos.</b> <em>Acertar os 15 de um grupo de 15 com um jogo ` +
      `de 15 só acontece quando o jogo é aquele grupo. Isso não é fechamento, é a ` +
      `lista inteira.</em>`;
  } else {
    destino.innerHTML =
      `Cada jogo de ${tamanhoJogo} já acerta <b>${minimoAutomatico}</b> de ` +
      `qualquer grupo, sem esforço. <em>Você está pedindo <b>${acertosPedidos}</b> ` +
      `— é aí que o motor trabalha.</em>`;
  }
}

document.querySelectorAll('#tamanho-jogo .opcao').forEach((botao) => {
  botao.addEventListener('click', () => {
    tamanhoJogo = Number(botao.dataset.k);
    document.querySelectorAll('#tamanho-jogo .opcao').forEach((b) => {
      b.classList.toggle('ativa', b === botao);
    });
    montarOpcoesDeAcerto();
  });
});

$('limpar-18').addEventListener('click', () => {
  escolhidos.clear();
  pintarSelecao18();
});

$('sortear-18').addEventListener('click', () => {
  const todos = Array.from({ length: UNIVERSO_18 }, (_, i) => i + 1);
  for (let i = todos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todos[i], todos[j]] = [todos[j], todos[i]];
  }
  escolhidos = new Set(todos.slice(0, ESCOLHER).sort((a, b) => a - b));
  pintarSelecao18();
});

$('iniciar-18').addEventListener('click', () => {
  if (escolhidos.size !== ESCOLHER) return;

  // O pool é a seleção do usuário, com os rótulos que ele marcou — não `1..18`.
  // O motor sempre aceitou pool esparso; é o que faz as cartelas saírem com os
  // números de verdade, prontos para apostar.
  const configuracao = {
    universo: UNIVERSO_18,
    pool: [...escolhidos].sort((a, b) => a - b),
    cartela: tamanhoJogo,
    alvo: GRUPO,
    intersecao: acertosPedidos,
    orcamento: null,
    semente: Number($('semente').value) || 1,
  };

  iniciarBusca(configuracao, null);
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
montarGrade25();
montarOpcoesDeAcerto();

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
