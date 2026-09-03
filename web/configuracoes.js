/*
 * A tela de Configurações.
 *
 * Reúne o que estava espalhado pelo rodapé de quatro páginas — o carimbo da
 * versão — e o que não estava em lugar nenhum: quanto o aplicativo ocupa neste
 * aparelho, quantos fechamentos estão guardados, se o modo sem internet está de
 * fato pronto, e se o navegador pode apagar tudo isso quando faltar espaço.
 *
 * O botão "Buscar atualizações" é a razão de a tela existir. Até aqui a
 * atualização era invisível: acontecia sozinha, e não havia como um usuário
 * perguntar "estou na versão mais nova?" e receber uma resposta. O carimbo no
 * rodapé responde metade da pergunta — diz o que está rodando, mas não o que
 * está publicado. Esta tela mostra os dois números e diz qual é a relação
 * entre eles.
 *
 * A regra que governa cada frase daqui: **nunca afirmar o que não foi
 * verificado**. "Não deu para verificar" é uma resposta legítima, e é a única
 * honesta quando a rede não respondeu. O contrário — tratar falha de rede como
 * ausência de novidade — transformaria o botão num enfeite que sempre diz sim.
 */

import * as atualizacao from './atualizacao.js';
import * as historico from './historico.js';
import * as exatoHistorico from './exato-historico.js';
import { quando } from './historico.js';

const $ = (id) => document.getElementById(id);

const CHAVE_DA_ULTIMA = 'sonho-lucido:ultima-verificacao';
const CHAVE_DO_AVISO_DE_TROCA = 'sonho-lucido:atualizou-para';

/** Quanto esperar pela troca de versão antes de recarregar de qualquer jeito. */
const PRAZO_DA_TROCA = 20000;

let versaoDaqui = null;

/*
 * Se foi esta carga da página que mandou instalar.
 *
 * Existe por um defeito medido: a confirmação "Atualizado. Agora você está na
 * versão X" aparecia na página **que estava indo embora**. O service worker
 * novo assume, a versão na tela troca, a confirmação é escrita — e um
 * décimo de segundo depois a recarga leva tudo, deixando o usuário numa tela
 * muda depois de ter tocado no botão. Quem escreve a nota não a lê; quem a lê é
 * a carga seguinte.
 */
let euPediAAtualizacao = false;

// ─────────── formatação ───────────

const decimal = (n, casas = 1) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * Bytes em unidade de gente.
 *
 * Sem casas decimais abaixo de um megabyte: "812 kB" é preciso o bastante, e
 * "812,4 kB" só ocupa espaço na linha.
 */
function emBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${decimal(bytes / (1024 * 1024))} MB`;
}

/** "nenhum", "1 fechamento", "7 fechamentos" — e nunca "1 fechamentos". */
function emFechamentos(n, limite) {
  if (!n) return 'nenhum';
  const plural = n === 1 ? '1 fechamento' : `${n} fechamentos`;
  return limite ? `${plural} de ${limite}` : plural;
}

function emArquivos(n) {
  return n === 1 ? '1 arquivo' : `${n} arquivos`;
}

function emNucleos(n) {
  return n === 1 ? '1 núcleo' : `${n} núcleos`;
}

function texto(id, valor) {
  const alvo = $(id);
  if (alvo) alvo.textContent = valor;
}

/**
 * O aviso flutuante, para o que não cabe numa linha de dado.
 *
 * Some sozinho: é informação de passagem, e um aviso que fica na tela para
 * sempre vira parte do cenário e deixa de ser lido.
 */
let relogioDoAviso = 0;
function avisar(mensagem, bom = false) {
  const aviso = $('cfg-aviso');
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.classList.toggle('bom', bom);
  aviso.hidden = false;
  clearTimeout(relogioDoAviso);
  relogioDoAviso = setTimeout(() => {
    aviso.hidden = true;
  }, 6000);
}

// ─────────── 1 · a versão e a atualização ───────────

function mostrarAVersao(versao) {
  versaoDaqui = versao;
  texto('cfg-versao', versao ?? 'não guardada neste navegador');
}

function mostrarOResultado(mensagem, tom = '') {
  const alvo = $('cfg-resultado');
  if (!alvo) return;
  alvo.textContent = mensagem;
  alvo.className = `resposta${tom ? ` ${tom}` : ''}`;
  alvo.hidden = false;
}

function mostrarAUltimaVerificacao() {
  const alvo = $('cfg-ultima');
  if (!alvo) return;
  const guardado = Number(localStorage.getItem(CHAVE_DA_ULTIMA));
  if (!guardado) {
    alvo.hidden = true;
    return;
  }
  alvo.textContent = `Última verificação: ${quando(guardado)}.`;
  alvo.hidden = false;
}

/**
 * Traduz as quatro situações em uma frase cada.
 *
 * As frases são diferentes de propósito, e cada uma carrega o número que a
 * sustenta. Uma tela que diga só "tudo certo" obriga a acreditar; mostrando o
 * carimbo, quem quiser conferir tem com o que conferir.
 */
function frase({ situacao, daqui, publicado }) {
  if (situacao === 'em-dia') {
    return [`Você já está na versão mais recente (${daqui}).`, 'boa'];
  }
  if (situacao === 'ha-novidade') {
    return [`Há uma versão nova: ${daqui} → ${publicado}.`, 'nova'];
  }
  if (situacao === 'sem-guardado') {
    return [
      'Este navegador não guarda o aplicativo para uso sem internet, então ' +
        `cada abertura busca o que está publicado — hoje, ${publicado}.`,
      '',
    ];
  }
  return [
    'Não deu para verificar: o servidor não respondeu. ' +
      (daqui
        ? `Você continua na versão ${daqui}, que está guardada no aparelho e funciona sem internet.`
        : 'Tente de novo quando houver conexão.'),
    'sem-resposta',
  ];
}

async function buscarAtualizacoes() {
  const botao = $('cfg-buscar');
  const atualizar = $('cfg-atualizar');
  if (atualizar) atualizar.hidden = true;

  if (botao) {
    botao.disabled = true;
    botao.dataset.ocupado = 'sim';
  }
  mostrarOResultado('Verificando…');

  let resultado;
  try {
    resultado = await atualizacao.procurar();
  } catch {
    resultado = { situacao: 'sem-resposta', daqui: versaoDaqui, publicado: null };
  }

  const [mensagem, tom] = frase(resultado);
  mostrarOResultado(mensagem, tom);

  // A hora só é guardada quando o servidor respondeu de fato. Guardá-la também
  // na falha faria a tela dizer "última verificação: agora" para uma
  // verificação que não aconteceu.
  if (resultado.situacao !== 'sem-resposta') {
    localStorage.setItem(CHAVE_DA_ULTIMA, String(Date.now()));
    mostrarAUltimaVerificacao();
  }

  if (resultado.situacao === 'ha-novidade' && atualizar) {
    atualizar.hidden = false;
    atualizar.dataset.para = resultado.publicado;
  }

  if (botao) {
    botao.disabled = false;
    delete botao.dataset.ocupado;
  }
}

/**
 * Instala o que está publicado.
 *
 * A troca acontece sozinha assim que o service worker novo assume, e o
 * `controllerchange` recarrega a página — é o mesmo caminho da atualização
 * automática. O prazo existe porque esse caminho pode não se fechar: se em
 * vinte segundos nada aconteceu, recarregar já resolve, porque os arquivos do
 * aplicativo são buscados na rede primeiro.
 */
async function atualizarAgora() {
  euPediAAtualizacao = true;
  const botao = $('cfg-atualizar');
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Instalando…';
    // Guardado antes de mandar instalar: a recarga pode vir em qualquer
    // instante depois desta linha, e escrever a nota depois seria escrever
    // numa página que já foi embora.
    if (botao.dataset.para) {
      sessionStorage.setItem(CHAVE_DO_AVISO_DE_TROCA, botao.dataset.para);
    }
  }

  const foi = await atualizacao.aplicar();
  if (!foi) {
    euPediAAtualizacao = false;
    sessionStorage.removeItem(CHAVE_DO_AVISO_DE_TROCA);
    mostrarOResultado(
      'Não deu para instalar daqui. Feche e abra o aplicativo: a versão nova ' +
        'assume sozinha na próxima abertura com internet.',
      'sem-resposta'
    );
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Atualizar agora';
    }
    return;
  }

  setTimeout(() => location.reload(), PRAZO_DA_TROCA);
}

/**
 * Depois da recarga, dizer o que aconteceu — senão a troca passa despercebida.
 *
 * E dizer a verdade nos dois casos. Se a versão que chegou não é a que se foi
 * buscar, anunciar "atualizado" seria a pior frase possível numa tela cuja
 * função é justamente responder "estou na versão mais nova?".
 */
function contarQueAtualizou() {
  const esperada = sessionStorage.getItem(CHAVE_DO_AVISO_DE_TROCA);
  if (!esperada || euPediAAtualizacao) return;
  sessionStorage.removeItem(CHAVE_DO_AVISO_DE_TROCA);

  if (versaoDaqui === esperada) {
    mostrarOResultado(`Atualizado. Agora você está na versão ${esperada}.`, 'boa');
    return;
  }

  mostrarOResultado(
    'A instalação não completou: este aparelho continua em ' +
      `${versaoDaqui ?? 'uma versão que não deu para ler'}, e o publicado é ${esperada}. ` +
      'Toque em Buscar atualizações para tentar de novo.',
    'sem-resposta'
  );
}

// ─────────── 2 · uso sem internet ───────────

async function contarOsArquivosGuardados() {
  if (!('caches' in window)) return 0;
  try {
    const chaves = await caches.keys();
    const contas = await Promise.all(
      chaves.map(async (chave) => (await (await caches.open(chave)).keys()).length)
    );
    return contas.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

async function pintarOModoSemInternet() {
  const arquivos = await contarOsArquivosGuardados();
  if (arquivos > 0) texto('cfg-offline', emArquivos(arquivos));
  else if (navigator.serviceWorker?.controller) texto('cfg-offline', 'sim');
  else texto('cfg-offline', 'ainda não');

  try {
    const { usage } = (await navigator.storage?.estimate?.()) ?? {};
    texto('cfg-espaco', Number.isFinite(usage) ? emBytes(usage) : 'o navegador não diz');
  } catch {
    texto('cfg-espaco', 'o navegador não diz');
  }

  await pintarAProtecao();
}

async function pintarAProtecao() {
  const botao = $('cfg-proteger');
  let protegido;
  try {
    protegido = await navigator.storage?.persisted?.();
  } catch {
    protegido = undefined;
  }

  if (protegido === true) {
    texto('cfg-persistencia', 'ativa');
    if (botao) botao.hidden = true;
    return;
  }
  if (protegido === false) {
    texto('cfg-persistencia', 'o navegador pode apagar');
    if (botao) botao.hidden = !navigator.storage?.persist;
    return;
  }
  texto('cfg-persistencia', 'o navegador não diz');
  if (botao) botao.hidden = true;
}

async function pedirProtecao() {
  const botao = $('cfg-proteger');
  if (botao) botao.disabled = true;
  let aceito = false;
  try {
    aceito = Boolean(await navigator.storage?.persist?.());
  } catch {
    aceito = false;
  }
  if (botao) botao.disabled = false;

  await pintarAProtecao();
  avisar(
    aceito
      ? 'Pronto: o navegador não vai apagar estes dados para abrir espaço.'
      : 'O navegador recusou por enquanto. Instalar o aplicativo na tela de ' +
          'início costuma bastar para ele aceitar.',
    aceito
  );
}

// ─────────── 3 · o trabalho guardado ───────────

/**
 * Soma o que a plataforma ocupa no `localStorage`.
 *
 * Só as chaves do próprio aplicativo entram: o `localStorage` é do domínio
 * inteiro, e somar o que não é nosso seria cobrar de outro. Cada caractere
 * conta dois bytes, que é como os navegadores guardam texto — é aproximação, e
 * a linha na tela não promete mais do que isso.
 */
function ocupadoPeloTrabalho() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (!chave?.startsWith('sonho-lucido')) continue;
      bytes += (chave.length + (localStorage.getItem(chave)?.length ?? 0)) * 2;
    }
  } catch {
    return null;
  }
  return bytes;
}

function pintarOTrabalhoGuardado() {
  let daLotinha = 0;
  let doExato = 0;
  try {
    daLotinha = historico.quantidade();
  } catch {
    daLotinha = 0;
  }
  try {
    doExato = exatoHistorico.quantidade();
  } catch {
    doExato = 0;
  }

  texto('cfg-hist-lotinha', emFechamentos(daLotinha, historico.LIMITE_DE_SESSOES));
  texto('cfg-hist-exato', emFechamentos(doExato, exatoHistorico.LIMITE_DE_SESSOES));

  const bytes = ocupadoPeloTrabalho();
  texto('cfg-espaco-trabalho', bytes === null ? 'o navegador não diz' : emBytes(bytes));
}

// ─────────── 4 · o aparelho ───────────

function ehInstalado() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    navigator.standalone === true
  );
}

function pintarOAparelho() {
  const nucleos = navigator.hardwareConcurrency;
  texto('cfg-nucleos', nucleos ? emNucleos(nucleos) : 'o navegador não diz');
  texto('cfg-wasm', typeof WebAssembly === 'object' ? 'disponível' : 'indisponível');
  texto('cfg-instalado', ehInstalado() ? 'instalado no aparelho' : 'no navegador');
}

// ─────────── 6 · voltar ao estado de recém-instalado ───────────

/*
 * O prefixo que marca tudo o que é deste aplicativo.
 *
 * Apagar `localStorage` inteiro seria mais simples e estaria errado: a origem é
 * compartilhada com qualquer outra coisa publicada no mesmo domínio, e um botão
 * desta tela não tem autoridade sobre o que não é dela. Todas as chaves nossas
 * começam com este prefixo — é o que torna o corte preciso.
 */
const PREFIXO = 'sonho-lucido:';

/** As chaves nossas que existem agora, sem tocar em nada de terceiros. */
function chavesDaqui(deposito) {
  const chaves = [];
  try {
    for (let i = 0; i < deposito.length; i += 1) {
      const chave = deposito.key(i);
      if (chave?.startsWith(PREFIXO)) chaves.push(chave);
    }
  } catch {
    // Um navegador com armazenamento bloqueado lança ao ser lido. Não há o que
    // apagar nesse caso, e falhar aqui impediria o resto do reset.
  }
  return chaves;
}

/** O que o botão vai apagar, dito antes de ele ser tocado. */
async function pintarOResumoDoReset() {
  const partes = [];

  const daLotinha = historico.listar().length;
  const doExato = exatoHistorico.listar().length;
  const fechamentos = daLotinha + doExato;
  if (fechamentos > 0) {
    partes.push(fechamentos === 1 ? '1 fechamento' : `${fechamentos} fechamentos`);
  }

  // As duas chaves de histórico já foram contadas como fechamentos logo acima.
  // Contá-las de novo aqui fazia um único fechamento salvo virar
  // "1 fechamento · 1 ajuste" — o mesmo dado listado duas vezes, numa tela
  // cuja função é dizer exatamente o que será apagado.
  const HISTORICOS = ['sonho-lucido:historico', 'sonho-lucido:exato:historico'];
  const ajustes = chavesDaqui(localStorage).filter((c) => !HISTORICOS.includes(c)).length;
  if (ajustes > 0) partes.push(ajustes === 1 ? '1 ajuste' : `${ajustes} ajustes`);

  try {
    const guardados = (await caches.keys()).length;
    if (guardados > 0) partes.push('o aplicativo guardado');
  } catch {
    // Sem CacheStorage não há o que contar, e a frase simplesmente não o cita.
  }

  texto('cfg-reset-resumo', partes.length === 0 ? 'nada — já está limpo' : partes.join(' · '));
}

/**
 * Apaga tudo o que é nosso e recarrega.
 *
 * A ordem importa e é a inversa da que parece natural. O service worker sai
 * **primeiro**: enquanto ele estiver no comando, ele pode responder à recarga
 * com o que tem guardado, e a página voltaria exatamente igual — que é o
 * sintoma que este botão existe para resolver. Só depois os depósitos, e a
 * recarga por último.
 */
async function apagarTudo() {
  const botao = $('cfg-reset');
  const resposta = $('cfg-reset-resultado');

  /*
   * A confirmação diz o número, e não só a categoria.
   *
   * "Os fechamentos guardados serão apagados" é abstrato o bastante para não
   * pesar. "Vai apagar 7 fechamentos" é o mesmo fato com a consequência à
   * vista — e a tela já tinha calculado esse número, logo acima, para o resumo
   * "Será apagado".
   */
  const quantos = historico.listar().length + exatoHistorico.listar().length;
  const oQueSePerde =
    quantos === 0
      ? 'Não há fechamento guardado. '
      : `Vai apagar ${quantos === 1 ? '1 fechamento' : `${quantos} fechamentos`} `
        + 'e os ajustes deste aparelho. ';

  const confirmou = window.confirm(
    'Apagar tudo e recomeçar?\n\n'
      + oQueSePerde
      + 'O aplicativo guardado para uso sem internet sai junto.\n\n'
      + 'Não dá para desfazer, e só o que você exportou para arquivo sobrevive.'
  );
  if (!confirmou) return;

  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Apagando…';
  }
  if (resposta) {
    resposta.hidden = false;
    resposta.textContent = 'Apagando o que está guardado neste aparelho…';
  }

  // Cada passo é tentado por conta própria: um navegador que proíbe um deles
  // não pode impedir os outros, e um reset pela metade é pior do que um reset
  // que diz o que não conseguiu.
  const falhou = [];

  try {
    const registros = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registros.map((r) => r.unregister()));
  } catch {
    falhou.push('o modo sem internet');
  }

  try {
    await Promise.all((await caches.keys()).map((c) => caches.delete(c)));
  } catch {
    falhou.push('o aplicativo guardado');
  }

  try {
    for (const chave of chavesDaqui(localStorage)) localStorage.removeItem(chave);
    for (const chave of chavesDaqui(sessionStorage)) sessionStorage.removeItem(chave);
  } catch {
    falhou.push('os ajustes e os históricos');
  }

  if (falhou.length > 0) {
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Apagar tudo e recomeçar';
    }
    if (resposta) {
      resposta.textContent =
        `Não deu para apagar ${falhou.join(' nem ')}. O resto foi apagado. `
        + 'Limpar os dados do site pelas configurações do navegador termina o serviço.';
    }
    await pintarOResumoDoReset();
    return;
  }

  if (resposta) resposta.textContent = 'Apagado. Baixando o aplicativo de novo…';

  // `location.replace` e não `reload`: a recarga simples pode ser servida do
  // cache de navegação do próprio navegador, que é outro depósito e não
  // obedece ao que acabou de ser apagado. Trocar o endereço força a busca.
  window.location.replace(`./configuracoes.html?recomecado=${Date.now()}`);
}

/*
 * A confirmação de que o reset aconteceu, lida pela carga seguinte.
 *
 * Pelo mesmo motivo da confirmação de atualização: quem apaga vai embora na
 * recarga, e uma mensagem escrita antes dela não é vista por ninguém. O sinal
 * viaja no endereço, porque é o único depósito que sobrevive a apagar todos os
 * outros.
 */
function contarQueRecomecou() {
  if (!new URLSearchParams(window.location.search).has('recomecado')) return;
  avisar('Pronto: o aplicativo voltou ao estado de recém-instalado.', true);
  // O endereço volta ao normal para uma recarga seguinte não repetir o aviso.
  window.history.replaceState(null, '', './configuracoes.html');
}

// ─────────── partida ───────────

$('cfg-buscar')?.addEventListener('click', buscarAtualizacoes);
$('cfg-atualizar')?.addEventListener('click', atualizarAgora);
$('cfg-proteger')?.addEventListener('click', pedirProtecao);
$('cfg-reset')?.addEventListener('click', apagarTudo);

atualizacao.registrar({
  aoSaberAVersao: (versao) => {
    mostrarAVersao(versao);
    contarQueAtualizou();
    pintarOModoSemInternet();
  },
});

// A versão não é chutada aqui. O traço do HTML fica até o service worker
// responder — dizer "não guardada" antes de perguntar seria afirmar, no
// primeiro décimo de segundo de toda visita, exatamente o que ainda não se
// sabe. Quem responde é `aoSaberAVersao`, inclusive com `null` quando não há
// service worker nenhum ou quando ele não respondeu no prazo.
mostrarAUltimaVerificacao();
pintarOTrabalhoGuardado();
pintarOAparelho();
pintarOModoSemInternet();
pintarOResumoDoReset();
contarQueRecomecou();
