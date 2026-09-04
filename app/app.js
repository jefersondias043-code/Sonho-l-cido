// Estado e desenho da tela. Uma tela só, e um estado só.
//
// O cliente não resolve nada: todas as respostas já estão no catálogo, prontas
// e conferidas. O que este arquivo faz é ler o que a pessoa quer, perguntar ao
// catálogo e mostrar. Nenhum número que chega à tela passou por um modelo de
// linguagem.

import * as catalogo from './catalogo.js';
import * as conferir from './conferir.js';
import * as volante from './volante.js';
import { escada, melhorEstrategia, melhorPool } from './estrategia.js';

const $ = (id) => document.getElementById(id);
const UNIVERSO = 25;
const guardar = (c, v) => { try { localStorage.setItem(c, JSON.stringify(v)); } catch { /**/ } };
const lembrar = (c, padrao) => {
  try { return JSON.parse(localStorage.getItem(c)) ?? padrao; } catch { return padrao; }
};

const estado = {
  orcamento: lembrar('orcamento', 5000), dezenas: new Set(lembrar('dezenas', [])),
  carteira: lembrar('carteira', []), garantiaMinima: 0,
  indice: null, precos: null, precosPublicados: null, acaso: null,
  plano: null, bilhetes: [], mascaras: [],
};

// ── dinheiro ────────────────────────────────────────────────────────────────

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (centavos) => reais.format((centavos ?? 0) / 100);

function emCentavos(texto) {
  const limpo = String(texto).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '');
  const numero = Number.parseFloat(limpo.replace(',', '.'));
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

// A régua é exponencial: de R$ 3 a R$ 50.000 em mil passos. Dinheiro anda por
// multiplicação — dez reais é enorme perto de trinta e invisível perto de dez mil.
const REGUA_MIN = 300;
const REGUA_MAX = 5000000;
const daRegua = (p) => Math.round(REGUA_MIN * (REGUA_MAX / REGUA_MIN) ** (p / 1000) / 100) * 100;
const paraARegua = (c) =>
  Math.round((1000 * Math.log(Math.max(c, REGUA_MIN) / REGUA_MIN)) / Math.log(REGUA_MAX / REGUA_MIN));

// ── arranque ────────────────────────────────────────────────────────────────

async function arrancar() {
  $('grade').innerHTML = Array.from({ length: UNIVERSO }, (_, i) => i + 1)
    .map((d) => `<button type="button" data-dezena="${d}" aria-pressed="false">${d}</button>`)
    .join('');
  ligarControles();
  registrarServico();

  try {
    [estado.indice, estado.precosPublicados, estado.acaso] = await Promise.all([
      catalogo.carregarIndice(),
      catalogo.carregarPrecos(),
      catalogo.carregarAcaso(),
    ]);
  } catch {
    $('resposta').innerHTML =
      '<p class="aviso">Sem internet na primeira visita. Abra de novo quando houver rede — ' +
      'depois disso o aplicativo funciona sem ela.</p>';
    return;
  }
  estado.precos = { ...estado.precosPublicados, ...lembrar('precos', {}) };

  const doLink = volante.lerLink(location.hash, UNIVERSO);
  if (doLink) {
    estado.dezenas = new Set(doLink.dezenas);
    estado.link = doLink;
  }

  desenharPrecos();
  desenharCarteira();
  atualizarDinheiro();
  responder();
}

function registrarServico() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const rede = () => ($('rede').textContent = navigator.onLine ? '' : 'sem internet');
  addEventListener('online', rede); addEventListener('offline', rede); rede();
  fetch('sw.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
    $('carimbo').textContent = `versão ${t.match(/CARIMBO = '([^']+)'/)?.[1] ?? '—'}`;
  }).catch(() => {});
}

// ── desenho ─────────────────────────────────────────────────────────────────

function atualizarDinheiro() {
  $('valor').value = dinheiro(estado.orcamento);
  $('regua').value = paraARegua(estado.orcamento);
}

function desenharGrade() {
  for (const botao of $('grade').children) {
    const marcada = estado.dezenas.has(Number(botao.dataset.dezena));
    botao.setAttribute('aria-pressed', String(marcada));
  }
  const n = estado.dezenas.size;
  $('contagem').textContent = n === 0 ? '' : `${n} ${n === 1 ? 'dezena' : 'dezenas'}`;
}

