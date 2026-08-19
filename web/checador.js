/*
 * O trabalhador das simulações longas.
 *
 * Dez mil sorteios sobre um fechamento de vinte e sete mil cartelas são 268
 * milhões de comparações. Isso não cabe na linha principal: a tela congelaria,
 * o toque pararia de responder, e o iOS acabaria oferecendo recarregar a
 * página. Aqui roda fora dela, com andamento chegando de lote em lote.
 *
 * Recebe as **máscaras** já prontas, não as cartelas: elas viajam como
 * `Int32Array` transferível, sem cópia e sem conversão do outro lado.
 */

import { simularVarios } from './checagem.js';

self.onmessage = ({ data }) => {
  if (data?.tipo !== 'simular') return;

  const { mascaras, quantos } = data;

  try {
    const resumo = simularVarios(null, quantos, {
      mascaras,
      aoProgresso: (feitos, total) => {
        self.postMessage({ tipo: 'andamento', feitos, total });
      },
      // Lotes maiores em fechamentos grandes: postar mensagem é barato, mas não
      // de graça, e um lote por sorteio faria o relatório custar mais que a
      // conta. Cem mil cartelas-sorteio por aviso é o suficiente para a barra
      // andar sem soluços.
      lote: Math.max(1, Math.ceil(100_000 / Math.max(1, mascaras.length))),
    });
    self.postMessage({ tipo: 'pronto', resumo });
  } catch (erro) {
    self.postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
  }
};
