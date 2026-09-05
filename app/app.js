// Estado e desenho da tela. Uma tela só, e um estado só.
//
// O cliente não resolve nada: todas as respostas já estão no catálogo, prontas
// e conferidas. O que este arquivo faz é ler o que a pessoa quer, perguntar ao
// catálogo e mostrar. Nenhum número que chega à tela passou por um modelo de
// linguagem.

import * as catalogo from './catalogo.js';
import * as conferir from './conferir.js';
import * as volante from './volante.js';
import { escada, fechamentosDe, melhorEstrategia, melhorPool } from './estrategia.js';

const $ = (id) => document.getElementById(id);
const UNIVERSO = 25;
// Quantos a lista desenha: os milhares de R$ 15.000 davam 339 mil pixels de página.
const MOSTRA = 50;
const guardar = (c, v) => { try { localStorage.setItem(c, JSON.stringify(v)); } catch { /**/ } };
const lembrar = (c, p) => { try { return JSON.parse(localStorage.getItem(c)) ?? p; } catch { return p; } };

const estado = {
  orcamento: lembrar('orcamento', 5000), dezenas: new Set(lembrar('dezenas', [])),
  carteira: lembrar('carteira', []), garantiaMinima: 0,
  indice: null, precos: null, precosPublicados: null, acaso: null,
  plano: null, fixo: null, bilhetes: [], todos: [], mascaras: [],
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
    [estado.indice, estado.precosPublicados, estado.acaso] = await Promise.all(
      [catalogo.carregarIndice(), catalogo.carregarPrecos(), catalogo.carregarAcaso()]);
  } catch {
    $('resposta').innerHTML = '<p class="aviso">Sem internet na primeira visita. Abra de novo '
      + 'quando houver rede — depois disso o aplicativo funciona sem ela.</p>';
    return;
  }
  estado.precos = { ...estado.precosPublicados, ...lembrar('precos', {}) };

  // Um link de bolão **fixa** o fechamento: sem isto quem o abre recebe o que o
  // orçamento guardado no aparelho dele escolheria, e cada um joga um bolão
  // diferente — sem a cobertura combinada, que é a razão de existir do bolão.
  const doLink = volante.lerLink(location.hash, UNIVERSO);
  const dele = doLink && estado.indice.entradas.find(
    (e) => e.v === doLink.v && e.k === doLink.k && e.t === doLink.t && e.jogos);
  if (doLink) estado.dezenas = new Set(doLink.dezenas);
  if (dele) [estado.link, estado.orcamento] = [doLink, dele.jogos * estado.precos.aposta[doLink.k]];

  $('m-pool').innerHTML = Array.from({ length: UNIVERSO - 14 }, (_, i) => i + 15)
    .map((v) => `<option value="${v}"${v === estado.dezenas.size ? ' selected' : ''}>${v}</option>`)
    .join('');
  desenharManual();
  desenharPrecos();
  desenharCarteira();
  atualizarDinheiro();
  responder();
}

