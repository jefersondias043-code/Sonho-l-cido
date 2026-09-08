// Estado e desenho da tela. Uma tela só, e um estado só.
//
// O cliente não resolve nada: todas as respostas já estão no catálogo, prontas
// e conferidas. O que este arquivo faz é ler o que a pessoa quer, perguntar ao
// catálogo e mostrar. Nenhum número que chega à tela passou por um modelo de
// linguagem.

import * as catalogo from './catalogo.js';
import * as analise from './analise.js';
import * as conferir from './conferir.js';
import * as volante from './volante.js';
import { escada, fechamentosDe, melhorEstrategia, melhorPool } from './estrategia.js';

const $ = (id) => document.getElementById(id);
const UNIVERSO = 25;
// Quantas a Lotofácil sorteia — e, por isso, o tamanho da aposta simples em que
// todo bilhete maior se decompõe.
const SORTEIO = 15;
// Quantos volantes cabem numa folha A4, para dizer o preço em papel antes de
// imprimir. Medido no próprio desenho, com a mídia de impressão emulada e a
// folha a 96 dpi com 1 cm de margem (718×1047 px): três por linha, cinco linhas.
const POR_FOLHA = 15;
// Quantos a lista desenha: os milhares de R$ 15.000 davam 339 mil pixels de página.
const MOSTRA = 50;
const guardar = (c, v) => { try { localStorage.setItem(c, JSON.stringify(v)); } catch { /**/ } };

/// O que volta do armazenamento é de fora, como um endereço: pode vir de outra
/// versão do aplicativo, de uma escrita interrompida, de outra aba mexendo ao
/// mesmo tempo. Ler sem conferir a forma fazia o aplicativo **não abrir** —
/// tela em branco e um `TypeError` — por causa de uma chave estragada que ele
/// mesmo sabia dispensar. `lerLink` já tratava endereço estranho assim; isto é
/// a mesma regra para o outro lugar de onde entra estado de fora.
const lembrar = (chave, padrao, valido = () => true) => {
  try {
    const guardado = JSON.parse(localStorage.getItem(chave));
    return guardado != null && valido(guardado) ? guardado : padrao;
  } catch { return padrao; }
};

const eLista = (a) => Array.isArray(a);
const eObjeto = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
const centavos = (n) => Number.isFinite(n) && n >= 0;

/// Só os pares chave-valor que são dinheiro. Um preço estragado não pode virar
/// `NaN` na tela nem derrubar o desenho da tabela.
const soPrecos = (tabela) => Object.fromEntries(
  Object.entries(eObjeto(tabela) ? tabela : {}).filter(([, v]) => centavos(v)));

const estado = {
  orcamento: lembrar('orcamento', 5000, (n) => Number.isFinite(n) && n > 0),
  dezenas: new Set(lembrar('dezenas', [], eLista)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= UNIVERSO)),
  // Um registro sem custo não fecha conta nenhuma, e um `null` no meio da lista
  // derrubava a carteira inteira ao desenhar.
  carteira: lembrar('carteira', [], eLista)
    .filter((r) => eObjeto(r) && centavos(r.custo) && Number.isFinite(r.jogos)),
  garantiaMinima: 0,
  indice: null, precos: null, precosPublicados: null, acaso: null,
  // `fixo` é o fechamento **nomeado** — montado à mão ou recebido num link de
  // bolão. Ele é um pedido, e pedido não se esquece ao fechar a aba: sem guardá-lo,
  // recarregar devolvia o que o orçamento compraria, que é outro fechamento.
  // `fixo` não leva conferência de forma aqui porque tem uma melhor logo
  // adiante: `fixoValido` é a única porta por onde fechamento nomeado entra, e
  // ela reprova qualquer coisa que não seja um fechamento que o catálogo tem.
  plano: null, fixo: lembrar('fixo', null), link: null,
  bilhetes: [], todos: [], mascaras: [], ultimoResultado: null,
};

/// Trocar o fechamento nomeado passa por aqui, sempre: é o que mantém o que está
/// na tela e o que está guardado dizendo a mesma coisa.
const fixar = (f) => { estado.fixo = f; guardar('fixo', f); };

// ── dinheiro ────────────────────────────────────────────────────────────────

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (centavos) => reais.format((centavos ?? 0) / 100);
/// "1 bilhete", "2 bilhetes". Um fechamento de uma cartela é raro no modo
/// automático e comum no manual, e "1 bilhetes" é o tipo de erro que faz a
/// pessoa desconfiar do resto da tela.
const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

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
  // O indicador de rede é barato e a pessoa precisa dele já; o resto de
  // `registrarServico` espera a resposta aparecer — veja lá embaixo por quê.
  const rede = () => ($('rede').textContent = navigator.onLine ? '' : 'sem internet');
  addEventListener('online', rede); addEventListener('offline', rede); rede();

  try {
    [estado.indice, estado.precosPublicados, estado.acaso] = await Promise.all(
      [catalogo.carregarIndice(), catalogo.carregarPrecos(), catalogo.carregarAcaso()]);
  } catch {
    $('resposta').innerHTML = '<p class="aviso">Sem internet na primeira visita. Abra de novo '
      + 'quando houver rede — depois disso o aplicativo funciona sem ela.</p>';
    return;
  }
  // Os preços que a pessoa editou entram por cima dos publicados, mas só o que
  // ainda for dinheiro: `{"premio": null}` guardado derrubava a tela de preços.
  const editados = lembrar('precos', {}, eObjeto);
  estado.precos = {
    ...estado.precosPublicados,
    aposta: { ...estado.precosPublicados.aposta, ...soPrecos(editados.aposta) },
    premio: { ...estado.precosPublicados.premio, ...soPrecos(editados.premio) },
  };

  // O que voltou guardado é um pedido de outra sessão, e o catálogo ou a tabela
  // de preços podem ter mudado desde então. Passa pela porta como qualquer outro.
  fixar(fixoValido(estado.fixo));

  // Um link de bolão **fixa** o fechamento, e fixar é isto: nomear o fechamento,
  // não só copiar o preço dele. Copiando o preço, quem abria o link recebia o que
  // aquele dinheiro compraria — e um fechamento montado à mão quase nunca é o que
  // o dinheiro compraria. Cada participante jogava um bolão diferente, com a tela
  // ainda prometendo a cobertura combinada, que é a razão de o bolão existir.
  const doLink = volante.lerLink(location.hash, UNIVERSO);
  const dele = doLink && fixoValido(doLink);
  if (doLink) estado.dezenas = new Set(doLink.dezenas);
  if (dele) {
    estado.link = doLink;
    fixar(dele);
  }

  desenharPrecos();
  desenharCarteira();
  atualizarDinheiro();
  responder();
  registrarServico();

  // Uma vez, no arranque: os selects nascem vazios, e quem manda é o fechamento
  // em uso — guardado de outra sessão ou recebido num link. Daqui em diante quem
  // manda é a pessoa, e `trocarOpcoes` preserva o que ela escolher.
  if (estado.fixo) {
    $('m-k').value = String(estado.fixo.k);
    desenharManual();
    $('m-fechamento').value = `${estado.fixo.k}-${estado.fixo.t}`;
  }
}