/// Recalcula a resposta e redesenha tudo que depende dela. Síncrono até a
/// resposta aparecer — o índice já está na memória, então a régua muda a tela na
/// mesma volta do laço. Só os bilhetes chegam depois, e só na primeira vez.
function responder() {
  desenharGrade();
  if (!estado.indice) return;

  const plano = melhorEstrategia(estado.indice, estado.precos, {
    orcamento: estado.orcamento,
    dezenas: estado.dezenas.size,
    garantiaMinima: estado.garantiaMinima,
  });
  estado.plano = plano;
  // Os degraus viram marcas na régua: arrastar passa a mostrar onde a resposta
  // muda, em vez de deixar a pessoa procurar às cegas.
  $('degraus').innerHTML = escada(estado.indice, estado.precos, estado.dezenas.size)
    .map((e) => `<option value="${paraARegua(e.custo)}" label="${e.t}"></option>`).join('');
  $('degrau').textContent = frasedoDegrau(plano);
  $('resposta').innerHTML = desenharResposta(plano);
  $('varredura').textContent = '';

  if (plano.escolha) {
    trazerBilhetes(plano.escolha);
    const { v, k, t, jogos, custo, piso } = plano.escolha;
    pedirAFrase('.resposta .frase',
      { v, k, t, jogos, custo, piso, degrauT: plano.degrau?.t, degrauFalta: plano.degrau?.falta });
  } else {
    estado.bilhetes = [];
    estado.mascaras = [];
    $('secao-bilhetes').innerHTML = '';
    $('acaso').innerHTML = '';
    $('bolao').innerHTML = '';
  }
}

function desenharResposta(plano) {
  if (plano.motivo === 'poucas-dezenas') {
    const f = plano.faltam;
    return `<p class="aviso">Marque mais ${f} ${f === 1 ? 'dezena' : 'dezenas'} — ou toque em
      <b>escolher por mim</b>.</p>`;
  }
  if (plano.motivo === 'sem-dinheiro') {
    return `<p class="aviso">Com ${estado.dezenas.size} dezenas, o fechamento mais barato custa
      ${dinheiro(plano.maisBarato.custo)}. Faltam ${dinheiro(plano.falta)} — ou marque menos
      dezenas.</p>`;
  }
  if (plano.motivo !== 'ok') {
    return `<p class="aviso">Não há fechamento catalogado para ${estado.dezenas.size} dezenas.</p>`;
  }

  const e = plano.escolha;
  const selo = e.provado
    ? '<span class="selo provado">mínimo provado</span>'
    : `<span class="selo conhecido">menor conhecido</span>
       <span class="piso">nenhum fechamento faz isso com menos de ${e.piso}</span>`;

  return `
    <p class="numero">${e.t}</p>
    <p class="unidade">acertos garantidos</p>
    <p class="detalhe">${e.jogos} ${e.jogos === 1 ? 'jogo' : 'jogos'} de ${e.k} dezenas ·
      <b>${dinheiro(e.custo)}</b>${plano.sobra ? ` · sobram ${dinheiro(plano.sobra)}` : ''}</p>
    <p class="selos">${selo}</p>
    <p class="frase">Se as 15 dezenas sorteadas saírem todas entre as suas ${e.v},
      ao menos um destes bilhetes terá <b>${e.t} acertos ou mais</b>. Não é probabilidade:
      é certeza, conferida sorteio por sorteio.</p>
    <p class="ressalva">${chanceDeCairDentro(e.v)} ${quantoPagaAGarantia(e.t)}</p>`;
}

/// Pede ao servidor uma frase sobre os números que já estão na tela — a troca
/// entre dinheiro e garantia, ou o que o sorteio rendeu. A frase determinística
/// já está lá; esta troca por outra, ou não troca. E só troca se não trouxer
/// **nenhum número** que não tenha saído daqui.
let pedidoDaVez = 0;
async function pedirAFrase(onde, dados) {
  const permitidos = new Set(
    Object.values(dados).filter(Number.isFinite)
      .flatMap((n) => [String(n), String(Math.round(n / 100))]),
  );
  const meu = ++pedidoDaVez;  // uma resposta atrasada não sobrescreve a atual
  try {
    const r = await fetch('api/explicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dados),
      signal: AbortSignal.timeout(4000),
    });
    const { frase } = await r.json();
    const alvo = document.querySelector(onde);
    if (alvo && meu === pedidoDaVez && (frase.match(/\d+/g) ?? []).every((n) => permitidos.has(n))) {
      alvo.textContent = frase;
    }
  } catch { /* a frase determinística fica */ }
}

