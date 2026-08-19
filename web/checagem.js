/*
 * Checar um fechamento contra um resultado.
 *
 * Este módulo não desenha nada e não guarda estado: recebe cartelas e um
 * resultado, devolve contas. É o que permite testá-lo sem navegador e reusá-lo
 * dentro de um worker, que é onde as simulações longas rodam.
 *
 * ## A representação: uma cartela é um número
 *
 * Dezenas vão de 1 a 25, então uma cartela inteira cabe num inteiro de 32 bits
 * — a dezena `d` é o bit `d − 1`. Contar acertos vira `popcount(cartela &
 * sorteio)`: duas instruções, em vez de percorrer quinze números procurando
 * cada um numa lista.
 *
 * A diferença não é cosmética. Um fechamento de 24 dezenas com jogos de 17 tem
 * 26.837 cartelas; dez mil sorteios simulados sobre ele são 268 milhões de
 * comparações. Com máscaras isso leva segundos; com `Array.includes` levaria
 * minutos e travaria a tela.
 *
 * ## O que este módulo não decide
 *
 * Se 11 acertos valem prêmio. Não valem, na Lotinha — só 15 paga — e essa
 * regra mora na tela, junto com a explicação. Aqui só se conta.
 */

/** O universo da modalidade: dezenas de 1 a 25. */
export const UNIVERSO = 25;

/** Quantas dezenas um sorteio tem. */
export const SORTEIO = 15;

/**
 * Converte uma cartela em máscara de bits.
 *
 * Dezenas fora de `1..25` são ignoradas em vez de deslocarem bits fora do
 * inteiro — uma cartela inválida vinda do armazenamento não pode corromper a
 * conta das outras.
 */
export function mascaraDe(cartela) {
  let m = 0;
  for (const d of cartela) {
    if (Number.isInteger(d) && d >= 1 && d <= UNIVERSO) m |= 1 << (d - 1);
  }
  return m;
}

/** Quantos bits ligados — o algoritmo de Wegner, sem laço sobre 32 posições. */
export function bitsEm(n) {
  let conta = 0;
  while (n) {
    n &= n - 1;
    conta++;
  }
  return conta;
}

/**
 * As máscaras de um fechamento inteiro, calculadas uma vez.
 *
 * Guardar num `Int32Array` e não num array comum importa: são dezenas de
 * milhares de entradas percorridas dez mil vezes numa simulação longa.
 */
export function mascarasDo(jogos) {
  const saida = new Int32Array(jogos.length);
  for (let i = 0; i < jogos.length; i++) saida[i] = mascaraDe(jogos[i]);
  return saida;
}

/**
 * Lê as dezenas que a pessoa digitou.
 *
 * Aceita qualquer separador — espaço, vírgula, ponto e vírgula, quebra de linha
 * — porque copiar um resultado de outro lugar traz o separador de lá, e recusar
 * por causa disso seria implicância.
 *
 * Devolve `{ dezenas }` ou `{ erro }`. O erro é uma frase pronta: quem chama
 * mostra, não interpreta.
 */
export function interpretarResultado(texto) {
  const numeros = (String(texto ?? '').match(/\d+/g) ?? []).map(Number);

  if (numeros.length === 0) {
    return { erro: 'Digite as 15 dezenas do resultado.' };
  }
  if (numeros.length !== SORTEIO) {
    return {
      erro: `Um sorteio tem ${SORTEIO} dezenas, e você digitou ${numeros.length}.`,
    };
  }

  const fora = numeros.filter((n) => n < 1 || n > UNIVERSO);
  if (fora.length) {
    return {
      erro:
        `As dezenas vão de 1 a ${UNIVERSO}, e ` +
        `${[...new Set(fora)].join(', ')} está fora.`,
    };
  }

  const repetidas = [...new Set(numeros.filter((n, i) => numeros.indexOf(n) !== i))];
  if (repetidas.length) {
    return {
      erro: `Um sorteio não repete dezena, e ${repetidas.join(', ')} apareceu duas vezes.`,
    };
  }

  return { dezenas: [...numeros].sort((a, b) => a - b) };
}

