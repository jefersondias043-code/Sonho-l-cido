/*
 * O motor exato, como estágio da ferramenta única.
 *
 * Este arquivo era a tela inteira do "Construtor Matemático Exato". O que
 * sobrou dele é só o que nenhuma outra parte do aplicativo sabia fazer: medir o
 * pedido, **provar** o mínimo, escalar até ele, verificar o que saiu e
 * demonstrar que não há menor. A grade de números, os parâmetros, o dinheiro, a
 * conferência e o histórico saíram daqui porque a ferramenta unificada já os
 * tinha — mantê-los em dobro era manter duas versões da mesma coisa, com duas
 * chances de discordarem.
 *
 * Quem manda nele é `app.js`, por `resolver()`. O módulo guarda o próprio
 * estado, fala com o próprio trabalhador e pinta os próprios cartões; o que ele
 * não faz é decidir quando rodar, e essa é a única coisa que mudou de dono.
 */
import {
  combinacoes,
  escapar,
  maximoPremiadas,
  milhares,
  porcento,
} from './comum.js';
import {
  frase,
  folga,
  veredito,
  MINIMO,
  PARCIAL,
  FALHA,
  CONTRADICAO,
} from './exato-veredito.js';
import * as historico from './exato-historico.js';
import * as arquivoDeSessao from './exato-sessao.js';

const $ = (id) => document.getElementById(id);

const trabalhador = new Worker('./exato-trabalhador.js', { type: 'module' });

/*
 * O motor pode morrer sem conseguir avisar, e a tela precisa saber.
 *
 * O trabalhador reporta falha por `postMessage({tipo:'erro'})`, e isso cobre o
 * que ele consegue capturar — um pedido recusado, uma conta que não fecha. O
 * que não cobre é o `panic!`: o perfil de publicação usa `panic = "abort"`, e
 * em WebAssembly isso vira uma armadilha que envenena a instância inteira. Não
 * sobra ninguém para chamar `postMessage`; o navegador avisa por `onerror`, e
 * sem este ouvinte o aviso caía no chão.
 *
 * O efeito era a pior falha possível numa tela de espera longa: "calculando…"
 * para sempre, sem mensagem, sem erro no console e sem caminho de volta — do
 * lado de fora, indistinguível de um cálculo que ainda está indo. A tela do
 * Construtor já tratava isto; esta, não.
 */
trabalhador.onerror = (erro) => {
  esconderTudo();
  $('ex-erro').hidden = false;
  $('ex-erro').innerHTML =
    '<b>O motor parou de responder.</b> <em>'
    + escapar(erro?.message || 'falha inesperada')
    + ' — o trabalho já guardado continua no histórico. Recarregue a página '
    + 'para tentar de novo.</em>';
  encerrar();
};

/*
 * Qual linha do histórico este trabalho está escrevendo.
 *
 * O aplicativo guardava um trabalho só, numa chave fixa, e começar outro
 * apagava o anterior sem aviso. Agora cada escalada tem a sua linha, e é este
 * identificador que diz qual atualizar — nasce no primeiro estado que o motor
 * devolve e vive até a escalada terminar.
 */
let sessaoEmCurso = null;

/*
 * O carimbo da construção que está rodando neste aparelho.
 *
 * Vai dentro do arquivo exportado. Não muda nada no que ele carrega, e serve
 * para uma pergunta que aparece quando algo dá errado meses depois: qual versão
 * produziu este fechamento. Quem responde é o service worker, que é quem sabe.
 */
let CARIMBO = '';

/** Quantos nós a prova ganha, por unidade de esforço escolhida. */
const NOS_POR_ESFORCO = 10_000_000;

/**
 * Quanto tempo a prova ganha, por unidade de esforço.
 *
 * Só a prova tem prazo. A escalada não: ela roda até fechar ou até você mandar
 * parar, porque quem decide a hora é quem está olhando.
 */
const MILISSEGUNDOS_POR_ESFORCO = 5_000;

/** A busca cíclica varre um espaço muito menor: recebe uma fração dos nós. */
const FATIA_CICLICA = 4;

/**
 * Quantas cartelas aparecem antes de alguém pedir para ver o resto.
 *
 * A lista inteira ficava aberta entre o resultado e as ferramentas que vêm
 * depois dele — o dinheiro e a conferência. Num fechamento de mil cartelas,
 * chegar à conferência custava mil cartelas de rolagem, e a ferramenta que a
 * pessoa mais quer usar era a mais longe de alcançar.
 *
 * Três, e não uma: uma cartela sozinha parece defeito de desenho, três leem-se
 * como amostra.
 */
const CARTELAS_NA_PREVIA = 3;

/**
 * O tamanho da leva, quando a lista inteira é aberta.
 *
 * Mesmo número que a Lotinha usa, e pelo mesmo motivo — está explicado em
 * `.cartelas.em-levas` no CSS: 60 divide 1, 2, 3 e 4 colunas, então toda leva
 * fecha um número inteiro de linhas em qualquer tela, e marcar 50 fronteiras
 * em vez de 3.000 mantém a rolagem no mesmo custo de antes.
 */
const CARTELAS_POR_LEVA = 60;

/*
 * Cada execução tem um número. Respostas de execuções anteriores chegam depois
 * de o usuário já ter mudado os parâmetros, e pintá-las mostraria o resultado
 * de um problema que não é mais o da tela.
 */
let etapa = 0;
let rodando = false;

/*
 * Se o laço da escalada está vivo neste instante.
 *
 * Diferente de `rodando`, que cobre o pipeline inteiro — verificação e prova
 * inclusive. A distinção não é preciosismo: os dois comandos manuais são
 * bandeiras aplicadas **entre lotes da escalada**, e quando o laço já terminou
 * não há entre-lotes nenhum. Um toque em "otimizar" no exato instante em que a
 * garantia fechou levantava a bandeira num laço que já não existia, e o botão
 * não fazia absolutamente nada. Sabendo que o laço morreu, a tela retoma o
 * motor com o pedido junto em vez de falar sozinha.
 */
let escalandoAgora = false;
let pedido = null;
let esforco = 4;
let estado = null;

/**
 * "1 cartela", "16 cartelas".
 *
 * O singular acontece de verdade: 18 números com jogos de 17 garantindo 13 tem
 * mínimo de uma cartela só, e a tela dizia "custa 1 cartelas".
 */
const emCartelas = (n) => `${milhares(n)} cartela${Number(n) === 1 ? '' : 's'}`;

/** Números grandes vêm do motor como texto, porque não cabem num `Number`. */
function grande(texto) {
  const n = Number(texto);
  return Number.isSafeInteger(n) ? milhares(n) : String(texto);
}

function avisar(texto) {
  // O aviso é o da ferramenta: um só balão, e não um por motor.
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(avisar.relogio);
  avisar.relogio = setTimeout(() => {
    aviso.hidden = true;
  }, 2600);
}

/* ─────────── a sequência ─────────── */

/** Primeira letra maiúscula. A frase anterior terminava em ponto. */
function maiuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* ─────────── a barra de situação ─────────── */

/*
 * A resposta, de qualquer altura da página, para "isso está funcionando?".
 *
 * A página passa de cinco mil pixels depois de um resultado, e os controles
 * ficam longe dos números: quem rola para ver o progresso perde o Parar de
 * vista, e vice-versa. A barra é fixa no topo e carrega as três coisas que
 * respondem à pergunta — se está trabalhando, em que estágio, e há quanto tempo.
 */