function registrarServico() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
    botao.setAttribute('aria-pressed', String(estado.dezenas.has(Number(botao.dataset.dezena))));
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

  const plano = estado.fixo ? planoFixo(estado.fixo) : melhorEstrategia(estado.indice, estado.precos, {
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
    // Um bilhete só não tem troca entre dinheiro e garantia para explicar.
    if (plano.motivo === 'ok') pedirAFrase('.resposta .frase',
      { v, k, t, jogos, custo, piso, degrauT: plano.degrau?.t, degrauFalta: plano.degrau?.falta });
  } else {
    estado.bilhetes = estado.todos = [];
    estado.mascaras = [];
    for (const id of ['secao-bilhetes', 'acaso', 'bolao']) $(id).innerHTML = '';
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
  if (!plano.escolha) {
    return `<p class="aviso">Não há fechamento catalogado para ${estado.dezenas.size} dezenas.</p>`;
  }

  const e = plano.escolha;
  // Um bilhete só. Mostrar "11 acertos garantidos" aqui seria verdade e seria
  // engano: com um bilhete a garantia é tautologia — ele acerta o que acertar.
  // O que a pessoa comprou é um bilhete, e é isso que a tela diz.
  if (plano.motivo === 'um-bilhete') {
    return `
      <p class="numero">1</p>
      <p class="unidade">bilhete de ${e.k} dezenas</p>
      <p class="detalhe"><b>${dinheiro(e.custo)}</b>${
      plano.sobra ? ` · sobram ${dinheiro(plano.sobra)}` : ''}</p>
      <p class="frase">Um bilhete não é fechamento: não há vários jogos se completando para
        cobrir o que falta a cada um, então não há garantia a comprar — só a sorte de sempre.${
      e.k < e.v ? ` E das suas ${e.v} dezenas, só ${e.k} entram nele.` : ''}</p>`;
  }
  const selo = e.provado
    ? '<span class="selo provado">mínimo provado</span>'
    : `<span class="selo conhecido">menor conhecido</span>
       <span class="piso">nenhum fechamento faz isso com menos de ${e.piso}</span>`;

  return `
    <p class="numero">${e.t}</p>
    <p class="unidade">acertos garantidos</p>
    <p class="detalhe">${e.jogos} ${e.jogos === 1 ? 'jogo' : 'jogos'} de ${e.k} dezenas ·
      <b>${dinheiro(e.custo)}</b>${plano.sobra ? ` · sobram ${dinheiro(plano.sobra)}, que não
      compram garantia maior` : ''}</p>
    <p class="selos">${selo}</p>
    <p class="frase">Se as 15 dezenas sorteadas saírem todas entre as suas ${e.v},
      ao menos um destes bilhetes terá <b>${e.t} acertos ou mais</b>. Não é probabilidade:
      é certeza, conferida sorteio por sorteio.</p>
    <p class="ressalva">${chanceDeCairDentro(e.v)} ${quantoPagaAGarantia(e.t)}</p>`;
}

/// Pede ao servidor uma frase sobre os números que já estão na tela — a troca
/// entre dinheiro e garantia, ou o que o sorteio rendeu. A frase determinística
/// já está lá; esta troca por outra, ou não troca, e só troca se não trouxer
/// **nenhum número** que não tenha saído daqui. Dinheiro entra na forma em que
/// o Brasil o escreve, que é onde a regra falhava: "R$ 199,50" virava 199 e 50,
/// nenhum autorizado. Reais inteiros só quando o valor é inteiro — arredondar
/// é calcular.
const CENTAVOS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const EM_DINHEIRO = new Set(['custo', 'degrauFalta', 'voltou']);
const NUMEROS = /\d+(?:\.\d{3})*(?:,\d+)?/g;
let pedidoDaVez = 0;
async function pedirAFrase(onde, dados) {
  const permitidos = new Set(Object.entries(dados).flatMap(([campo, n]) => (!Number.isFinite(n) ? []
    : EM_DINHEIRO.has(campo)
      ? [`${n}`, (n / 100).toLocaleString('pt-BR', CENTAVOS), ...(n % 100 ? [] : [`${n / 100}`])]
      : [`${n}`])));
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
    if (alvo && meu === pedidoDaVez && (frase.match(NUMEROS) ?? []).every((n) => permitidos.has(n))) {
      alvo.textContent = frase;
    }
  } catch { /* a frase determinística fica */ }
}

/// Quanto a garantia vale em dinheiro. Sem este número "garantido" se lê como
/// lucro garantido, e nas faixas fixas o prêmio fica abaixo do que se gastou.
function quantoPagaAGarantia(t) {
  if (t > 13) return `O prêmio de ${t} acertos é rateado e muda a cada concurso.`;
  return `Esses ${t} acertos pagam ${dinheiro(estado.precos.premio[t])} por cartela premiada —
    o fechamento compra certeza, não lucro.`;
}

/// A ressalva que faz a garantia ser verdade inteira: ela só vale se as 15
/// sorteadas caírem no pool, e essa chance — `C(v,15)/C(25,15)`, do catálogo — é
/// o que separa uma promessa grande de uma promessa útil.
function chanceDeCairDentro(v) {
  const p = estado.acaso.dentro?.[v];
  if (!p) return '';
  if (p === 1) return 'Suas 25 dezenas são todas as que existem: a garantia vale sempre.';
  const uma = Math.round(1 / p).toLocaleString('pt-BR');
  return `A garantia só vale quando as 15 sorteadas caem todas entre as suas ${v} dezenas —
    o que acontece em cerca de 1 concurso a cada ${uma}.`;
}

