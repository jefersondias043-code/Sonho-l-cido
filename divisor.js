/*
 * O trabalhador da divisão de fechamento.
 *
 * Repartir 26.837 cartelas em blocos equilibrados leva alguns segundos: para
 * cada escolha é preciso saber quanto uma cartela ainda acrescenta ao bloco, e
 * isso é contar sorteios. Na linha principal a tela congelaria e o iOS acabaria
 * oferecendo recarregar a página.
 *
 * Aqui roda fora dela. E é aqui que o WebAssembly é inicializado — `init()` é
 * obrigatório antes de qualquer chamada, e é por isso que a divisão não podia
 * ser feita direto do `app.js`, que nunca carregou o módulo.
 */

import init, { dividir } from './wasm/motor_web.js';

let pronto = null;

self.onmessage = async ({ data }) => {
  if (data?.tipo !== 'dividir') return;

  try {
    pronto = pronto ?? init();
    await pronto;
    const saida = dividir(JSON.stringify(data.pedido));
    postMessage({ tipo: 'divisao', saida });
  } catch (erro) {
    // A mensagem do Rust já é escrita para ser lida por quem usa — "não dá para
    // repartir 240 cartelas em 300 blocos". Repassar é melhor que traduzir.
    postMessage({ tipo: 'erro', erro: String(erro?.message ?? erro) });
  }
};