let relogioDaSituacao = 0;
let comecoDaCorrida = 0;

function pintarSituacao(texto, trabalhando = true) {
  const barra = $('ex-situacao');
  if (!barra) return;
  barra.hidden = false;
  barra.classList.toggle('trabalhando', trabalhando);
  $('ex-texto-situacao').textContent = texto;
}

function ligarORelogioDaSituacao() {
  comecoDaCorrida = Date.now();
  clearInterval(relogioDaSituacao);
  const tique = () => {
    const passou = (Date.now() - comecoDaCorrida) / 1000;
    $('ex-relogio').textContent =
      passou < 60
        ? `${passou.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`
        : haQuanto(Date.now() - comecoDaCorrida);
  };
  tique();
  // Cinco vezes por segundo: é uma atribuição de texto, e é o bastante para o
  // relógio parecer vivo sem custar nada.
  relogioDaSituacao = setInterval(tique, 200);
}

function pararORelogioDaSituacao() {
  clearInterval(relogioDaSituacao);
  relogioDaSituacao = 0;
}

function esconderTudo() {
  for (const id of [
    'ex-analise-cartao',
    'ex-piso-cartao',
    'ex-construcao-cartao',
    'ex-verificacao-cartao',
    'ex-prova-cartao',
    'ex-resultado-cartao',
  ]) {
    $(id).hidden = true;
  }
  $('ex-erro').hidden = true;
}

/*
 * O que a tela escolheu, entregue por `resolver()`.
 *
 * Antes eram seis variáveis mantidas aqui e repintadas por uma grade própria.
 * Agora a grade é uma só, mora na ferramenta, e este módulo recebe o resultado
 * dela pronto: as dezenas em ordem e o universo de onde saíram.
 */
let numerosEscolhidos = [];
let universo = 25;

/** As dezenas marcadas, em ordem: a posição `i` da cartela é o número `lista[i]`. */
function dezenas() {
  return numerosEscolhidos;
}

/*
 * Os avisos que o módulo devolve a quem o chama.
 *
 * Ele não conhece a aba Histórico nem o botão que o ligou — e não deve
 * conhecer. Quando o histórico muda, ou quando o trabalho acaba, ele diz; quem
 * decide o que fazer com isso é a ferramenta.
 */
let aoMudarOHistorico = () => {};
let aoTerminar = () => {};

/** Liga os avisos. Chamado uma vez, na partida da ferramenta. */
export function ligar(avisos = {}) {
  aoMudarOHistorico = avisos.aoMudarOHistorico ?? aoMudarOHistorico;
  aoTerminar = avisos.aoTerminar ?? aoTerminar;
}

/** O carimbo da construção, que vai dentro do arquivo exportado. */
export function definirCarimbo(carimbo) {
  CARIMBO = String(carimbo ?? '');
}

/** Se o motor exato está trabalhando neste instante. */
export function estaRodando() {
  return rodando;
}

/** O fechamento que está na tela agora — vazio antes de haver um. */
export function cartelasAtuais() {
  return estado?.cartelas ?? [];
}

/** Manda parar. Quem decide a hora é quem está olhando. */
export function pararTudo() {
  if (!rodando) return;
  trabalhador.postMessage({ tipo: 'parar' });
  avisar('Parando…');
}

/**
 * Resolve um pedido do começo: análise, piso, escalada, verificação e prova.
 *
 * `numeros` são as dezenas marcadas, na ordem em que a cartela as indexa;
 * `sessao` e `estadoGuardado` só aparecem quando se retoma um trabalho salvo, e
 * é o que faz o piso já determinado não ser determinado de novo.
 */
export function resolver({
  pedido: pedidoPedido,
  numeros,
  universo: universoDaTela = 25,
  esforco: esforcoPedido = 4,
  estadoGuardado = null,
  sessao = null,
}) {
  if (!pedidoPedido || !numeros?.length) return;
  numerosEscolhidos = [...numeros];
  universo = universoDaTela;

  etapa += 1;
  rodando = true;
  // Corrida nova, crédito zerado: a bandeira da construção avançada não pode
  // atravessar de um pedido para o outro.
  avancoFoiPedido = false;
  pedido = { ...pedidoPedido };
  esforco = esforcoPedido;
  estado = {
    // Um fechamento guardado já traz o piso e de onde ele veio. Reaproveitá-lo
    // é o que faz "continuar" continuar: no esforço fundo a determinação do
    // mínimo leva minutos, e refazê-la para chegar ao mesmo número seria
    // recomeçar o trabalho que se mandou não recomeçar.
    piso: sessao?.piso ?? 0,
    origem: sessao?.origem ?? '',
    fechado: sessao?.fechado ?? false,
    cartelas: [],
    metodo: '',
    verificado: false,
    descobertos: 0,
    ciclicaFechou: false,
    linhasDaProva: [],
    familiaPendente: null,
    dadosPendentes: null,
    parado: false,
    escalada: null,
    guardado: null,
    curva: sessao?.curva ?? [],
    melhorCobertura: -1,
    desdeAMelhora: Date.now(),
  };

  esconderTudo();
  $('ex-curva-cartao').hidden = true;
  $('ex-parar').hidden = false;
  $('ex-analise-cartao').hidden = false;
  for (const id of ['ex-alvos', 'ex-blocos', 'ex-por-bloco', 'ex-por-alvo']) {
    $(id).textContent = '…';
  }
  estado.guardado = estadoGuardado;

  /*
   * Levar a pessoa até onde o trabalho aparece.
   *
   * Medido: numa tela de iPhone, depois de tocar em Resolver o `scrollY` não
   * mudava um pixel, o botão continuava escrito "Resolver" — só um pouco mais
   * apagado — e o progresso nascia mil pixels abaixo da dobra. A ação mais
   * importante do aplicativo não mudava nada que a pessoa conseguisse ver, e o
   * primeiro instinto de quem não vê resposta é tocar de novo.
   *
   * O rótulo muda junto, porque um botão que continua dizendo "Resolver"
   * enquanto resolve não informa nada.
   */
  pintarSituacao('medindo o pedido…');
  ligarORelogioDaSituacao();
  $('ex-analise-cartao').scrollIntoView({ block: 'start', behavior: 'smooth' });

  trabalhador.postMessage({ tipo: 'retomar' });
  enviar({ tipo: 'analisar' });
}

function enviar(mensagem) {
  trabalhador.postMessage({ ...mensagem, pedido: JSON.stringify(pedido), etapa });
}

/*
 * Se a construção avançada foi ligada à mão nesta corrida.
 *
 * Existe só para a tela não creditar a um botão o que o motor fez sozinho: com
 * garantia cheia o botão nem aparece, e mesmo assim o resultado passa do piso.
 */
let avancoFoiPedido = false;

function encerrar() {
  rodando = false;
  escalandoAgora = false;
  /*
   * O estágio 5 é repintado no fim, e não deixado como estava.
   *
   * Sem isto ele congelava no último quadro do motor: "Otimizando: procurando
   * cobrir tudo com 12…" continuava na tela com o motor parado, o Parar já
   * escondido e o resultado final logo abaixo dizendo outro número. Texto em
   * gerúndio depois de tudo ter acabado é a tela afirmando algo que não está
   * mais acontecendo.
   */
  if (estado?.escalada) pintarEscalada(estado.escalada, true);
  pararORelogioDaSituacao();
  pintarSituacao('parado — o que está na tela continua valendo', false);
  $('ex-parar').hidden = true;
  $('ex-avancar').hidden = true;
  encerrarASessao();
  aoTerminar(estado?.cartelas ?? [], estado?.verificado ?? false, null);
}