/// A linha logo abaixo da régua. Quando a pessoa pediu uma garantia que não
/// coube, ela responde ao pedido — é a pergunta que a pessoa fez, e cobra
/// resposta antes da que o aplicativo faria sozinho. Senão, mostra o degrau
/// seguinte, que sempre falta dinheiro: se coubesse, já teria sido escolhido.
function frasedoDegrau(plano) {
  if (!plano.escolha) return '';
  // Montado à mão, não há "próximo degrau": a escada é de quem pergunta o que o
  // dinheiro compra, e aqui a pergunta foi outra.
  if (estado.fixo) return 'Você montou este fechamento à mão, em "montar do meu jeito".';
  const p = plano.pedido;
  if (p) {
    return p.degrau
      ? `Garantir ${p.t} acertos com ${plano.escolha.v} dezenas custa
         ${dinheiro(p.degrau.custo)} — faltam ${dinheiro(p.degrau.falta)}.`
      : `Não há fechamento catalogado que garanta ${p.t} acertos com ${plano.escolha.v} dezenas.`;
  }
  const d = plano.degrau;
  // Marcar as quinze favoritas é natural, e dava numa saída sem porta.
  if (!d) return plano.motivo === 'um-bilhete'
    ? `Com ${plano.escolha.v} dezenas não há fechamento a comprar: marque mais dezenas.`
    : `Não há garantia maior para comprar com ${plano.escolha.v} dezenas.`;
  // Depois de um bilhete só, o degrau seguinte não é "subir de 11 para 12": é
  // passar a ter fechamento. A tela não disse 11 nenhum, e não pode partir dele.
  if (plano.motivo === 'um-bilhete') {
    return `Por mais ${dinheiro(d.falta)} você compra ${d.jogos} bilhetes que se completam e
      garantem ${d.t} acertos.`;
  }
  return `Por mais ${dinheiro(d.falta)} você sobe de ${plano.escolha.t} para ${d.t} acertos
    garantidos.`;
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

  // `todos` é o fechamento inteiro; `bilhetes`, o que cabe a quem está olhando.
  estado.todos = catalogo.emDezenas(estado.mascaras, estado.dezenas);
  estado.bilhetes = estado.link?.parte == null ? estado.todos
    : volante.dividir(estado.todos, estado.link.partes)[estado.link.parte];
  desenharBilhetes();
  desenharAcaso();
  desenharBolao();
}

function desenharBilhetes() {
  $('secao-bilhetes').innerHTML = `
    ${estado.link?.parte == null ? '' : `<p class="ajuda">Você é a parte
      ${estado.link.parte + 1} de ${estado.link.partes} deste bolão: a garantia acima é do bolão
      inteiro, e estes ${estado.bilhetes.length} bilhetes são os que cabem a você.</p>`}
    ${estado.bilhetes.length <= MOSTRA ? '' : `<p class="ajuda">São
      ${estado.bilhetes.length.toLocaleString('pt-BR')} bilhetes, e a lista mostra os ${MOSTRA}
      primeiros — copie, baixe ou imprima para ter todos. O que se confere abaixo usa todos.</p>`}
    <ol class="bilhetes">${estado.bilhetes.slice(0, MOSTRA).map((b) =>
      `<li>${b.map((d) => `<span>${String(d).padStart(2, '0')}</span>`).join('')}</li>`).join('')}</ol>
    <div class="linha">
      <button type="button" data-acao="copiar">Copiar</button>${[['texto', 'Baixar texto'],
        ['csv', 'Baixar CSV'], ['imprimir', 'Imprimir volantes'], ['guardar', 'Guardar na carteira']]
        .map(([a, r]) => `<button type="button" data-acao="${a}" class="discreto">${r}</button>`)
        .join('')}
    </div>`;
}

