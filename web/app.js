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
 *
 * Repare que não há estado final. A busca não termina sozinha — nem ao provar
 * que encontrou o melhor possível. Quem a encerra é o usuário, em `pausar` ou
 * em `encerrar`; até lá o motor continua procurando.
 */

import * as historico from './historico.js';
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

/*
 * O que se sabe sobre o mínimo deste problema, quando o motor não sabe.
 *
 * O motor conhece a tabela mundial de coberturas, que vai até grupos de 8
 * números. A Lotinha trabalha com grupos de 15, muito fora dela — então ali o
 * motor não tem referência nenhuma, e o limite inferior que ele calcula é
 * fraco: a cota de contagem dá 6 onde o mínimo real, pelo teorema de Turán, é
 * 16. Sem isto a tela dizia "sem referência publicada" e deixava o usuário sem
 * saber se ainda havia o que procurar — a pergunta mais importante agora que a
 * busca não termina sozinha.
 *
 * Vem de `lotinha.minimo()`: `{ jogos, exato, piso }`.
 */
let referenciaDaBusca = null;

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

/* ─────────── situação e relógio ─────────── */

const SITUACOES = {
  ocioso: { classe: '', texto: 'parado' },
  carregando: { classe: 'trabalhando', texto: 'carregando o motor…' },
  preparando: { classe: 'trabalhando', texto: 'montando a primeira solução…' },
  buscando: { classe: 'trabalhando', texto: 'procurando soluções melhores' },
  pausado: { classe: 'pausada', texto: 'pausado' },
  falhou: { classe: 'falhou', texto: 'algo deu errado' },
};

/*
 * Não existe uma situação "concluída", e a ausência é a mudança.
 *
 * Havia: ao alcançar o limite inferior provado, a tela anunciava "ótimo
 * provado — não há melhor" e desabilitava o Pausar. Do lado de quem usa, o
 * aplicativo simplesmente parava — sem ter sido mandado parar.
 *
 * A optimalidade provada continua sendo anunciada, no selo e no texto da
 * situação. O que ela não faz mais é decidir. Enquanto o motor estiver vivo,
 * ele está em `buscando`, e o botão de parar é do usuário.
 */

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
  $('pausar').disabled = ['ocioso', 'carregando', 'preparando', 'falhou'].includes(nova);
}

/**
 * Verdadeiro quando não existe fechamento menor que o já encontrado.
 *
 * Duas fontes, e a ordem entre elas importa.
 *
 * O motor prova a optimalidade comparando o recorde com o limite inferior que
 * ele calcula. Nos dezoito fechamentos da Lotinha de mínimo comprovado isso
 * basta — medindo, a cota de Schönheim coincide exatamente com o mínimo de
 * Turán: 16 para C(18,17,15), 51 para C(19,17,15), 40 para C(20,18,15). Mas
 * é coincidência, e a tela não deve depender de coincidência: quando o mínimo
 * é conhecido pelo teorema, é o teorema que responde.
 *
 * Nos dez casos em aberto não há mínimo conhecido, e aí só resta o motor. Se
 * ele um dia alcançar o próprio limite inferior ali, terá provado algo que
 * ninguém provou — e o selo acende com razão.
 */
function noMinimoComprovado(estado) {
  const nossas = estado.melhor_cartelas;
  if (referenciaDaBusca?.exato) return nossas > 0 && nossas <= referenciaDaBusca.jogos;
  return Boolean(estado.optimalidade_provada);
}

/**
 * O que a faixa de situação diz enquanto o motor trabalha.
 *
 * Quando o mínimo já foi alcançado, a frase muda mas o motor não para. Dizer
 * "procurando algo menor que 16" num fechamento em que 16 é comprovadamente o
 * menor seria mentir sobre o que está acontecendo — e é justamente a
 * informação de que o usuário precisa para decidir quando desligar.
 */
