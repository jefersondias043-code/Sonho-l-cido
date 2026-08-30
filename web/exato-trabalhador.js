/*
 * O trabalhador do Construtor Matemático Exato.
 *
 * Ele carrega o próprio módulo compilado — `wasm-exato`, que não é o da
 * Lotinha — e executa um estágio por mensagem. A separação em estágios é a
 * mesma que o aplicativo promete na tela:
 *
 *   analisar     o modelo: quantos alvos, quantos blocos candidatos
 *   limitar      o piso pelas cotas fechadas, em microssegundos
 *   aprofundar   o piso pelo subproblema resolvido aqui dentro
 *   construir    as cartelas
 *   verificar    alvo por alvo, sobre o que a tela tem na mão
 *   provar       existe alguma coisa menor?
 *
 * Uma busca exaustiva não é interrompível no meio: ela varre ou estoura o
 * orçamento. Por isso o orçamento é escolhido antes, dito em voz alta, e o
 * resultado sempre informa quantos nós custou — inclusive quando não deu.
 */

import init, {
  analisar,
  limitar,
  limitar_por_dentro,
  construir,
  verificar,
  provar,
} from './wasm-exato/motor_exato_web.js';

let pronto = null;

async function garantirWasm() {
  pronto = pronto ?? init();
  await pronto;
}

/** Cada estágio é uma chamada; o erro do motor vira uma mensagem de erro. */
const estagios = {
  analisar: (m) => ({ tipo: 'analise', dados: JSON.parse(analisar(m.pedido)) }),
  limitar: (m) => ({ tipo: 'piso', dados: JSON.parse(limitar(m.pedido)) }),
  aprofundar: (m) => ({
    tipo: 'piso-fundo',
    dados: JSON.parse(limitar_por_dentro(m.pedido, m.orcamento)),
  }),
  construir: (m) => ({ tipo: 'construcao', dados: JSON.parse(construir(m.pedido)) }),
  verificar: (m) => ({
    tipo: 'verificacao',
    dados: JSON.parse(verificar(m.pedido, JSON.stringify(m.cartelas))),
  }),
  provar: (m) => ({
    tipo: 'prova',
    familia: m.familia,
    teto: m.teto,
    dados: JSON.parse(provar(m.pedido, m.teto, m.orcamento, m.familia)),
  }),
};

onmessage = async (evento) => {
  const mensagem = evento.data ?? {};
  const estagio = estagios[mensagem.tipo];
  if (!estagio) return;
  try {
    await garantirWasm();
    postMessage({ ...estagio(mensagem), etapa: mensagem.etapa ?? null });
  } catch (erro) {
    postMessage({
      tipo: 'erro',
      etapa: mensagem.etapa ?? null,
      estagio: mensagem.tipo,
      mensagem: String(erro?.message ?? erro),
    });
  }
};
