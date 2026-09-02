/*
 * A tela do Construtor Matemático Exato.
 *
 * Onze estágios, e ele mostra os onze. A tentação seria uma chamada só que
 * devolvesse um número no fim de dois minutos — e ela esconderia justamente o
 * que há para ver: que determinar o mínimo, construir, verificar e provar são
 * quatro trabalhos diferentes, e que só o encontro dos dois últimos autoriza a
 * palavra "mínimo". Depois deles vêm o dinheiro, a conferência e a simulação,
 * que respondem o "e daí?"; e ao lado, numa aba própria, o histórico dos
 * fechamentos.
 *
 * Todo estágio longo mostra progresso ao vivo e pode ser parado. A versão
 * anterior não mostrava nada, e uma tela parada é indistinguível de uma tela
 * travada — quem está olhando não tem como saber se espera ou se desiste.
 *
 * A regra do que pode ser afirmado mora em `exato-veredito.js`, sem DOM e sem
 * WebAssembly. Aqui só há pintura e sequência.
 */

import {
  frase,
  folga,
  veredito,
  MINIMO,
  PARCIAL,
  FALHA,
  CONTRADICAO,
} from './exato-veredito.js';
import { definirFechamento, esquecerFechamento } from './exato-conferencia.js';
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

/* ─────────── os números escolhidos ─────────── */

let universo = 25;
const escolhidos = new Set();
let jogo = 17;
let sorteio = 15;
let garantia = 15;
let premiadas = 1;

function escapar(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const milhares = (n) => Number(n).toLocaleString('pt-BR');

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
  const aviso = $('ex-aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(avisar.relogio);
  avisar.relogio = setTimeout(() => {
    aviso.hidden = true;
  }, 2600);
}

/* ─────────── binomiais, para a tela contar sozinha ─────────── */

function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < Math.min(k, n - k); i += 1) {
    total = (total * (n - i)) / (i + 1);
  }
  return Math.round(total);
}

/**
 * Quantas cartelas distintas conseguem atender um mesmo sorteio.
 *
 * É o teto de cartelas premiadas: acima dele não há o que comprar, só repetir
 * cartela — que soma custo e prêmio na mesma proporção e não muda nada.
 */
function maximoPremiadas(v, k, j, t) {
  let total = 0;
  for (let i = t; i <= Math.min(k, j); i += 1) {
    if (k - i <= v - j) total += combinacoes(j, i) * combinacoes(v - j, k - i);
  }
  return Math.max(1, Math.min(total, 1000));
}

/* ─────────── a grade e os parâmetros ─────────── */

function montarGrade() {
  const grade = $('ex-grade');
  grade.innerHTML = '';
  for (let n = 1; n <= universo; n += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'numero';
    b.textContent = String(n).padStart(2, '0');
    b.dataset.n = String(n);
    b.addEventListener('click', () => {
      if (escolhidos.has(n)) escolhidos.delete(n);
      else escolhidos.add(n);
      pintarParametros();
    });
    grade.appendChild(b);
  }
}

/** Uma fileira de botões de opção, com o valor ativo marcado. */
function montarOpcoes(id, valores, atual, aoEscolher) {
  const alvo = $(id);
  alvo.innerHTML = '';
  for (const valor of valores) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao' + (valor === atual ? ' ativa' : '');
    b.textContent = String(valor);
    b.dataset.valor = String(valor);
    b.setAttribute('aria-pressed', String(valor === atual));
    b.addEventListener('click', () => {
      aoEscolher(valor);
      pintarParametros();
    });
    alvo.appendChild(b);
  }
}

/** A escala de cartelas premiadas: de 1 a 8, e sempre incluindo o teto. */
function escalaDePremiadas(teto) {
  const escala = [];
  for (let r = 1; r <= Math.min(teto, 8); r += 1) escala.push(r);
  if (!escala.includes(teto)) escala.push(teto);
  if (!escala.includes(premiadas)) escala.splice(escala.length - 1, 0, premiadas);
  return escala.sort((a, b) => a - b);
}

function pintarParametros() {
  pintarParametrosSem();
  pintarOfertaDeRetomar();
  pedirAEscala();
}

