/*
 * A tela do Construtor Matemático Exato.
 *
 * O aplicativo tem sete estágios e mostra os sete. A tentação seria uma chamada
 * só que devolvesse um número no fim de dez segundos — e ela esconderia
 * justamente o que há para ver: que determinar o mínimo, construir, verificar e
 * provar são quatro trabalhos diferentes, e que só o encontro dos dois últimos
 * autoriza a palavra "mínimo".
 *
 * A regra que decide o que pode ser afirmado mora em `exato-veredito.js`, sem
 * DOM e sem WebAssembly. Aqui só há pintura e sequência.
 */

import { frase, folga, veredito, MINIMO, FALHA } from './exato-veredito.js';

const $ = (id) => document.getElementById(id);

const trabalhador = new Worker('./exato-trabalhador.js', { type: 'module' });

/** Quantos nós a busca cíclica recebe: ela varre um espaço muito menor. */
const FATIA_CICLICA = 4;

/** Quanto o botão "insistir" multiplica o orçamento. */
const MULTIPLICADOR_DA_INSISTENCIA = 10;

/** Teto do orçamento, para o botão não crescer para sempre. */
const ORCAMENTO_MAXIMO = 2_000_000_000;

/*
 * Cada execução tem um número. Respostas de execuções anteriores chegam depois
 * de o usuário já ter mudado os parâmetros, e pintá-las mostraria o resultado
 * de um problema que não é mais o da tela.
 */
let etapa = 0;
let pedido = null;
let esforco = 0;
let estado = null;

function escapar(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function milhares(n) {
  return Number(n).toLocaleString('pt-BR');
}

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
  $('ex-insistir').hidden = true;
}

/* ─────────── o pedido ─────────── */

function lerPedido() {
  const v = Number($('ex-universo').value);
  const k = Number($('ex-cartela').value);
  const t = Number($('ex-alvo').value);
  for (const [nome, valor] of [
    ['v', v],
    ['k', k],
    ['t', t],
  ]) {
    if (!Number.isInteger(valor) || valor < 1) {
      throw new Error(`${nome} precisa ser um número inteiro maior que zero`);
    }
  }
  if (k > v) throw new Error(`a cartela tem ${k} números e o universo só tem ${v}: ela não cabe`);
  if (t > k) throw new Error(`o alvo pede ${t} números juntos numa cartela de ${k}`);
  return { v, k, t };
}

function comecar() {
  let novo;
  try {
    novo = lerPedido();
  } catch (erro) {
    $('ex-erro').hidden = false;
    $('ex-erro').innerHTML = `<b>Não dá para resolver isso.</b> <em>${escapar(erro.message)}</em>`;
    return;
  }

  etapa += 1;
  pedido = novo;
  esforco = Number($('ex-esforco').value);
  estado = {
    analise: null,
    piso: 0,
    origem: '',
    cartelas: [],
    metodo: '',
    verificado: false,
    descobertos: 0,
    ciclicaFechou: false,
    livreFechou: false,
    nos: 0,
  };

  esconderTudo();
  $('ex-analise-cartao').hidden = false;
  $('ex-alvos').textContent = '…';
  $('ex-blocos').textContent = '…';
  $('ex-por-bloco').textContent = '…';
  enviar({ tipo: 'analisar' });
}

function enviar(mensagem) {
  trabalhador.postMessage({ ...mensagem, pedido: JSON.stringify(pedido), etapa });
}

/* ─────────── a pintura, estágio a estágio ─────────── */

function pintarAnalise(dados) {
  estado.analise = dados;
  $('ex-alvos').textContent = grande(dados.alvos);
  $('ex-blocos').textContent = grande(dados.blocos);
  $('ex-por-bloco').textContent = grande(dados.alvos_por_bloco);
}

function pintarPiso(dados, aprofundado) {
  estado.piso = dados.valor;
  estado.origem = dados.origem;
  $('ex-piso-cartao').hidden = false;
  $('ex-piso').innerHTML =
    `<b>Nada menor que ${milhares(dados.valor)} cartelas existe.</b>` +
    `<br><em>De onde vem: ${escapar(dados.origem)}.</em>` +
    (aprofundado
      ? ''
      : '<br><em>Aprofundando pelo subproblema resolvido aqui dentro…</em>');
}

function pintarConstrucao(dados) {
  estado.cartelas = dados.cartelas;
  estado.metodo = dados.metodo;
  $('ex-construcao-cartao').hidden = false;
  $('ex-construcao').innerHTML =
    `<b>${milhares(dados.tamanho)} cartelas.</b>` +
    `<br><em>Método: ${escapar(dados.metodo)}.</em>`;
}