/// Quanto a garantia vale em dinheiro. Sem este número, "garantido" se lê como
/// lucro garantido — e não é: nas faixas fixas o prêmio de uma cartela costuma
/// ficar abaixo do que o fechamento inteiro custou.
function quantoPagaAGarantia(t) {
  if (t > 13) return `O prêmio de ${t} acertos é rateado e muda a cada concurso.`;
  return `Esses ${t} acertos pagam ${dinheiro(estado.precos.premio[t])} por cartela premiada —
    o fechamento compra certeza, não lucro.`;
}

/// A ressalva que faz a garantia ser verdade inteira: ela só vale se as 15
/// sorteadas caírem dentro do pool, e essa chance — `C(v,15)/C(25,15)`, vinda do
/// catálogo — é o que separa uma promessa grande de uma promessa útil.
function chanceDeCairDentro(v) {
  const p = estado.acaso.dentro?.[v];
  if (!p) return '';
  if (p === 1) return 'Suas 25 dezenas são todas as que existem: a garantia vale sempre.';
  const uma = Math.round(1 / p).toLocaleString('pt-BR');
  return `A garantia só vale quando as 15 sorteadas caem todas entre as suas ${v} dezenas —
    o que acontece em cerca de 1 concurso a cada ${uma}.`;
}

/// O degrau sempre falta dinheiro: se coubesse no orçamento, ele já teria sido
/// escolhido — a resposta é a maior garantia que cabe.
function frasedoDegrau(plano) {
  if (plano.motivo !== 'ok') return '';
  const d = plano.degrau;
  if (!d) return `Não há garantia maior para comprar com ${plano.escolha.v} dezenas.`;
  return `Por mais ${dinheiro(d.falta)} você sobe de ${d.de} para ${d.t} acertos garantidos.`;
}

async function trazerBilhetes(escolha) {
  try {
    estado.mascaras = await catalogo.carregarFechamento(escolha);
  } catch (erro) {
    $('secao-bilhetes').innerHTML = `<p class="aviso">Não deu para trazer os bilhetes:
      ${erro.message}. O que você já abriu continua aqui.</p>`;
    return;
  }
  if (estado.plano?.escolha !== escolha) return; // a pessoa mudou de ideia no meio

  estado.bilhetes = catalogo.emDezenas(estado.mascaras, estado.dezenas);
  if (estado.link?.parte != null) {
    estado.bilhetes = volante.dividir(estado.bilhetes, estado.link.partes)[estado.link.parte];
  }
  desenharBilhetes();
  desenharAcaso();
  desenharBolao();
}

function desenharBilhetes() {
  $('secao-bilhetes').innerHTML = `
    ${estado.link?.parte == null ? '' : `<p class="ajuda">Você é a parte
      ${estado.link.parte + 1} de ${estado.link.partes} deste bolão: a garantia acima é do bolão
      inteiro, e estes ${estado.bilhetes.length} bilhetes são os que cabem a você.</p>`}
    <ol class="bilhetes">${estado.bilhetes
      .map((b) => `<li>${b.map((d) => `<span>${String(d).padStart(2, '0')}</span>`).join('')}</li>`)
      .join('')}</ol>
    <div class="linha">
      <button type="button" data-acao="copiar">Copiar</button>${[
        ['texto', 'Baixar texto'], ['csv', 'Baixar CSV'],
        ['imprimir', 'Imprimir volantes'], ['guardar', 'Guardar na carteira'],
      ].map(([a, r]) => `<button type="button" data-acao="${a}" class="discreto">${r}</button>`)
        .join('')}
    </div>`;
}