/// Registrar o service worker depois da resposta, e não antes.
///
/// Instalar custa a casca inteira — quatorze arquivos — mais uma leitura do
/// próprio `sw.js` para o carimbo do rodapé, e tudo isso partia antes dos três
/// arquivos do catálogo, que são o que a resposta espera.
///
/// **Medido, não muda nada**: 1.450 ms para a resposta antes, 1.458 depois, em
/// 3G rápido (`ferramentas/medir-3g.mjs`). O caminho crítico é dominado pelas
/// duas idas e voltas, e o service worker não disputava a janela que sobra.
///
/// Fica assim mesmo assim, porque a ordem é a certa e não custa nada: a
/// promessa do service worker é sobre a **segunda** visita, e nada do que ele
/// faz precisa acontecer antes de a primeira responder. Quem vier medir de
/// novo — noutra rede, com o catálogo maior — parte de uma ordem que já está
/// certa, em vez de descobrir esta como se fosse novidade.
function registrarServico() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
  // Com um fechamento nomeado o campo de dinheiro é o preço **dele**, e não um
  // orçamento. Qualquer coisa que mexa nesse preço — editar a tabela de preços,
  // voltar noutra sessão — tem de mover o campo junto, ou a tela passa a afirmar
  // duas coisas ao mesmo tempo, uma delas falsa.
  if (estado.fixo && plano.escolha && plano.escolha.custo !== estado.orcamento) {
    estado.orcamento = plano.escolha.custo;
    guardar('orcamento', estado.orcamento);
    atualizarDinheiro();
  }
  // Os degraus viram marcas na régua: arrastar passa a mostrar onde a resposta
  // muda, em vez de deixar a pessoa procurar às cegas.
  $('degraus').innerHTML = escada(estado.indice, estado.precos, estado.dezenas.size)
    .map((e) => `<option value="${paraARegua(e.custo)}" label="${e.t}"></option>`).join('');
  desenharManual();
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
    estado.ultimoResultado = null;
    cartaoDesenhado = '';
    // Sem fechamento não há o que analisar, e uma área aberta sobre nada é uma
    // tela que mente sobre o que a pessoa tem na mão.
    fecharAnalise();
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
      <p class="unidade">cartela de ${e.k} dezenas</p>
      <p class="detalhe"><b>${dinheiro(e.custo)}</b>${
      plano.sobra ? ` · sobram ${dinheiro(plano.sobra)}` : ''}</p>
      <p class="frase">Uma cartela não é fechamento: não há várias se completando para
        cobrir o que falta a cada uma, então não há garantia a comprar — só a sorte de sempre.${
      e.k < e.v ? ` E das suas ${e.v} dezenas, só ${e.k} entram nela.` : ''}</p>`;
  }
  const selo = e.provado
    ? '<span class="selo provado">mínimo provado</span>'
    : `<span class="selo conhecido">menor conhecido</span>
       <span class="piso">nenhum fechamento faz isso com menos de
         ${plural(e.piso, 'cartela', 'cartelas')}</span>`;

  return `
    <p class="numero">${e.t}</p>
    <p class="unidade">acertos garantidos</p>
    <p class="detalhe">${plural(e.jogos, 'cartela', 'cartelas')} de ${e.k} dezenas ·
      <b>${dinheiro(e.custo)}</b>${plano.sobra ? ` · sobram ${dinheiro(plano.sobra)}, que não
      compram garantia maior` : ''}</p>
    <p class="selos">${selo}</p>
    <p class="frase">Se as 15 dezenas sorteadas saírem todas entre as suas ${e.v},
      ao menos uma destas cartelas terá <b>${e.t} acertos ou mais</b>. Não é probabilidade:
      é certeza, conferida sorteio por sorteio.</p>
    <p class="ressalva">${chanceDeCairDentro(e.v)} ${quantoPagaAGarantia(e.t, e.k)}</p>`;
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
///
/// O tamanho do bilhete entra na conta: uma cartela de 16 dezenas com 11
/// acertos não paga uma onze, paga cinco — são cinco das dezesseis apostas
/// dentro dela que ficam com as onze certas.
function quantoPagaAGarantia(t, k) {
  if (t > 13) return `O prêmio de ${t} acertos é rateado e muda a cada concurso.`;
  const porCartela = analise.premioDoBilhete(k, t, { [t]: estado.precos.premio[t] });
  return `Esses ${t} acertos pagam ${dinheiro(porCartela)} por cartela premiada —
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
  // Nomeado, não há "próximo degrau": a escada é de quem pergunta o que o
  // dinheiro compra, e aqui a pergunta foi outra.
  if (estado.link) return 'Este é o fechamento do bolão que compartilharam com você.';
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
    return `Por mais ${dinheiro(d.falta)} você compra ${d.jogos} cartelas que se completam e
      garantem ${d.t} acertos.`;
  }
  return `Por mais ${dinheiro(d.falta)} você sobe de ${plano.escolha.t} para ${d.t} acertos
    garantidos.`;
}

async function trazerBilhetes(escolha) {
  try {
    estado.mascaras = await catalogo.carregarFechamento(escolha);
  } catch (erro) {
    $('secao-bilhetes').innerHTML = `<p class="aviso">Não deu para trazer as cartelas:
      ${erro.message}. O que você já abriu continua aqui.</p>`;
    return;
  }
  if (estado.plano?.escolha !== escolha) return; // a pessoa mudou de ideia no meio

  // `todos` é o fechamento inteiro; `bilhetes`, o que cabe a quem está olhando.
  estado.todos = catalogo.emDezenas(estado.mascaras, estado.dezenas);
  estado.bilhetes = estado.link?.parte == null ? estado.todos
    : volante.dividir(estado.todos, estado.link.partes)[estado.link.parte];
  estado.ultimoResultado = null;
  desenharBilhetes();
  desenharAcaso();
  desenharBolao();
  // Trocar de fechamento com a área aberta: ela passa a falar do novo, e não
  // continua mostrando as cartelas do anterior.
  if (!$('analise').hidden) {
    const aberta = ABAS.find((a) => !$(`aba-${a}`).hidden) ?? 'cartelas';
    $('conferencia').innerHTML = '';
    $('simulacao').innerHTML = '';
    $('varredura').textContent = '';
    abrirAnalise(aberta);
  }
}