function desenharAcaso() {
  const e = estado.plano.escolha;
  const p = estado.acaso.chegam?.[`${e.v}-${e.k}`]?.[e.t];
  if (p == null) return;
  const noChute = 1 - (1 - p) ** e.jogos;
  // E quanto isso devolve por concurso, em média. Só as faixas de prêmio fixo:
  // 14 e 15 são rateadas, e somá-las trocaria um número exato por um palpite.
  // Hipergeométrico, não simulado, e igual para qualquer arranjo dos mesmos
  // bilhetes — que é justamente o que faz dele a prova de "certeza, não lucro".
  const solto = estado.acaso.chegam?.[`${UNIVERSO}-${e.k}`] ?? {};
  const media = e.jogos * [11, 12, 13].reduce(
    (soma, f) => soma + ((solto[f] ?? 0) - (solto[f + 1] ?? 0)) * estado.precos.premio[f], 0);
  $('acaso').innerHTML = `
    <p>Com ${dinheiro(e.custo)} você compra ${e.jogos} ${e.jogos === 1 ? 'bilhete' : 'bilhetes'}
      de ${e.k} dezenas. Se eles fossem escolhidos no chute, chegariam a ${e.t} acertos em
      <b>${(noChute * 100).toFixed(noChute > 0.995 ? 2 : 1)}%</b> dos sorteios que caem dentro das
      suas ${e.v} dezenas. Com o fechamento, em <b>100%</b>.</p>
    <p class="ressalva">Em média os dois pagam o mesmo: a mesma quantidade de bilhetes do mesmo
      tamanho tem a mesma expectativa de prêmio, com fechamento ou sem${media ? `, que aqui é
      <b>${dinheiro(Math.round(media))}</b> por concurso nas faixas de 11, 12 e 13 acertos — mais
      o que sair de 14 e 15, que é rateado e ninguém sabe de antemão` : ''}. O que o fechamento
      compra não é lucro — é certeza no lugar de sorte.</p>`;
}

function desenharBolao() {
  // Sempre o fechamento inteiro, mesmo para quem chegou por um link de parte: o
  // link daqui diz "parte i de n **do fechamento**", e dividir a parte de alguém
  // faria a tela contar um conjunto e o link entregar outro. E nunca mais partes
  // que bilhetes: um link com zero bilhetes é promessa vazia a gente de verdade.
  const partes = Math.min(20, estado.todos.length, Math.max(2, Number($('partes').value) || 2));
  const grupos = volante.dividir(estado.todos, partes);
  const base = location.href.split('#')[0], { v, k, t } = estado.plano.escolha;
  $('bolao').innerHTML = `<ol class="partes">${grupos
    .map((g, i) => {
      const link = volante.linkDaParte(base, { dezenas: estado.dezenas, v, k, t, parte: i, partes });
      return `<li><b>Parte ${i + 1}</b> — ${g.length} bilhetes · ${dinheiro(g.length * estado.precos.aposta[k])}
        <button type="button" class="discreto" data-link="${link}">Copiar link</button></li>`;
    })
    .join('')}</ol>`;
}

function desenharPrecos() {
  const grupos = [['aposta', 'Quanto custa a aposta', 'dezenas'], ['premio', 'Quanto paga cada faixa', 'acertos']];
  $('tabela-precos').innerHTML = `${grupos.map(([grupo, titulo, unidade]) =>
    `<div class="precos"><h3>${titulo}</h3>${Object.keys(estado.precos[grupo]).map((k) =>
      `<label>${k} ${unidade}<input type="text" inputmode="decimal" data-grupo="${grupo}"
        data-chave="${k}" value="${dinheiro(estado.precos[grupo][k])}"></label>`).join('')}</div>`)
    .join('')}
    <p class="ajuda">Valores de ${estado.precosPublicados.vigencia}.</p>`;
}

function desenharCarteira() {
  if (!estado.carteira.length) { $('carteira').innerHTML = '<p class="ajuda">Nada guardado.</p>'; return; }
  $('carteira').innerHTML = `<ol class="registros">${estado.carteira
    .map((r, i) => `<li><b>${r.t} acertos garantidos</b> · ${r.jogos} jogos de ${r.k} dezenas ·
        ${dinheiro(r.custo)} · ${new Date(r.data).toLocaleDateString('pt-BR')}${
      r.retorno == null ? ''
        : ` · <b>voltou ${dinheiro(r.retorno)}</b>${r.concurso ? ` no concurso ${r.concurso}` : ''}`}
        <button type="button" class="discreto" data-apagar="${i}">Apagar</button></li>`)
    .join('')}</ol>`;
}