/**
 * Um sorteio ao acaso: 15 dezenas distintas entre 1 e 25.
 *
 * Embaralhamento de Fisher-Yates sobre as 25 e corte nas primeiras 15. É o
 * único jeito que dá a mesma probabilidade a toda combinação — sortear quinze
 * vezes e descartar repetidas dá o mesmo conjunto, mas com um laço que pode não
 * terminar; sortear "sem repor" pela ordem enviesa as primeiras posições.
 */
export function sortearResultado(aleatorio = Math.random) {
  const urna = Array.from({ length: UNIVERSO }, (_, i) => i + 1);
  for (let i = urna.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [urna[i], urna[j]] = [urna[j], urna[i]];
  }
  return urna.slice(0, SORTEIO).sort((a, b) => a - b);
}

/**
 * Confere um fechamento contra um resultado.
 *
 * Devolve:
 *
 * - `porFaixa[a]` — quantas cartelas fizeram exatamente `a` acertos, para
 *   `a` de 0 a 15;
 * - `indices[a]` — quais cartelas, para as faixas de 11 a 15. Abaixo disso a
 *   lista teria dezenas de milhares de entradas e ninguém a olharia;
 * - `melhor` — a maior quantidade de acertos alcançada, ou `-1` sem cartelas;
 * - `premiadas` — quantas fizeram os 15, que é a única faixa que paga.
 */
export function conferir(jogos, resultado, mascaras = null) {
  const alvo = mascaraDe(resultado);
  const ms = mascaras ?? mascarasDo(jogos);

  const porFaixa = new Array(SORTEIO + 1).fill(0);
  const indices = new Map();
  for (let a = 11; a <= SORTEIO; a++) indices.set(a, []);

  let melhor = -1;
  for (let i = 0; i < ms.length; i++) {
    const acertos = bitsEm(ms[i] & alvo);
    porFaixa[acertos]++;
    if (acertos > melhor) melhor = acertos;
    if (acertos >= 11) indices.get(acertos).push(i);
  }

  return {
    porFaixa,
    indices,
    melhor,
    total: ms.length,
    premiadas: porFaixa[SORTEIO],
    resultado: [...resultado].sort((a, b) => a - b),
  };
}

/**
 * Muitos sorteios independentes, e o que se aprende com eles.
 *
 * Para cada faixa de 11 a 15 devolve: em quantos sorteios apareceu ao menos uma
 * cartela, a soma para tirar a média, e o maior e o menor número de cartelas
 * num mesmo sorteio.
 *
 * `aoProgresso` é chamado a cada `lote` sorteios com quantos já foram — é o que
 * permite mostrar andamento sem que quem chama precise saber do laço.
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
  const faixas = [11, 12, 13, 14, 15];

  const estatistica = new Map(
    faixas.map((a) => [
      a,
      { acertos: a, sorteiosComAlguma: 0, soma: 0, maximo: 0, minimo: Infinity },
    ])
  );

  for (let s = 0; s < quantos; s++) {
    const alvo = mascaraDe(sortearResultado(aleatorio));

    // Conta só as faixas que interessam, num vetor de seis posições — montar
    // um objeto por sorteio custaria mais que a conferência inteira.
    const conta = [0, 0, 0, 0, 0];
    for (let i = 0; i < ms.length; i++) {
      const acertos = bitsEm(ms[i] & alvo);
      if (acertos >= 11) conta[acertos - 11]++;
    }

    for (let f = 0; f < faixas.length; f++) {
      const e = estatistica.get(faixas[f]);
      const n = conta[f];
      e.soma += n;
      if (n > 0) e.sorteiosComAlguma++;
      if (n > e.maximo) e.maximo = n;
      if (n < e.minimo) e.minimo = n;
    }

    if (aoProgresso && (s + 1) % lote === 0) aoProgresso(s + 1, quantos);
  }

  for (const e of estatistica.values()) {
    if (e.minimo === Infinity) e.minimo = 0;
    e.media = quantos > 0 ? e.soma / quantos : 0;
    e.proporcao = quantos > 0 ? e.sorteiosComAlguma / quantos : 0;
  }

  if (aoProgresso) aoProgresso(quantos, quantos);
  return { sorteios: quantos, cartelas: ms.length, faixas: [...estatistica.values()] };
}
