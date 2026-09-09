/*
 * Checar um fechamento da Lotinha contra um resultado.
 *
 * ## Este módulo deixou de ter matemática própria
 *
 * Ele era cópia de `aritmetica.js`, com as mesmas contas escritas duas
 * vezes — e as duas cópias divergiram, como cópias divergem. `mascaraDe` aceita
 * até 25 aqui e até 31 lá; `bitsEm` usa um algoritmo em cada lado; e o veredito
 * da conferência do Exato passou meses lendo "exatamente `t` acertos" onde a
 * garantia é "ao menos `t`", num defeito que o gêmeo daqui não tinha. Cada
 * correção chegava a um lado e o outro seguia como estava.
 *
 * Agora só sobra a tradução. A Lotinha é o caso particular em que o universo
 * tem 25 dezenas, saem 15, e a tabela mostra as faixas de 11 a 15 — e
 * `faixasDe({ k, j: 15, t: 11 })` reproduz exatamente essas cinco faixas para
 * qualquer tamanho de jogo. O que este arquivo faz é dizer isso uma vez, para
 * que a tela e o worker continuem chamando o que sempre chamaram.
 *
 * ## O que este módulo não decide
 *
 * Se 11 acertos valem prêmio. Não valem, na Lotinha — só 15 paga — e essa
 * regra mora na tela, junto com a explicação. Aqui só se conta.
 */

import {
  bitsEm as bitsGeral,
  conferir as conferirGeral,
  faixasDe,
  interpretarResultado as interpretarGeral,
  mascaraDe as mascaraGeral,
  mascarasDe,
  simularVarios as simularGeral,
  sortearDe,
  urnaDoUniverso,
} from './aritmetica.js';

/** O universo da modalidade: dezenas de 1 a 25. */
export const UNIVERSO = 25;

/** Quantas dezenas saem num sorteio. */
export const SORTEIO = 15;

/**
 * As cinco faixas que a tela da Lotinha mostra: 11 a 15.
 *
 * `faixasDe` deriva a janela do pedido, e com `t = 11` ela devolve exatamente
 * 11..15 para qualquer tamanho de jogo — porque o teto é `min(j, k)`, que é 15
 * quando saem 15, e o piso é `max(0, maximo − 9, min(t, maximo − 4))`, que dá
 * 11. Escrever a janela à mão aqui seria repor a duplicata que este arquivo
 * acabou de perder.
 */
const FAIXAS = faixasDe({ k: SORTEIO, j: SORTEIO, t: 11 });

/**
 * A tradução de posição para dezena, que aqui não traduz nada.
 *
 * O módulo geral recebe cartelas como **posições** dentro de uma lista de
 * números escolhidos, porque no Construtor Exato as dezenas são escolhidas uma
 * a uma. Na Lotinha as cartelas já vêm com as dezenas de verdade, então a
 * tradução é a identidade — e passá-la explicitamente é mais honesto do que ter
 * duas funções que fazem quase a mesma coisa.
 */
const IDENTIDADE = Array.from({ length: 31 }, (_, i) => i + 1);

export function mascaraDe(cartela) {
  return mascaraGeral(cartela);
}

export function bitsEm(n) {
  return bitsGeral(n);
}

export function mascarasDo(jogos) {
  return mascarasDe(jogos, IDENTIDADE);
}

/**
 * Lê as dezenas que a pessoa digitou.
 *
 * Devolve `{ dezenas }` ou `{ erro }`. O módulo geral chama o campo de
 * `numeros`, porque lá o universo não é necessariamente de loteria; aqui o
 * nome antigo fica, para os pontos de chamada não mudarem por causa de uma
 * palavra.
 */
export function interpretarResultado(texto) {
  const lido = interpretarGeral(texto, {
    universo: UNIVERSO,
    sorteio: SORTEIO,
    nome: 'dezena',
    plural: 'dezenas',
  });
  return lido.erro ? lido : { dezenas: lido.numeros };
}

export function sortearResultado(aleatorio = Math.random) {
  return sortearDe(urnaDoUniverso(UNIVERSO), SORTEIO, aleatorio);
}

/**
 * Confere um fechamento contra um resultado.
 *
 * Mantém o formato antigo — `porFaixa` indexado por acertos, e `premiadas`
 * pronto — porque é o que a tela lê. O módulo geral devolve `contagem` com o
 * mesmo conteúdo e um `porFaixa` de outra forma; converter aqui é uma linha, e
 * evita mexer em dez pontos de pintura por causa de um nome.
 */
export function conferir(jogos, resultado, mascaras = null) {
  const ms = mascaras ?? mascarasDo(jogos);
  const r = conferirGeral(ms, resultado, FAIXAS);
  return {
    porFaixa: r.contagem,
    indices: r.indices,
    melhor: r.melhor,
    total: r.total,
    premiadas: r.contagem[SORTEIO],
    resultado: r.resultado,
  };
}

/**
 * Muitos sorteios independentes, e o que se aprende com eles.
 *
 * **Isto é simulação, não previsão.** Cada sorteio é sorteado do zero, com a
 * mesma chance para toda combinação; o que sai daqui descreve o comportamento
 * do fechamento, não o próximo resultado da loteria.
 */
export function simularVarios(
  jogos,
  quantos,
  { aleatorio = Math.random, aoProgresso = null, lote = 200, mascaras = null } = {}
) {
  const ms = mascaras ?? mascarasDo(jogos);
  return simularGeral(ms, quantos, {
    urna: urnaDoUniverso(UNIVERSO),
    sorteio: SORTEIO,
    faixas: FAIXAS,
    aleatorio,
    aoProgresso,
    lote,
  });
}
