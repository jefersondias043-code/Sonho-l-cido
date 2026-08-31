/*
 * A tela do Construtor Matemático Exato.
 *
 * O aplicativo tem oito estágios e mostra os oito. A tentação seria uma chamada
 * só que devolvesse um número no fim de dois minutos — e ela esconderia
 * justamente o que há para ver: que determinar o mínimo, construir, verificar e
 * provar são quatro trabalhos diferentes, e que só o encontro dos dois últimos
 * autoriza a palavra "mínimo".
 *
 * Todo estágio longo mostra progresso ao vivo e pode ser parado. A versão
 * anterior não mostrava nada, e uma tela parada é indistinguível de uma tela
 * travada — quem está olhando não tem como saber se espera ou se desiste.
 *
 * A regra do que pode ser afirmado mora em `exato-veredito.js`, sem DOM e sem
 * WebAssembly. Aqui só há pintura e sequência.
 */

import { frase, folga, veredito, MINIMO, PARCIAL, FALHA } from './exato-veredito.js';
import { definirFechamento, esquecerFechamento } from './exato-conferencia.js';

const $ = (id) => document.getElementById(id);

const trabalhador = new Worker('./exato-trabalhador.js', { type: 'module' });

/** Onde o trabalho em curso fica guardado, para continuar depois. */
const CHAVE_DO_TRABALHO = 'sonho-lucido:exato:escalada';

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

/** Acima disto as cartelas não são todas desenhadas — só copiadas. */
const CARTELAS_DESENHADAS = 500;

/*
 * Cada execução tem um número. Respostas de execuções anteriores chegam depois
 * de o usuário já ter mudado os parâmetros, e pintá-las mostraria o resultado
 * de um problema que não é mais o da tela.
 */
let etapa = 0;
let rodando = false;
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
      : `<b>${v} de ${universo} marcados.</b> <em>São ${milhares(
          combinacoes(v, sorteio)
        )} sorteios possíveis dentro deles.</em>`;

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