/* ─────────── a pintura, estágio a estágio ─────────── */

function pintarAnalise(dados) {
  pintarSituacao('medindo o pedido…');
  $('ex-alvos').textContent = grande(dados.alvos);
  $('ex-blocos').textContent = grande(dados.blocos);
  $('ex-por-bloco').textContent = grande(dados.alvos_por_bloco);
  $('ex-por-alvo').textContent = grande(dados.blocos_por_alvo);
}

function pintarPiso(dados) {
  pintarSituacao('mínimo determinado — montando o fechamento…');
  estado.piso = dados.valor;
  estado.origem = dados.origem;
  estado.fechado = dados.fechado;
  $('ex-piso-cartao').hidden = false;
  $('ex-piso').innerHTML =
    `<b>Nada menor que ${emCartelas(dados.valor)} existe.</b>` +
    `<br><em>De onde vem: ${escapar(dados.origem)}.</em>` +
    (dados.fechado
      ? ''
      : '<br><em>Com sorteio diferente da garantia, Schönheim não vale — ela fala de ' +
        'cobertura simples, e esticá-la até aqui inventaria um piso. O que vale é a ' +
        'contagem e a cota de Turán no avesso, que troca cartela e sorteio pelos ' +
        'complementos deles e volta a ser um problema com teorema.</em>');
}

/*
 * A curva, cartela por cartela.
 *
 * A subida costuma acontecer rápido demais para ser acompanhada ao vivo — num
 * problema pequeno ela vai de zero ao teto num piscar. Por isso o motor a
 * **grava**, e aqui ela é só desenhada.
 */
function pintarCurva(pontos) {
  if (!pontos || pontos.length === 0) return;
  estado.curva = pontos;
  $('ex-curva-cartao').hidden = false;
  $('ex-curva').innerHTML = pontos
    .map(([cartelas, cobertura]) => `<b>${milhares(cartelas)}</b> → ${porcento(cobertura)}`)
    .join(' · ');
}

/*
 * A barra é a **cobertura**, e não o tempo.
 *
 * É a diferença que dá sentido à tela inteira: o número de cartelas está preso
 * ao teto, então o que há para acompanhar é o quanto já está coberto. Uma barra
 * de tempo aqui só diria quanto o aparelho trabalhou, que é o que menos importa.
 */
/** "2 min 30 s", "45 s" — quanto tempo faz, escrito para ser lido de relance. */
function haQuanto(milissegundos) {
  const segundos = Math.max(0, Math.round(milissegundos / 1000));
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto ? `${minutos} min ${resto} s` : `${minutos} min`;
}

/**
 * Quais dos dois comandos manuais fazem sentido agora.
 *
 * ## Por que a paciência do motor não manda mais aqui
 *
 * A construção avançada só aparecia depois de a reorganização atravessar
 * `RODADAS_NO_PISO` — cinco mil rodadas sem um ganho sequer — e a ideia era não
 * convidar ninguém a desistir de um mínimo que ainda estava ao alcance.
 *
 * Medido, o efeito era o oposto do pretendido. Em 25 dezenas com jogos de 17, o
 * motor faz cerca de cinco rodadas por segundo: cinco mil rodadas **seguidas**
 * sem melhora levariam uns dezessete minutos, e qualquer ganho isolado no meio
 * do caminho zera a contagem e recomeça tudo. Na prática o botão não chegava
 * nunca, e a tela ficava sem saída — em cima justamente das configurações
 * grandes, que são as que mais precisam do modo avançado.
 *
 * Uma trava automática na frente de um comando manual é uma contradição. Agora
 * os dois comandos ficam disponíveis enquanto fizerem sentido, e o que o motor
 * sabe vira **conselho**, não porta: a nota abaixo dos números diz se agora é
 * uma boa hora, e a hora é de quem está olhando.
 *
 * O que continua sendo condição, porque é matemática e não opinião:
 *
 * - avançar só faz sentido enquanto o teto ainda é o piso e a garantia não foi
 *   cumprida — passado o piso, já se está no modo avançado;
 * - otimizar só faz sentido havendo uma coleção completa **maior que o piso**.
 *   No piso não há folga: ele é cota inferior provada, e apertar dali seria
 *   esperar por algo que não existe.
 */
function pintarOsComandos(passo, terminou) {
  const podeAvancar =
    Boolean(passo) && !passo.alem_do_piso && !passo.fechou && !terminou;

  // Enquanto constrói, o número ainda está caindo por conta própria: oferecer
  // o aperto ali seria oferecer o terceiro estágio antes de o segundo acabar.
  const construindo = passo?.fase === 'construindo' && !terminou;
  const otimizando = passo?.fase === 'otimizando' && !terminou;
  const completo = passo?.completo ?? 0;
  const podeOtimizar =
    Boolean(passo)
    && !otimizando
    && !construindo
    && completo > 1
    && completo > (passo.piso ?? 0);

  $('ex-avancar').hidden = !podeAvancar;
  $('ex-otimizar').hidden = !podeOtimizar;

  // O rótulo carrega o conselho do motor. Com o botão sempre à mão, é ele que
  // distingue "dá para fazer" de "é hora de fazer".
  $('ex-avancar').textContent = passo?.piso_esgotado
    ? 'Ativar construção avançada — o piso não está bastando'
    : 'Ativar construção avançada';

  $('ex-otimizar').textContent = `Ativar otimização — tentar menos de ${milhares(
    completo
  )} cartelas`;

  pintarANotaDosComandos(passo, podeAvancar, podeOtimizar);
}

/**
 * A frase que acompanha os comandos.
 *
 * Ela carrega o que a antiga trava carregava calada: se o piso ainda pode
 * bastar, se ele já se esgotou, e o que se perde ao passar dele. Dizer isso é
 * mais útil do que esconder o botão — quem lê decide, e quem não lê pelo menos
 * não fica preso.
 */
/**
 * Se a cobertura parou de subir tempo suficiente para mudar o conselho.
 *
 * Oito segundos: curto o bastante para não deixar alguém esperando por engano,
 * longo o bastante para não chamar de "parada" uma escalada que só está entre
 * duas melhoras. O motor entrega estado várias vezes por segundo.
 */
const PARADA_PARA_AVISAR = 8000;

function paradoHaMuito(passo) {
  if (passo?.piso_esgotado) return true;
  if (!estado.desdeAMelhora) return false;
  return Date.now() - estado.desdeAMelhora > PARADA_PARA_AVISAR;
}