function pintarVerificacao(dados) {
  estado.verificado = dados.cobre;
  estado.descobertos = dados.descobertos;
  $('ex-verificacao-cartao').hidden = false;
  $('ex-verificacao').innerHTML = dados.cobre
    ? `<b>Confere.</b> <em>Os ${milhares(dados.alvos)} alvos estão todos cobertos.</em>`
    : `<b>Não confere.</b> <em>${milhares(dados.descobertos)} de ${milhares(
        dados.alvos
      )} alvos ficaram descobertos.</em>`;
}

function pintarProva(linhas) {
  $('ex-prova-cartao').hidden = false;
  $('ex-prova').innerHTML = linhas.join('<br>');
}

function pintarResultado() {
  const encontrado = estado.cartelas.length;
  const dados = {
    verificado: estado.verificado,
    encontrado,
    piso: estado.piso,
    ciclicaFechou: estado.ciclicaFechou,
    descobertos: estado.descobertos,
  };
  const qual = veredito(dados);

  $('ex-resultado-cartao').hidden = false;
  $('ex-frase').innerHTML = `<b>${escapar(frase(dados))}</b>`;
  $('ex-encontrado').textContent = milhares(encontrado);
  $('ex-provado').textContent = `≥ ${milhares(estado.piso)}`;
  $('ex-folga').textContent = milhares(folga(encontrado, estado.piso));
  $('ex-insistir').hidden = qual === MINIMO || qual === FALHA;
  $('ex-compartilhar').hidden = typeof navigator.share !== 'function';

  $('ex-cartelas').innerHTML =
    `<div class="cartelas">${estado.cartelas
      .map(
        (c, i) =>
          `<div class="cartela"><span class="indice">${String(i + 1).padStart(2, '0')}</span>` +
          `<span>${c.map((n) => String(n).padStart(2, '0')).join(' ')}</span></div>`
      )
      .join('')}</div>`;
}

/* ─────────── o texto que sai do aplicativo ─────────── */

function textoDoResultado() {
  const encontrado = estado.cartelas.length;
  const cabecalho =
    `C(${pedido.v},${pedido.k},${pedido.t}) — ${frase({
      verificado: estado.verificado,
      encontrado,
      piso: estado.piso,
      ciclicaFechou: estado.ciclicaFechou,
      descobertos: estado.descobertos,
    })}\n` +
    `Piso: ${estado.origem}\n` +
    `Construção: ${estado.metodo}\n\n`;
  return cabecalho + estado.cartelas.map((c) => c.join(' ')).join('\n') + '\n';
}

/* ─────────── a sequência ─────────── */

function proximoDepoisDaVerificacao() {
  // O piso pelo subproblema é caro e pode dispensar a prova inteira: se ele
  // encostar na construção, não há o que procurar.
  enviar({ tipo: 'aprofundar', orcamento: esforco });
}

function proximoDepoisDoPisoFundo() {
  const encontrado = estado.cartelas.length;
  if (!estado.verificado) {
    pintarResultado();
    return;
  }
  if (encontrado <= estado.piso) {
    pintarProva([
      '<b>Não foi preciso procurar.</b>',
      `<em>O piso já encosta na construção: ${milhares(encontrado)} cartelas, ` +
        `e nada menor que ${milhares(estado.piso)} existe.</em>`,
    ]);
    pintarResultado();
    return;
  }
  pintarProva(['<em>Varrendo a família cíclica…</em>']);
  enviar({
    tipo: 'provar',
    teto: encontrado,
    orcamento: Math.max(1000, Math.floor(esforco / FATIA_CICLICA)),
    familia: 'ciclica',
  });
}

function contarProva(dados, familia) {
  const nome = familia === 'ciclica' ? 'família cíclica' : 'todas as coleções';
  const nos = `${milhares(dados.visitados)} nós, ${milhares(dados.candidatos)} candidatos`;
  switch (dados.desfecho) {
    case 'minimo':
      return `<b>${nome}:</b> achou ${milhares(dados.tamanho)} e varreu o resto — ${nos}.`;
    case 'nada-abaixo':
      return `<b>${nome}:</b> nada abaixo de ${milhares(dados.tamanho)} existe — ${nos}.`;
    case 'excedido':
      return `<b>${nome}:</b> o orçamento acabou antes da resposta — ${nos}. Isto é "não sei", e não "não existe".`;
    default:
      return `<b>${nome}:</b> grande demais para varrer neste aparelho.`;
  }
}