// ── montar do meu jeito ─────────────────────────────────────────────────────
//
// O outro caminho. No automático a pessoa diz quanto tem e o aplicativo escolhe
// a configuração; aqui ela nomeia a configuração e o aplicativo monta. Nenhuma
// busca acontece nos dois: as 330 combinações já estão resolvidas e conferidas,
// e nomear uma é escolher uma linha do índice.
//
// Fica abaixo da dobra porque é parâmetro técnico, e a tela principal não tem
// nenhum. Quem quer isto sabe o que quer; quem não quer nunca precisa abrir.

/// O fechamento que a pessoa nomeou, como plano — o mesmo formato que a
/// estratégia devolve, para a tela desenhar por um caminho só.
function planoFixo({ v, k, t }) {
  const escolha = estado.indice.entradas.find((e) => e.v === v && e.k === k && e.t === t && e.jogos);
  if (!escolha) return { motivo: 'sem-catalogo', escolha: null };
  const custo = escolha.jogos * estado.precos.aposta[k];
  return { motivo: escolha.jogos === 1 ? 'um-bilhete' : 'ok', escolha: { ...escolha, custo },
    sobra: 0, degrau: null, pedido: null };
}

/// Troca as opções de um `select` mantendo a escolha, quando ela sobrevive.
/// Redesenhar sem isto apagaria o que a pessoa acabou de escolher a cada tecla
/// digitada no teto de cartelas.
function trocarOpcoes(id, opcoes) {
  const antes = $(id).value;
  $(id).innerHTML = opcoes.map(([v, texto]) => `<option value="${v}">${texto}</option>`).join('');
  if (opcoes.some(([v]) => String(v) === antes)) $(id).value = antes;
}

/// Redesenha o modo manual a partir do catálogo. Quatro coisas se pede aqui —
/// pool, dezenas por cartela, garantia e quantas cartelas —, e as quatro só
/// oferecem o que existe: não há como pedir uma configuração que o catálogo não
/// tenha, nem chegar a uma tela vazia sem saber por quê.
function desenharManual() {
  const pool = Number($('m-pool').value) || estado.dezenas.size || UNIVERSO;
  const teto = Number($('m-teto').value) || Infinity;
  const todas = fechamentosDe(estado.indice, estado.precos, pool);
  // Os dois filtros listam só os valores que este pool tem. Oferecer "18 por
  // cartela" onde não existe fechamento de 18 não é dar escolha, é dar um beco.
  for (const [id, campo, rotulo] of [['m-k', 'k', 'por cartela'], ['m-t', 't', 'acertos']]) {
    trocarOpcoes(id, [['', 'tanto faz'], ...[...new Set(todas.map((e) => e[campo]))]
      .sort((a, b) => a - b).map((n) => [n, `${n} ${rotulo}`])]);
  }
  const k = Number($('m-k').value);
  const t = Number($('m-t').value);
  // Duas linhas com o mesmo tamanho de cartela e o mesmo preço, uma garantindo
  // menos, é ruído: ninguém escolheria a menor. A escada some com as dominadas
  // entre tamanhos diferentes; aqui só somem as dominadas dentro do mesmo
  // tamanho, porque escolher o tamanho é justamente o que este modo oferece.
  const quais = todas
    .filter((e) => e.jogos <= teto && (!k || e.k === k) && (!t || e.t >= t))
    .filter((e, _, ate) => !ate.some((o) => o.k === e.k && o.custo <= e.custo && o.t > e.t));
  // Garantia e preço primeiro: num telefone a lista fechada mostra só o começo
  // do texto, e o começo tem de ser o que faz escolher entre uma linha e outra.
  trocarOpcoes('m-fechamento', quais.map((e) => [`${e.k}-${e.t}`,
    `garante ${e.t} acertos · ${dinheiro(e.custo)} ·
     ${e.jogos} ${e.jogos === 1 ? 'cartela' : 'cartelas'} de ${e.k} dezenas`]));
  // Lista vazia sem explicação é a pessoa achando que o aplicativo quebrou. A
  // frase nomeia o que ela pediu, para ela saber o que afrouxar.
  const pedido = [k && `${k} dezenas por cartela`, t && `${t} acertos garantidos`,
    teto !== Infinity && `no máximo ${teto} ${teto === 1 ? 'cartela' : 'cartelas'}`].filter(Boolean);
  const frase = pedido.length < 2 ? pedido.join('')
    : `${pedido.slice(0, -1).join(', ')} e ${pedido.at(-1)}`;
  $('manual').textContent = quais.length ? ''
    : `Com ${pool} dezenas não há fechamento catalogado${frase ? ` com ${frase}` : ''}.`;
}