function pintarANotaDosComandos(passo, podeAvancar, podeOtimizar) {
  const nota = $('ex-comandos-nota');
  if (!nota) return;

  const partes = [];

  if (podeAvancar) {
    partes.push(
      passo.piso_esgotado
        ? `<b>O piso se esgotou:</b> ${milhares(passo.rodadas)} rodadas, e nenhuma ` +
          `disposição de ${emCartelas(passo.piso)} cobriu tudo. A construção ` +
          'avançada é o caminho para os 100%.'
        : `A escalada ainda está tentando fechar com ${emCartelas(passo.piso)}, que é ` +
          'o piso provado. A construção avançada passa desse número e vai até a ' +
          'garantia ser cumprida — o resultado deixa de ser o mínimo. ' +
          /*
           * O conselho tem de olhar o que está acontecendo, e não a fase.
           *
           * A frase dizia sempre "enquanto a cobertura sobe, vale esperar" —
           * inclusive com a cobertura parada há minutos, que é justamente
           * quando ela aparece. Medido no caminho de garantia parcial: os três
           * números grandes ficavam idênticos do primeiro frame ao
           * quadragésimo quinto segundo, com esta frase embaixo mandando
           * esperar. O conselho estava invertido em relação ao que a própria
           * tela mostrava.
           */
          (paradoHaMuito(passo)
            ? '<b>A cobertura não sobe há um tempo</b> — este número não vai ' +
              'fechar sozinho.'
            : 'Enquanto a cobertura sobe, vale esperar.')
    );
  }

  if (podeOtimizar) {
    partes.push(
      `<b>A garantia já está cumprida com ${emCartelas(passo.completo)}.</b> A ` +
        'otimização tira uma cartela de cada vez e refaz a cobertura; o fechamento ' +
        'que você já tem fica guardado, e parar a qualquer momento devolve o melhor ' +
        'número alcançado.'
    );
  }

  nota.innerHTML = partes.join('<br><br>');
  nota.hidden = partes.length === 0;
}

function pintarEscalada(passo, terminou) {
  $('ex-construcao-cartao').hidden = false;
  // O estágio longo. A barra carrega o que a pessoa precisa saber sem rolar:
  // quantas cartelas já existem, e quanto da garantia está coberto.
  if (!terminou) {
    pintarSituacao(
      passo.completo
        ? `${milhares(passo.completo)} cartelas — procurando menos`
        : `montando — ${porcento(passo.melhor_cobertura)} de cobertura`
    );
  }
  estado.escalada = passo;
  pintarOsComandos(passo, terminou);

  // Quando a cobertura melhorou pela última vez. Na reorganização é o único
  // número que responde à pergunta que a pessoa está fazendo — "ainda vale a
  // pena deixar isso rodando?" —, e o motor não o entrega: as rodadas sobem
  // sempre, melhorando ou não.
  if (passo.melhor_cobertura > (estado.melhorCobertura ?? -1)) {
    estado.melhorCobertura = passo.melhor_cobertura;
    estado.desdeAMelhora = Date.now();
  }

  /*
   * Acabado, o quadro mostra o que a pessoa **tem**, e não o que o motor
   * estava tentando.
   *
   * A tela chegava a exibir três números diferentes ao mesmo tempo: o quadro
   * com o que o otimizador estava perseguindo, o texto abaixo com outro, e o
   * cartão de resultado com um terceiro. A pergunta "quantas cartelas eu tenho,
   * afinal?" não tinha resposta na página.
   */
  const naMao = terminou && estado.cartelas.length ? estado.cartelas.length : passo.cartelas;
  $('ex-cartelas-agora').textContent = milhares(naMao);
  // O quadro mostra o **piso**, que é o número que não muda. O teto mudava de
  // significado ao entrar na construção avançada, e um quadro que troca de
  // sentido no meio do caminho engana mais do que informa.
  $('ex-teto').textContent = milhares(passo.piso ?? passo.teto);
  // No caminho de garantia cheia o piso nunca foi teto de nada: ele é a cota
  // inferior contra a qual o resultado vai ser comparado no fim. Chamá-lo de
  // "já ultrapassado" ali soaria como derrota logo no primeiro segundo, quando
  // o motor apenas ainda não desceu até ele.
  $('ex-teto').nextElementSibling.textContent =
    passo.fase === 'construindo'
      ? 'piso — o mínimo comprovado'
      : passo.alem_do_piso
        ? 'piso — já ultrapassado'
        : 'piso — o teto da escalada';
  $('ex-cobertura').textContent = porcento(passo.melhor_cobertura);
  $('ex-construcao-barra').style.width = `${(passo.melhor_cobertura * 100).toFixed(1)}%`;
  /*
   * A barra deixa de parecer progresso quando ela deixou de ser progresso.
   *
   * Preenchida a 87% e azul, ela diz "faltam 13%" — e no piso esgotado não
   * falta nada: nenhuma disposição daquele tamanho cobre tudo, e o motor já
   * demonstrou isso em cinco mil rodadas. Quem lê espera, e espera, porque a
   * barra prometeu. As listras dizem que ali é um limite alcançado, e a nota
   * ao lado diz o que fazer a respeito.
   */
  $('ex-construcao-barra').classList.toggle('parada', Boolean(passo.piso_esgotado));

  if (passo.fase === 'otimizando') {
    $('ex-construcao').innerHTML =
      `<b>Garantia cumprida com ${emCartelas(passo.completo)}.</b> ` +
      `<em>Otimizando: procurando cobrir tudo com ${milhares(
        Math.max(0, passo.cartelas)
      )} — uma a menos. O fechamento que você já tem fica guardado.</em>` +
      `<br><em>Cada sucesso aperta mais um. Toque em <b>Parar</b> quando o ` +
      `número já servir.</em>`;
    return;
  }

  // A construção avançada em curso, pelo motor de Turán.
  //
  // A tela não pode mostrar a cobertura da escalada aqui: ela ficou parada onde
  // o piso a deixou, e o motor novo trabalha noutro espaço. O que há para
  // mostrar é o fechamento que ele já entregou — e ele entrega cedo, porque a
  // recursão vem antes da busca em órbitas justamente para isso.
  if (passo.fase === 'construindo') {
    const noPiso = passo.completo && passo.completo <= passo.piso;
    $('ex-construcao').innerHTML = !passo.completo
      ? `<b>Montando o primeiro fechamento.</b> <em>Ele aparece em segundos, e ` +
        `daí em diante o número só cai.</em>`
      : noPiso
        ? `<b>Garantia cumprida com ${emCartelas(passo.completo)} — no piso.</b> ` +
          `<em>Nada menor existe. Pode parar.</em>`
        : `<b>Garantia cumprida com ${emCartelas(passo.completo)}.</b> ` +
          `<em>Procurando menor; o piso provado é ${milhares(passo.piso)}. O que já ` +
          `vale fica guardado, e parar devolve o melhor até aqui.</em>`;
    return;
  }

  if (passo.fechou) {
    // Fechar no piso e fechar acima dele são resultados diferentes, e o
    // segundo não autoriza falar em mínimo. Dizer "exatamente o teto" para uma
    // coleção de 344 cartelas cujo piso é 160 seria afirmar o contrário do que
    // aconteceu.
    $('ex-construcao').innerHTML = passo.alem_do_piso
      ? `<b>Fechou em 100% com ${emCartelas(passo.melhor_cartelas)}.</b>` +
        `<br><em>Acima do piso de ${milhares(passo.piso)}` +
        /*
         * Só se credita ao botão quem tocou nele.
         *
         * A frase dizia "pela construção avançada" sempre que o resultado
         * ficasse acima do piso — inclusive com garantia cheia, onde esse
         * botão nem aparece, porque ali o motor passa do piso sozinho. Quem
         * apenas tocou em Resolver lia que um botão que nunca viu produziu o
         * resultado dela.
         */
        (avancoFoiPedido
          ? ', pela construção avançada: a garantia está cumprida, e este não é o mínimo.'
          : ` — ${milhares(passo.piso)} não bastou. A garantia está cumprida, e ` +
            'este não é o mínimo.') +
        '</em>'
      : `<b>Fechou em 100% com ${emCartelas(passo.melhor_cartelas)}.</b>` +
        `<br><em>Exatamente no piso provado — nada menor existe.</em>`;
    return;
  }

  if (terminou) {
    $('ex-construcao').innerHTML =
      `<b>${porcento(passo.melhor_cobertura)} de cobertura, com ${emCartelas(
        passo.cartelas
      )}.</b> <em>Parada. O botão continuar retoma daqui.</em>`;
    return;
  }

  /*
   * Subindo e reorganizando são dois trabalhos diferentes, e a diferença
   * importa para quem está olhando.
   *
   * Subindo, há um fim à vista: faltam tantas cartelas para o teto. Na
   * reorganização não há — ela roda até fechar ou até mandarem parar, e foi
   * assim que se pediu. Mas a tela dizia só "reorganizando (12.345 rodadas)", e
   * as rodadas sobem sempre, melhorando ou não: quem olhava não tinha como
   * distinguir progresso de teimosia, nem sabia que aquilo não ia terminar
   * sozinho. Uma configuração comum — 20 dezenas, jogos de 17 — chega ao teto
   * em 86,4% e reorganiza para sempre, e o primeiro encontro com isso é uma
   * tela que parece travada.
   */
  /*
   * A construção avançada: o piso não bastou, e o teto saiu.
   *
   * O piso é uma cota **inferior** — diz que nada menor existe, não que aquele
   * tamanho basta. Em 20 números com jogos de 17 ele vale 160 e o melhor
   * fechamento conhecido tem 240: nenhuma disposição de 160 cobre tudo, e a
   * reorganização ficava tentando o impossível para sempre. Agora, esgotada a
   * paciência no piso, ela volta a acrescentar cartelas até fechar de verdade.
   *
   * A tela precisa anunciar isso no momento em que acontece, porque é o momento
   * em que a coleção deixa de ser candidata a mínima.
   */
  if (passo.alem_do_piso) {
    $('ex-construcao').innerHTML =
      `<b>${porcento(passo.melhor_cobertura)} de cobertura</b> ` +
      `<em>— construção avançada: ${milhares(passo.cartelas)} cartelas, acima do ` +
      `piso de ${milhares(passo.piso)}.</em>` +
      `<br><em>O piso não bastou — nenhuma disposição de ${milhares(passo.piso)} ` +
      `cartelas cobre tudo. Acrescentando até a garantia ser cumprida; o ` +
      `resultado não será o mínimo, e a tela vai dizer isso.</em>`;
    return;
  }

  if (passo.fase === 'subindo') {
    $('ex-construcao').innerHTML =
      `<b>${porcento(passo.melhor_cobertura)} de cobertura</b> ` +
      `<em>— subindo: ${milhares(passo.cartelas)} de ${milhares(passo.teto)} cartelas.</em>`;
    return;
  }

  const parado = haQuanto(Date.now() - (estado.desdeAMelhora ?? Date.now()));
  $('ex-construcao').innerHTML =
    `<b>${porcento(passo.melhor_cobertura)} de cobertura</b> ` +
    `<em>— no piso de ${milhares(passo.teto)} cartelas, reorganizando sem acrescentar ` +
    `nenhuma (${milhares(passo.rodadas)} rodadas).</em>` +
    // O conselho sobre o piso esgotado mora na nota dos comandos, junto do
    // botão que o atende. Dito aqui também, virava a mesma frase duas vezes
    // com palavras diferentes, a três linhas de distância.
    `<br><em>Sem melhorar há <b>${parado}</b>. Parar agora guarda o que está aí.</em>`;
}