/// Uma tabela de números. São oito na área de análise, e escrever o mesmo
/// `<table>` oito vezes é oito chances de escrevê-lo diferente. Cada linha é
/// uma lista de células; a última pode pedir destaque, que é onde vai o total.
const quadro = (cabecalho, linhas) => `<table class="quadro">${cabecalho
  ? `<thead><tr>${cabecalho.map((c) => `<th>${c}</th>`).join('')}</tr></thead>` : ''}
  <tbody>${linhas.map(({ celulas, destaque }) => `<tr${destaque ? ' class="destaque"' : ''}>${
  celulas.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/// Uma linha da tabela; `total` é a que fica em negrito no fim.
const linha = (...celulas) => ({ celulas });
const total = (...celulas) => ({ celulas, destaque: true });

const botoes = (pares) => `<div class="linha">${pares
  .map(([a, r]) => `<button type="button" data-acao="${a}" class="discreto">${r}</button>`)
  .join('')}</div>`;

/// O que aparece assim que o fechamento existe: a confirmação, quantas cartelas
/// e o caminho para o resto.
///
/// As cartelas **não** entram aqui. Cinquenta linhas de números logo abaixo da
/// resposta enchiam a tela de uma coisa que ninguém tinha pedido ainda, e
/// empurravam para baixo de tudo o que se faz com elas — conferir, simular,
/// fechar a conta. Elas continuam a um toque, na área de análise.
/// O que foi desenhado por último. Redesenhar joga fora os botões — e com eles
/// o toque que já estava a caminho de um: no telefone, digitar um valor e tocar
/// em "Visualizar cartelas" dispara o `change` do campo ao perder o foco, o
/// cartão se refaz, e o primeiro toque morre junto com o botão que ia acertar.
/// A pessoa toca duas vezes e acha que o aplicativo travou.
let cartaoDesenhado = '';

function desenharBilhetes() {
  const n = estado.bilhetes.length;
  const e = estado.plano?.escolha;
  if (!e || !n) return;
  const assinatura = [e.v, e.k, e.t, n, estado.precos.aposta[e.k], estado.link?.parte].join('-');
  if (assinatura === cartaoDesenhado) return;
  cartaoDesenhado = assinatura;
  $('secao-bilhetes').innerHTML = `
    <div class="gerado">
      <p class="oque">Fechamento gerado</p>
      <p class="quantas">${n.toLocaleString('pt-BR')}</p>
      <p class="oque">${n === 1 ? 'cartela' : 'cartelas'} de ${e.k} dezenas ·
        ${dinheiro(n * estado.precos.aposta[e.k])}</p>
      ${estado.link?.parte == null ? '' : `<p class="ajuda">Você é a parte
        ${estado.link.parte + 1} de ${estado.link.partes} deste bolão: a garantia acima é do
        bolão inteiro.</p>`}
      <div class="linha abrir">
        <button type="button" data-acao="abrir">Visualizar cartelas</button>
      </div>
    </div>
    ${botoes([['copiar', 'Copiar'], ['texto', 'Baixar texto'], ['csv', 'Baixar CSV'],
      ['guardar', 'Guardar na carteira']])}`;
}

// ── a área de análise ───────────────────────────────────────────────────────
//
// Gerar e analisar são dois assuntos. O primeiro cabe numa tela curta; o
// segundo tem cartelas, conferência, simulação e dinheiro, e nenhum deles
// precisa estar visível enquanto a pessoa ainda decide o que comprar.
//
// A barra de abas é a navegação: uma coisa de cada vez, todas a um toque. Nada
// foi escondido — foi organizado.

const ABAS = ['cartelas', 'conferir', 'simular', 'valores', 'resumo'];

/// De onde a área foi aberta, para o foco voltar exatamente para lá. Sem isto o
/// foco cai no `body`, e quem navega por teclado perde o lugar onde estava.
let voltarOFocoPara = null;

function abrirAnalise(qual = 'cartelas') {
  if (!estado.bilhetes.length || !$('analise').hidden) return;
  const e = estado.plano.escolha;
  $('analise-titulo').textContent =
    `${plural(estado.bilhetes.length, 'cartela', 'cartelas')} de ${e.k} dezenas`;
  desenharListaCartelas();
  desenharResumo();
  desenharValores();
  desenharAcaso();
  voltarOFocoPara = document.activeElement;
  $('analise').hidden = false;
  // Sem isto o corpo rola por baixo da área, e o dedo arrasta a página errada.
  document.body.style.overflow = 'hidden';
  // A tela de geração continua no documento, atrás. `inert` a tira do caminho
  // do teclado e do leitor de tela: sem ele, um Tab vaza para os cinquenta e
  // seis controles escondidos lá atrás, e quem não enxerga a área não descobre
  // que saiu dela.
  $('painel-principal').inert = true;
  trocarAba(qual);
  $('analise').scrollTop = 0;
  $('voltar').focus();
  // Uma entrada no histórico: no telefone, "voltar" é o gesto de fechar o que
  // está por cima. Sem isto ele fechava o aplicativo inteiro.
  history.pushState({ analise: true }, '');
}

function fecharAnalise({ voltandoNoHistorico = false } = {}) {
  const estavaAberta = !$('analise').hidden;
  $('analise').hidden = true;
  $('painel-principal').inert = false;
  document.body.style.overflow = '';
  if (estavaAberta && voltarOFocoPara?.isConnected) voltarOFocoPara.focus();
  voltarOFocoPara = null;
  // Fechar pelo botão consome a entrada que abrir criou; chegando pelo próprio
  // histórico ela já foi consumida, e chamar `back` de novo sairia do aplicativo.
  if (estavaAberta && !voltandoNoHistorico && history.state?.analise) history.back();
}

function trocarAba(qual, focar = false) {
  for (const botao of $('abas').children) {
    const escolhida = botao.dataset.aba === qual;
    botao.setAttribute('aria-selected', String(escolhida));
    // Só a aba escolhida entra na ordem do Tab; entre elas anda-se com as
    // setas, que é como uma barra de abas se comporta em toda parte.
    botao.tabIndex = escolhida ? 0 : -1;
    if (escolhida && focar) botao.focus();
  }
  for (const id of ABAS) $(`aba-${id}`).hidden = id !== qual;
  $('analise').scrollTop = 0;
}

function desenharListaCartelas() {
  if (!estado.bilhetes.length) return;
  const n = estado.bilhetes.length;
  $('lista-cartelas').innerHTML = `
    ${n <= MOSTRA ? '' : `<p class="ajuda">São ${n.toLocaleString('pt-BR')} cartelas, e a lista
      mostra as ${MOSTRA} primeiras — copie, baixe ou imprima para ter todas. O que se confere
      e simula aqui usa todas.</p>`}
    <ol class="bilhetes">${estado.bilhetes.slice(0, MOSTRA).map((b) =>
      `<li>${b.map((d) => `<span>${String(d).padStart(2, '0')}</span>`).join('')}</li>`).join('')}</ol>
    ${botoes([['copiar', 'Copiar'], ['texto', 'Baixar texto'], ['csv', 'Baixar CSV'],
      ['imprimir', 'Imprimir volantes']])}`;
}

function desenharResumo() {
  const e = estado.plano?.escolha;
  if (!e || !estado.bilhetes.length) return;
  const n = estado.bilhetes.length;
  const linhas = [
    ['Dezenas no seu pool', `${e.v}`],
    ['Dezenas em cada cartela', `${e.k}`],
    ['Acertos garantidos', e.jogos === 1 ? '— (uma cartela não é fechamento)' : `${e.t}`],
    ['Cartelas no fechamento', e.jogos.toLocaleString('pt-BR')],
    ...(n === e.jogos ? [] : [['Cartelas que cabem a você', n.toLocaleString('pt-BR')]]),
    ['Custo', dinheiro(n * estado.precos.aposta[e.k])],
    ['Tamanho', e.provado ? 'mínimo provado — nenhum fechamento faz isso com menos'
      : `menor conhecido — nenhum faz com menos de ${plural(e.piso, 'cartela', 'cartelas')}`],
  ];
  $('resumo').innerHTML = quadro(null, linhas.map(([r, v]) => linha(r, v)))
    + `<p class="ressalva">${chanceDeCairDentro(e.v)}</p>`;
}

function desenharAcaso() {
  const e = estado.plano?.escolha;
  if (!e) return;
  const p = estado.acaso.chegam?.[`${e.v}-${e.k}`]?.[e.t];
  if (p == null) return;
  const noChute = 1 - (1 - p) ** e.jogos;
  // E quanto isso devolve por concurso, em média. Só as faixas de prêmio fixo:
  // 14 e 15 são rateadas, e somá-las trocaria um número exato por um palpite.
  //
  // A conta é por aposta simples, e não por bilhete, porque é assim que a
  // lotérica cobra e paga: um bilhete de `k` dezenas **são** as `C(k,15)`
  // apostas de 15 que cabem dentro dele. Por linearidade, a expectativa de um
  // bilhete de `k` é `C(k,15)` vezes a de uma aposta simples — e como o preço
  // é `C(k,15)` vezes o de uma aposta simples, a taxa de retorno é **a mesma
  // para todo tamanho de bilhete**. Isso não é um detalhe: é o que transforma
  // "o fechamento compra certeza, não lucro" de frase em teorema.
  const simples = estado.acaso.chegam?.[`${UNIVERSO}-${SORTEIO}`] ?? {};
  const porAposta = [11, 12, 13].reduce(
    (soma, f) => soma + ((simples[f] ?? 0) - (simples[f + 1] ?? 0)) * estado.precos.premio[f], 0);
  const media = e.jogos * analise.binomial(e.k, SORTEIO) * porAposta;
  $('acaso').innerHTML = `
    <p>Com ${dinheiro(e.custo)} você compra ${e.jogos} ${e.jogos === 1 ? 'cartela' : 'cartelas'}
      de ${e.k} dezenas. Se eles fossem escolhidos no chute, chegariam a ${e.t} acertos em
      <b>${(noChute * 100).toFixed(noChute > 0.995 ? 2 : 1)}%</b> dos sorteios que caem dentro das
      suas ${e.v} dezenas. Com o fechamento, em <b>100%</b>.</p>
    <p class="ressalva">Em média os dois pagam o mesmo: a mesma quantidade de cartelas do mesmo
      tamanho tem a mesma expectativa de prêmio, com fechamento ou sem${media ? `, que aqui é
      <b>${dinheiro(Math.round(media))}</b> por concurso nas faixas de 11, 12 e 13 acertos — mais
      o que sair de 14 e 15, que é rateado e ninguém sabe de antemão` : ''}. O que o fechamento
      compra não é lucro — é certeza no lugar de sorte.</p>`;
}

/// O dinheiro do fechamento, preenchido pelo aplicativo e editável por quem
/// discordar. Os campos escrevem na mesma tabela de preços da tela principal:
/// dois lugares da tela dizendo preços diferentes seria pior do que não ter os
/// dois. O resultado financeiro é o da última conferência ou simulação — sem
/// uma delas, não há prêmio nenhum a somar, e a tela diz isso em vez de zerar.
function desenharValores() {
  // Sem fechamento não há conta a fazer: um preço editado pode ter acabado com
  // ele, e a tela principal já está explicando por quê.
  const e = estado.plano?.escolha;
  if (!e || !estado.bilhetes.length) return;
  const n = estado.bilhetes.length;
  const unitario = estado.precos.aposta[e.k];
  const u = estado.ultimoResultado;
  const campo = (grupo, chave, valor) => `<input type="text" inputmode="decimal"
    data-grupo="${grupo}" data-chave="${chave}" value="${dinheiro(valor)}"
    aria-label="${grupo === 'aposta' ? 'Valor de cada cartela' : `Prêmio de ${chave} acertos`}">`;
  $('valores').innerHTML = quadro(null, [
    linha('Valor de cada cartela', campo('aposta', e.k, unitario)),
    linha('Cartelas', n.toLocaleString('pt-BR')),
    total('Custo total', dinheiro(n * unitario)),
  ]) + `<details><summary>Quanto paga cada faixa</summary><div>${quadro(null,
    [11, 12, 13, 14, 15].map((f) => linha(`${f} acertos`, campo('premio', f, estado.precos.premio[f]))))}
      <p class="ajuda">14 e 15 acertos são rateados e mudam a cada concurso; os valores aqui são
        referência. Nenhum destes números é auditado por este aplicativo.</p>
    </div></details>` + (u ? quadro([u.titulo, ''], [
    linha('Cartelas premiadas', u.premiadas.toLocaleString('pt-BR')),
    linha('Gasto', dinheiro(u.gasto)),
    linha('Prêmios', dinheiro(u.premio)),
    total('Resultado', saldo(u.premio - u.gasto)),
  ]) : '<p class="ajuda">Confira contra um sorteio ou simule para ver o resultado financeiro.</p>');
}

/// As máscaras do que **esta pessoa** tem na mão. Num bolão é a parte dela:
/// simular o fechamento inteiro diria a ela como foi o jogo de outra gente.
const mascarasNaMao = () => (estado.link?.parte == null ? estado.mascaras
  : volante.dividir(estado.mascaras, estado.link.partes)[estado.link.parte]);

async function rodarSimulacao() {
  if (!estado.mascaras.length) return;
  const quantos = Number($('s-quantos').value);
  const dentroDoPool = $('s-onde').value === 'pool';
  const e = estado.plano.escolha;
  $('simular').disabled = true;
  $('simulacao').innerHTML = '<p class="ajuda">Simulando…</p>';
  await new Promise((pronto) => setTimeout(pronto, 0));  // deixa o aviso aparecer
  const meus = mascarasNaMao();
  const r = analise.simular({
    mascaras: meus, dezenas: estado.dezenas, universo: UNIVERSO, quantos,
    dentroDoPool, premios: estado.precos.premio, garantia: e.jogos === 1 ? 0 : e.t, k: e.k,
    custo: estado.bilhetes.length * estado.precos.aposta[e.k],
    // Os mesmos bilhetes no chute, contra os mesmos sorteios. É a pergunta que
    // o aplicativo responde por escrito desde sempre — "o fechamento compra
    // certeza, não lucro" — passando a ser medida na frente de quem duvida.
    contra: analise.bilhetesAoAcaso(e.v, e.k, meus.length),
  });
  estado.ultimoResultado = { premiadas: r.premiadas, gasto: r.gasto, premio: r.premio,
    titulo: `${quantos.toLocaleString('pt-BR')} ${quantos === 1 ? 'sorteio simulado'
      : 'sorteios simulados'}` };
  $('simulacao').innerHTML = desenharSimulacao(r, e);
  $('simular').disabled = false;
  desenharValores();
}

// As faixas de prêmio fixo se comparam; as rateadas não. Separá-las é a
// diferença entre uma tabela que informa e uma que engana com um número grande.
const FIXAS = [11, 12, 13];
const RATEADAS = [14, 15];
/// Só as faixas pedidas, para o mesmo cálculo de prêmio valer nas duas colunas.
const soAsFaixas = (faixas) => Object.fromEntries(
  faixas.map((f) => [f, estado.precos.premio[f] ?? 0]));
const pagam = (placar, faixas, k) => (!placar ? 0
  : analise.premioDe(placar.faixas, soAsFaixas(faixas), k));

/// Por que o dinheiro de um bilhete grande não bate com a conta de cabeça.
///
/// Quem vê "1 × 14 acertos" e um preço de catorze na tabela espera o valor de
/// uma catorze. Com bilhete de mais de 15 dezenas ele recebe mais, e sem esta
/// frase o número parece errado — ou, pior, parece propaganda. O exemplo é
/// calculado, não escrito: é a decomposição de verdade daquele tamanho.
function comoPaga(k) {
  if (k <= SORTEIO) return '';
  const partes = [];
  for (let i = SORTEIO; i >= 11; i--) {
    const quantas = analise.apostasComAcertos(k, 14, i);
    if (quantas) partes.push(`${quantas} de ${i}`);
  }
  return `<p class="ressalva">Cada cartela de ${k} dezenas vale
    ${analise.binomial(k, SORTEIO)} apostas de 15 — é por isso que ele custa
    ${dinheiro(estado.precos.aposta[k])} e não ${dinheiro(estado.precos.aposta[SORTEIO])}. O
    prêmio segue a mesma conta: uma cartela de ${k} que cruza 14 dezenas com o sorteio paga
    ${partes.join(', ')} acertos — e não uma catorze só.</p>`;
}

const porcento = (parte, total) => (total ? `${((100 * parte) / total).toFixed(1)}%` : '—');
const saldo = (c) => `${c >= 0 ? '' : '−'}${dinheiro(Math.abs(c))}`;

function desenharSimulacao(r, e) {
  const premiadas = [15, 14, 13, 12, 11].filter((f) => r.faixas.has(f));
  // A união dos dois lados: o fechamento não desce da garantia, e o chute
  // desce. Mostrar só as linhas do fechamento esconderia exatamente onde os
  // dois diferem, que é o que a tabela existe para mostrar.
  const melhores = [...new Set([...r.distribuicao.keys(),
    ...(r.rival?.distribuicao.keys() ?? [])])].sort((a, b) => b - a);
  const maior = Math.max(...melhores.map((m) => r.distribuicao.get(m) ?? 0));
  const numero = (n) => n.toLocaleString('pt-BR');
  return `
    <p><b>${numero(r.quantos)}</b> ${r.quantos === 1 ? 'sorteio' : 'sorteios'} ${r.dentroDoPool
      ? `dentro das suas ${e.v} dezenas` : 'entre as 25 dezenas, como na vida real'}.
      Melhor resultado: <b>${r.melhor} acertos</b>.</p>
    ${r.dentroDoPool ? `<p class="ressalva">Estes são os concursos em que a garantia vale — e
      só eles. ${chanceDeCairDentro(e.v)} O resultado abaixo não é o que se espera por concurso:
      é o que acontece nesse punhado.</p>` : `<p class="ressalva">${r.caiuNoPool === 0 ? 'Nenhum sorteio caiu'
      : `${numero(r.caiuNoPool)} ${r.caiuNoPool === 1 ? 'sorteio caiu' : 'sorteios caíram'}`}
      inteiro dentro do seu pool — e só nesses a garantia de ${e.t} acertos vale. É a diferença
      entre o tamanho da promessa e a chance de ela ser cobrada.</p>`}
    ${r.garantia ? quadro([`Alcançou ${r.garantia} acertos`, 'Seu fechamento', 'No chute'],
    [total('dos sorteios', porcento(r.alcancaram, r.quantos),
      porcento(r.rival.alcancaram, r.quantos))])
    + `<p class="ressalva">"No chute" são ${plural(estado.bilhetes.length, 'cartela tirada',
      'cartelas tiradas')} ao acaso do mesmo pool, do mesmo tamanho, contra os mesmos sorteios:
      o que o mesmo dinheiro compraria sem fechamento nenhum. ${r.alcancaram === r.rival.alcancaram
      ? 'Aqui os dois deram no mesmo — nesta configuração a garantia não compra nada que o acaso já não desse.'
      : 'A diferença entre as duas colunas é o que o fechamento compra.'}</p>` : ''}
    ${quadro(['Faixa', 'Cartelas', 'No chute', 'Sorteios'], premiadas.length
    ? premiadas.map((f) => linha(`${f} acertos`, numero(r.faixas.get(f)),
      numero(r.rival?.faixas.get(f) ?? 0), numero(r.sorteiosComFaixa.get(f))))
    : [linha('Nenhuma cartela premiada.', 0, 0, 0)])}
    ${quadro(['Melhor cartela do sorteio', 'Seu fechamento', 'No chute', ''],
    melhores.map((acertos) => {
      const meu = r.distribuicao.get(acertos) ?? 0;
      return linha(`${acertos} acertos`, numero(meu),
        numero(r.rival?.distribuicao.get(acertos) ?? 0),
        `<span class="barra" style="width:${Math.round((100 * meu) / maior)}%"></span>`);
    }))}
    ${quadro(['', 'Seu fechamento', 'No chute'], [
    linha('Gasto', dinheiro(r.gasto), dinheiro(r.gasto)),
    linha('Prêmios de 11 a 13',
      dinheiro(pagam(r, FIXAS, e.k)), dinheiro(pagam(r.rival, FIXAS, e.k))),
    linha('Prêmios de 14 e 15',
      dinheiro(pagam(r, RATEADAS, e.k)), dinheiro(pagam(r.rival, RATEADAS, e.k))),
    total('Resultado', saldo(r.saldo), saldo(r.rival?.saldo ?? -r.gasto)),
  ])}
    ${comoPaga(e.k)}
    <p class="ressalva">As duas primeiras faixas se comparam: 11, 12 e 13 acertos pagam valor
      fixo, os dois lados custam o mesmo e, na média, pagam o mesmo — é assim que a matemática
      funciona. A linha de 14 e 15 não se compara: são rateadas, e <b>um único acerto de 15 num
      dos lados vira milhão</b> e vira a conta inteira. O que o fechamento compra está na
      primeira tabela, não nesta.</p>
    ${r.melhorSorteio ? `<p class="ajuda">O melhor deles foi
      ${r.melhorSorteio.map((d) => String(d).padStart(2, '0')).join(' ')}.</p>` : ''}`;
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
      return `<li><b>Parte ${i + 1}</b> — ${plural(g.length, 'cartela', 'cartelas')} ·
        ${dinheiro(g.length * estado.precos.aposta[k])}
        <button type="button" class="discreto" data-link="${link}"
          aria-label="Copiar o link da parte ${i + 1}">Copiar link</button></li>`;
    })
    .join('')}</ol>${fechamentoDaConta()}`;
}

/// A conta de tudo o que está guardado. Um jogo de cada vez não responde à
/// pergunta que a pessoa realmente tem — "no fim das contas, quanto isto me
/// custou?" —, e é uma pergunta que ela merece ver respondida sem calculadora.
///
/// Só entram no retorno os jogos já conferidos: somar zero pelos que ainda não
/// foram conferidos faria a carteira dizer que se perdeu dinheiro que ainda
/// pode voltar.
function fechamentoDaConta() {
  const gasto = estado.carteira.reduce((soma, r) => soma + r.custo, 0);
  const conferidos = estado.carteira.filter((r) => r.retorno != null);
  const voltou = conferidos.reduce((soma, r) => soma + r.retorno, 0);
  const gastoConferido = conferidos.reduce((soma, r) => soma + r.custo, 0);
  return quadro(null, [
    linha(plural(estado.carteira.length, 'fechamento guardado', 'fechamentos guardados'), dinheiro(gasto)),
    ...(conferidos.length ? [
      linha(`${plural(conferidos.length, 'já conferido', 'já conferidos')} · custaram`,
        dinheiro(gastoConferido)),
      linha('e voltaram', dinheiro(voltou)),
      total('Saldo do que foi conferido', saldo(voltou - gastoConferido)),
    ] : [linha('Nenhum conferido ainda', '—')]),
  ]);
}

function desenharPrecos() {
  const grupos = [['aposta', 'Quanto custa a aposta', 'dezenas'], ['premio', 'Quanto paga cada faixa', 'acertos']];
  $('tabela-precos').innerHTML = `${grupos.map(([grupo, titulo, unidade]) =>
    `<div class="precos"><h2>${titulo}</h2>${Object.keys(estado.precos[grupo]).map((k) =>
      `<label>${k} ${unidade}<input type="text" inputmode="decimal" data-grupo="${grupo}"
        data-chave="${k}" value="${dinheiro(estado.precos[grupo][k])}"></label>`).join('')}</div>`)
    .join('')}
    <p class="ajuda">Valores de ${estado.precosPublicados.vigencia}.</p>`;
}

function desenharCarteira() {
  if (!estado.carteira.length) { $('carteira').innerHTML = '<p class="ajuda">Nada guardado.</p>'; return; }
  $('carteira').innerHTML = `<ol class="registros">${estado.carteira
    .map((r, i) => `<li><b>${r.t} acertos garantidos</b> ·
        ${plural(r.jogos, 'cartela', 'cartelas')} de ${r.k} dezenas ·
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

/// A porta por onde todo fechamento nomeado entra: o que a pessoa escolhe na
/// lista, o que volta guardado de outra sessão e o que chega num link de bolão.
///
/// A régua é a mesma que a lista usa para oferecer — `fechamentosDe` —, e por
/// isso o modo manual não pode mais aceitar o que o automático recusa. Sem esta
/// porta, um link antigo montava cartelas de 22 dezenas, que lotérica nenhuma
/// aceita, e um preço zerado à mão dava um fechamento de graça.
function fixoValido(pedido) {
  const { v, k, t } = pedido ?? {};
  if (!estado.indice || !(v && k && t)) return null;
  const existe = fechamentosDe(estado.indice, estado.precos, v)
    .some((e) => e.k === k && e.t === t);
  return existe ? { v, k, t } : null;
}

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
  // Sem catálogo não há lista: na primeira visita sem rede os controles existem
  // na página antes de o índice chegar, e mexer neles não pode quebrar a tela.
  if (!estado.indice) return;
  // O pool é o que está marcado na grade, e não o que o select guardou: são a
  // mesma coisa dita de dois jeitos, e duas fontes discordando faziam a primeira
  // escolha aqui refazer em silêncio a marcação que a pessoa tinha feito lá.
  const pool = estado.dezenas.size >= 15 ? estado.dezenas.size : UNIVERSO;
  trocarOpcoes('m-pool', Array.from({ length: UNIVERSO - 14 }, (_, i) => [i + 15, `${i + 15}`]));
  $('m-pool').value = String(pool);
  // "2,5 cartelas" e "-5 cartelas" são pedidos que não existem; um campo numérico
  // aceita os dois. Valem como "sem teto", que é o que a pessoa tinha antes.
  const pedidoDeTeto = Math.floor(Number($('m-teto').value));
  const teto = pedidoDeTeto >= 1 ? pedidoDeTeto : Infinity;
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
  // O descarte não esconde o fechamento em uso. Ele veio de uma escolha desta
  // pessoa — ou de um link de bolão — e some-lo do select deixaria a lista
  // dizendo uma coisa e a resposta acima dela, outra. Os **filtros** continuam
  // valendo sobre ele: filtrar é a pessoa pedindo outra coisa, e o pedido novo
  // manda no antigo.
  const emUso = (e) => estado.fixo && e.v === estado.fixo.v && e.k === estado.fixo.k
    && e.t === estado.fixo.t;
  const quais = todas
    .filter((e) => e.jogos <= teto && (!k || e.k === k) && (!t || e.t >= t))
    .filter((e, _, ate) => emUso(e)
      || !ate.some((o) => o.k === e.k && o.custo <= e.custo && o.t > e.t));
  // Garantia e preço primeiro: num telefone a lista fechada mostra só o começo
  // do texto, e o começo tem de ser o que faz escolher entre uma linha e outra.
  trocarOpcoes('m-fechamento', quais.map((e) => [`${e.k}-${e.t}`,
    `garante ${e.t} acertos · ${dinheiro(e.custo)} ·
     ${plural(e.jogos, 'cartela', 'cartelas')} de ${e.k} dezenas`]));
  // Lista vazia sem explicação é a pessoa achando que o aplicativo quebrou. A
  // frase nomeia o que ela pediu, para ela saber o que afrouxar.
  const pedido = [k && `${k} dezenas por cartela`, t && `${t} acertos garantidos`,
    teto !== Infinity && `no máximo ${plural(teto, 'cartela', 'cartelas')}`].filter(Boolean);
  const frase = pedido.length < 2 ? pedido.join('')
    : `${pedido.slice(0, -1).join(', ')} e ${pedido.at(-1)}`;
  $('manual').textContent = quais.length ? ''
    : `Com ${pool} dezenas não há fechamento catalogado${frase ? ` com ${frase}` : ''}.`;
}

/// Aplica o que foi escolhido: ajusta a marcação ao pool pedido, fixa o
/// fechamento e deixa a tela responder pelo caminho de sempre.
function aplicarManual() {
  if (!estado.indice) return;
  const pool = Number($('m-pool').value);
  // A ordem é o conserto: ajustar a grade, redesenhar a lista **para o pool
  // novo**, e só então ler o que sobrou. Lendo antes, o fechamento vinha da
  // lista do pool anterior — uma combinação que o catálogo não tem — e a tela
  // morria dizendo "não há fechamento catalogado" para um pool cheio deles.
  if (estado.dezenas.size !== pool) ajustarPara(pool);
  desenharManual();
  const [k, t] = ($('m-fechamento').value || '').split('-').map(Number);
  fixar(fixoValido({ v: pool, k, t }));
  // Quem chegou por um link de bolão recebe uma parte, não o fechamento inteiro.
  // Montando outro fechamento à mão, aquela parte era de outro conjunto — e sem
  // isto a tela entregaria um terço do novo dizendo ser a parte do bolão antigo.
  if (estado.fixo) estado.link = null;
  responder();
  mostrarAResposta();
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
    // Mexer no dinheiro é voltar a perguntar "o que isto compra": sai o bolão
    // de outra pessoa, e sai o fechamento nomeado à mão.
    estado.link = null;
    fixar(null);
    guardar('orcamento', estado.orcamento);
    atualizarDinheiro();
    responder();
  };
  $('regua').addEventListener('input', () => trocarOrcamento(daRegua(Number($('regua').value))));
  $('valor').addEventListener('change', () => trocarOrcamento(emCentavos($('valor').value)));

  for (const id of ['secao-bilhetes', 'lista-cartelas', 'painel-corpo']) {
    $(id).addEventListener('click', (ev) => acaoDosBilhetes(ev.target.dataset?.acao));
  }
  $('voltar').addEventListener('click', () => fecharAnalise());
  // "Voltar" do navegador, e o gesto de deslizar do telefone: fecham a área em
  // vez de sair do aplicativo.
  addEventListener('popstate', () => {
    if (!$('analise').hidden) fecharAnalise({ voltandoNoHistorico: true });
  });
  $('abas').addEventListener('click', (ev) => {
    const qual = ev.target.dataset?.aba;
    if (qual) trocarAba(qual);
  });
  // Setas andam entre as abas, como numa barra de abas de verdade.
  $('abas').addEventListener('keydown', (ev) => {
    const passo = { ArrowRight: 1, ArrowLeft: -1, Home: -ABAS.length, End: ABAS.length }[ev.key];
    if (!passo) return;
    ev.preventDefault();
    const agora = ABAS.indexOf(ev.target.dataset?.aba);
    const alvo = Math.min(ABAS.length - 1, Math.max(0, (agora < 0 ? 0 : agora) + passo));
    trocarAba(ABAS[alvo], true);
  });
  $('simular').addEventListener('click', rodarSimulacao);
  // A área é uma tela por cima da outra, e "voltar" tem de fechá-la — no
  // telefone o gesto é esse, e no teclado é a tecla de escape.
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('analise').hidden) fecharAnalise();
  });
  // Os valores editáveis escrevem na mesma tabela de preços da tela principal.
  $('valores').addEventListener('change', (ev) => {
    if (trocarPreco(ev.target)) { desenharPrecos(); responder(); desenharValores(); }
  });
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
    if (trocarPreco(ev.target)) { desenharPrecos(); responder(); }
  });
  $('restaurar-precos').addEventListener('click', () => {
    estado.precos = structuredClone(estado.precosPublicados);
    guardar('precos', {});
    desenharPrecos();
    responder();
  });

  // Trocar o pool mexe na grade, e o redesenho vem de lá — redesenhar aqui
  // devolveria o pool anterior antes de `aplicarManual` chegar a ler o novo.
  $('m-pool').addEventListener('input', aplicarManual);
  for (const id of ['m-teto', 'm-k', 'm-t']) {
    $(id).addEventListener('input', () => { desenharManual(); aplicarManual(); });
  }
  $('m-fechamento').addEventListener('change', aplicarManual);

  $('varrer').addEventListener('click', varrerTudo);
  $('buscar-sorteio').addEventListener('click', buscarSorteio);
  $('sorteio').addEventListener('change', conferirContraOSorteio);
  $('enviar-intencao').addEventListener('click', enviarIntencao);
  $('fechar-painel').addEventListener('click', () => ($('painel').hidden = true));
}

/// Um valor editado pela pessoa, vindo de qualquer das duas tabelas de preço —
/// a da tela principal e a do painel de valores. As duas escrevem no mesmo
/// lugar: dois preços diferentes na mesma sessão seria um deles mentindo.
function trocarPreco(campo) {
  const { grupo, chave } = campo?.dataset ?? {};
  if (!grupo) return false;
  const c = emCentavos(campo.value);
  if (c != null && c >= 0) estado.precos[grupo][chave] = c;
  guardar('precos', { aposta: estado.precos.aposta, premio: estado.precos.premio });
  return true;
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

/// Toda troca de dezenas passa por aqui: guarda, desfaz os dois vínculos que
/// eram de outro conjunto de dezenas — o link de bolão e o fechamento montado à
/// mão — e redesenha. Sem soltar o fechamento, limpar a grade deixava na tela
/// quatro bilhetes vazios sob uma manchete de garantia: o fechamento era de 22
/// dezenas, e não havia mais dezena nenhuma de onde tirar os números.
function trocarDezenas(novas) {
  estado.dezenas = novas;
  estado.link = null;
  fixar(null);
  guardar('dezenas', [...novas]);
  responder();
}

async function acaoDosBilhetes(acao) {
  if (!acao || estado.bilhetes.length === 0) return;
  const e = estado.plano.escolha;
  if (acao === 'abrir') return abrirAnalise();
  const nome = `fechamento-${e.v}-${e.k}-${e.t}`;
  if (acao === 'copiar') {
    const deu = await volante.copiar(volante.comoTexto(estado.bilhetes));
    if (deu) $('secao-bilhetes').querySelector('[data-acao=copiar]').textContent = 'Copiado';
  } else if (acao === 'texto') {
    volante.baixar(`${nome}.txt`, volante.comoTexto(estado.bilhetes));
  } else if (acao === 'csv') {
    volante.baixar(`${nome}.csv`, volante.comoCsv(estado.bilhetes), 'text/csv');
  } else if (acao === 'imprimir') {
    // Quem toca aqui com 3.608 cartelas na mão estava a um toque de **241
    // folhas** de papel, e nada na tela dizia isso: o painel abria e a caixa de
    // impressão do sistema aparecia junto. Agora o painel diz quantas folhas
    // são, mostra os volantes, e a impressão só começa quando ela pedir de
    // novo. Não é uma funcionalidade escondida — é a conta na frente da conta.
    const folhas = Math.ceil(estado.bilhetes.length / POR_FOLHA);
    $('painel-titulo').textContent = 'Volantes';
    $('painel-corpo').innerHTML = `<p class="ajuda so-na-tela">${
      plural(estado.bilhetes.length, 'volante', 'volantes')} · cerca de ${
      plural(folhas, 'folha', 'folhas')} de papel.</p>
      <div class="linha so-na-tela"><button type="button" data-acao="imprimir-agora"
        >Imprimir ${plural(folhas, 'folha', 'folhas')}</button></div>
      ${estado.bilhetes.map((b) => volante.comoVolante(b, UNIVERSO)).join('')}`;
    $('painel').hidden = false;
  } else if (acao === 'imprimir-agora') {
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
    : `<b>A garantia não se sustentou</b>: existe resultado em que a melhor cartela faz só
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
    // O último resultado guardado passa pela mesma porta por onde passa o que a
    // pessoa digita: `dezenasDoTexto`. Sem isso, um `ultimo-sorteio` estragado
    // fazia o botão estourar dentro do `catch` que existia para não deixar nada
    // estourar — e quem tocasse nele em modo avião ficava com "Buscando…" para
    // sempre, sem erro na tela e sem jeito de continuar.
    const guardado = lembrar('ultimo-sorteio', null);
    const dezenas = guardado && dezenasDoTexto(String(guardado.dezenas ?? ''));
    if (!dezenas) { $('buscar-sorteio').textContent = 'Sem resultado — digite as 15 dezenas'; return; }
    $('sorteio').value = dezenas.join(' ');
    conferirContraOSorteio();
    $('buscar-sorteio').textContent = Number.isFinite(guardado.concurso)
      ? `Concurso ${guardado.concurso} (guardado)` : 'Último resultado guardado';
  }
}