function pintarParametrosSem() {
  const v = escolhidos.size;

  // Os limites de cada parâmetro dependem dos outros, e mostrar opções que não
  // descrevem problema nenhum só faria a pessoa descobrir isso por erro.
  jogo = Math.max(1, Math.min(jogo, Math.max(v, 1)));
  sorteio = Math.max(1, Math.min(sorteio, Math.max(v, 1)));
  garantia = Math.max(1, Math.min(garantia, Math.min(jogo, sorteio)));
  const teto = v > 0 ? maximoPremiadas(v, jogo, sorteio, garantia) : 1;
  premiadas = Math.max(1, Math.min(premiadas, teto));

  for (const b of document.querySelectorAll('#ex-grade .numero')) {
    const marcado = escolhidos.has(Number(b.dataset.n));
    b.classList.toggle('escolhido', marcado);
    b.setAttribute('aria-pressed', String(marcado));
  }

  $('ex-contagem').innerHTML =
    v === 0
      ? '<b>Nenhum número marcado.</b> <em>Marque os que você vai jogar.</em>'
      : `<b>${v} de ${universo} marcados.</b> <em>${
          combinacoes(v, sorteio) === 1
            ? 'Há um único sorteio possível dentro deles.'
            : `São ${milhares(combinacoes(v, sorteio))} sorteios possíveis dentro deles.`
        }</em>`;

  const ateV = (limite) => {
    const lista = [];
    for (let n = 1; n <= limite; n += 1) lista.push(n);
    return lista;
  };

  montarOpcoes('ex-jogo', ateV(Math.max(v, 1)), jogo, (n) => {
    jogo = n;
  });
  montarOpcoes('ex-sorteio', ateV(Math.max(v, 1)), sorteio, (n) => {
    sorteio = n;
  });
  montarOpcoes('ex-garantia', ateV(Math.min(jogo, sorteio)), garantia, (n) => {
    garantia = n;
  });
  montarOpcoes('ex-premiadas', escalaDePremiadas(teto), premiadas, (n) => {
    premiadas = n;
  });

  const botao = $('ex-resolver');
  const falta = jogo > v || v === 0;
  botao.disabled = falta || rodando;
  botao.textContent = falta ? 'Marque ao menos o tamanho do jogo' : 'Resolver';
}

function trocarUniverso() {
  const novo = Number($('ex-universo').value);
  if (!Number.isInteger(novo) || novo < 2 || novo > 31) return;
  universo = novo;
  for (const n of [...escolhidos]) if (n > universo) escolhidos.delete(n);
  montarGrade();
  pintarParametros();
}

/* ─────────── a escala do problema, antes de começar ─────────── */

/*
 * Quantas cartelas este pedido vai custar — perguntado antes de resolver.
 *
 * Sem isto, a única forma de saber se uma configuração dá 16 cartelas ou 27.000
 * é resolvê-la. São dois problemas de naturezas completamente diferentes — um
 * termina em segundos, o outro enche o aparelho — e escolher entre eles às
 * cegas é o tipo de coisa que faz alguém desistir da ferramenta.
 *
 * O cálculo é o mesmo do estágio 4 e leva microssegundos: é contagem, não
 * busca. O que ele responde é o **piso**, que aqui é também o teto — o número
 * de cartelas que a escalada vai montar.
 */
let relogioDaEscala = null;
let escalaPedida = null;

function pedirAEscala() {
  const atual = pedidoDaTela();
  $('ex-escala').innerHTML = '';
  if (!atual || rodando) return;

  // Enquanto o dedo desliza pelas opções, o pedido muda várias vezes por
  // segundo. Perguntar a cada mudança seria dezenas de idas ao motor para
  // mostrar um número que já mudou.
  clearTimeout(relogioDaEscala);
  relogioDaEscala = setTimeout(() => {
    escalaPedida = JSON.stringify(atual);
    trabalhador.postMessage({ tipo: 'previa', pedido: escalaPedida });
  }, 250);
}

/** O motor recusou o pedido — e é melhor saber disso agora que depois. */
function pintarEscalaRecusada(motivo, doPedido) {
  if (rodando || doPedido !== JSON.stringify(pedidoDaTela())) return;
  $('ex-escala').innerHTML =
    `<b>Este pedido não cabe neste aparelho.</b> <em>${escapar(motivo)}</em>`;
}

