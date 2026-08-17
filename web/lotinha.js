/*
 * A Lotinha — a modalidade inteira, num módulo só.
 *
 * ## O que é
 *
 * Escolhem-se de 17 a 23 dezenas entre 25. O resultado da Lotofácil é a
 * referência. Ganha-se quando as 15 sorteadas caem **todas** dentro do conjunto
 * escolhido. O prêmio depende de quantas dezenas foram escolhidas — quanto
 * menos dezenas, maior o multiplicador.
 *
 * ## A conta que quase todo mundo erra
 *
 * Para fechar um pool de `P` dezenas com jogos de `k`, a intuição manda dividir
 * o número de sorteios pelo que cada jogo cobre. Isso subestima por duas a três
 * vezes, e quem orça assim compra metade dos jogos que precisa — ficando com um
 * fechamento furado sem saber.
 *
 * A conta certa vem de uma troca de ponto de vista: um jogo de `k` dentro de um
 * pool de `P` é o **complemento** de `a = P − k` dezenas, e um sorteio de 15 é o
 * complemento de `b = P − 15`. Então
 *
 *     o jogo contém o sorteio  ⟺  as `a` que faltam ao jogo
 *                                  estão entre as `b` que faltam ao sorteio
 *
 * O problema deixa de ser "cobrir" e vira "caber" — um sistema de Turán. Daí
 * saem os valores exatos de [`MINIMOS`], conferidos por força bruta.
 *
 * ## O que este módulo não faz
 *
 * Não guarda multiplicador nenhum. As cotações variam por banca, não são
 * auditadas, e quem as conhece é o usuário — elas entram pela tela, não pelo
 * código. A matemática combinatória daqui não depende delas, e é justamente
 * essa separação que permite trocar a tabela sem tocar no fechamento.
 */

export const UNIVERSO = 25;
export const SORTEIO = 15;
export const MENOR_POOL = 17;
export const MAIOR_POOL = 23;

/** `C(n, k)` exato para os tamanhos desta modalidade. */
export function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    total = (total * (n - i)) / (i + 1);
  }
  return Math.round(total);
}

/**
 * Chance de as 15 sorteadas caírem todas dentro de um conjunto de `n` dezenas.
 *
 * É `C(n,15) / C(25,15)` — e é o único número que decide se a aposta ganha.
 * Nenhum arranjo de jogos altera isso: a aposta é binária, sem acerto parcial.
 */
export function chanceDe(n) {
  return combinacoes(n, SORTEIO) / combinacoes(UNIVERSO, SORTEIO);
}

/**
 * Quantos jogos de `k` dezenas fecham um pool de `P`, e quanto se sabe disso.
 *
 * Devolve `{ jogos, exato, piso }`:
 *
 * - `exato: true` — é o mínimo, provado. Acontece quando `P − k ≤ 2`.
 * - `exato: false` — `jogos` é o melhor que o motor encontrou até agora, e
 *   `piso` é o menor valor que a matemática ainda não descartou. O mínimo
 *   verdadeiro é problema em aberto.
 */
export function minimo(pool, jogo) {
  const a = pool - jogo;
  const b = pool - SORTEIO;
  const piso = Math.ceil(combinacoes(pool, SORTEIO) / combinacoes(jogo, SORTEIO));

  // Jogo do tamanho do pool: uma aposta só, e ela ou ganha ou perde inteira.
  if (a === 0) return { jogos: 1, exato: true, piso: 1 };

  // Falta uma dezena ao jogo: dezesseis bastam, qualquer que seja o pool.
  //
  // Cada jogo é o pool menos uma dezena, e ele contém o sorteio quando a dezena
  // removida está entre as `b` que o sorteio deixou de fora. Removendo 16
  // dezenas diferentes, sobram `P − 16` fora dessa lista; como o sorteio deixa
  // `b = P − 15` de fora, ao menos uma das removidas está entre elas. Sempre.
  if (a === 1) return { jogos: 16, exato: true, piso };

  // Faltam duas: teorema de Turán. Parte-se o pool em `b − 1` grupos e tomam-se
  // todos os pares dentro de cada um; qualquer sorteio deixa `b` dezenas de
  // fora, e duas delas caem no mesmo grupo pela casa dos pombos.
  if (a === 2) {
    const g = b - 1;
    let total = 0;
    for (let i = 0; i < g; i++) {
      const tam = Math.floor(pool / g) + (i < pool % g ? 1 : 0);
      total += combinacoes(tam, 2);
    }
    return { jogos: total, exato: true, piso };
  }

  return { jogos: null, exato: false, piso };
}

/** Todas as combinações da modalidade, com o que se sabe de cada uma. */
export function matriz() {
  const linhas = [];
  for (let pool = MENOR_POOL; pool <= MAIOR_POOL; pool++) {
    for (let jogo = MENOR_POOL; jogo <= pool; jogo++) {
      linhas.push({ pool, jogo, ...minimo(pool, jogo), chance: chanceDe(pool) });
    }
  }
  return linhas;
}

/* ─────────── o banco de fechamentos ─────────── */

let banco = null;

/**
 * Carrega o banco embutido no aplicativo.
 *
 * Vem gerado de fábrica, conferido por enumeração exaustiva antes de ser
 * gravado — não há download, nem dependência de terceiros, nem cálculo na hora
 * do uso. Os jogos são guardados como **posições** `1..P` dentro do pool, e não
 * como dezenas: assim o mesmo fechamento serve para qualquer conjunto de números
 * que o usuário escolher.
 */
export async function carregarBanco() {
  if (banco) return banco;
  const resposta = await fetch('./lotinha.json');
  if (!resposta.ok) throw new Error('não consegui carregar o banco de fechamentos');
  banco = await resposta.json();
  return banco;
}