function textoDaProcura(estado) {
  const n = estado.melhor_cartelas;
  return noMinimoComprovado(estado)
    ? `${n} é o mínimo comprovado — o motor segue até você mandar parar`
    : `procurando algo menor que ${n}`;
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
        // Sem ramo alternativo: existe primeira solução, então há busca a
        // fazer. Mesmo quando essa primeira solução já é comprovadamente a
        // melhor possível, quem decide encerrar é o usuário.
        trabalhador.postMessage({ tipo: 'rodar' });
        definirFase('buscando');
        break;

      case 'estado':
        aplicarMensagem(data);
        if (fase === 'buscando') $('texto-situacao').textContent = textoDaProcura(data.estado);
        break;

      case 'pausado':
        aplicarMensagem(data);
        definirFase('pausado');
        break;

      // O usuário mandou encerrar. O worker já devolveu tudo e liberou a
      // memória; aqui só resta desmontá-lo e voltar à Lotinha.
      case 'encerrado':
        aplicarMensagem(data);
        desmontarTrabalhador();
        definirFase('ocioso');
        zerarCronometro();
        soltarTelaLigada();
        atualizarAtalhoDoHistorico();
        mostrarPainel('lotinha');
        avisar('Busca encerrada. O resultado ficou salvo.', true);
        break;

      case 'erro':
        definirFase('falhou', data.mensagem);
        soltarTelaLigada();
        avisar(data.mensagem);
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

  const noMinimo = noMinimoComprovado(estado);
  $('selo-otimo').hidden = !noMinimo;
  $('res-selo-otimo').hidden = !noMinimo;

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
  } else if (origem === 'fechamento do aplicativo') {
    const podadas = trazidas - (estado.melhor_cartelas || trazidas);
    texto =
      `Partiu do <b>fechamento que já vem no aplicativo</b> ` +
      (podadas > 0
        ? `<em>— ${milhares(trazidas)} jogos, dos quais ${milhares(podadas)} eram dispensáveis.</em>`
        : `<em>— ${milhares(trazidas)} jogos prontos, sem reconstruir nada.</em>`);
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

  // Quando a busca traz a própria referência, ela manda. É o caso da Lotinha:
  // a tabela mundial não alcança grupos de 15, e o que o motor diria ali é
  // "sem referência publicada" — verdadeiro e imprestável.
  if (referenciaDaBusca) {
    const texto = textoDaReferenciaDaBusca(estado);
    $('selo-recorde').hidden = true;
    $('res-selo-recorde').hidden = true;
    alvos.forEach((id) => {
      $(id).hidden = false;
      $(id).innerHTML = texto;
    });
    return;
  }

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

/**
 * A referência quando ela não vem da tabela mundial.
 *
 * Os dois casos dizem coisas opostas, e a diferença é o que o usuário precisa
 * para decidir se vale deixar o aparelho trabalhando:
 *
 * - **mínimo comprovado** — o teorema de Turán fecha a questão. O motor pode
 *   rodar a noite inteira que não vai achar menos. Dizer isso é o oposto de
 *   desanimar: é devolver a decisão a quem paga a bateria.
 * - **em aberto** — ninguém no mundo sabe o mínimo, e a única certeza é o
 *   piso. Aqui o motor não está redescobrindo nada; está procurando de fato.
 */
function textoDaReferenciaDaBusca(estado) {
  const { jogos, exato, piso } = referenciaDaBusca;
  const nossas = estado.melhor_cartelas || 0;

  // Jogo do tamanho do pool: aposta única, e não há fechamento a fazer. Creditar
  // Turán por isso seria invocar um teorema para dizer que um é um.
  if (jogos === 1) {
    return (
      `<b>Aposta única.</b> <em>Jogar todas as dezenas escolhidas de uma vez é ` +
      `um jogo só: não há fechamento, e nada que o motor possa reduzir. Para ` +
      `fechar, o jogo precisa ser menor que o pool.</em>`
    );
  }

  if (exato) {
    return (
      `Mínimo comprovado: <b>${milhares(jogos)}</b> jogos <em>— sai do ` +
      `teorema de Turán, e não existe fechamento menor. O motor continua ` +
      `procurando enquanto você deixar: ele não vai achar menos, e não vai ` +
      `parar sozinho.</em>`
    );
  }

  // Quanto o motor já cortou do fechamento que veio no aplicativo. É o único
  // placar honesto aqui: não existe recorde mundial de que se aproximar, mas
  // existe o número com que esta busca começou, e superá-lo é resultado de
  // verdade — é o que paga a bateria gasta.
  const trazidas = estado.cartelas_trazidas || 0;
  const cortou = trazidas > 0 && nossas > 0 && nossas < trazidas ? trazidas - nossas : 0;

  const onde = nossas > 0 ? `Você está com <b>${milhares(nossas)}</b>` : '';
  const placar = cortou
    ? `${onde}, contra os ${milhares(trazidas)} que vieram no aplicativo — o ` +
      `motor já cortou ${milhares(cortou)}. `
    : onde
      ? `${onde}. `
      : '';

  return (
    `Ninguém no mundo sabe o mínimo aqui <em>— é problema em aberto. O que se ` +
    `sabe é que não dá com menos de <b>${milhares(piso)}</b>. ${placar}É onde o ` +
    `motor tem trabalho de verdade, e onde deixá-lo rodando faz diferença.</em>`
  );
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
/* Quantos acertos garantir, e quantas cartelas precisam ganhar. Os padrões são
   a Lotinha como ela é jogada: as 15, numa cartela. */
let lotGarantia = lotinha.SORTEIO;
let lotPremiadas = 1;
let lotDezenas = new Set();
let lotFechamento = null;

/**
 * Esquece o fechamento carregado, porque ele deixou de ser o desta seleção.
 *
 * Sem isto, trocar a exigência depois de carregar mostrava números de duas
 * seleções diferentes ao mesmo tempo: a explicação dizia "17 jogos bastam" e a
 * economia continuava calculando em cima dos 16 que estavam na memória. Cada um
 * dos dois estava certo sobre uma pergunta diferente, e juntos mentiam.
 */
function lotEsquecerFechamento() {
  lotFechamento = null;
  $('lot-conferir').hidden = true;
  $('lot-conferencia').innerHTML =
    '<em>Ao carregar, cada sorteio possível dentro do seu pool é conferido um a ' +
    'um — sem consultar o motor que produziu o fechamento.</em>';
}

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
      lotEsquecerFechamento();
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

/**
 * Os botões de garantia e de cartelas premiadas.
 *
 * Refeitos a cada mudança de pool ou de tamanho de jogo porque o teto de
 * cartelas premiadas depende dos dois: num pool de 18 com jogos de 17, só três
 * jogos distintos podem conter um mesmo sorteio, e pedir a quarta obrigaria a
 * comprar jogo repetido.
 */
function lotMontarExigencias() {
  const alvoGarantia = $('lot-garantia');
  alvoGarantia.innerHTML = '';
  for (let g = lotinha.SORTEIO; g >= lotinha.MENOR_GARANTIA; g--) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(g);
    b.dataset.garantia = String(g);
    b.addEventListener('click', () => {
      lotGarantia = g;
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvoGarantia.appendChild(b);
  }

  // O limite dos botões é de tela, não de matemática: uma fileira de 252
  // botões não serve a ninguém. Dez cobre qualquer uso realista, e o teto
  // verdadeiro — quantos jogos distintos podem premiar juntos — aparece na
  // explicação quando ele é menor que isto.
  const teto = Math.min(lotinha.maximoPremiadas(lotPool, lotJogo, lotGarantia), 10);
  if (lotPremiadas > teto) lotPremiadas = teto;

  const alvoPremiadas = $('lot-premiadas');
  alvoPremiadas.innerHTML = '';
  for (let r = 1; r <= Math.max(teto, 1); r++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(r);
    b.dataset.premiadas = String(r);
    b.addEventListener('click', () => {
      lotPremiadas = r;
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvoPremiadas.appendChild(b);
  }

  document.querySelectorAll('#lot-garantia .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.garantia) === lotGarantia);
  });
  document.querySelectorAll('#lot-premiadas .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.premiadas) === lotPremiadas);
  });
}

/**
 * O que se sabe sobre o mínimo desta configuração, quando o motor não sabe.
 *
 * Derivada da configuração, e não passada à mão, para que continuar um trabalho
 * salvo do histórico recupere a mesma referência de quando ele começou — sem
 * isso, retomar uma busca a rebaixaria para "sem referência publicada".
 *
 * Devolve `null` fora da Lotinha, e aí a tela volta a usar a tabela mundial que
 * o motor carrega.
 */
function referenciaDe(configuracao) {
  const pool = configuracao?.pool?.length ?? 0;
  const garantia = configuracao?.intersecao ?? 0;
  const ehLotinha =
    configuracao?.universo === lotinha.UNIVERSO &&
    configuracao?.alvo === lotinha.SORTEIO &&
    garantia >= lotinha.MENOR_GARANTIA &&
    garantia <= lotinha.SORTEIO &&
    pool >= lotinha.MENOR_POOL &&
    pool <= lotinha.MAIOR_POOL &&
    configuracao.cartela >= lotinha.MENOR_POOL &&
    configuracao.cartela <= pool;

  return ehLotinha
    ? lotinha.minimo(pool, configuracao.cartela, garantia, configuracao.premiadas ?? 1)
    : null;
}

function lotAlternar(n) {
  lotEsquecerFechamento();
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
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvo.appendChild(b);
  }
  if (lotJogo > lotPool) lotJogo = lotPool;
  lotMontarExigencias();
  lotPintarExplicacao();
  lotPintarEconomia();
}

function lotPintarExplicacao() {
  document.querySelectorAll('#lot-jogo .opcao').forEach((b) => {
    b.classList.toggle('ativa', Number(b.dataset.jogo) === lotJogo);
  });

  const { jogos, exato, piso } = lotinha.minimo(lotPool, lotJogo, lotGarantia, lotPremiadas);
  const destino = $('lot-explicacao');
  const teto = lotinha.maximoPremiadas(lotPool, lotJogo, lotGarantia);

  // O que se está pedindo, em uma frase — antes de dizer quanto custa.
  const pedido =
    `Cada resultado possível dentro das suas ${lotPool} dezenas vai cair em ` +
    (lotPremiadas === 1 ? 'uma cartela' : `<b>${lotPremiadas}</b> cartelas`) +
    ` com ao menos <b>${lotGarantia}</b> acerto${lotGarantia === 1 ? '' : 's'}.`;

  // O aviso que o usuário não tem como deduzir sozinho.
  const aviso =
    lotGarantia === lotinha.SORTEIO && lotPremiadas >= teto && teto > 1
      ? ` <em>Este é o máximo: só ${teto} jogos distintos podem conter um mesmo ` +
        `sorteio, então pedir mais obrigaria a comprar jogo repetido.</em>`
      : '';

  if (lotJogo === lotPool) {
    destino.innerHTML =
      `<b>Um jogo só.</b> <em>Jogar as ${lotPool} dezenas de uma vez é uma aposta ` +
      `única: ou as 15 caem dentro, ou não. Não há fechamento a fazer — para ` +
      `fechar, o jogo precisa ser menor que o pool.</em>`;
  } else if (exato) {
    const porque =
      lotPool - lotJogo === 1
        ? `São sempre ${lotinha.SORTEIO} + ${lotPremiadas} quando o jogo tem uma dezena a ` +
          `menos que o pool, seja qual for o pool.`
        : 'Vem do teorema de Turán.';
    destino.innerHTML =
      `${pedido} <b>${milhares(jogos)} jogos</b> bastam. <em>Este número é o ` +
      `mínimo comprovado — não existe fechamento menor. ${porque}</em>${aviso}`;
  } else {
    destino.innerHTML =
      `${pedido} <b>Mínimo desconhecido.</b> <em>Ninguém no mundo sabe quantos ` +
      `jogos bastam aqui — é problema em aberto. O que se sabe é que não dá com ` +
      `menos de <b>${milhares(piso)}</b>. O motor procura, e só para quando você ` +
      `mandar.</em>${aviso}`;
  }
}

/**
 * Como descrever a quantidade de jogos, dizendo de onde ela veio.
 *
 * Chamar o piso de "custo" seria prometer um preço que não existe: em 25
 * dezenas com jogos de 20, o piso conhecido é 211 e o melhor fechamento que o
 * motor encontra passa de mil. O número continua útil — é o que a matemática
 * garante que ninguém vai bater — mas precisa vir rotulado.
 */
function textoDaQuantidade(quantidade, ehPiso) {
  const plural = quantidade === 1 ? 'jogo' : 'jogos';
  return ehPiso
    ? `no mínimo ${milhares(quantidade)} ${plural} — o piso conhecido`
    : `${milhares(quantidade)} ${plural}`;
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
  const { jogos, piso } = lotinha.minimo(lotPool, lotJogo, lotGarantia, lotPremiadas);
  const quantidade = lotFechamento?.length ?? jogos ?? piso;

  // De onde veio o número, porque a diferença muda o que a conta significa.
  // Com o fechamento na mão ou com o mínimo comprovado, é o custo de verdade.
  // Com o piso, é o **mínimo concebível** — o fechamento real costuma ser bem
  // maior, e apresentar o piso como preço seria prometer barato.
  const ehPiso = !lotFechamento && jogos === null;

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
    garantia: lotGarantia,
    premiadas: lotPremiadas,
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

  // Garantir menos de 15 não compra prêmio nenhum nesta modalidade: a Lotinha
  // paga o jogo que contém as 15, e só ele. Prometer um piso de prêmio aqui
  // seria a mentira mais cara que esta tela poderia contar.
  if (!e.garantePremio) {
    destino.innerHTML =
      `<div class="linha-economia"><span>Custo do fechamento</span>` +
      `<b>${dinheiro(e.custo)}</b> <em>${textoDaQuantidade(quantidade, ehPiso)}</em></div>` +

      `<div class="linha-economia perde"><span>Prêmio garantido nesta modalidade</span>` +
      `<b>nenhum</b></div>` +

      `<div class="linha-economia total"><span>Retorno esperado</span>` +
      `<b>${dinheiro(e.retornoEsperado)}</b> <em>por real apostado</em></div>` +

      `<p class="ajuda">Você escolheu garantir <b>${lotGarantia} acertos</b>, e a ` +
      `Lotinha só paga quem acerta os <b>15</b>. Um fechamento para ${lotGarantia} ` +
      `não garante prêmio nenhum aqui — ele faz sentido na Lotofácil, que premia ` +
      `a partir de 11. O retorno esperado acima continua valendo, porque ele ` +
      `depende de cada jogo conter as 15, não da garantia escolhida.</p>`;
    return;
  }

  const lucro = e.premioMinimo - e.custo;
  const quantasGanham =
    e.premiadas === 1 ? 'uma cartela premiada' : `<b>${e.premiadas}</b> cartelas premiadas`;
  destino.innerHTML =
    `<div class="linha-economia"><span>Custo do fechamento</span>` +
    `<b>${dinheiro(e.custo)}</b> <em>${textoDaQuantidade(quantidade, ehPiso)}</em></div>` +

    `<div class="linha-economia ganha"><span>Se o sorteio cair no seu pool ` +
    `<em>(1 em ${milhares(1 / e.chanceDoPool)})</em></span>` +
    `<b>${dinheiro(e.premioMinimo)}</b> no mínimo <em>(${quantasGanham})</em>, ` +
    `<em>${dinheiro(e.premioMedioQuandoGanha)} em média — saldo ` +
    `${lucro >= 0 ? '+' : ''}${dinheiro(lucro)}</em></div>` +

    `<div class="linha-economia perde"><span>Se não cair ` +
    `<em>(${porcento(e.chanceDePerder)} das vezes)</em></span>` +
    `<b>−${dinheiro(e.perdaQuandoPerde)}</b> <em>nada volta</em></div>` +

    `<div class="linha-economia total"><span>Retorno esperado</span>` +
    `<b>${dinheiro(e.retornoEsperado)}</b> <em>por real apostado</em></div>` +

    `<p class="ajuda">O retorno esperado é fixo por jogo e apenas soma: ` +
    `<b>nenhum arranjo de fechamento o altera</b> — nem exigir mais cartelas ` +
    `premiadas. Fechar muda quando você ganha, com que frequência e quanto de ` +
    `cada vez; nunca a média.</p>`;
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
  lotEsquecerFechamento();
  lotPintarTudo();
});

$('lot-sortear').addEventListener('click', () => {
  const todas = Array.from({ length: lotinha.UNIVERSO }, (_, i) => i + 1);
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  lotDezenas = new Set(todas.slice(0, lotPool).sort((a, b) => a - b));
  lotEsquecerFechamento();
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
    // O banco só guarda o caso padrão: garantir as 15 numa cartela. As outras
    // exigências multiplicam o espaço muito além do que caberia num aplicativo
    // — e nelas o motor parte do próprio guloso, que é o que ele faz de melhor.
    const doBanco =
      lotGarantia === lotinha.SORTEIO && lotPremiadas === 1
        ? await lotinha.fechamentoPara(lotPool, lotJogo, dezenas)
        : null;

    lotFechamento = doBanco;

    if (doBanco) {
      destino.textContent = `conferindo ${milhares(
        lotinha.combinacoes(lotPool, lotinha.SORTEIO)
      )} sorteios, um a um…`;

      // Cede um quadro à tela antes da conferência, que pode levar segundos
      // nos pools grandes — sem isto a mensagem acima nunca apareceria.
      await new Promise((r) => setTimeout(r, 0));
      lotPintarConferencia(dezenas, doBanco);
    } else {
      destino.innerHTML =
        `<b>Sem fechamento pronto para esta combinação.</b> <em>O motor vai ` +
        `construir um do zero. Quando houver solução na tela, o botão abaixo ` +
        `confere sorteio a sorteio o que ele encontrou.</em>`;
    }
    $('lot-conferir').hidden = false;

    lotPintarEconomia();

    // E agora o motor: para superar o que o banco entregou, ou para construir
    // o que ele não tinha.
    const configuracao = {
      universo: lotinha.UNIVERSO,
      pool: dezenas,
      cartela: lotJogo,
      alvo: lotinha.SORTEIO,
      intersecao: lotGarantia,
      premiadas: lotPremiadas,
      orcamento: null,
      semente: Number($('semente').value) || 1,
    };
    // Quando há fechamento do banco, ele vai duas vezes de propósito: como
    // semente para o motor, e como cartelas já na tela. Sem o segundo
    // argumento, `comecar` zera a lista exibida — e a aba Resultado ficaria
    // vazia entre carregar e o motor devolver o primeiro estado, que é
    // justamente quando o usuário vai olhar.
    comecar({ configuracao, doBanco }, doBanco ?? []);
  } catch (erro) {
    destino.innerHTML = `<b>Falhou:</b> ${escapar(String(erro?.message ?? erro))}`;
  }
});