function desenharAcaso() {
  const e = estado.plano.escolha;
  const p = estado.acaso.chegam?.[`${e.v}-${e.k}`]?.[e.t];
  if (p == null) return;
  const noChute = 1 - (1 - p) ** e.jogos;
  $('acaso').innerHTML = `
    <p>Com ${dinheiro(e.custo)} você compra ${e.jogos} ${e.jogos === 1 ? 'bilhete' : 'bilhetes'}
      de ${e.k} dezenas. Se eles fossem escolhidos no chute, chegariam a ${e.t} acertos em
      <b>${(noChute * 100).toFixed(noChute > 0.995 ? 2 : 1)}%</b> dos sorteios que caem dentro das
      suas ${e.v} dezenas. Com o fechamento, em <b>100%</b>.</p>
    <p class="ressalva">Em média os dois pagam o mesmo: a mesma quantidade de bilhetes do mesmo
      tamanho tem a mesma expectativa de prêmio, com fechamento ou sem. O que o fechamento
      compra não é lucro — é certeza no lugar de sorte.</p>`;
}

function desenharBolao() {
  // Nunca mais partes que bilhetes: um link com zero bilhetes é uma promessa
  // vazia mandada para uma pessoa de verdade.
  const partes = Math.min(20, estado.bilhetes.length, Math.max(2, Number($('partes').value) || 2));
  const grupos = volante.dividir(estado.bilhetes, partes);
  const base = location.href.split('#')[0];
  const { v, k, t } = estado.plano.escolha;
  $('bolao').innerHTML = `<ol class="partes">${grupos
    .map((g, i) => {
      const link = volante.linkDaParte(base, {
        dezenas: estado.dezenas, v, k, t, parte: i, partes,
      });
      return `<li><b>Parte ${i + 1}</b> — ${g.length} bilhetes ·
        ${dinheiro(g.length * estado.precos.aposta[k])}
        <button type="button" class="discreto" data-link="${link}">Copiar link</button></li>`;
    })
    .join('')}</ol>`;
}

function desenharPrecos() {
  const grupos = [['aposta', 'Quanto custa a aposta', 'dezenas'],
    ['premio', 'Quanto paga cada faixa', 'acertos']];
  $('tabela-precos').innerHTML = `${grupos.map(([grupo, titulo, unidade]) =>
    `<div class="precos"><h3>${titulo}</h3>${Object.keys(estado.precos[grupo]).map((k) =>
      `<label>${k} ${unidade}<input type="text" inputmode="decimal" data-grupo="${grupo}"
        data-chave="${k}" value="${dinheiro(estado.precos[grupo][k])}"></label>`).join('')}</div>`)
    .join('')}
    <p class="ajuda">Valores de ${estado.precosPublicados.vigencia}.
      ${estado.precosPublicados.observacao}</p>`;
}

function desenharCarteira() {
  if (estado.carteira.length === 0) {
    $('carteira').innerHTML = '<p class="ajuda">Nada guardado ainda.</p>';
    return;
  }
  $('carteira').innerHTML = `<ol class="registros">${estado.carteira
    .map((r, i) => `<li><b>${r.t} acertos garantidos</b> · ${r.jogos} jogos de ${r.k} dezenas ·
        ${dinheiro(r.custo)} · ${new Date(r.data).toLocaleDateString('pt-BR')}${
      r.retorno != null
        ? ` · <b>voltou ${dinheiro(r.retorno)}</b>${r.concurso ? ` no concurso ${r.concurso}` : ''}`
        : ''}
        <button type="button" class="discreto" data-apagar="${i}">Apagar</button></li>`)
    .join('')}</ol>`;
}

// ── controles ───────────────────────────────────────────────────────────────