/// Aplica o que foi escolhido: ajusta a marcação ao pool pedido, fixa o
/// fechamento e deixa a tela responder pelo caminho de sempre.
function aplicarManual() {
  const pool = Number($('m-pool').value);
  const [k, t] = ($('m-fechamento').value || '').split('-').map(Number);
  if (estado.dezenas.size !== pool) ajustarPara(pool);
  estado.fixo = k && t ? { v: pool, k, t } : null;
  // O campo de dinheiro passa a dizer o preço do que foi escolhido. Sem isto ele
  // continuaria mostrando o orçamento antigo ao lado de uma resposta que custa
  // outra coisa — duas afirmações na mesma tela, uma delas falsa.
  const custo = estado.fixo && planoFixo(estado.fixo).escolha?.custo;
  if (custo) { estado.orcamento = custo; guardar('orcamento', custo); atualizarDinheiro(); }
  responder();
  mostrarAResposta();
}

// ── controles ───────────────────────────────────────────────────────────────

function ligarControles() {
  $('grade').addEventListener('click', (ev) => {
    const d = Number(ev.target.dataset?.dezena);
    if (!d) return;
    estado.dezenas.has(d) ? estado.dezenas.delete(d) : estado.dezenas.add(d);
    estado.fixo = null;  // mexer na grade muda o pool, e o fechamento nomeado era para outro
    trocarDezenas(estado.dezenas);
  });

  $('escolher').addEventListener('click', () => estado.indice
    && ((estado.fixo = null), sortearDezenas(melhorPool(estado.indice, estado.precos, estado.orcamento))));
  $('limpar').addEventListener('click', () => trocarDezenas(new Set()));
  // A régua e o campo dizem a mesma coisa de dois jeitos, e um valor que não dá
  // para ler — texto vazio, "abc" — deixa o orçamento como estava em vez de
  // zerar a tela.
  const trocarOrcamento = (centavos) => {
    if (centavos != null && centavos > 0) estado.orcamento = centavos;
    // Mexer no dinheiro é voltar a perguntar "o que isto compra": sai o bolão
    // de outra pessoa, e sai o fechamento nomeado à mão.
    estado.link = estado.fixo = null;
    guardar('orcamento', estado.orcamento);
    atualizarDinheiro();
    responder();
  };
  $('regua').addEventListener('input', () => trocarOrcamento(daRegua(Number($('regua').value))));
  $('valor').addEventListener('change', () => trocarOrcamento(emCentavos($('valor').value)));

  $('secao-bilhetes').addEventListener('click', (ev) => acaoDosBilhetes(ev.target.dataset?.acao));
  $('partes').addEventListener('input', () => estado.todos.length && desenharBolao());
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

  // O pool e o teto redesenham a lista; escolher um fechamento troca a resposta.
  for (const id of ['m-pool', 'm-teto', 'm-k', 'm-t']) {
    $(id).addEventListener('input', () => { desenharManual(); aplicarManual(); });
  }
  $('m-fechamento').addEventListener('change', aplicarManual);

  $('varrer').addEventListener('click', varrerTudo);
  $('buscar-sorteio').addEventListener('click', buscarSorteio);
  $('sorteio').addEventListener('change', conferirContraOSorteio);
  $('enviar-intencao').addEventListener('click', enviarIntencao);
  $('fechar-painel').addEventListener('click', () => ($('painel').hidden = true));
}

/// Marca `quantas` dezenas ao acaso: nenhuma é mais provável que outra.
const embaralhar = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const todasAsDezenas = () => Array.from({ length: UNIVERSO }, (_, i) => i + 1);