/**
 * A conferência independente, escrita na tela.
 *
 * Confere as duas exigências e não só a cobertura: cada sorteio precisa cair em
 * `lotPremiadas` jogos com ao menos `lotGarantia` acertos. Um fechamento que
 * prometa duas cartelas premiadas e entregue uma passaria batido numa
 * conferência que só perguntasse "alguém cobre?".
 */
function lotPintarConferencia(dezenas, jogos) {
  const destino = $('lot-conferencia');
  const { total, cobertos, falha, minimoPremiadas } = lotinha.conferirCobertura(
    dezenas,
    jogos,
    lotGarantia,
    lotPremiadas
  );

  const oQue =
    `${lotPremiadas === 1 ? 'uma cartela' : `${lotPremiadas} cartelas`} com ` +
    `${lotGarantia} acerto${lotGarantia === 1 ? '' : 's'}`;

  if (cobertos === total) {
    destino.innerHTML =
      `<b>Garantia comprovada: 100%</b> <em>— ${milhares(total)} sorteios ` +
      `conferidos um a um, e em todos você fica com ${oQue}, usando ` +
      `${milhares(jogos.length)} jogos. A conferência não consultou o motor que ` +
      `produziu o fechamento.</em>` +
      (minimoPremiadas > lotPremiadas
        ? ` <em>No pior caso são ${minimoPremiadas} cartelas, não ${lotPremiadas}.</em>`
        : '');
    return;
  }

  destino.innerHTML =
    `<b>Garantia cumprida em ${porcento(cobertos / total)}</b> <em>— ${milhares(
      total - cobertos
    )} sorteios ficam abaixo de ${oQue}. O primeiro deles: ${falha.join(' ')}. ` +
    `Isto é o motor ainda trabalhando, não um fechamento pronto e furado.</em>`;
}

