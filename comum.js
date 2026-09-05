/*
 * O que as telas compartilham.
 *
 * Este módulo existe por uma medida, não por gosto de arrumação: entre os
 * arquivos de tela havia catorze nomes definidos duas ou três vezes, e a
 * duplicação já produziu defeitos reais — uma correção chegava numa cópia e a
 * outra seguia quebrada, com o comentário da correção servindo de prova de que
 * alguém já tinha pago por aquele defeito uma vez.
 *
 * O que entra aqui é o que **não** depende de tela: contagem, formatação,
 * escape. O que depende de tela — avisos, painéis, ligação de botões — fica em
 * cada uma enquanto elas forem três, porque ali as diferenças são de propósito
 * e fundi-las às cegas trocaria comportamento por simetria.
 */

/** Texto que vai para dentro de `innerHTML` sem virar marcação. */
export function escapar(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * `C(n, k)`, pela forma multiplicativa.
 *
 * Itera pelo menor dos dois lados e divide a cada passo, o que mantém o valor
 * intermediário pequeno — a forma ingênua, com fatoriais, estoura o inteiro
 * seguro do JavaScript bem antes dos tamanhos que este aplicativo usa.
 */
export function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < Math.min(k, n - k); i += 1) {
    total = (total * (n - i)) / (i + 1);
  }
  return Math.round(total);
}

/**
 * Quantas cartelas de uma cartela premiada é possível exigir.
 *
 * Conta as cartelas que um sorteio pode premiar: para cada quantidade `i` de
 * acertos a partir da garantia, as maneiras de escolher `i` dentro do sorteio
 * vezes as de completar a cartela fora dele. É o teto do que faz sentido pedir.
 */
export function maximoPremiadas(v, k, j, t) {
  let total = 0;
  for (let i = t; i <= Math.min(k, j); i += 1) {
    if (k - i <= v - j) total += combinacoes(j, i) * combinacoes(v - j, k - i);
  }
  return Math.max(1, Math.min(total, 1000));
}

/**
 * Número com separador de milhar do português.
 *
 * Arredonda de propósito: tudo o que passa por aqui é contagem — cartelas,
 * alvos, sorteios — e contagem não tem casa decimal. Havia duas versões deste
 * mesmo nome, uma arredondando e outra não, e a segunda deixava escapar coisas
 * como "27.124,7 cartelas".
 */
export const milhares = (n) => Math.round(n).toLocaleString('pt-BR');

/** Fração como porcentagem, sempre com uma casa. */
export const porcento = (f) =>
  `${(f * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

/** Dois dígitos, para as dezenas saírem alinhadas em coluna. */
export const doisDigitos = (n) => String(n).padStart(2, '0');