function ligarControles() {
  $('grade').addEventListener('click', (ev) => {
    const d = Number(ev.target.dataset?.dezena);
    if (!d) return;
    estado.dezenas.has(d) ? estado.dezenas.delete(d) : estado.dezenas.add(d);
    trocarDezenas(estado.dezenas);
  });

  $('escolher').addEventListener('click', () => estado.indice
    && sortearDezenas(melhorPool(estado.indice, estado.precos, estado.orcamento)));
  $('limpar').addEventListener('click', () => trocarDezenas(new Set()));
  // A régua e o campo dizem a mesma coisa de dois jeitos, e um valor que não dá
  // para ler — texto vazio, "abc" — deixa o orçamento como estava em vez de
  // zerar a tela.
  const trocarOrcamento = (centavos) => {
    if (centavos != null && centavos > 0) estado.orcamento = centavos;
    guardar('orcamento', estado.orcamento);
    atualizarDinheiro();
    responder();
  };
  $('regua').addEventListener('input', () => trocarOrcamento(daRegua(Number($('regua').value))));
  $('valor').addEventListener('change', () => trocarOrcamento(emCentavos($('valor').value)));

  $('secao-bilhetes').addEventListener('click', (ev) => acaoDosBilhetes(ev.target.dataset?.acao));
  $('partes').addEventListener('input', () => estado.bilhetes.length && desenharBolao());
  $('bolao').addEventListener('click', async (ev) => {
    const link = ev.target.dataset?.link;
    if (link) ev.target.textContent = (await volante.copiar(link)) ? 'Copiado' : link;
  });
  $('carteira').addEventListener('click', (ev) => {
    const i = ev.target.dataset?.apagar;
    if (i == null) return;
    estado.carteira.splice(Number(i), 1);
    guardar('carteira', estado.carteira);
    desenharCarteira();
  });
  $('tabela-precos').addEventListener('change', (ev) => {
    const { grupo, chave } = ev.target.dataset ?? {};
    if (!grupo) return;
    const c = emCentavos(ev.target.value);
    if (c != null && c >= 0) estado.precos[grupo][chave] = c;
    guardar('precos', { aposta: estado.precos.aposta, premio: estado.precos.premio });
    desenharPrecos();
    responder();
  });
  $('restaurar-precos').addEventListener('click', () => {
    estado.precos = structuredClone(estado.precosPublicados);
    guardar('precos', {});
    desenharPrecos();
    responder();
  });

  $('varrer').addEventListener('click', varrerTudo);
  $('buscar-sorteio').addEventListener('click', buscarSorteio);
  $('sorteio').addEventListener('change', conferirContraOSorteio);
  $('enviar-intencao').addEventListener('click', enviarIntencao);
  $('fechar-painel').addEventListener('click', () => ($('painel').hidden = true));
}

/// Marca `quantas` dezenas ao acaso: nenhuma é mais provável que outra, e de
/// **quantas** cuida `melhorPool`.
function sortearDezenas(quantas) {
  const todas = Array.from({ length: UNIVERSO }, (_, i) => i + 1);
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  trocarDezenas(new Set(todas.slice(0, quantas).sort((a, b) => a - b)));
}

/// Toda troca de dezenas passa por aqui: guarda, desfaz o vínculo com um link de
/// bolão — as dezenas já não são as daquele bolão — e redesenha.
function trocarDezenas(novas) {
  estado.dezenas = novas;
  estado.link = null;
  guardar('dezenas', [...novas]);
  responder();
}

async function acaoDosBilhetes(acao) {
  if (!acao || estado.bilhetes.length === 0) return;
  const e = estado.plano.escolha;
  const nome = `fechamento-${e.v}-${e.k}-${e.t}`;
  if (acao === 'copiar') {
    const deu = await volante.copiar(volante.comoTexto(estado.bilhetes));
    if (deu) $('secao-bilhetes').querySelector('[data-acao=copiar]').textContent = 'Copiado';
  } else if (acao === 'texto') {
    volante.baixar(`${nome}.txt`, volante.comoTexto(estado.bilhetes));
  } else if (acao === 'csv') {
    volante.baixar(`${nome}.csv`, volante.comoCsv(estado.bilhetes), 'text/csv');
  } else if (acao === 'imprimir') {
    $('painel-titulo').textContent = 'Volantes';
    $('painel-corpo').innerHTML = estado.bilhetes.map((b) => volante.comoVolante(b, UNIVERSO)).join('');
    $('painel').hidden = false;
    print();
  } else if (acao === 'guardar') {
    estado.carteira.unshift({
      data: Date.now(), v: e.v, k: e.k, t: e.t, jogos: e.jogos, custo: e.custo,
      dezenas: [...estado.dezenas].sort((a, b) => a - b),
    });
    guardar('carteira', estado.carteira);
    desenharCarteira();
    $('det-carteira').open = true;
  }
}

