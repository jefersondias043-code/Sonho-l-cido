/*
 * O Construtor — a tela.
 *
 * A inversão que dá nome ao aplicativo: em vez de partir de uma solução grande
 * e perguntar o que dá para tirar, ele parte das **regras** e pergunta qual é a
 * menor estrutura que as satisfaz. E ataca a pergunta pelos dois lados —
 * construindo por cima, e sabendo por baixo o que a matemática já garante.
 *
 * A tela existe para tornar esse vão visível. É a única coisa que o aplicativo
 * mostra o tempo todo, porque é a única que responde à pergunta que importa:
 * ainda vale deixar isto trabalhando?
 */

import { combinacoes, escapar, maximoPremiadas, milhares } from './comum.js';
import { Escada, PROVADO, IMPOSSIVEL } from './escada.js';

const $ = (id) => document.getElementById(id);

/** Quanto tempo cada tentativa de degrau corre antes de reportar e recomeçar. */
const SEGUNDOS_POR_TENTATIVA = 15;

let trabalhador = null;
let escada = null;
let solucao = [];
let configuracaoAtual = null;
let descendo = false;
let medindo = null;

/* ─────────── os números escolhidos ─────────── */

/*
 * O universo é quantos números existem; o pool é quais deles você vai jogar.
 * A distinção importa porque a garantia é sobre o pool — se o sorteio cair
 * fora dele, nenhum fechamento do mundo salva — e porque as cartelas saem com
 * os números marcados, prontas para usar.
 */
const escolhidos = new Set();
let premiadas = 1;

function montarGrade() {
  const universo = Number($('cs-universo').value);
  const grade = $('cs-grade');
  grade.innerHTML = '';
  if (!Number.isInteger(universo) || universo < 1 || universo > 31) return;
  for (let n = 1; n <= universo; n += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'numero';
    b.textContent = String(n).padStart(2, '0');
    b.dataset.n = String(n);
    b.addEventListener('click', () => {
      if (escolhidos.has(n)) escolhidos.delete(n);
      else escolhidos.add(n);
      medir();
    });
    grade.appendChild(b);
  }
}

/** Os números marcados, em ordem. É o pool que vai ao motor. */
function pool() {
  return [...escolhidos].sort((a, b) => a - b);
}

/** A escala de cartelas premiadas: de 1 a 8, e sempre incluindo o teto. */
function montarPremiadas(teto) {
  if (premiadas > teto) premiadas = teto;
  const escala = [];
  for (let r = 1; r <= Math.min(teto, 8); r += 1) escala.push(r);
  if (!escala.includes(teto)) escala.push(teto);
  if (!escala.includes(premiadas)) escala.push(premiadas);
  escala.sort((a, b) => a - b);

  const alvo = $('cs-premiadas');
  alvo.innerHTML = '';
  for (const r of escala) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao' + (r === premiadas ? ' ativa' : '');
    b.textContent = String(r);
    b.dataset.valor = String(r);
    b.setAttribute('aria-pressed', String(r === premiadas));
    b.addEventListener('click', () => {
      premiadas = r;
      medir();
    });
    alvo.appendChild(b);
  }
}

function pintarContagem(universo) {
  const marcados = escolhidos.size;
  $('cs-contagem').innerHTML =
    marcados === 0
      ? '<b>Nenhum número marcado.</b> <em>Marque os que você vai jogar.</em>'
      : `<b>${marcados} de ${universo} marcados.</b>`;
}

/* ─────────── o problema ─────────── */

function lerParametros() {
  return {
    universo: Number($('cs-universo').value),
    pool: pool(),
    cartela: Number($('cs-cartela').value),
    alvo: Number($('cs-alvo').value),
    intersecao: Number($('cs-intersecao').value),
    premiadas,
  };
}

/**
 * Recusa o que não descreve um problema, antes de o motor ser incomodado.
 *
 * Cada mensagem diz o que está errado **e** por quê. "Inválido" manda a pessoa
 * adivinhar; "a cartela não cabe no universo" ela conserta sozinha.
 */