function pintarEscala(dados, doPedido) {
  // A resposta pode chegar depois de a pessoa já ter mudado de ideia.
  if (rodando || doPedido !== JSON.stringify(pedidoDaTela())) return;

  const quantas = dados.valor;
  const porte =
    quantas <= 100
      ? 'termina em segundos'
      : quantas <= 2_000
        ? 'leva algum tempo, e cabe folgado no aparelho'
        : 'é um fechamento grande — vai levar minutos e ocupar bastante espaço';

  $('ex-escala').innerHTML =
    `<b>Este pedido custa ${emCartelas(quantas)}.</b> ` +
    `<em>É o mínimo matemático, e também o teto: a escalada monta até aí e não ` +
    `passa. ${porte}.</em>`;
}

/* ─────────── a sequência ─────────── */

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

/** As dezenas marcadas, em ordem: a posição `i` da cartela é o número `lista[i]`. */
function dezenas() {
  return [...escolhidos].sort((a, b) => a - b);
}

/** Os cinco números como estão na tela, sem começar nada. */
function pedidoDaTela() {
  const lista = dezenas();
  if (lista.length === 0 || jogo > lista.length) return null;
  return { v: lista.length, k: jogo, j: sorteio, t: garantia, r: premiadas };
}

function comecar(estadoGuardado = null, sessao = null) {
  const lista = dezenas();
  if (lista.length === 0 || jogo > lista.length) return;

  etapa += 1;
  rodando = true;
  pedido = { v: lista.length, k: jogo, j: sorteio, t: garantia, r: premiadas };
  esforco = Number($('ex-esforco').value) || 1;
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
  $('ex-resolver').disabled = true;
  $('ex-analise-cartao').hidden = false;
  for (const id of ['ex-alvos', 'ex-blocos', 'ex-por-bloco', 'ex-por-alvo']) {
    $(id).textContent = '…';
  }
  estado.guardado = estadoGuardado;
  $('ex-continuar').hidden = true;
  $('ex-retomar-aviso').hidden = true;
  trabalhador.postMessage({ tipo: 'retomar' });
  enviar({ tipo: 'analisar' });
}

function enviar(mensagem) {
  trabalhador.postMessage({ ...mensagem, pedido: JSON.stringify(pedido), etapa });
}

function encerrar() {
  rodando = false;
  escalandoAgora = false;
  $('ex-parar').hidden = true;
  $('ex-avancar').hidden = true;
  encerrarASessao();
  pintarParametros();
}

/* ─────────── a pintura, estágio a estágio ─────────── */

function pintarAnalise(dados) {
  $('ex-alvos').textContent = grande(dados.alvos);
  $('ex-blocos').textContent = grande(dados.blocos);
  $('ex-por-bloco').textContent = grande(dados.alvos_por_bloco);
  $('ex-por-alvo').textContent = grande(dados.blocos_por_alvo);
}

function pintarPiso(dados) {
  estado.piso = dados.valor;
  estado.origem = dados.origem;
  estado.fechado = dados.fechado;
  $('ex-piso-cartao').hidden = false;
  $('ex-piso').innerHTML =
    `<b>Nada menor que ${emCartelas(dados.valor)} existe.</b>` +
    `<br><em>De onde vem: ${escapar(dados.origem)}.</em>` +
    (dados.fechado
      ? ''
      : '<br><em>Com sorteio diferente da garantia, ou mais de uma cartela premiada, ' +
        'só a cota de contagem vale — as outras falam de cobertura simples, e esticá-las ' +
        'até aqui inventaria um piso.</em>');
}