$('lot-conferir').addEventListener('click', async () => {
  if (lotDezenas.size !== lotPool) return;
  const dezenas = [...lotDezenas].sort((a, b) => a - b);
  const jogos = melhorCartelas;

  if (!jogos.length) {
    $('lot-conferencia').innerHTML = '<b>Ainda não há solução na tela para conferir.</b>';
    return;
  }

  $('lot-conferencia').textContent = `conferindo ${milhares(
    lotinha.combinacoes(lotPool, lotinha.SORTEIO)
  )} sorteios, um a um…`;
  await new Promise((r) => setTimeout(r, 0));
  lotFechamento = jogos;
  lotPintarConferencia(dezenas, jogos);
  lotPintarEconomia();
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

  const { distribuicao, comQuinze } = lotinha.simular(lotFechamento, numeros, lotGarantia);
  const faixas = [...distribuicao.entries()].sort((a, b) => b[0] - a[0]);

  destino.innerHTML =
    (comQuinze.length
      ? `<b>${comQuinze.length} jogo${comQuinze.length > 1 ? 's' : ''} com 15 acertos.</b> ` +
        `<em>Jogo ${comQuinze.map((p) => p.indice).join(', ')}.</em>`
      : `<b>Nenhum jogo com 15.</b> <em>Nesta modalidade só 15 paga — as faixas ` +
        `abaixo mostram o quão perto se chegou, não prêmio.</em>`) +
    '<div class="faixas">' +
    faixas
      .map(([acertos, quantos]) => `<span><b>${quantos}</b> com ${acertos}</span>`)
      .join('') +
    '</div>';
});

