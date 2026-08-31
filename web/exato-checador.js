/*
 * O trabalhador das simulações longas do Construtor Exato.
 *
 * Dez mil sorteios sobre um fechamento de vinte e sete mil cartelas são 268
 * milhões de comparações. Isso não cabe na linha principal: a tela congelaria,
 * o toque pararia de responder, e o iOS acabaria oferecendo recarregar a
 * página. Aqui roda fora dela, com andamento chegando de lote em lote.
 *
 * Recebe as **máscaras** já prontas, não as cartelas: viajam como `Int32Array`
 * transferível, sem cópia e sem conversão do outro lado.
 *
 * Devolve também a matriz de contagens por sorteio, transferida de volta pelo
 * mesmo motivo — é ela que deixa a tela mudar os preços sem simular de novo.
 */

import { simularVarios } from './exato-checagem.js';

self.onmessage = ({ data }) => {
  if (data?.tipo !== 'simular') return;

  const { mascaras, quantos, urna, sorteio, faixas } = data;

  try {
    const resumo = simularVarios(mascaras, quantos, {
      urna,
      sorteio,
      faixas,
      aoProgresso: (feitos, total) => {
        self.postMessage({ tipo: 'andamento', feitos, total });
      },
      // Lotes maiores em fechamentos grandes: postar mensagem é barato, mas não
      // de graça, e um lote por sorteio faria o relatório custar mais que a
      // conta. Cem mil cartelas-sorteio por aviso é o suficiente para a barra
      // andar sem soluços.
      lote: Math.max(1, Math.ceil(100_000 / Math.max(1, mascaras.length))),
    });
    self.postMessage({ tipo: 'pronto', resumo }, [resumo.porSorteio.buffer]);
  } catch (erro) {
    // Falhar em silêncio deixaria a tela dizendo "simulando" para sempre.
    self.postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
  }
};