/** A cobertura como a pessoa lê: uma porcentagem com uma casa. */
function porcento(fracao) {
  return `${(fracao * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
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
          'garantia ser cumprida — o resultado deixa de ser o mínimo. Enquanto a ' +
          'cobertura sobe, vale esperar.'
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

  $('ex-cartelas-agora').textContent = milhares(passo.cartelas);
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
        `<br><em>Acima do piso de ${milhares(passo.piso)}, pela construção ` +
        `avançada: a garantia está cumprida, e este não é o mínimo.</em>`
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

  // As cartelas existem: a conferência passa a ter o que conferir.
  //
  // Vale mesmo quando a cobertura ficou abaixo de 100%. Um fechamento parcial
  // é o que a pessoa tem na mão, e saber quanto ele rendeu num sorteio é
  // justamente a pergunta que sobra quando a garantia não foi alcançada.
  definirFechamento({ cartelas: estado.cartelas, numeros, pedido });

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
  pintarHistorico();
}

/** Fecha a linha do histórico: o motor não está mais trabalhando nela. */
function encerrarASessao() {
  if (!sessaoEmCurso) return;
  historico.encerrar(sessaoEmCurso);
  pintarHistorico();
}

/**
 * Mostra, ou esconde, a oferta de continuar de onde parou.
 *
 * Só aparece quando os cinco números na tela são os mesmos de algum fechamento
 * guardado — retomar sobre outra configuração seria continuar o problema errado.
 */
function pintarOfertaDeRetomar() {
  const atual = pedidoDaTela();
  const guardado = atual ? historico.paraOPedido(atual) : null;
  const serve = Boolean(guardado) && !rodando;
  $('ex-continuar').hidden = !serve;
  $('ex-retomar-aviso').hidden = !serve;
  if (!serve) return;

  $('ex-retomar-aviso').innerHTML =
    `<b>Há trabalho guardado para estes números.</b> <em>${
      historico.contarCartelas(guardado)
        ? `${milhares(historico.contarCartelas(guardado))} cartelas, ${porcento(
            guardado.cobertura
          )} de ` +
          'cobertura. '
        : ''
    }Continuar retoma de onde parou, sem repetir nada.</em>`;
}

/* ─────────── a tela do histórico ─────────── */

/** O selo de cada linha: o que aquele fechamento alcançou. */
function seloDaSessao(sessao) {
  if (sessao.emCurso) return '<span class="sessao-marca viva">trabalhando</span>';
  if (
    sessao.verificado &&
    historico.contarCartelas(sessao) <= sessao.piso &&
    sessao.piso > 0
  ) {
    return '<span class="sessao-marca otima">★ mínimo</span>';
  }
  return '';
}

function pintarHistorico() {
  const sessoes = historico.listar();
  const lista = $('ex-hist-lista');

  $('ex-hist-limpar').hidden = sessoes.length === 0;

  if (sessoes.length === 0) {
    lista.innerHTML =
      '<div class="historico-vazio">Nenhum fechamento guardado ainda. ' +
      'O primeiro aparece aqui assim que a escalada começar a montar cartelas.</div>';
    pintarInterrompido();
    return;
  }

  lista.innerHTML = sessoes
    .map(
      (s) =>
        `<div class="sessao${s.emCurso ? ' em-andamento' : ''}" data-sessao="${escapar(s.id)}">` +
        `<div class="sessao-topo">` +
        `<span class="sessao-quantia">${milhares(historico.contarCartelas(s))}</span>` +
        `<span class="sessao-unidade">cartela${
          historico.contarCartelas(s) === 1 ? '' : 's'
        }</span>` +
        seloDaSessao(s) +
        `</div>` +
        `<div class="sessao-config">${escapar(historico.descrever(s.pedido))}` +
        `<br>${porcento(s.cobertura)} de cobertura · piso ${milhares(s.piso)} · ` +
        `${escapar(historico.quando(s.atualizadaEm))}</div>` +
        `<div class="sessao-acoes">` +
        `<button data-ver="${escapar(s.id)}">Abrir</button>` +
        `<button class="continuar" data-abrir="${escapar(s.id)}">Continuar</button>` +
        `<button data-exportar="${escapar(s.id)}">Exportar</button>` +
        `<button class="excluir" data-excluir="${escapar(s.id)}">✕</button>` +
        `</div></div>`
    )
    .join('');

  for (const botao of lista.querySelectorAll('[data-ver]')) {
    botao.addEventListener('click', () => abrirParaVer(botao.dataset.ver));
  }
  for (const botao of lista.querySelectorAll('[data-abrir]')) {
    botao.addEventListener('click', () => continuarSessao(botao.dataset.abrir));
  }
  for (const botao of lista.querySelectorAll('[data-exportar]')) {
    botao.addEventListener('click', () => exportarSessao(botao.dataset.exportar));
  }
  for (const botao of lista.querySelectorAll('[data-excluir]')) {
    botao.addEventListener('click', () => excluirSessao(botao.dataset.excluir));
  }

  pintarInterrompido();
}

/*
 * O trabalho que ficou em andamento quando o aplicativo fechou.
 *
 * Responde à pergunta que aparece ao reabrir depois de uma noite: o motor
 * estava rodando? O sistema pode ter encerrado a página por bateria, por
 * memória, ou porque a pessoa passou tempo demais noutro aplicativo — e em
 * nenhum desses casos o aplicativo teve chance de anotar que parou.
 */
function pintarInterrompido() {
  const viva = historico.interrompida();
  const mostrar = Boolean(viva) && viva.id !== sessaoEmCurso;
  $('ex-hist-interrompido-cartao').hidden = !mostrar;
  if (!mostrar) return;

  $('ex-hist-interrompido').innerHTML =
    `<div class="referencia"><b>${emCartelas(historico.contarCartelas(viva))} em ${escapar(
      historico.descrever(viva.pedido)
    )}.</b> <em>${porcento(viva.cobertura)} de cobertura, trabalhado ${escapar(
      historico.quando(viva.atualizadaEm)
    )}. O motor estava rodando quando o aplicativo fechou.</em></div>`;
  $('ex-hist-retomar').dataset.sessao = viva.id;
}

/**
 * Abre um fechamento guardado e continua de onde ele parou.
 *
 * Repõe a grade e as regras a partir do que foi salvo — as cartelas são
 * posições, e sem os números marcados elas não voltam a ser números — e entrega
 * o estado ao motor. O piso salvo evita refazer os estágios 3 e 4, que no
 * esforço fundo levam minutos para chegar ao mesmo número.
 */
/**
 * Repõe na tela os números e as regras de um fechamento guardado.
 *
 * Comum aos dois jeitos de abri-lo: só olhar, e continuar de onde parou.
 */
function reporOsParametros(sessao) {
  universo = Math.max(sessao.universo || 0, ...sessao.numeros);
  $('ex-universo').value = String(universo);
  montarGrade();
  escolhidos.clear();
  for (const n of sessao.numeros) escolhidos.add(n);
  jogo = sessao.pedido.k;
  sorteio = sessao.pedido.j;
  garantia = sessao.pedido.t;
  premiadas = sessao.pedido.r;
  $('ex-esforco').value = String(sessao.esforco ?? 4);
  pintarParametrosSem();
  sessaoEmCurso = sessao.id;
  mostrarPainel('exato');
  esquecerFechamento();
}

/** O fechamento guardado que a tela pode abrir agora, ou uma frase dizendo por quê não. */
function sessaoParaAbrir(id) {
  const sessao = historico.obter(id);
  if (!sessao) {
    avisar('Este fechamento já não está guardado.');
    pintarHistorico();
    return null;
  }
  if (rodando) {
    avisar('Pare o trabalho em curso antes de abrir outro.');
    return null;
  }
  return sessao;
}

/**
 * Abre um fechamento guardado **sem pôr o motor para trabalhar**.
 *
 * Este é o caminho que faltava, e a falta era cara: "Continuar" era o único
 * jeito de abrir um fechamento, e ele sempre retoma a escalada. Quem quisesse
 * apenas rever as cartelas, conferir um resultado ou simular sorteios punha o
 * aparelho a calcular — e num fechamento que não fecha, a calcular **para
 * sempre**, já que a escalada só para quando mandam.
 *
 * Aqui não há motor nenhum. As cartelas são decodificadas das máscaras que a
 * sessão guarda, e o veredito é remontado dos números que ela também guarda:
 * abrir passa a ser instantâneo, e o aparelho fica quieto.
 */
function abrirParaVer(id) {
  const sessao = sessaoParaAbrir(id);
  if (!sessao) return;

  reporOsParametros(sessao);

  etapa += 1;
  pedido = { ...sessao.pedido };
  esforco = sessao.esforco ?? 4;
  estado = {
    piso: sessao.piso,
    origem: sessao.origem,
    fechado: sessao.fechado,
    cartelas: historico.cartelasDaSessao(sessao),
    metodo: 'fechamento guardado',
    verificado: sessao.verificado,
    descobertos: sessao.descobertos,
    ciclicaFechou: false,
    linhasDaProva: [],
    familiaPendente: null,
    dadosPendentes: null,
    parado: true,
    // O passo que o veredito e a barra leem. Não veio do motor agora: veio de
    // quando este fechamento foi trabalhado, e é exatamente o que foi salvo.
    escalada: {
      cartelas: historico.contarCartelas(sessao),
      teto: sessao.piso,
      melhor_cobertura: sessao.cobertura,
      melhor_cartelas: historico.contarCartelas(sessao),
      fase: sessao.fase,
      rodadas: 0,
      fechou: sessao.verificado,
    },
    guardado: sessao.escalada,
    curva: sessao.curva ?? [],
    melhorCobertura: sessao.cobertura,
    desdeAMelhora: Date.now(),
  };

  esconderTudo();
  $('ex-piso-cartao').hidden = false;
  pintarPiso({ valor: sessao.piso, origem: sessao.origem, fechado: sessao.fechado });
  pintarEscalada(estado.escalada, true);
  pintarCurva(estado.curva);
  pintarVerificacao({
    cobre: sessao.verificado,
    descobertos: sessao.descobertos,
    alvos: combinacoes(pedido.v, pedido.j),
    premiadas: pedido.r,
  });
  pintarProva(
    [
      '<b>Fechamento guardado, aberto para consulta.</b>',
      '<em>O motor não foi acionado: o que está na tela é o que ficou salvo. ' +
        'Para retomar a escalada, use Continuar no histórico.</em>',
    ],
    false
  );
  pintarResultado();
  avisar('Fechamento aberto. O motor não está trabalhando.');
}

/** Abre um fechamento guardado e **retoma a escalada** de onde ela parou. */
function continuarSessao(id) {
  const sessao = sessaoParaAbrir(id);
  if (!sessao) return;
  reporOsParametros(sessao);
  comecar(sessao.escalada, sessao);
}

function excluirSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;
  if (
    !globalThis.confirm(
      `Excluir o fechamento de ${emCartelas(historico.contarCartelas(sessao))} em ` +
        `${historico.descrever(sessao.pedido)}? Isto não tem volta.`
    )
  ) {
    return;
  }
  if (sessaoEmCurso === id) sessaoEmCurso = null;
  historico.remover(id);
  pintarHistorico();
  avisar('Fechamento excluído.');
}

/* ─────────── o arquivo, para fora e para dentro ─────────── */

function exportarSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;

  const pacote = arquivoDeSessao.empacotar(sessao, {
    versao: CARIMBO,
    cartelas: historico.cartelasDaSessao(sessao),
  });
  const texto = JSON.stringify(pacote, null, 1);
  const nome = arquivoDeSessao.nomeDoArquivo(pacote);
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));

  const link = document.createElement('a');
  link.href = endereco;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Um quadro depois: revogar na mesma volta do laço cancela o download em
  // alguns navegadores antes de ele começar.
  setTimeout(() => URL.revokeObjectURL(endereco), 4000);
  avisar(`Exportado: ${nome}`);
}

/** O que o arquivo escolhido trouxe, esperando confirmação. */
let importacaoPendente = null;

async function lerArquivoEscolhido(entrada) {
  const arquivo = entrada.files?.[0];
  // Sempre limpo: escolher o mesmo arquivo duas vezes seguidas não dispara
  // `change` se o valor continuar lá.
  entrada.value = '';
  if (!arquivo) return;

  const previa = $('ex-hist-previa');
  previa.hidden = false;
  previa.innerHTML = '<em>Lendo o arquivo…</em>';

  let texto;
  try {
    texto = await arquivo.text();
  } catch {
    previa.innerHTML = '<b>Não deu para ler o arquivo.</b>';
    return;
  }

  const lido = arquivoDeSessao.interpretar(texto);
  if (!lido.ok) {
    importacaoPendente = null;
    $('ex-hist-confirmar-cartao').hidden = true;
    previa.innerHTML = `<b>Este arquivo não serve.</b> <em>${escapar(lido.erro)}</em>`;
    return;
  }

  importacaoPendente = lido.pacote;
  $('ex-hist-confirmar-cartao').hidden = false;
  const r = lido.resumo;
  previa.innerHTML =
    `<b>${emCartelas(r.cartelas)} em ${escapar(historico.descrever(r.pedido))}.</b> ` +
    `<em>${porcento(r.cobertura)} de cobertura, teto ${milhares(r.teto)}${
      r.verificado ? ', já verificado' : ''
    }.${r.criadoEm ? ` Exportado em ${escapar(r.criadoEm.slice(0, 10))}.` : ''}</em>`;
}

function confirmarImportacao() {
  if (!importacaoPendente) return;
  const sessao = historico.importar(arquivoDeSessao.paraSessao(importacaoPendente));
  importacaoPendente = null;
  $('ex-hist-confirmar-cartao').hidden = true;
  $('ex-hist-previa').hidden = true;
  pintarHistorico();
  avisar(`Guardado: ${emCartelas(historico.contarCartelas(sessao))}.`);
}

/* ─────────── o que vem depois de cada estágio ─────────── */

/** Manda a escalada começar, com o teto que o piso determinou. */
/**
 * Retoma o fechamento que está na tela com um comando já ligado.
 *
 * `retomar` limpa as bandeiras do trabalhador de propósito, então o pedido não
 * pode ser mandado por fora: ele viaja dentro da própria mensagem de escalar.
 */
function retomarComPedido(pedidoJunto) {
  if (!estado?.guardado) {
    avisar('Não há trabalho guardado para continuar.');
    return false;
  }
  etapa += 1;
  rodando = true;
  escalandoAgora = true;
  $('ex-parar').hidden = false;
  $('ex-resolver').disabled = true;
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
function mostrarPainel(qual) {
  for (const painel of document.querySelectorAll('main > .painel')) {
    painel.classList.toggle('ativo', painel.id === qual);
  }
  for (const aba of document.querySelectorAll('.aba[data-painel]')) {
    const ativa = aba.dataset.painel === qual;
    aba.classList.toggle('ativa', ativa);
    aba.setAttribute('aria-selected', String(ativa));
    aba.tabIndex = ativa ? 0 : -1;
  }
  if (qual === 'exato-historico') pintarHistorico();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/*
 * As setas trocam de aba — sem isto, a aba inativa some do teclado.
 *
 * `role="tablist"` com `tabindex="-1"` na aba não selecionada é o padrão ARIA,
 * e ele pressupõe navegação por setas: é ela que devolve o acesso que o
 * `tabindex` tirou. Sem o par, a aba Histórico ficava inalcançável por
 * teclado, e com ela o trabalho guardado, o retomar, o importar e o exportar.
 *
 * A Lotinha já fazia isto; esta tela tinha só a metade que fecha a porta.
 */
document.querySelector('.abas')?.addEventListener('keydown', (evento) => {
  const abas = [...document.querySelectorAll('.aba[data-painel]')];
  const atual = abas.indexOf(document.activeElement);
  if (atual < 0) return;

  const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[evento.key];
  let destino = null;
  if (passo) destino = (atual + passo + abas.length) % abas.length;
  else if (evento.key === 'Home') destino = 0;
  else if (evento.key === 'End') destino = abas.length - 1;
  if (destino === null) return;

  evento.preventDefault();
  mostrarPainel(abas[destino].dataset.painel);
  // O foco acompanha a seleção: deixá-lo para trás faria a próxima seta partir
  // da aba errada.
  abas[destino].focus();
});

for (const aba of document.querySelectorAll('.aba[data-painel]')) {
  aba.addEventListener('click', () => mostrarPainel(aba.dataset.painel));
}

/* ─────────── os botões do histórico ─────────── */

$('ex-hist-importar').addEventListener('click', () => $('ex-hist-arquivo').click());
$('ex-hist-arquivo').addEventListener('change', (e) => lerArquivoEscolhido(e.target));
$('ex-hist-confirmar').addEventListener('click', confirmarImportacao);
$('ex-hist-cancelar').addEventListener('click', () => {
  importacaoPendente = null;
  $('ex-hist-confirmar-cartao').hidden = true;
  $('ex-hist-previa').hidden = true;
});

$('ex-hist-retomar').addEventListener('click', (e) => {
  const id = e.currentTarget.dataset.sessao;
  if (id) continuarSessao(id);
});

$('ex-hist-dispensar').addEventListener('click', () => {
  const viva = historico.interrompida();
  if (viva) historico.encerrar(viva.id);
  pintarHistorico();
});

$('ex-hist-limpar').addEventListener('click', () => {
  const quantos = historico.quantidade();
  if (
    !globalThis.confirm(
      `Apagar ${quantos} fechamento${quantos === 1 ? '' : 's'} guardado${
        quantos === 1 ? '' : 's'
      }? Isto não tem volta, e o que não foi exportado se perde.`
    )
  ) {
    return;
  }
  historico.limpar();
  sessaoEmCurso = null;
  pintarHistorico();
  avisar('Histórico apagado.');
});

/*
 * Ficar sem espaço não pode acontecer em silêncio.
 *
 * Descartar os fechamentos mais antigos é melhor do que perder o que está sendo
 * feito agora, mas fazer isso calado é apagar trabalho pelas costas de quem o
 * guardou — e a pessoa só descobriria ao ir procurar e não achar.
 */
historico.quandoFaltarEspaco(({ descartadas, guardou }) => {
  const aviso = $('ex-hist-aviso');
  aviso.hidden = false;
  aviso.innerHTML =
    `<b>O aparelho ficou sem espaço.</b> <em>${milhares(descartadas)} fechamento${
      descartadas === 1 ? '' : 's'
    } mais antigo${descartadas === 1 ? '' : 's'} ${
      descartadas === 1 ? 'precisou' : 'precisaram'
    } sair para caber o de agora${
      guardou ? '' : ', e mesmo assim não coube'
    }. Exporte o que quiser manter.</em>`;
  avisar('Sem espaço: fechamentos antigos foram descartados.');
});

/* ─────────── os botões ─────────── */

$('ex-universo').addEventListener('input', trocarUniverso);
$('ex-limpar').addEventListener('click', () => {
  escolhidos.clear();
  pintarParametros();
});
$('ex-todos').addEventListener('click', () => {
  for (let n = 1; n <= universo; n += 1) escolhidos.add(n);
  pintarParametros();
});
$('ex-resolver').addEventListener('click', () => {
  // Começar de novo abre uma linha nova no histórico, e não sobrescreve a
  // anterior: o trabalho de antes continua guardado, que é o ponto de haver
  // histórico.
  sessaoEmCurso = null;
  esquecerFechamento();
  comecar();
});

$('ex-continuar').addEventListener('click', () => {
  const atual = pedidoDaTela();
  const guardado = atual ? historico.paraOPedido(atual) : null;
  if (guardado) continuarSessao(guardado.id);
});
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

// Começa com um pool cheio: quem quiser tirar números tira, e quem só quiser
// experimentar não precisa marcar vinte e cinco botões antes de ver a tela
// funcionar.
montarGrade();
for (let n = 1; n <= universo; n += 1) escolhidos.add(n);
pintarParametros();

// Guarda o trabalho antes de a página sumir, sem depender de um lote chegar.
window.addEventListener('pagehide', () => {
  if (rodando && estado?.guardado) guardarTrabalho(estado.guardado);
});

/*
 * O trabalho guardado pela versão de um fechamento só entra no histórico.
 *
 * Sem isto, quem tem uma escalada salva agora a veria sumir nesta atualização —
 * exatamente o oposto do que o histórico existe para garantir.
 */
const migrado = historico.migrarDoSlotUnico();
if (migrado) {
  avisar('O trabalho que estava guardado foi para o histórico.');
}
pintarHistorico();

// O service worker é o que faz o aplicativo abrir sem internet. Registrá-lo
// daqui é o que garante que quem entrar direto nesta página saia com ele. Ele é
// também quem sabe o carimbo desta construção, que vai dentro do arquivo
// exportado.
if ('serviceWorker' in navigator) {
  // `updateViaCache: 'none'` é o que impede o próprio `sw.js` de vir do cache
  // do navegador. Sem ele, quem entrasse direto nesta página podia ficar com
  // uma cópia velha do service worker e nunca perceber que havia versão nova
  // — as outras três telas já registravam assim, e esta tinha ficado de fora.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.tipo === 'versao') CARIMBO = String(data.versao ?? '');
  });
  navigator.serviceWorker.ready
    .then((registro) => {
      (navigator.serviceWorker.controller ?? registro.active)?.postMessage({ tipo: 'versao' });
    })
    .catch(() => {});
}