lotMontar();

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
  { configuracao, salvo, fechamento = null, doBanco = null, sessaoId = null },
  cartelasIniciais = []
) {
  // Um motor antigo ainda vivo continuaria consumindo processador e memória.
  desmontarTrabalhador();

  recordes = [];
  melhorCartelas = cartelasIniciais;
  configuracaoDaBusca = configuracao;
  referenciaDaBusca = referenciaDe(configuracao);
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

  garantirTrabalhador().postMessage({ tipo: 'criar', configuracao, salvo, fechamento, doBanco });
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
    mostrarPainel('lotinha');
    return;
  }
  // O worker devolve o estado final e libera a memória; a resposta 'encerrado'
  // é quem desmonta tudo e traz o usuário de volta à Lotinha.
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
  // O cabeçalho descreve o que produziu estas cartelas. Sem busca em curso —
  // ao ver um trabalho antigo pelo histórico, por exemplo — não há o que
  // afirmar, e é melhor exportar sem cabeçalho do que inventar um.
  const c = configuracaoDaBusca;
  const cabecalho = c
    ? `# Sonho Lúcido — ${melhorCartelas.length} jogos de ${c.cartela} dezenas\n` +
      `# fechamento de ${c.pool.length} dezenas escolhidas entre ${c.universo}\n`
    : `# Sonho Lúcido — ${melhorCartelas.length} jogos\n`;
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