function criticar({ universo, pool, cartela, alvo, intersecao, premiadas }) {
  if (![universo, cartela, alvo, intersecao].every((n) => Number.isInteger(n) && n > 0)) {
    return 'Os quatro números precisam ser inteiros maiores que zero.';
  }
  if (universo > 31) {
    return 'O universo vai até 31 números — acima disso a conta não cabe na memória do aparelho.';
  }
  if (pool.length === 0) {
    return 'Marque na grade quais números você vai jogar.';
  }
  // Daqui para baixo o que limita é o **pool**, e não o universo: a garantia
  // vale dentro dos números que você marcou, e é entre eles que as cartelas
  // são montadas.
  if (cartela > pool.length) {
    return `A cartela tem ${cartela} números e você marcou só ${pool.length}: ela não cabe.`;
  }
  if (alvo > pool.length) {
    return `O sorteio tira ${alvo} números de um pool de ${pool.length}: não há de onde tirar.`;
  }
  if (intersecao > alvo) {
    return `A garantia pede ${intersecao} acertos de um sorteio que só tem ${alvo} números.`;
  }
  if (intersecao > cartela) {
    return `A garantia pede ${intersecao} acertos numa cartela de ${cartela} números.`;
  }
  const teto = maximoPremiadas(pool.length, cartela, alvo, intersecao);
  if (premiadas > teto) {
    return (
      `Você pediu ${premiadas} cartelas premiadas, e só existem ${teto} cartelas distintas ` +
      `capazes de atender um mesmo sorteio — acima disso só repetindo cartela.`
    );
  }
  return null;
}

function configuracaoDe(p) {
  return {
    universo: p.universo,
    pool: p.pool,
    cartela: p.cartela,
    alvo: p.alvo,
    intersecao: p.intersecao,
    premiadas: p.premiadas,
    semente: 20260828,
  };
}

/**
 * Mede o problema sem procurar nada.
 *
 * O limite inferior sai antes de qualquer busca, e é isso que dá ao aplicativo
 * a metade que ele conhece de graça. Quem olha decide se liga o motor sabendo
 * o tamanho do universo e o piso — em vez de descobrir depois de meia hora.
 */
function medir() {
  const universo = Number($('cs-universo').value);
  if ($('cs-grade').childElementCount !== (Number.isInteger(universo) ? universo : -1)) {
    montarGrade();
    for (const n of [...escolhidos]) if (n > universo) escolhidos.delete(n);
  }
  for (const b of document.querySelectorAll('#cs-grade .numero')) {
    const marcado = escolhidos.has(Number(b.dataset.n));
    b.classList.toggle('escolhido', marcado);
    b.setAttribute('aria-pressed', String(marcado));
  }
  pintarContagem(universo);

  const p = lerParametros();
  montarPremiadas(
    p.pool.length > 0
      ? maximoPremiadas(p.pool.length, p.cartela, p.alvo, p.intersecao)
      : 1
  );
  p.premiadas = premiadas;

  const erro = criticar(p);
  $('cs-erro').hidden = !erro;
  if (erro) {
    $('cs-erro').innerHTML = `<b>Não dá para medir isso.</b> <em>${escapar(erro)}</em>`;
    $('cs-medida').innerHTML = '';
    $('cs-construir').disabled = true;
    return;
  }
  $('cs-construir').disabled = false;
  configuracaoAtual = configuracaoDe(p);
  clearTimeout(medindo);
  medindo = setTimeout(() => enviar({ tipo: 'medir', configuracao: configuracaoAtual }), 120);
}

/* ─────────── o trabalhador ─────────── */

function garantirTrabalhador() {
  if (trabalhador) return trabalhador;
  trabalhador = new Worker('./construtor-trabalhador.js', { type: 'module' });
  trabalhador.onmessage = ({ data }) => receber(data);
  trabalhador.onerror = (e) => avisar(`O motor falhou: ${e?.message ?? 'erro desconhecido'}`);
  return trabalhador;
}

function enviar(mensagem) {
  garantirTrabalhador().postMessage(mensagem);
}

function receber(m) {
  switch (m.tipo) {
    case 'medida':
      pintarMedida(m);
      break;
    case 'construindo':
      $('cs-construcao').hidden = false;
      $('cs-construcao').innerHTML =
        '<b>Construindo…</b> <em>O motor monta a estrutura a partir das regras: ' +
        'pega um sorteio ainda descoberto, cria uma cartela em torno dele, e ' +
        'repete até não sobrar nenhum.</em>';
      $('cs-construir').disabled = true;
      break;
    case 'construido':
      pintarConstrucao(m);
      break;
    case 'venceu':
      solucao = m.solucao;
      escada.venceu(m.quantas);
      pintarEscada();
      pintarResultado();
      if (descendo && !escada.acabou) proximaTentativa();
      else pararEscada();
      break;
    case 'andamento':
      pintarAndamento(m);
      break;
    case 'resistiu':
      escada.resistiu();
      pintarEscada();
      // Insistir é o padrão: um degrau que resistiu quinze segundos pode cair
      // nos próximos quinze, e quem decide desistir é quem está olhando.
      if (descendo && !m.parado) proximaTentativa();
      else pararEscada();
      break;
    case 'erro':
      avisar(m.erro);
      $('cs-construir').disabled = false;
      pararEscada();
      break;
  }
}