async function varrerTudo() {
  if (estado.mascaras.length === 0) return;
  const e = estado.plano.escolha;
  $('varredura').textContent = 'Conferindo…';
  const { sorteios, pior, comQuinze } = await conferir.varrer(estado.mascaras, e.v, e.t);
  $('varredura').innerHTML = pior >= e.t
    ? `Varridos os ${sorteios.toLocaleString('pt-BR')} resultados possíveis dentro das suas
       ${e.v} dezenas. No pior deles, o melhor bilhete faz <b>${pior} acertos</b> —
       a garantia de ${e.t} está de pé. ${
         comQuinze ? `Em ${comQuinze.toLocaleString('pt-BR')} deles, alguém acerta os 15.` : ''
       }`
    : `<b>A garantia não se sustentou</b>: existe resultado em que o melhor bilhete faz só
       ${pior} acertos. Não use este fechamento e avise quem publicou.`;
}

// ── sorteio oficial ─────────────────────────────────────────────────────────

function dezenasDoTexto(texto) {
  const numeros = String(texto).match(/\d+/g)?.map(Number) ?? [];
  const validas = [...new Set(numeros.filter((d) => d >= 1 && d <= UNIVERSO))];
  return validas.length === 15 ? validas : null;
}

async function buscarSorteio() {
  $('buscar-sorteio').textContent = 'Buscando…';
  try {
    const r = await fetch('api/resultado', { signal: AbortSignal.timeout(4000) });
    const { concurso, dezenas } = await r.json();
    if (!Array.isArray(dezenas) || dezenas.length !== 15) throw new Error('resposta estranha');
    guardar('ultimo-sorteio', { concurso, dezenas });
    $('sorteio').value = dezenas.join(' ');
    conferirContraOSorteio();
    $('buscar-sorteio').textContent = `Concurso ${concurso}`;
  } catch {
    const guardado = lembrar('ultimo-sorteio', null);
    if (guardado) {
      $('sorteio').value = guardado.dezenas.join(' ');
      conferirContraOSorteio();
      $('buscar-sorteio').textContent = `Concurso ${guardado.concurso} (guardado)`;
    } else {
      $('buscar-sorteio').textContent = 'Sem resultado — digite as 15 dezenas';
    }
  }
}

function conferirContraOSorteio() {
  const sorteadas = dezenasDoTexto($('sorteio').value);
  if (!sorteadas || estado.bilhetes.length === 0) {
    $('conferencia').innerHTML = sorteadas
      ? ''
      : '<p class="ajuda">Escreva as 15 dezenas sorteadas, separadas por espaço.</p>';
    return;
  }
  const { faixas, melhor } = conferir.contraOSorteio(estado.bilhetes, sorteadas);
  const voltou = conferir.retorno(faixas, estado.precos.premio);
  const custo = estado.bilhetes.length * estado.precos.aposta[estado.plano.escolha.k];
  const linhas = [...faixas.entries()].sort((a, b) => b[0] - a[0]);
  anotarNaCarteira(sorteadas, voltou);
  $('conferencia').innerHTML = `
    <p>Melhor bilhete: <b>${melhor} acertos</b>.</p>
    ${linhas.length
      ? `<ul>${linhas.map(([a, q]) => `<li>${q} × ${a} acertos</li>`).join('')}</ul>`
      : '<p>Nenhum bilhete premiado.</p>'}
    <p>Custou ${dinheiro(custo)}, voltou ${dinheiro(voltou)} —
      <b>${voltou >= custo ? 'saldo de' : 'faltaram'} ${dinheiro(Math.abs(voltou - custo))}</b>.</p>
    <p class="frase narracao">Prêmios de 14 e 15 acertos variam a cada concurso; os valores
      aqui são os da sua tabela.</p>`;
  pedirAFrase('#conferencia .narracao',
    { assunto: 'sorteio', melhor, jogos: estado.bilhetes.length, custo, voltou });
}