function comecar(estadoGuardado = null) {
  const lista = dezenas();
  if (lista.length === 0 || jogo > lista.length) return;

  etapa += 1;
  rodando = true;
  pedido = { v: lista.length, k: jogo, j: sorteio, t: garantia, r: premiadas };
  esforco = Number($('ex-esforco').value) || 1;
  estado = {
    piso: 0,
    origem: '',
    fechado: false,
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
  $('ex-parar').hidden = true;
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
    `<b>Nada menor que ${milhares(dados.valor)} cartelas existe.</b>` +
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
function pintarEscalada(passo, terminou) {
  $('ex-construcao-cartao').hidden = false;
  estado.escalada = passo;

  $('ex-cartelas-agora').textContent = milhares(passo.cartelas);
  $('ex-teto').textContent = milhares(passo.teto);
  $('ex-cobertura').textContent = porcento(passo.melhor_cobertura);
  $('ex-construcao-barra').style.width = `${(passo.melhor_cobertura * 100).toFixed(1)}%`;

  if (passo.fechou) {
    $('ex-construcao').innerHTML =
      `<b>Fechou em 100% com ${milhares(passo.melhor_cartelas)} cartelas.</b>` +
      `<br><em>Exatamente o teto — e o teto é o piso provado.</em>`;
    return;
  }

  const fase =
    passo.fase === 'subindo'
      ? `subindo — ${milhares(passo.cartelas)} de ${milhares(passo.teto)} cartelas`
      : `reorganizando as ${milhares(passo.cartelas)}, sem acrescentar nenhuma ` +
        `(${milhares(passo.rodadas)} rodadas)`;

  $('ex-construcao').innerHTML =
    `<b>${porcento(passo.melhor_cobertura)} de cobertura</b> <em>— ${escapar(fase)}.</em>` +
    (terminou ? '<br><em>Parada. O botão continuar retoma daqui.</em>' : '');
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
    teto: estado.piso,
    cobertura: estado.escalada?.melhor_cobertura ?? 0,
  };
}

function pintarResultado() {
  const encontrado = estado.cartelas.length;
  const dados = dadosDoVeredito();
  const qual = veredito(dados);

  $('ex-resultado-cartao').hidden = false;
  $('ex-frase').innerHTML = `<b>${escapar(frase(dados))}</b>`;
  if (qual === MINIMO) esquecerTrabalho();
  $('ex-encontrado').textContent = milhares(encontrado);
  $('ex-provado').textContent = `≥ ${milhares(estado.piso)}`;
  $('ex-folga').textContent =
    qual === PARCIAL ? porcento(dados.cobertura) : milhares(folga(encontrado, estado.piso));
  $('ex-folga').nextElementSibling.textContent =
    qual === PARCIAL ? 'cobertura alcançada' : 'folga que resta';
  $('ex-compartilhar').hidden = typeof navigator.share !== 'function';

  const numeros = dezenas();
  const mostradas = estado.cartelas.slice(0, CARTELAS_DESENHADAS);
  $('ex-aviso-cartelas').hidden = estado.cartelas.length <= CARTELAS_DESENHADAS;
  $('ex-aviso-cartelas').innerHTML =
    `<em>Desenhando as primeiras ${milhares(CARTELAS_DESENHADAS)} de ` +
    `${milhares(estado.cartelas.length)} — o botão Copiar leva todas.</em>`;

  $('ex-cartelas').innerHTML =
    `<div class="cartelas">${mostradas
      .map(
        (c, i) =>
          `<div class="cartela"><span class="indice">${String(i + 1).padStart(2, '0')}</span>` +
          `<span>${c.map((p) => String(numeros[p - 1]).padStart(2, '0')).join(' ')}</span></div>`
      )
      .join('')}</div>`;

  if (qual === MINIMO || qual === FALHA) $('ex-prova-barra').style.width = '100%';

  // As cartelas existem: a conferência passa a ter o que conferir.
  //
  // Vale mesmo quando a cobertura ficou abaixo de 100%. Um fechamento parcial
  // é o que a pessoa tem na mão, e saber quanto ele rendeu num sorteio é
  // justamente a pergunta que sobra quando a garantia não foi alcançada.
  definirFechamento({ cartelas: estado.cartelas, numeros, pedido });

  encerrar();
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
 * aplicativo não custar o que já foi feito. As cartelas vão como máscaras — um
 * número por cartela — então mesmo um conjunto de milhares cabe folgado.
 */
function guardarTrabalho(estadoJson) {
  if (!estadoJson) return;
  estado.guardado = estadoJson;
  try {
    localStorage.setItem(
      CHAVE_DO_TRABALHO,
      JSON.stringify({ pedido, escalada: estadoJson, quando: Date.now() })
    );
  } catch {
    // Sem espaço, ou armazenamento desligado. A escalada continua na memória:
    // perder a chance de retomar é menos grave do que parar de trabalhar.
  }
}

function trabalhoGuardado() {
  try {
    const bruto = localStorage.getItem(CHAVE_DO_TRABALHO);
    if (!bruto) return null;
    const guardado = JSON.parse(bruto);
    return guardado?.escalada && guardado?.pedido ? guardado : null;
  } catch {
    return null;
  }
}

function esquecerTrabalho() {
  try {
    localStorage.removeItem(CHAVE_DO_TRABALHO);
  } catch {
    /* nada a fazer */
  }
}

/** Os mesmos cinco números? Só então faz sentido oferecer retomar. */
function mesmoPedido(a, b) {
  if (!a || !b) return false;
  return ['v', 'k', 'j', 't', 'r'].every((campo) => a[campo] === b[campo]);
}

/**
 * Mostra, ou esconde, a oferta de continuar de onde parou.
 *
 * Só aparece quando os parâmetros na tela são os mesmos do trabalho guardado —
 * retomar sobre outra configuração seria continuar o problema errado.
 */
function pintarOfertaDeRetomar() {
  const guardado = trabalhoGuardado();
  const atual = pedidoDaTela();
  const serve = Boolean(guardado && atual && mesmoPedido(guardado.pedido, atual));
  $('ex-continuar').hidden = !serve || rodando;
  $('ex-retomar-aviso').hidden = !serve || rodando;
  if (!serve || rodando) return;

  let cartelas = 0;
  try {
    const e = JSON.parse(guardado.escalada);
    cartelas = (e.melhor ?? e.cartelas ?? []).length;
  } catch {
    /* envelope estragado: a oferta some na próxima tentativa */
  }
  $('ex-retomar-aviso').innerHTML =
    `<b>Há trabalho guardado para estes números.</b> <em>${
      cartelas ? `${milhares(cartelas)} cartelas já montadas. ` : ''
    }Continuar retoma de onde parou, sem repetir nada.</em>`;
}

/* ─────────── o que vem depois de cada estágio ─────────── */

/** Manda a escalada começar, com o teto que o piso determinou. */
function comecarEscalada(estadoGuardado = null) {
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

    case 'escalada':
      estado.cartelas = mensagem.cartelas;
      estado.metodo =
        mensagem.dados.fase === 'subindo'
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

    case 'verificacao': {
      pintarVerificacao(mensagem.dados);
      // Quem mandou parar não quer que o aplicativo siga para o estágio
      // seguinte por conta própria.
      if (estado.parado) {
        pintarProva(
          ['<b>Interrompido antes da prova.</b> <em>O que está acima continua valendo.</em>'],
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
  // Começar de novo abandona o que estava guardado: ou são outros parâmetros,
  // ou é a mesma configuração recomeçada de propósito.
  esquecerTrabalho();
  esquecerFechamento();
  comecar();
});

$('ex-continuar').addEventListener('click', () => {
  const guardado = trabalhoGuardado();
  if (!guardado) return;
  esquecerFechamento();
  comecar(guardado.escalada);
});
$('ex-parar').addEventListener('click', () => {
  trabalhador.postMessage({ tipo: 'parar' });
  avisar('Parando…');
});

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

// O service worker é o que faz o aplicativo abrir sem internet. Registrá-lo
// daqui é o que garante que quem entrar direto nesta página saia com ele.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