function pintarVerificacao(dados) {
  pintarSituacao('conferindo sorteio a sorteio…');
  estado.verificado = dados.cobre;
  estado.descobertos = dados.descobertos;
  $('ex-verificacao-cartao').hidden = false;
  $('ex-verificacao').innerHTML = dados.cobre
    ? `<b>Confere.</b> <em>Os ${milhares(dados.alvos)} sorteios possíveis estão todos ` +
      `atendidos${dados.premiadas > 1 ? ` por ${dados.premiadas} cartelas cada` : ''}.</em>`
    : `<b>Não confere.</b> <em>${milhares(dados.descobertos)} de ${milhares(
        dados.alvos
      )} sorteios ficaram sem a garantia.</em>`;
}

function pintarProva(linhas, andando) {
  $('ex-prova-cartao').hidden = false;
  $('ex-prova').innerHTML = linhas.join('<br>');
  if (!andando) $('ex-prova-barra').style.width = '100%';
}

function contarProva(dados, familia) {
  const nome = familia === 'ciclica' ? 'família cíclica' : 'todas as coleções';
  const nos = `${milhares(dados.visitados)} nós, ${milhares(dados.candidatos)} candidatas`;
  switch (dados.desfecho) {
    case 'minimo':
      return `<b>${nome}:</b> achou ${milhares(dados.tamanho)} e varreu o resto — ${nos}.`;
    case 'nada-abaixo':
      return `<b>${nome}:</b> nada abaixo de ${milhares(dados.tamanho)} existe — ${nos}.`;
    case 'excedido':
      return (
        `<b>${nome}:</b> o orçamento acabou antes da resposta — ${nos}. ` +
        `Isto é "não sei", e não "não existe".`
      );
    default:
      return (
        `<b>${nome}:</b> grande demais para varrer neste aparelho — ` +
        `${milhares(dados.candidatos)} candidatas.`
      );
  }
}

function dadosDoVeredito() {
  return {
    verificado: estado.verificado,
    encontrado: estado.cartelas.length,
    piso: estado.piso,
    ciclicaFechou: estado.ciclicaFechou,
    descobertos: estado.descobertos,
    teto: estado.escalada?.teto ?? estado.piso,
    alemDoPiso: estado.escalada?.alem_do_piso ?? false,
    cobertura: estado.escalada?.melhor_cobertura ?? 0,
  };
}

function pintarResultado() {
  const encontrado = estado.cartelas.length;
  const dados = dadosDoVeredito();
  const qual = veredito(dados);

  $('ex-resultado-cartao').hidden = false;
  $('ex-frase').innerHTML = `<b>${escapar(frase(dados))}</b>`;
  $('ex-encontrado').textContent = milhares(encontrado);
  $('ex-provado').textContent = `≥ ${milhares(estado.piso)}`;
  $('ex-folga').textContent =
    qual === PARCIAL ? porcento(dados.cobertura) : milhares(folga(encontrado, estado.piso));
  $('ex-folga').nextElementSibling.textContent =
    qual === PARCIAL ? 'cobertura alcançada' : 'folga que resta';
  $('ex-compartilhar').hidden = typeof navigator.share !== 'function';

  const numeros = dezenas();
  pintarPreviaDasCartelas(numeros);

  // A contradição também encerra: não há mais o que provar quando os próprios
  // números se desmentem, e deixar a barra pela metade sugeriria trabalho em
  // curso que não existe.
  if (qual === MINIMO || qual === FALHA || qual === CONTRADICAO) {
    $('ex-prova-barra').style.width = '100%';
  }

  // As cartelas existem: a conferência da ferramenta passa a ter o que conferir.
  //
  // Vale mesmo quando a cobertura ficou abaixo de 100%. Um fechamento parcial
  // é o que a pessoa tem na mão, e saber quanto ele rendeu num sorteio é
  // justamente a pergunta que sobra quando a garantia não foi alcançada.
  //
  // Quem recebe é `app.js`, pela aba Checar — a mesma que confere o que vem do
  // banco, da fórmula e da busca. Este módulo tinha uma segunda conferência só
  // sua, com outra caixa de texto e outro conferidor, e duas telas para a mesma
  // pergunta são duas chances de responderem coisas diferentes.
  aoTerminar(estado.cartelas, estado.verificado, { numeros, pedido });

  encerrar();
}