function conferirContraOSorteio() {
  const sorteadas = dezenasDoTexto($('sorteio').value);
  if (!sorteadas || estado.bilhetes.length === 0) {
    $('conferencia').innerHTML = sorteadas ? ''
      : '<p class="ajuda">Escreva as 15 dezenas sorteadas, separadas por espaço.</p>';
    return;
  }
  const e = estado.plano.escolha;
  const { faixas, melhor } = analise.umSorteio(mascarasNaMao(),
    analise.mascaraDoSorteio(sorteadas, [...estado.dezenas].sort((a, b) => a - b)));
  const voltou = analise.premioDe(faixas, estado.precos.premio, e.k);
  const custo = estado.bilhetes.length * estado.precos.aposta[e.k];
  const linhas = [...faixas.entries()].sort((a, b) => b[0] - a[0]);
  anotarNaCarteira(sorteadas, voltou);
  estado.ultimoResultado = { titulo: 'Conferência contra o sorteio',
    premiadas: [...faixas.values()].reduce((a, b) => a + b, 0), gasto: custo, premio: voltou };
  if (!$('analise').hidden) desenharValores();
  $('conferencia').innerHTML = `
    <p>Melhor cartela: <b>${melhor} acertos</b>.</p>
    ${linhas.length ? `<ul>${linhas.map(([a, q]) => `<li>${q} × ${a} acertos</li>`).join('')}</ul>`
      : '<p>Nenhuma cartela premiada.</p>'}
    <p>Custou ${dinheiro(custo)}, voltou ${dinheiro(voltou)} — <b>${voltou >= custo ? 'saldo de'
      : 'faltaram'} ${dinheiro(Math.abs(voltou - custo))}</b>.</p>
    ${comoPaga(e.k)}
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
