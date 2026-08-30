/*
 * O trabalhador do Construtor Matemático Exato.
 *
 * Ele carrega o próprio módulo compilado — `wasm-exato`, que não é o da
 * Lotinha — e faz o trabalho longo em **lotes**, falando entre um e outro.
 *
 * Por que em lotes, e não de uma vez: um worker só recebe mensagens entre
 * tarefas. Uma construção que rodasse do início ao fim numa chamada só deixaria
 * a tela sem notícia e surda ao pedido de parar — que foi exatamente o defeito
 * que motivou esta versão. Entre um lote e outro ele devolve o progresso e
 * confere se mandaram parar.
 *
 * O tamanho do lote é calibrado pelo relógio: mede-se quanto durou o anterior e
 * ajusta-se para o próximo cair perto do alvo. Sem isso o mesmo número serviria
 * a um problema de 78 alvos e a um de três milhões, e num deles estaria errado
 * por ordens de grandeza.
 */

import init, {
  analisar,
  limitar,
  limitar_por_dentro,
  verificar,
  ConstrutorExato,
  ProvaExata,
} from './wasm-exato/motor_exato_web.js';

/** Quanto tempo cada lote deve durar. Curto o bastante para a parada ser
 *  sentida na hora, longo o bastante para o recado não custar mais que o
 *  trabalho. */
const ALVO_DO_LOTE = 120;

/** Limites do lote, para a calibragem não sair da realidade. */
const MENOR_LOTE = 2_000;
const MAIOR_LOTE = 400_000_000;

/** O primeiro lote, antes de haver qualquer medição. Pequeno de propósito. */
const LOTE_INICIAL = 200_000;

let pronto = null;
let parar = false;

async function garantirWasm() {
  pronto = pronto ?? init();
  await pronto;
}

/** Ajusta o lote para o próximo durar perto do alvo. */
function calibrar(lote, duracao) {
  if (duracao <= 0) return Math.min(lote * 4, MAIOR_LOTE);
  const fator = ALVO_DO_LOTE / duracao;
  const novo = Math.round(lote * Math.max(0.25, Math.min(4, fator)));
  return Math.max(MENOR_LOTE, Math.min(MAIOR_LOTE, novo));
}

/** Deixa o worker respirar: é aqui que uma mensagem de parada chega. */
function respirar() {
  return new Promise((seguir) => setTimeout(seguir, 0));
}

/* ─────────── os estágios instantâneos ─────────── */

const instantaneos = {
  analisar: (m) => ({ tipo: 'analise', dados: JSON.parse(analisar(m.pedido)) }),
  limitar: (m) => ({ tipo: 'piso', dados: JSON.parse(limitar(m.pedido)) }),
  aprofundar: (m) => ({
    tipo: 'piso-fundo',
    dados: JSON.parse(limitar_por_dentro(m.pedido, m.orcamento)),
  }),
  verificar: (m) => ({
    tipo: 'verificacao',
    dados: JSON.parse(verificar(m.pedido, JSON.stringify(m.cartelas))),
  }),
};

/* ─────────── os estágios longos ─────────── */

async function construir(mensagem) {
  const construtor = new ConstrutorExato(mensagem.pedido, mensagem.teto ?? 0);
  const prazo = performance.now() + Math.max(500, Number(mensagem.limite) || 0);
  let lote = LOTE_INICIAL;
  let passo = null;
  let esgotou = false;

  try {
    for (;;) {
      const comeco = performance.now();
      passo = JSON.parse(construtor.avancar(lote));
      lote = calibrar(lote, performance.now() - comeco);

      postMessage({
        tipo: 'construcao-passo',
        etapa: mensagem.etapa,
        dados: passo,
        prazo: Math.max(0, prazo - performance.now()),
      });
      if (passo.terminou || parar) break;
      // O prazo é a promessa que o orçamento em unidades de trabalho não
      // consegue fazer: uma unidade custa nanossegundos num problema e
      // microssegundos noutro, e só o relógio vale para os dois.
      if (performance.now() >= prazo) {
        esgotou = true;
        break;
      }
      await respirar();
    }

    postMessage({
      tipo: 'construcao',
      etapa: mensagem.etapa,
      dados: passo,
      metodo: construtor.metodo(),
      cartelas: JSON.parse(construtor.melhor()),
      interrompida: parar && !passo.terminou,
      esgotou,
    });
  } finally {
    construtor.free?.();
  }
}

async function provar(mensagem) {
  const busca = new ProvaExata(mensagem.pedido, mensagem.teto, mensagem.familia);
  const orcamento = Math.max(1, Number(mensagem.orcamento) || 0);
  const prazo = performance.now() + Math.max(500, Number(mensagem.limite) || 0);
  let lote = LOTE_INICIAL;
  let passo = { visitados: 0, recorde: mensagem.teto, terminou: !busca.montou() };

  try {
    while (!passo.terminou && !parar && passo.visitados < orcamento) {
      const comeco = performance.now();
      passo = JSON.parse(busca.avancar(Math.min(lote, orcamento - passo.visitados)));
      lote = calibrar(lote, performance.now() - comeco);
      postMessage({
        tipo: 'prova-passo',
        etapa: mensagem.etapa,
        familia: mensagem.familia,
        dados: passo,
        orcamento,
        prazo: Math.max(0, prazo - performance.now()),
      });
      // Um nó pode custar mil vezes mais num problema que noutro, e o orçamento
      // em nós não sabe disso. O relógio sabe.
      if (performance.now() >= prazo) break;
      await respirar();
    }

    postMessage({
      tipo: 'prova',
      etapa: mensagem.etapa,
      familia: mensagem.familia,
      dados: JSON.parse(busca.desfecho()),
      interrompida: parar && !passo.terminou,
    });
  } finally {
    busca.free?.();
  }
}

/* ─────────── o correio ─────────── */

onmessage = async (evento) => {
  const mensagem = evento.data ?? {};

  if (mensagem.tipo === 'parar') {
    parar = true;
    return;
  }
  if (mensagem.tipo === 'retomar') {
    parar = false;
    return;
  }

  try {
    await garantirWasm();

    const instantaneo = instantaneos[mensagem.tipo];
    if (instantaneo) {
      postMessage({ ...instantaneo(mensagem), etapa: mensagem.etapa ?? null });
      return;
    }
    if (mensagem.tipo === 'construir') {
      await construir(mensagem);
      return;
    }
    if (mensagem.tipo === 'provar') {
      await provar(mensagem);
      return;
    }
  } catch (erro) {
    postMessage({
      tipo: 'erro',
      etapa: mensagem.etapa ?? null,
      estagio: mensagem.tipo,
      mensagem: String(erro?.message ?? erro),
    });
  }
};