/// Fecha a conta do que está guardado: o que foi jogado, em que concurso, e
/// quanto voltou. Só mexe no registro que descreve exatamente este fechamento —
/// conferir um sorteio não pode reescrever a história de outro jogo.
function anotarNaCarteira(sorteadas, voltou) {
  const e = estado.plano.escolha;
  const registro = estado.carteira.find((r) => r.v === e.v && r.k === e.k && r.t === e.t);
  if (!registro) return;
  const ultimo = lembrar('ultimo-sorteio', null);
  const mesmas = (a) => [...a].sort((x, y) => x - y).join(' ');
  registro.retorno = voltou;
  registro.concurso = ultimo && mesmas(ultimo.dezenas) === mesmas(sorteadas) ? ultimo.concurso : null;
  guardar('carteira', estado.carteira);
  desenharCarteira();
}

// ── intenção em texto livre ─────────────────────────────────────────────────

/// Manda o texto ao servidor e aceita a resposta **só** se ela couber no
/// esquema. Fora do esquema é silêncio: nenhum número inventado toca o estado.
async function enviarIntencao() {
  const texto = $('intencao').value.trim();
  if (!texto) return;
  $('aviso-intencao').textContent = 'Lendo…';

  let pedido = null;
  try {
    const r = await fetch('api/intencao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto }),
      signal: AbortSignal.timeout(4000),
    });
    pedido = await r.json();
  } catch {
    pedido = null;
  }

  // Sem servidor, ou com resposta fora do esquema, o leitor determinístico
  // assume. Ele entende menos e nunca inventa — que é o que importa.
  if (!aplicarPedido(pedido) && !aplicarPedido(ler(texto))) {
    $('aviso-intencao').textContent =
      'Não consegui ler esse pedido. Use o campo de dinheiro e a grade — dá no mesmo.';
    return;
  }
  $('aviso-intencao').textContent = '';
}

/// O caminho alternativo, sem modelo nenhum. Não entende tudo, e não precisa —
/// precisa nunca inventar. Um número solto não é dinheiro: em "vinte dezenas,
/// garantir 14" não há valor, e ler o 14 como catorze reais seria pior do que
/// não entender.
const EM_REAIS = { cem: 100, duzentos: 200, trezentos: 300, quinhentos: 500, mil: 1000 };
const QUANTAS = ['quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte e cinco',
  'vinte e quatro', 'vinte e três', 'vinte e dois', 'vinte e um', 'vinte'];
function ler(texto) {
  const t = texto.toLowerCase();
  const achado = t.match(/(?:r\$\s*)?(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|conto|pila)/)
    ?? t.match(/r\$\s*(\d[\d.]*(?:,\d{1,2})?)/);
  const orcamento = achado
    ? Number(achado[1].replace(/\./g, '').replace(',', '.'))
    : (Object.entries(EM_REAIS).find(([palavra]) => t.includes(palavra))?.[1] ?? 0);
  if (!orcamento) return null;
  const nomeada = QUANTAS.findIndex((palavra) => t.includes(palavra));
  return {
    orcamento,
    dezenas: [],
    quantasDezenas: Number(t.match(/(\d{2})\s*dezenas/)?.[1] ?? 0)
      || (nomeada < 0 ? 0 : [15, 16, 17, 18, 19, 25, 24, 23, 22, 21, 20][nomeada]),
    garantiaMinima: Number(t.match(/garant\w*\s*(?:de\s*)?(\d{2})/)?.[1] ?? 0),
  };
}

export function aplicarPedido(pedido) {
  const orcamento = Number(pedido?.orcamento);
  const dezenas = Array.isArray(pedido?.dezenas) ? pedido.dezenas.map(Number) : [];
  const garantia = Number(pedido?.garantiaMinima ?? 0);
  const quantas = Number(pedido?.quantasDezenas ?? 0);
  const dezenasValidas =
    dezenas.every((d) => Number.isInteger(d) && d >= 1 && d <= UNIVERSO) &&
    new Set(dezenas).size === dezenas.length;
  if (!Number.isFinite(orcamento) || orcamento <= 0 || !dezenasValidas) return false;
  if (!inteiroEntre(garantia, 0, 15) || !inteiroEntre(quantas, 0, UNIVERSO)) return false;

  estado.orcamento = Math.round(orcamento * 100);
  estado.garantiaMinima = garantia;
  estado.link = null;
  guardar('orcamento', estado.orcamento);
  atualizarDinheiro();
  if (dezenas.length >= 15) trocarDezenas(new Set(dezenas));
  else if (quantas >= 15) sortearDezenas(quantas);
  else responder();
  return true;
}

const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

arrancar();