/// A resposta nasce a quase 800 px do topo, abaixo da dobra em telefone pequeno:
/// quem pediu que o aplicativo escolhesse não vai procurar o que ele escolheu.
const mostrarAResposta = () => $('resposta').scrollIntoView({ block: 'start',
  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

function sortearDezenas(quantas) {
  trocarDezenas(new Set(embaralhar(todasAsDezenas()).slice(0, quantas).sort((a, b) => a - b)));
  mostrarAResposta();
}

/// Leva a marcação a `quantas` dezenas **mantendo** as que já estavam marcadas,
/// e completando ao acaso o que faltar. Quem escolheu as dele não perde a
/// escolha por mexer no tamanho do pool; encolhendo, saem as últimas marcadas.
function ajustarPara(quantas) {
  const fora = embaralhar(todasAsDezenas().filter((d) => !estado.dezenas.has(d)));
  trocarDezenas(new Set([...estado.dezenas, ...fora].slice(0, quantas).sort((a, b) => a - b)));
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
    // O que **esta pessoa** jogou: num bolão, a parte dela. Guardar o fechamento
    // inteiro punha na carteira um custo que ela não pagou, com o retorno só dela.
    estado.carteira.unshift({ data: Date.now(), v: e.v, k: e.k, t: e.t,
      jogos: estado.bilhetes.length, custo: estado.bilhetes.length * estado.precos.aposta[e.k],
      dezenas: [...estado.dezenas].sort((a, b) => a - b) });
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
       ${e.v} dezenas. No pior deles, o melhor bilhete faz <b>${pior} acertos</b> — a garantia de
       ${e.t} está de pé. ${comQuinze
      ? `Em ${comQuinze.toLocaleString('pt-BR')} deles, alguém acerta os 15.` : ''}`
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
    if (!guardado) { $('buscar-sorteio').textContent = 'Sem resultado — digite as 15 dezenas'; return; }
    $('sorteio').value = guardado.dezenas.join(' ');
    conferirContraOSorteio();
    $('buscar-sorteio').textContent = `Concurso ${guardado.concurso} (guardado)`;
  }
}

function conferirContraOSorteio() {
  const sorteadas = dezenasDoTexto($('sorteio').value);
  if (!sorteadas || estado.bilhetes.length === 0) {
    $('conferencia').innerHTML = sorteadas ? ''
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
    ${linhas.length ? `<ul>${linhas.map(([a, q]) => `<li>${q} × ${a} acertos</li>`).join('')}</ul>`
      : '<p>Nenhum bilhete premiado.</p>'}
    <p>Custou ${dinheiro(custo)}, voltou ${dinheiro(voltou)} — <b>${voltou >= custo ? 'saldo de'
      : 'faltaram'} ${dinheiro(Math.abs(voltou - custo))}</b>.</p>
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
  const mesmas = (a) => [...(a ?? [])].sort((x, y) => x - y).join(' ');
  // As dezenas entram na comparação: dois jogos podem ter o mesmo tamanho e a
  // mesma garantia e ainda assim ser jogos diferentes, e o retorno é de um só.
  const registro = estado.carteira.find(
    (r) => r.v === e.v && r.k === e.k && r.t === e.t &&
      mesmas(r.dezenas) === mesmas(estado.dezenas));
  if (!registro) return;
  const ultimo = lembrar('ultimo-sorteio', null);
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
// Em pares, e os compostos antes dos simples: "vinte e cinco" contém "vinte".
const QUANTAS = [['quinze', 15], ['dezesseis', 16], ['dezessete', 17], ['dezoito', 18],
  ['dezenove', 19], ['vinte e cinco', 25], ['vinte e quatro', 24], ['vinte e três', 23],
  ['vinte e dois', 22], ['vinte e um', 21], ['vinte', 20]];
function ler(texto) {
  const t = texto.toLowerCase();
  const achado = t.match(/(?:r\$\s*)?(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|conto|pila)/)
    ?? t.match(/r\$\s*(\d[\d.]*(?:,\d{1,2})?)/);
  const orcamento = achado
    ? Number(achado[1].replace(/\./g, '').replace(',', '.'))
    : (Object.entries(EM_REAIS).find(([palavra]) => t.includes(palavra))?.[1] ?? 0);
  if (!orcamento) return null;
  const nomeada = QUANTAS.find(([palavra]) => t.includes(palavra));
  return {
    orcamento,
    dezenas: [],
    quantasDezenas: Number(t.match(/(\d{2})\s*dezenas/)?.[1] ?? 0) || nomeada?.[1] || 0,
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