let linhasDaProva = [];

/*
 * Quando uma varredura melhora a solução, a nova coleção vai ao verificador
 * antes de a sequência continuar. Estas duas guardam onde a sequência parou,
 * para retomá-la quando o verificador responder.
 */
let familiaPendente = null;
let dadosPendentes = null;

function receberProva(mensagem) {
  const { dados, familia } = mensagem;
  linhasDaProva.push(contarProva(dados, familia));
  pintarProva(linhasDaProva);

  // Uma varredura que achou algo menor melhora a solução — e a nova solução
  // volta ao verificador antes de valer, como qualquer outra. É a mesma regra
  // que vale para a construção: nada é aceito pela palavra de quem produziu.
  if (dados.desfecho === 'minimo' && dados.cartelas && dados.tamanho < estado.cartelas.length) {
    estado.cartelas = dados.cartelas;
    estado.metodo =
      familia === 'ciclica' ? 'busca exata sobre órbitas' : 'busca exata sobre todos os blocos';
    $('ex-construcao').innerHTML =
      `<b>${milhares(dados.tamanho)} cartelas.</b><br><em>Método: ${escapar(estado.metodo)}.</em>`;
    familiaPendente = familia;
    dadosPendentes = dados;
    enviar({ tipo: 'verificar', cartelas: estado.cartelas });
    return;
  }

  seguirDepoisDaProva(familia, dados);
}

function seguirDepoisDaProva(familia, dados) {
  if (familia === 'ciclica') {
    estado.ciclicaFechou = dados.fechou;
    pintarProva([...linhasDaProva, '<em>Varrendo todas as coleções…</em>']);
    enviar({
      tipo: 'provar',
      teto: estado.cartelas.length,
      orcamento: esforco,
      familia: 'livre',
    });
    return;
  }

  estado.livreFechou = dados.fechou;
  if (dados.fechou) {
    // A varredura completa é a afirmação mais forte que existe aqui: o piso
    // passa a ser o próprio tamanho, e a origem passa a ser a exaustão.
    estado.piso = estado.cartelas.length;
    estado.origem = 'exaustão: nenhuma solução menor existe';
    pintarPiso({ valor: estado.piso, origem: estado.origem }, true);
  }
  pintarResultado();
}

/* ─────────── as respostas do trabalhador ─────────── */

trabalhador.onmessage = (evento) => {
  const mensagem = evento.data ?? {};
  if (mensagem.etapa !== etapa) return;

  if (mensagem.tipo === 'erro') {
    $('ex-erro').hidden = false;
    $('ex-erro').innerHTML =
      `<b>O motor recusou o pedido.</b> <em>${escapar(mensagem.mensagem)}</em>`;
    esconderTudo();
    $('ex-erro').hidden = false;
    return;
  }

  switch (mensagem.tipo) {
    case 'analise':
      pintarAnalise(mensagem.dados);
      enviar({ tipo: 'limitar' });
      break;

    case 'piso':
      pintarPiso(mensagem.dados, false);
      enviar({ tipo: 'construir' });
      break;

    case 'construcao':
      pintarConstrucao(mensagem.dados);
      enviar({ tipo: 'verificar', cartelas: estado.cartelas });
      break;

    case 'verificacao': {
      pintarVerificacao(mensagem.dados);
      if (familiaPendente) {
        const familia = familiaPendente;
        const dados = dadosPendentes;
        familiaPendente = null;
        dadosPendentes = null;
        seguirDepoisDaProva(familia, dados);
      } else {
        proximoDepoisDaVerificacao();
      }
      break;
    }

    case 'piso-fundo':
      pintarPiso(mensagem.dados, true);
      linhasDaProva = [];
      proximoDepoisDoPisoFundo();
      break;

    case 'prova':
      receberProva(mensagem);
      break;
  }
};

/* ─────────── os botões ─────────── */

$('ex-resolver').addEventListener('click', comecar);

$('ex-insistir').addEventListener('click', () => {
  esforco = Math.min(ORCAMENTO_MAXIMO, esforco * MULTIPLICADOR_DA_INSISTENCIA);
  avisar(`Insistindo com ${milhares(esforco)} nós.`);
  linhasDaProva = [];
  $('ex-insistir').hidden = true;
  proximoDepoisDoPisoFundo();
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

// O service worker é o que faz o aplicativo abrir sem internet. Registrá-lo
// daqui é o que garante que quem entrar direto nesta página saia com ele.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