/* ─────────── as telas ─────────── */

function pintarMedida(m) {
  const conhecido =
    m.melhorConhecido > 0
      ? ` O melhor que o mundo já publicou para esta configuração tem <b>${milhares(
          m.melhorConhecido
        )}</b> cartelas.`
      : '';
  $('cs-medida').innerHTML =
    `<b>${milhares(m.totalAlvos)}</b> sorteios possíveis para cobrir.` +
    `<br><em>Nenhuma solução pode ter menos de <b>${milhares(m.limite)}</b> cartelas — ` +
    `${escapar(m.metodo)}. Isso é teorema, e sai antes de qualquer busca.${conhecido}</em>`;
}

function pintarConstrucao(m) {
  solucao = m.solucao;
  $('cs-construir').disabled = false;
  $('cs-construcao').hidden = false;
  $('cs-construcao').innerHTML =
    `<b>${milhares(m.cartelas)} cartelas.</b> <em>Veio de: ${escapar(m.origem)}. ` +
    `O mínimo possível é ${milhares(m.limite)}, então ainda há espaço para ` +
    `<b>${milhares(Math.max(0, m.cartelas - m.limite))}</b> caírem — se caírem.</em>`;

  escada = new Escada({ partida: m.cartelas, limite: m.limite });
  $('cs-escada-cartao').hidden = false;
  pintarEscada();
  pintarResultado();
}

function pintarEscada() {
  if (!escada) return;
  $('cs-melhor').textContent = milhares(escada.melhor);
  $('cs-limite').textContent = milhares(escada.limite);
  $('cs-degrau').textContent = escada.degrau === null ? '—' : milhares(escada.degrau);
  $('cs-regua-piso').textContent = `mínimo ${milhares(escada.limite)}`;
  $('cs-regua-topo').textContent = `partiu de ${milhares(escada.partida)}`;
  $('cs-regua-cheio').style.width = `${(100 * escada.progresso).toFixed(1)}%`;

  const destino = $('cs-veredito');
  if (escada.veredito === PROVADO) {
    destino.innerHTML =
      `<span class="veredito-provado">Mínimo provado.</span> <em>As ` +
      `${milhares(escada.melhor)} cartelas encontradas encostaram no limite ` +
      `matemático. Não existe solução menor — não é que não achamos, é que não há.</em>`;
    $('cs-descer').disabled = true;
  } else if (escada.veredito === IMPOSSIVEL) {
    // Uma solução abaixo do piso quer dizer que o piso está errado. Melhor
    // gritar do que exibir um "provado" que mentiria.
    destino.innerHTML =
      `<span class="veredito-impossivel">Algo não bate.</span> <em>A solução tem ` +
      `${milhares(escada.melhor)} cartelas e o limite inferior diz ` +
      `${milhares(escada.limite)}. Um dos dois está errado, e não vou fingir que não vi.</em>`;
    $('cs-descer').disabled = true;
  } else {
    destino.innerHTML =
      `<em>Faltam no máximo <b>${milhares(escada.folga)}</b> cartelas até o ` +
      `mínimo possível${
        escada.tentativas > 0
          ? ` — o degrau de ${milhares(escada.degrau)} resistiu a ${milhares(
              escada.tentativas
            )} tentativa${escada.tentativas > 1 ? 's' : ''}`
          : ''
      }.</em>`;
    $('cs-descer').disabled = descendo;
  }
}

function pintarAndamento(m) {
  $('cs-cobertura').textContent = `${(100 * m.cobertura).toFixed(2).replace('.', ',')}%`;
}