/**
 * O fechamento pronto para `(pool, jogo)`, traduzido para as dezenas escolhidas.
 *
 * `dezenas` é a seleção do usuário, em ordem crescente; a posição `i` do banco
 * vira `dezenas[i-1]`.
 */
export async function fechamentoPara(pool, jogo, dezenas) {
  const b = await carregarBanco();
  const bruto = b[`${pool},${jogo}`];
  if (!bruto) return null;
  return bruto.map((linha) => linha.map((posicao) => dezenas[posicao - 1]));
}

/* ─────────── o validador independente ─────────── */

/**
 * Confere a cobertura percorrendo **todos** os sorteios possíveis dentro do pool.
 *
 * Não consulta o motor que produziu os jogos, e não confia nele: enumera cada um
 * dos `C(P,15)` sorteios e verifica se algum jogo o contém. Um fechamento que
 * afirme cobrir e não cubra é o pior defeito que esta ferramenta poderia ter, e
 * a única defesa contra ele é uma segunda opinião que não compartilhe código com
 * a primeira.
 *
 * Usa máscaras de bits — `P ≤ 23` cabe num inteiro de 32 bits, e "o jogo contém
 * o sorteio" vira uma operação só. O pior caso são 490.314 sorteios.
 *
 * Devolve `{ total, cobertos, falha }`, onde `falha` é o primeiro sorteio
 * descoberto — porque "não cobre" sem dizer onde é impossível de investigar.
 */
export function conferirCobertura(dezenas, jogos) {
  const pool = dezenas.length;
  const posicao = new Map(dezenas.map((d, i) => [d, i]));
  const mascaras = jogos.map((jogo) =>
    jogo.reduce((m, d) => m | (1 << posicao.get(d)), 0)
  );

  const indices = Array.from({ length: SORTEIO }, (_, i) => i);
  let total = 0;
  let cobertos = 0;
  let falha = null;

  for (;;) {
    total += 1;
    const mascara = indices.reduce((m, i) => m | (1 << i), 0);
    if (mascaras.some((j) => (j & mascara) === mascara)) {
      cobertos += 1;
    } else if (!falha) {
      falha = indices.map((i) => dezenas[i]);
    }

    let i = SORTEIO;
    while (i > 0 && indices[i - 1] === i - 1 + pool - SORTEIO) i -= 1;
    if (i === 0) break;
    indices[i - 1] += 1;
    for (let j = i; j < SORTEIO; j++) indices[j] = indices[j - 1] + 1;
  }

  return { total, cobertos, falha };
}

/* ─────────── o simulador ─────────── */

/**
 * Como o fechamento se sairia contra um resultado qualquer.
 *
 * Devolve a distribuição de acertos e quais jogos premiaram. Serve para testar
 * uma estrutura contra qualquer sorteio hipotético sem esperar o próximo.
 *
 * Vale lembrar o que "premiado" significa nesta modalidade: só o jogo que contém
 * as **15** conta. Acertar 14 não paga nada — a distribuição existe para mostrar
 * o quão perto se chegou, não para sugerir prêmio onde não há.
 */
export function simular(jogos, resultado) {
  const sorteadas = new Set(resultado);
  const distribuicao = new Map();
  const premiados = [];

  jogos.forEach((jogo, i) => {
    const acertos = jogo.reduce((n, d) => n + (sorteadas.has(d) ? 1 : 0), 0);
    distribuicao.set(acertos, (distribuicao.get(acertos) ?? 0) + 1);
    if (acertos === SORTEIO) premiados.push({ indice: i + 1, jogo });
  });

  return { distribuicao, premiados };
}

/* ─────────── o motor financeiro, separado do combinatório ─────────── */

/**
 * A economia de um fechamento, dada a tabela de cotação do usuário.
 *
 * `cotacao` mapeia tamanho do jogo → multiplicador. Nada vem embutido: as
 * cotações mudam por banca e não são auditadas, então quem as informa é quem
 * tem acesso a elas.
 *
 * Os dois ramos vêm juntos de propósito. O ramo vencedor de um fechamento é
 * sedutor — dezesseis jogos de 17 dezenas custam R$16 e pagam no mínimo R$7.201
 * — e apresentá-lo sozinho seria enganoso, porque o outro ramo acontece em mais
 * de 99% das vezes e devolve zero.
 */
export function economia({ pool, jogo, quantidade, cotacao, valorDoJogo = 1 }) {
  const multiplicador = cotacao[jogo] ?? null;
  const custo = quantidade * valorDoJogo;
  const chanceDoPool = chanceDe(pool);
  const chanceDeUmJogo = chanceDe(jogo);

  if (multiplicador === null) {
    return { custo, chanceDoPool, multiplicador: null };
  }

  const premioDeUm = multiplicador * valorDoJogo;

  // Quantos jogos ganham, em média, quando o sorteio cai dentro do pool.
  // O fechamento garante ao menos um; costuma premiar mais de um.
  const ganhosEsperadosNoPool = (quantidade * chanceDeUmJogo) / chanceDoPool;

  return {
    custo,
    chanceDoPool,
    multiplicador,
    premioMinimo: premioDeUm,
    premioMedioQuandoGanha: ganhosEsperadosNoPool * premioDeUm,
    // O que sai no bolso, em média, por real apostado. É fixo por jogo e apenas
    // soma: nenhum arranjo de fechamento altera este número.
    retornoEsperado: (quantidade * chanceDeUmJogo * premioDeUm) / custo,
    perdaQuandoPerde: custo,
    chanceDePerder: 1 - chanceDoPool,
  };
}