/* ─────────── as cartelas: uma amostra, e o resto sob demanda ─────────── */

/*
 * A lista completa só existe no DOM depois que alguém pede.
 *
 * Não é só rolagem: montar mil cartelas custa mil elementos, e pagá-los a cada
 * resultado — inclusive de quem nunca vai olhar a lista — atrasa a tela no
 * momento em que ela deveria estar respondendo. `abertas` guarda se a lista já
 * foi montada, para o segundo toque no botão ser só mostrar e esconder.
 */
let cartelasAbertas = false;
let cartelasMontadas = false;

/** Uma cartela desenhada, com o índice e os números que a pessoa marcou. */
function desenharCartela(cartela, i, numeros) {
  return (
    `<div class="cartela"><span class="indice">${String(i + 1).padStart(2, '0')}</span>` +
    `<span>${cartela.map((p) => String(numeros[p - 1]).padStart(2, '0')).join(' ')}</span></div>`
  );
}

/** A amostra que fica sempre visível, e a legenda que diz quantas existem. */
function pintarPreviaDasCartelas(numeros) {
  const total = estado.cartelas.length;
  const quantas = Math.min(total, CARTELAS_NA_PREVIA);

  // Toda vez que um resultado novo chega a lista volta a ficar fechada: as
  // cartelas de antes não são mais as da tela, e deixá-las abertas mostraria o
  // fechamento errado.
  cartelasAbertas = false;
  cartelasMontadas = false;
  $('ex-cartelas').hidden = true;
  $('ex-cartelas').innerHTML = '';
  $('ex-ver-cartelas').classList.remove('aberto');

  $('ex-previa').innerHTML =
    `<div class="cartelas">${estado.cartelas
      .slice(0, quantas)
      .map((c, i) => desenharCartela(c, i, numeros))
      .join('')}</div>`;

  $('ex-aviso-cartelas').innerHTML =
    total > quantas
      ? `<b>${emCartelas(total)}.</b> <em>Mostrando ${
          quantas === 1 ? 'a primeira' : `as ${quantas} primeiras`
        } — o botão abaixo abre a lista inteira, e o Copiar leva todas.</em>`
      : `<b>${emCartelas(total)}.</b> <em>São todas.</em>`;

  const botao = $('ex-ver-cartelas');
  botao.hidden = total <= quantas;
  botao.textContent = `Ver todas as ${milhares(total)} cartelas`;
}

/**
 * Monta a lista inteira, em levas.
 *
 * A primeira leva entra de imediato e o resto no quadro seguinte. Num aparelho
 * fraco — que é o aparelho para o qual este aplicativo foi feito — montar mil
 * cartelas de uma vez seguraria o toque por décimos de segundo, e um botão que
 * demora a responder é indistinguível de um botão que não funcionou.
 */
function montarListaDeCartelas() {
  const numeros = dezenas();
  const total = estado.cartelas.length;
  const alvo = $('ex-cartelas');

  alvo.innerHTML = '<div class="cartelas em-levas"></div>';
  const caixa = alvo.firstElementChild;

  const leva = (inicio) => {
    const fim = Math.min(total, inicio + CARTELAS_POR_LEVA);
    const partes = [];
    for (let i = inicio; i < fim; i += 1) {
      partes.push(desenharCartela(estado.cartelas[i], i, numeros));
    }
    caixa.insertAdjacentHTML('beforeend', `<div class="leva">${partes.join('')}</div>`);
    return fim;
  };

  let feito = leva(0);
  const seguir = () => {
    if (feito >= total) return;
    feito = leva(feito);
    requestAnimationFrame(seguir);
  };
  requestAnimationFrame(seguir);

  cartelasMontadas = true;
}