function pintarResultado() {
  if (!solucao.length) return;
  $('cs-resultado-cartao').hidden = false;
  const quantasPremiadas = configuracaoAtual.premiadas ?? 1;
  $('cs-ficha').innerHTML =
    `<b>${milhares(solucao.length)} cartelas</b> de ${escapar(
      String(configuracaoAtual.cartela)
    )} números, entre os ${escapar(String(configuracaoAtual.pool.length))} que você marcou.` +
    `<br><em>Toda combinação de ${escapar(String(configuracaoAtual.alvo))} números tem ao ` +
    `menos ${escapar(String(configuracaoAtual.intersecao))} deles dentro de ` +
    `${
      quantasPremiadas > 1
        ? `<b>${escapar(String(quantasPremiadas))}</b> cartelas`
        : 'alguma cartela'
    }.</em>`;
  $('cs-cartelas').innerHTML =
    `<div class="cartelas em-levas">${solucao
      .map(
        (c, i) =>
          `<div class="cartela"><span class="indice">${String(i + 1).padStart(2, '0')}</span>` +
          `<span>${c.map((n) => String(n).padStart(2, '0')).join(' ')}</span></div>`
      )
      .join('')}</div>`;
}

/* ─────────── a escada, em movimento ─────────── */

function proximaTentativa() {
  if (!escada || escada.acabou) {
    pararEscada();
    return;
  }
  enviar({
    tipo: 'degrau',
    configuracao: configuracaoAtual,
    quantas: escada.degrau,
    semente: solucao,
    segundos: SEGUNDOS_POR_TENTATIVA,
  });
}

function comecarEscada() {
  if (!escada || escada.acabou || descendo) return;
  descendo = true;
  $('cs-descer').disabled = true;
  $('cs-parar-escada').hidden = false;
  proximaTentativa();
}

function pararEscada() {
  descendo = false;
  $('cs-parar-escada').hidden = true;
  pintarEscada();
}

/* ─────────── utilidades ─────────── */

function avisar(mensagem) {
  const destino = $('cs-aviso');
  destino.hidden = false;
  destino.textContent = mensagem;
  setTimeout(() => (destino.hidden = true), 6000);
}

function textoDaSolucao() {
  const c = configuracaoAtual;
  return (
    `# Sonho Lúcido — Construtor\n` +
    `# ${solucao.length} cartelas de ${c.cartela} números, pool de ${c.pool.length}\n` +
    `# garante ${c.intersecao} acertos em todo sorteio de ${c.alvo}` +
    `${(c.premiadas ?? 1) > 1 ? `, em ${c.premiadas} cartelas` : ''}\n` +
    `# números do pool: ${c.pool.join(' ')}\n` +
    solucao.map((linha) => linha.map((n) => String(n).padStart(2, '0')).join(' ')).join('\n') +
    '\n'
  );
}

/* ─────────── ligações ─────────── */

for (const campo of ['cs-universo', 'cs-cartela', 'cs-alvo', 'cs-intersecao']) {
  $(campo).addEventListener('input', medir);
}

$('cs-limpar').addEventListener('click', () => {
  escolhidos.clear();
  medir();
});

$('cs-todos').addEventListener('click', () => {
  const universo = Number($('cs-universo').value);
  for (let n = 1; n <= universo; n += 1) escolhidos.add(n);
  medir();
});

// Começa com o universo inteiro marcado: quem quiser tirar números tira, e quem
// só quer experimentar não precisa marcar treze botões antes de a tela
// responder.
montarGrade();
for (let n = 1; n <= Number($('cs-universo').value); n += 1) escolhidos.add(n);
medir();

$('cs-construir').addEventListener('click', () => {
  if (!configuracaoAtual) return;
  escada = null;
  solucao = [];
  $('cs-escada-cartao').hidden = true;
  $('cs-resultado-cartao').hidden = true;
  enviar({ tipo: 'construir', configuracao: configuracaoAtual });
});

$('cs-descer').addEventListener('click', comecarEscada);

$('cs-parar-escada').addEventListener('click', () => {
  enviar({ tipo: 'parar' });
  pararEscada();
});

$('cs-copiar').addEventListener('click', async () => {
  if (!solucao.length) return;
  try {
    await navigator.clipboard.writeText(textoDaSolucao());
    avisar(`${milhares(solucao.length)} cartelas copiadas.`);
  } catch {
    avisar('O navegador não deixou copiar. Segure o dedo sobre as cartelas para selecionar.');
  }
});

if (navigator.share) {
  $('cs-compartilhar').hidden = false;
  $('cs-compartilhar').addEventListener('click', async () => {
    if (!solucao.length) return;
    try {
      await navigator.share({ title: 'Construtor — Sonho Lúcido', text: textoDaSolucao() });
    } catch (erro) {
      if (erro?.name !== 'AbortError') avisar('Não deu para compartilhar.');
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
}

medir();
