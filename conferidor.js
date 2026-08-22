/*
 * O trabalhador da conferência independente.
 *
 * A conferência varre **todos** os sorteios possíveis do pool contra todas as
 * cartelas. Em 25 dezenas com jogos de 21 são 266 cartelas contra 3.268.760
 * sorteios: 869 milhões de comparações, e medidas na linha principal de um
 * aparelho de entrada davam **cinco segundos de tela congelada** — sem cursor,
 * sem toque, sem sinal de que algo estava acontecendo. Outras combinações
 * ficavam entre um e dois segundos, tempo suficiente para o iOS achar que a
 * página travou.
 *
 * Aqui roda fora da linha principal. A tela continua respondendo, e o texto de
 * "conferindo" aparece de verdade em vez de ser engolido pelo bloqueio.
 *
 * Recebe as cartelas como vieram — a cópia estruturada de alguns milhares de
 * arranjos custa milissegundos contra os segundos do cálculo, e mandar máscaras
 * prontas obrigaria a duplicar aqui a lógica de `conferirCobertura`, que é
 * justamente a segunda opinião que não deve compartilhar código com ninguém.
 */

import { conferirCobertura } from './lotinha.js';

self.onmessage = ({ data }) => {
  if (data?.tipo !== 'conferir') return;

  const { id, dezenas, jogos, garantia, premiadas, exaustivo } = data;

  try {
    const resultado = conferirCobertura(dezenas, jogos, garantia, premiadas, { exaustivo });
    self.postMessage({ tipo: 'pronto', id, resultado });
  } catch (erro) {
    // Falhar em silêncio deixaria a tela dizendo "conferindo" para sempre.
    self.postMessage({ tipo: 'falhou', id, erro: String(erro?.message ?? erro) });
  }
};