/** O botão que abre e fecha a lista. */
function alternarCartelas() {
  cartelasAbertas = !cartelasAbertas;
  if (cartelasAbertas && !cartelasMontadas) montarListaDeCartelas();
  $('ex-cartelas').hidden = !cartelasAbertas;

  const botao = $('ex-ver-cartelas');
  botao.textContent = cartelasAbertas
    ? 'Ocultar as cartelas'
    : `Ver todas as ${milhares(estado.cartelas.length)} cartelas`;
  // Aberto, ele gruda no rodapé: a lista de um fechamento grande passa de
  // 800.000 px, e sem isto quem rola para dentro dela não tem como voltar.
  botao.classList.toggle('aberto', cartelasAbertas);

  // Fechar de dentro da lista deixaria a página rolada num ponto que já não
  // existe. Voltar ao botão é voltar ao lugar de onde se saiu.
  if (!cartelasAbertas) {
    botao.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

/* ─────────── o texto que sai do aplicativo ─────────── */

function textoDoResultado() {
  const numeros = dezenas();
  const encontrado = estado.cartelas.length;
  const cabecalho =
    `Pool de ${pedido.v}, jogos de ${pedido.k}, saem ${pedido.j}, garante ${pedido.t}` +
    `${pedido.r > 1 ? `, ${pedido.r} cartelas premiadas` : ''}\n` +
    `${frase(dadosDoVeredito())}\n` +
    `Piso: ${estado.origem}\n` +
    `Construção: ${estado.metodo}\n\n`;
  return (
    cabecalho +
    estado.cartelas.map((c) => c.map((p) => numeros[p - 1]).join(' ')).join('\n') +
    '\n'
  );
}

/* ─────────── guardar o trabalho, para continuar depois ─────────── */

/*
 * O trabalho em curso fica no aparelho, e nada sai daqui.
 *
 * Num aparelho fraco, "fazer aos poucos" só significa alguma coisa se fechar o
 * aplicativo não custar o que já foi feito. O que é guardado não é a lista de
 * cartelas e sim o estado do motor: com ele `Escalada::retomar` reconstrói pelo
 * **teto salvo** e pelo conjunto salvo, e continuar devolve exatamente a mesma
 * quantidade de cartelas em vez de recomeçar a montagem.
 */
function guardarTrabalho(estadoJson) {
  if (!estadoJson) return;
  estado.guardado = estadoJson;

  const dados = {
    pedido,
    numeros: dezenas(),
    universo,
    esforco,
    piso: estado.piso,
    origem: estado.origem,
    fechado: estado.fechado,
    // `estado.cartelas` só é preenchido quando a escalada **termina**, então
    // um trabalho em curso gravava zero — e o histórico exibia "0 cartelas,
    // 83,6% de cobertura", que é contradição visível a olho nu. O número certo
    // está no passo que o motor acabou de mandar.
    cartelasContadas: estado.cartelas.length || estado.escalada?.cartelas || 0,
    escalada: estadoJson,
    curva: estado.curva ?? [],
    cobertura: estado.escalada?.melhor_cobertura ?? 0,
    fase: estado.escalada?.fase ?? 'subindo',
    verificado: estado.verificado,
    descobertos: estado.descobertos,
    emCurso: rodando,
  };

  // A linha nasce no primeiro estado que o motor devolve, e não quando alguém
  // toca em Resolver: uma escalada abandonada antes de produzir qualquer coisa
  // não é um fechamento, e encheria o histórico de linhas vazias.
  if (sessaoEmCurso && historico.obter(sessaoEmCurso)) {
    historico.atualizar(sessaoEmCurso, dados);
  } else {
    sessaoEmCurso = historico.criar(dados).id;
  }
  aoMudarOHistorico();
}

/** Fecha a linha do histórico: o motor não está mais trabalhando nela. */
function encerrarASessao() {
  if (!sessaoEmCurso) return;
  historico.encerrar(sessaoEmCurso);
  aoMudarOHistorico();
}

function retomarComPedido(pedidoJunto) {
  if (!estado?.guardado) {
    avisar('Não há trabalho guardado para continuar.');
    return false;
  }
  etapa += 1;
  rodando = true;
  escalandoAgora = true;
  $('ex-parar').hidden = false;
  estado.parado = false;
  trabalhador.postMessage({ tipo: 'retomar' });
  enviar({
    tipo: 'escalar',
    teto: estado.piso,
    estado: estado.guardado,
    ...pedidoJunto,
  });
  return true;
}

function comecarEscalada(estadoGuardado = null) {
  escalandoAgora = true;
  $('ex-construcao-cartao').hidden = false;
  $('ex-cartelas-agora').textContent = '0';
  $('ex-teto').textContent = milhares(estado.piso);
  $('ex-cobertura').textContent = '0,0%';
  enviar({ tipo: 'escalar', teto: estado.piso, estado: estadoGuardado ?? estado.guardado });
}

function depoisDaVerificacao() {
  const encontrado = estado.cartelas.length;
  if (!estado.verificado) {
    // Ela parou antes de fechar: o conjunto cobre uma parte, e é isso que a
    // tela vai dizer. Não há mínimo a provar sobre uma cobertura parcial.
    pintarProva(
      [
        '<b>Não houve o que provar.</b>',
        '<em>A cobertura ainda não fechou, e um conjunto que não cobre tudo não ' +
          'tem mínimo a demonstrar.</em>',
      ],
      false
    );
    pintarResultado();
    return;
  }
  if (encontrado <= estado.piso) {
    // Fechou dentro do teto, e o teto é o piso: o mínimo está determinado sem
    // procurar mais nada. É o encontro que o aplicativo existe para produzir.
    pintarProva(
      [
        '<b>Não foi preciso procurar.</b>',
        `<em>A cobertura fechou com ${milhares(encontrado)} cartelas, e nada menor ` +
          `que ${milhares(estado.piso)} existe.</em>`,
      ],
      false
    );
    pintarResultado();
    return;
  }
  /*
   * Daqui para baixo não se chega — e é de propósito.
   *
   * A escalada monta no máximo `piso` cartelas, então `encontrado > piso` é
   * impossível: fechar a cobertura é fechar exatamente no mínimo. A varredura
   * abaixo resolvia o problema do desenho anterior, em que a construção podia
   * passar do piso e era preciso provar que nada menor existia.
   *
   * Fica de pé porque `ProvaExata` continua sendo o alicerce da busca cíclica
   * planejada — escolher órbitas em vez de cartelas —, e porque o Rust dela é
   * testado. O que **não** pode ficar é a tela prometendo uma busca que não
   * acontece: o rótulo do esforço e o texto do estágio 7 falam do que de fato
   * roda, que é o aprofundamento do piso.
   */
  estado.linhasDaProva = [];
  pintarProva(['<em>Varrendo a família cíclica…</em>'], true);
  enviar({
    tipo: 'provar',
    teto: encontrado,
    orcamento: Math.max(1000, Math.floor((esforco * NOS_POR_ESFORCO) / FATIA_CICLICA)),
    limite: Math.max(500, Math.floor((esforco * MILISSEGUNDOS_POR_ESFORCO) / FATIA_CICLICA)),
    familia: 'ciclica',
  });
}

function seguirDepoisDaProva(familia, dados) {
  if (estado.parado) {
    if (familia === 'ciclica') estado.ciclicaFechou = dados.fechou;
    pintarResultado();
    return;
  }
  if (familia === 'ciclica') {
    estado.ciclicaFechou = dados.fechou;
    pintarProva([...estado.linhasDaProva, '<em>Varrendo todas as coleções…</em>'], true);
    enviar({
      tipo: 'provar',
      teto: estado.cartelas.length,
      orcamento: esforco * NOS_POR_ESFORCO,
      limite: esforco * MILISSEGUNDOS_POR_ESFORCO,
      familia: 'livre',
    });
    return;
  }

  if (dados.fechou) {
    // A varredura completa é a afirmação mais forte que existe aqui: o piso
    // passa a ser o próprio tamanho, e a origem passa a ser a exaustão.
    estado.piso = estado.cartelas.length;
    estado.origem = 'exaustão: nenhuma solução menor existe';
    pintarPiso({ valor: estado.piso, origem: estado.origem, fechado: estado.fechado });
  }
  pintarResultado();
}

function receberProva(mensagem) {
  const { dados, familia } = mensagem;
  estado.linhasDaProva.push(contarProva(dados, familia));
  pintarProva(estado.linhasDaProva, false);

  // Uma varredura que achou algo menor melhora a solução — e a nova solução
  // volta ao verificador antes de valer, como qualquer outra. É a mesma regra
  // da construção: nada é aceito pela palavra de quem produziu.
  if (dados.desfecho === 'minimo' && dados.cartelas && dados.tamanho < estado.cartelas.length) {
    estado.cartelas = dados.cartelas;
    estado.metodo =
      familia === 'ciclica' ? 'busca exata sobre órbitas' : 'busca exata sobre todas as cartelas';
    estado.familiaPendente = familia;
    estado.dadosPendentes = dados;
    enviar({ tipo: 'verificar', cartelas: estado.cartelas });
    return;
  }

  seguirDepoisDaProva(familia, dados);
}

/* ─────────── as respostas do trabalhador ─────────── */

trabalhador.onmessage = (evento) => {
  const mensagem = evento.data ?? {};

  // A prévia da escala não pertence a execução nenhuma: ela responde enquanto a
  // pessoa escolhe, e por isso passa antes da conferência de etapa.
  if (mensagem.tipo === 'previa') {
    pintarEscala(mensagem.dados, mensagem.pedido ?? '');
    return;
  }

  // Um pedido que o motor recusa também é uma resposta sobre a escala, e é a
  // mais útil de todas: dizê-la aqui evita que a pessoa escolha, toque em
  // Resolver e só então descubra que o problema não cabe no aparelho.
  if (mensagem.tipo === 'erro' && mensagem.estagio === 'previa') {
    pintarEscalaRecusada(mensagem.mensagem, mensagem.pedido ?? '');
    return;
  }

  if (mensagem.etapa !== etapa) return;

  if (mensagem.tipo === 'erro') {
    esconderTudo();
    $('ex-erro').hidden = false;
    $('ex-erro').innerHTML =
      `<b>O motor recusou o pedido.</b> <em>${escapar(mensagem.mensagem)}</em>`;
    encerrar();
    return;
  }

  switch (mensagem.tipo) {
    case 'analise':
      pintarAnalise(mensagem.dados);
      enviar({ tipo: 'limitar' });
      break;

    case 'piso':
      // Um fechamento guardado já traz o piso, e ele foi determinado com o
      // mesmo esforço. Refazer a varredura para chegar ao mesmo número custaria
      // minutos no esforço fundo — e continuar um trabalho não pode começar
      // repetindo a parte mais cara do que já foi feito.
      if (estado.piso > 0 && estado.origem) {
        pintarPiso({ valor: estado.piso, origem: estado.origem, fechado: estado.fechado });
        comecarEscalada();
        break;
      }
      pintarPiso(mensagem.dados);
      // O piso é o teto: é ele que limita quantas cartelas podem existir. A
      // escalada só pode começar depois de saber esse número.
      enviar({ tipo: 'aprofundar', orcamento: esforco * NOS_POR_ESFORCO });
      break;

    case 'escalada-passo':
      pintarEscalada(mensagem.dados, false);
      pintarCurva(mensagem.curva);
      if (mensagem.estado) guardarTrabalho(mensagem.estado);
      break;

    case 'escalada': {
      escalandoAgora = false;

      /*
       * A otimização não pode devolver menos do que já havia.
       *
       * Esta linha era uma atribuição direta, e havia um caminho em que ela
       * destruía trabalho: a prova exata (`receberProva`) troca
       * `estado.cartelas` por uma coleção **menor e já verificada** quando a
       * varredura acha uma. Se depois disso alguém tocasse em "Ativar
       * otimização" e mandasse parar, o resultado do otimizador entrava por
       * cima — medido devolvendo 13 onde a pessoa tinha 12.
       *
       * É a pior forma do defeito: o botão promete "tentar menos", a nota
       * abaixo dele promete que parar "devolve o melhor número alcançado", e
       * o aplicativo entrega mais. Num aplicativo cuja tese é a honestidade
       * sobre o que se encontrou, perder em silêncio um número melhor é a
       * contradição mais cara que ele podia ter.
       *
       * O incumbente só resiste se for menor **e** já ter passado pelo
       * verificador: uma coleção menor que ninguém conferiu não é melhor
       * coisa nenhuma, é trabalho pela metade.
       */
      const incumbenteVale =
        estado.verificado && estado.cartelas.length > 0
        && estado.cartelas.length < mensagem.cartelas.length;

      if (incumbenteVale) {
        avisar(
          `A otimização parou em ${milhares(mensagem.cartelas.length)}; o `
          + `fechamento de ${milhares(estado.cartelas.length)} que você já tinha `
          + 'continua sendo o seu.'
        );
      } else {
        estado.cartelas = mensagem.cartelas;
      }
      // O método vai dentro do arquivo exportado, e precisa dizer o que
      // realmente produziu aquelas cartelas: quem fechou acima do piso passou
      // pelo motor de Turán, e não pela escalada.
      estado.metodo = mensagem.dados.alem_do_piso
        ? 'construção avançada: órbitas cíclicas e recursão de Turán'
        : mensagem.dados.fase === 'subindo'
          ? 'escalada de cobertura'
          : 'escalada de cobertura, com reorganização';
      pintarEscalada(mensagem.dados, true);
      pintarCurva(mensagem.curva);
      guardarTrabalho(mensagem.estado);
      if (mensagem.interrompida) {
        estado.parado = true;
        avisar('Escalada interrompida. O trabalho ficou guardado.');
      }
      // Mesmo interrompida, a coleção passa pelo verificador antes de aparecer:
      // nada aqui vale pela palavra de quem produziu.
      enviar({ tipo: 'verificar', cartelas: estado.cartelas });
      break;
    }

    case 'verificacao': {
      pintarVerificacao(mensagem.dados);
      // Quem mandou parar não quer que o aplicativo siga para o estágio
      // seguinte por conta própria.
      if (estado.parado) {
        pintarProva(
          [
            '<b>Interrompido.</b>',
            '<em>Tudo o que está acima continua valendo, e o trabalho ficou ' +
              'guardado no histórico.</em>',
          ],
          false
        );
        pintarResultado();
        break;
      }
      if (estado.familiaPendente) {
        const familia = estado.familiaPendente;
        const dados = estado.dadosPendentes;
        estado.familiaPendente = null;
        estado.dadosPendentes = null;
        seguirDepoisDaProva(familia, dados);
      } else {
        depoisDaVerificacao();
      }
      break;
    }

    case 'piso-fundo':
      pintarPiso(mensagem.dados);
      comecarEscalada();
      break;

    case 'prova-passo': {
      const { dados, orcamento } = mensagem;
      const feito = Math.min(1, dados.visitados / Math.max(1, orcamento));
      $('ex-prova-barra').style.width = `${Math.round(feito * 100)}%`;
      pintarProva(
        [
          ...estado.linhasDaProva,
          `<em>Varrendo ${
            mensagem.familia === 'ciclica' ? 'a família cíclica' : 'todas as coleções'
          }: ${milhares(dados.visitados)} nós, recorde ${milhares(dados.recorde)}.</em>`,
        ],
        true
      );
      break;
    }

    case 'prova':
      if (mensagem.interrompida) {
        estado.parado = true;
        avisar('Prova interrompida.');
      }
      receberProva(mensagem);
      break;
  }
};

/* ─────────── as abas ─────────── */

/**
 * Troca o painel visível.
 *
 * Mesma mecânica da Lotinha, e é `.painel.ativo` no CSS que faz o trabalho. As
 * abas existem para o histórico não virar o décimo segundo cartão de uma página
 * que já é longa: ele é outro lugar, não outra etapa.
 */
$('ex-parar').addEventListener('click', () => {
  trabalhador.postMessage({ tipo: 'parar' });
  avisar('Parando…');
});

/*
 * Os dois comandos manuais.
 *
 * Cada um tem dois caminhos, e a escolha entre eles é `escalandoAgora`: com o
 * laço vivo, uma bandeira aplicada entre lotes; com o laço encerrado, uma
 * retomada do motor já com o pedido junto. Antes, o segundo caminho era
 * escolhido por `rodando`, que continua verdadeiro durante a verificação e a
 * prova — e tocar em otimizar naquela janela não fazia nada.
 */
$('ex-avancar').addEventListener('click', () => {
  avancoFoiPedido = true;
  $('ex-avancar').hidden = true;
  if (escalandoAgora) {
    trabalhador.postMessage({ tipo: 'avancar-alem-do-piso' });
    avisar('Construção avançada ligada.');
  } else if (retomarComPedido({ avancar: true })) {
    avisar('Construção avançada ligada.');
  }
});

$('ex-otimizar').addEventListener('click', () => {
  $('ex-otimizar').hidden = true;
  if (escalandoAgora) {
    trabalhador.postMessage({ tipo: 'otimizar' });
    avisar('Otimização ligada.');
  } else if (retomarComPedido({ otimizar: true })) {
    avisar('Otimização ligada.');
  }
});

$('ex-ver-cartelas').addEventListener('click', alternarCartelas);

$('ex-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(textoDoResultado());
    avisar('Copiado.');
  } catch {
    avisar('O navegador não deixou copiar.');
  }
});

$('ex-compartilhar').addEventListener('click', async () => {
  try {
    await navigator.share({ text: textoDoResultado() });
  } catch {
    /* cancelar não é erro */
  }
});

window.addEventListener('pagehide', () => {
  if (rodando && estado?.guardado) guardarTrabalho(estado.guardado);
});
