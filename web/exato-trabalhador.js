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
  EscaladaExata,
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

/** De quanto em quanto tempo o estado volta à tela para ser guardado. */
const MILISSEGUNDOS_ENTRE_SALVAMENTOS = 4_000;

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
  // A prévia é o mesmo cálculo do piso, com outro nome. O nome separado é o que
  // permite consultá-la enquanto a pessoa mexe nos parâmetros sem que a
  // resposta seja confundida com o estágio 4 de uma execução.
  previa: (m) => ({ tipo: 'previa', dados: JSON.parse(limitar(m.pedido)) }),
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

/*
 * A escalada de cobertura.
 *
 * O teto de cartelas vem de fora — é o piso provado — e nunca é ultrapassado.
 * Ela roda até fechar em 100% ou até mandarem parar: quem decide a hora é quem
 * está olhando, e não um orçamento decidido de antemão.
 *
 * O estado volta de tempos em tempos para a tela poder guardá-lo. Assim fechar
 * o aplicativo no meio não custa o trabalho já feito.
 */
async function escalar(mensagem) {
  const escalada = mensagem.estado
    ? EscaladaExata.retomada(mensagem.estado)
    : new EscaladaExata(mensagem.pedido, mensagem.teto);
  let lote = LOTE_INICIAL;
  let passo = JSON.parse(escalada.passo());
  let desdeOSalvamento = 0;
  let primeiroLote = true;

  try {
    while (!passo.fechou && !parar) {
      const comeco = performance.now();
      passo = JSON.parse(escalada.avancar(lote));
      const durou = performance.now() - comeco;
      lote = calibrar(lote, durou);

      desdeOSalvamento += durou;
      // O primeiro lote sempre volta com o estado, e não só depois de quatro
      // segundos: é ele que faz a linha aparecer no histórico. Esperando o
      // primeiro salvamento comum, a aba Histórico dizia "nenhum fechamento
      // guardado ainda" durante os primeiros quatro segundos de uma execução
      // que estava visivelmente rodando ao lado.
      const guardar = primeiroLote || desdeOSalvamento >= MILISSEGUNDOS_ENTRE_SALVAMENTOS;
      if (guardar) desdeOSalvamento = 0;
      primeiroLote = false;

      postMessage({
        tipo: 'escalada-passo',
        etapa: mensagem.etapa,
        dados: passo,
        curva: JSON.parse(escalada.curva()),
        estado: guardar ? escalada.guardar() : null,
      });
      await respirar();
    }

    postMessage({
      tipo: 'escalada',
      etapa: mensagem.etapa,
      dados: passo,
      curva: JSON.parse(escalada.curva()),
      cartelas: JSON.parse(escalada.melhor()),
      estado: escalada.guardar(),
      interrompida: parar && !passo.fechou,
    });
  } finally {
    escalada.free?.();
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
      // O pedido volta junto: a prévia da escala precisa saber de qual
      // configuração a resposta fala, porque a pessoa pode ter mudado de ideia
      // enquanto o motor contava.
      postMessage({
        ...instantaneo(mensagem),
        etapa: mensagem.etapa ?? null,
        pedido: mensagem.pedido,
      });
      return;
    }
    if (mensagem.tipo === 'escalar') {
      await escalar(mensagem);
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
      // O pedido volta junto pelo mesmo motivo da prévia: a recusa precisa ser
      // atribuída à configuração que a provocou, e não à que estiver na tela
      // quando ela chegar.
      pedido: mensagem.pedido,
      mensagem: String(erro?.message ?? erro),
    });
  }
};
