/*
 * A Lotinha — a modalidade inteira, num módulo só.
 *
 * ## O que é
 *
 * Escolhem-se de 17 a 25 dezenas entre 25. O resultado da Lotofácil é a
 * referência. Ganha-se quando as 15 sorteadas caem **todas** dentro do conjunto
 * escolhido. O prêmio depende de quantas dezenas foram escolhidas — quanto
 * menos dezenas, maior o multiplicador.
 *
 * As bancas costumam parar em 23, e faz sentido: acima disso o multiplicador
 * cai tanto que a aposta perde a graça para elas. Mas a matemática não para —
 * escolher as 25 é escolher o universo inteiro, e aí o sorteio cai dentro do
 * pool com **certeza**. O fechamento deixa de ser uma aposta condicional e vira
 * uma garantia, e é essa a razão de a ferramenta ir até lá.
 *
 * ## Três eixos, não um
 *
 * Além de quantas dezenas e de que tamanho são os jogos, há duas exigências que
 * mudam completamente o tamanho do fechamento:
 *
 * - **quantos acertos garantir** — 15 é o que a Lotinha paga, mas garantir 14,
 *   13, 12 ou 11 custa uma fração disso, e é o que a Lotofácil premia.
 * - **quantas cartelas premiadas** — exigir que duas ou três cartelas acertem,
 *   e não apenas uma. Custa mais, mas às vezes bem menos do que parece: em 18
 *   dezenas com jogos de 17, a segunda cartela premiada custa **um** jogo.
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
export const MAIOR_POOL = 25;

/** Menor garantia de acertos oferecida — é a faixa mais baixa que a Lotofácil paga. */
export const MENOR_GARANTIA = 11;

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
 * Quantos sorteios um único jogo atende — a "oferta" de cada jogo comprado.
 *
 * Um jogo de `k` dezenas atende um sorteio quando tem ao menos `garantia` das
 * 15 sorteadas. Somando sobre quantas das 15 vêm de dentro do jogo:
 *
 *     Σ  C(k, i) · C(P − k, 15 − i)   para i de `garantia` até min(k, 15)
 */
export function sorteiosPorJogo(pool, jogo, garantia = SORTEIO) {
  let total = 0;
  for (let i = garantia; i <= Math.min(jogo, SORTEIO); i++) {
    total += combinacoes(jogo, i) * combinacoes(pool - jogo, SORTEIO - i);
  }
  return total;
}

/**
 * Quantos jogos **distintos** podem premiar um mesmo sorteio.
 *
 * É o teto de cartelas premiadas que faz sentido pedir: acima dele não há mais
 * jogos diferentes a oferecer, e a única forma de somar prêmios é comprar o
 * mesmo jogo duas vezes — o que ninguém quer sem saber que está fazendo.
 *
 * Em 18 dezenas com jogos de 17 dá 3, e a razão é visível: cada jogo é o pool
 * menos uma dezena, o sorteio deixa 3 dezenas de fora, e só esses 3 jogos o
 * contêm.
 */
export function maximoPremiadas(pool, jogo, garantia = SORTEIO) {
  let total = 0;
  for (let i = garantia; i <= Math.min(jogo, SORTEIO); i++) {
    total += combinacoes(SORTEIO, i) * combinacoes(pool - SORTEIO, jogo - i);
  }
  return total;
}

/**
 * Cota de Schönheim para cobrir todo subconjunto de `t` dentro de `v`, com `k`.
 *
 *     L(v, k, 1) = ⌈v / k⌉
 *     L(v, k, t) = ⌈ (v / k) · L(v−1, k−1, t−1) ⌉
 *
 * O argumento: fixe uma dezena. Os jogos que a contêm precisam cobrir todos os
 * `(t−1)`-subconjuntos das outras `v−1`, e cada jogo contribui com `k−1` delas.
 *
 * ## Por que ela importa tanto aqui
 *
 * Nas 15 combinações da Lotinha em que o mínimo verdadeiro é **conhecido**, esta
 * cota acerta as 15 — exatamente, sem folga. A cota de contagem, que é a que
 * esta tela mostrava, erra por 76% a 433% nas mesmas 15.
 *
 * O efeito não era só cosmético: a tela da Lotinha dizia "não dá com menos de
 * 114" enquanto a tela de Buscar, que consulta o motor, dizia 160 para o mesmo
 * problema. Duas telas discordando, e a que estava certa era a outra.
 */
function schonheim(v, k, t) {
  if (t < 1 || k < 1 || t > k || k > v) return 0;
  let valor = Math.ceil((v - t + 1) / (k - t + 1));
  for (let i = 2; i <= t; i++) {
    valor = Math.ceil(((v - t + i) * valor) / (k - t + i));
  }
  return valor;
}

/**
 * Quantos jogos de `k` dezenas fecham um pool de `P`, e quanto se sabe disso.
 *
 * Devolve `{ jogos, exato, piso }`:
 *
 * - `exato: true` — é o mínimo, provado.
 * - `exato: false` — o mínimo verdadeiro é problema em aberto; `piso` é o menor
 *   valor que a matemática ainda não descartou, e `jogos` é `null`.
 *
 * O `piso` é o mais forte entre dois argumentos independentes:
 *
 * - **contagem** — são `C(P,15)` sorteios a atender, cada um `premiadas` vezes,
 *   e cada jogo comprado atende [`sorteiosPorJogo`] deles;
 * - **[`schonheim`]** — vale só na garantia cheia, e é a que manda em toda a
 *   modalidade: nas 15 combinações de mínimo conhecido ela acerta as 15, e a de
 *   contagem erra por 76% a 433%.
 */
export function minimo(pool, jogo, garantia = SORTEIO, premiadas = 1) {
  const a = pool - jogo;
  const b = pool - SORTEIO;
  const oferta = sorteiosPorJogo(pool, jogo, garantia);
  const porContagem = oferta > 0
    ? Math.ceil((premiadas * combinacoes(pool, SORTEIO)) / oferta)
    : Infinity;

  // O piso é o mais forte entre dois argumentos independentes, exatamente como
  // o motor faz — sem isto as duas telas do aplicativo diziam números
  // diferentes para o mesmo problema.
  //
  // Schönheim só vale para cobertura completa: ela conta jogos que **contêm**
  // o sorteio, e uma garantia parcial não exige isso. E não se multiplica por
  // `premiadas`: nenhum teorema autoriza. Mas continua valendo inteira, porque
  // atender cada sorteio `r` vezes implica atendê-lo ao menos uma.
  const porSchonheim = garantia === SORTEIO ? schonheim(pool, jogo, SORTEIO) : 0;
  const piso = Math.max(porContagem, porSchonheim);

  // Jogo do tamanho do pool: uma aposta só, e ela ou ganha ou perde inteira.
  // Não há um segundo jogo distinto para premiar junto.
  if (a === 0) return { jogos: premiadas, exato: true, piso: premiadas };

  // Fora da garantia cheia, o mínimo deixa de ter fórmula fechada aqui: a
  // troca de ponto de vista que dá os valores exatos abaixo depende de o jogo
  // precisar **conter** o sorteio inteiro. Sobra o piso de contagem, que vale
  // sempre.
  if (garantia !== SORTEIO) return { jogos: null, exato: false, piso };

  // Falta uma dezena ao jogo: `15 + r` jogos bastam, qualquer que seja o pool.
  //
  // Cada jogo é o pool menos uma dezena, e ele contém o sorteio quando a dezena
  // removida está entre as `b` que o sorteio deixou de fora. Escolhendo `m`
  // dezenas para remover, o pior sorteio deixa de fora o máximo de dezenas não
  // escolhidas que couberem — então ele contém `b − min(b, P − m)` das
  // escolhidas. Exigir que isso seja ao menos `r` dá `m ≥ 15 + r`.
  //
  // Com `r = 1` são os 16 de sempre; com `r = 2`, dezessete. A segunda cartela
  // premiada custa um jogo, não dezesseis — medido e conferido contra o motor.
  if (a === 1) {
    return premiadas <= b
      ? { jogos: SORTEIO + premiadas, exato: true, piso }
      : { jogos: null, exato: false, piso };
  }

  // Faltam duas: teorema de Turán. Parte-se o pool em `b − 1` grupos e tomam-se
  // todos os pares dentro de cada um; qualquer sorteio deixa `b` dezenas de
  // fora, e duas delas caem no mesmo grupo pela casa dos pombos.
  //
  // O argumento é de cobertura simples e não se estende a `r > 1`.
  if (a === 2 && premiadas === 1) {
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

/* ─────────── construir na hora, sem motor ─────────── */

/**
 * Acima disto não vale construir aqui: são jogos demais para caber na memória
 * de um celular, e mais do que qualquer pessoa compraria.
 *
 * Os cinco casos que passam deste teto — 24 e 25 dezenas com jogos de 17 a 19 —
 * têm construção de 134 mil a 1,08 **milhão** de jogos. Ali o motor parte do
 * próprio guloso, que nasce muito menor.
 */
const TETO_PARA_CONSTRUIR = 25_000;

/**
 * O fechamento montado por fórmula, sem busca nenhuma.
 *
 * Esta é a resposta rápida, e na maior parte da modalidade ela é também a
 * resposta certa: em 24 das 45 combinações a construção **é** o mínimo
 * comprovado, e em várias outras ela bate o que o motor encontra depois de
 * minutos. Medido em 25 dezenas com jogos de 22: a fórmula dá 95 jogos num
 * piscar, e o guloso do motor gasta seis segundos para chegar a 139.
 *
 * ## Por que funciona
 *
 * Um jogo de `k` dezenas é o complemento de `a = P − k`; um sorteio de 15 é o
 * complemento de `b = P − 15`. Então *o jogo contém o sorteio* ⟺ *as `a` que
 * faltam ao jogo estão entre as `b` que faltam ao sorteio*.
 *
 * Partindo o pool em `g` grupos e tomando todos os `a`-subconjuntos dentro de
 * cada grupo: qualquer sorteio deixa `b` dezenas de fora, e pela casa dos
 * pombos algum grupo fica com pelo menos `⌈b/g⌉` delas. Escolhendo
 * `g = ⌊(b−1)/(a−1)⌋` isso é ao menos `a`, e aquele grupo contém um dos
 * subconjuntos escolhidos — logo o jogo correspondente contém o sorteio.
 *
 * A garantia vem do argumento, não de uma varredura. O validador independente
 * do aplicativo confere assim mesmo, porque um argumento certo não protege
 * contra um erro de digitação.
 *
 * Devolve `null` quando não há construção fechada para o pedido — garantia
 * parcial, ou grande demais para montar aqui.
 */
export function construir(pool, jogo, dezenas, garantia = SORTEIO, premiadas = 1) {
  if (garantia !== SORTEIO) return null;

  const a = pool - jogo;
  const b = pool - SORTEIO;

  // Jogar todas as dezenas: uma aposta só. Repetida `r` vezes se for preciso
  // garantir `r` cartelas premiadas — não há um segundo jogo distinto.
  if (a === 0) return Array.from({ length: premiadas }, () => [...dezenas]);

  // Falta uma dezena ao jogo: cada jogo é o pool menos uma das `15 + r`
  // primeiras dezenas. Acima de `b` não há como, com jogos distintos.
  if (a === 1) {
    const quantos = SORTEIO + premiadas;
    if (premiadas > b || quantos > pool) return null;
    return dezenas.slice(0, quantos).map((fora) => dezenas.filter((d) => d !== fora));
  }

  // Daqui em diante a construção por grupos só vale para uma cartela premiada:
  // o argumento da casa dos pombos garante **um** subconjunto no grupo, não `r`.
  if (premiadas !== 1) return null;

  const g = Math.max(Math.floor((b - 1) / (a - 1)), 1);
  const grupos = Array.from({ length: g }, () => []);
  dezenas.forEach((d, i) => grupos[i % g].push(d));

  const quantos = grupos.reduce((total, grupo) => total + combinacoes(grupo.length, a), 0);
  if (quantos > TETO_PARA_CONSTRUIR) return null;

  const jogos = [];
  for (const grupo of grupos) {
    for (const fora of subconjuntos(grupo, a)) {
      const excluir = new Set(fora);
      jogos.push(dezenas.filter((d) => !excluir.has(d)));
    }
  }
  return jogos;
}

/** Todos os subconjuntos de `k` elementos de `itens`, em ordem. */
function* subconjuntos(itens, k) {
  const escolha = [];
  yield* (function* passo(inicio) {
    if (escolha.length === k) {
      yield [...escolha];
      return;
    }
    for (let i = inicio; i <= itens.length - (k - escolha.length); i++) {
      escolha.push(itens[i]);
      yield* passo(i + 1);
      escolha.pop();
    }
  })(0);
}

/**
 * Quantos jogos a construção produziria, sem construí-la.
 *
 * Serve para a tela decidir antes de gastar memória, e para dizer ao usuário o
 * tamanho do que ele está pedindo.
 */
export function tamanhoDaConstrucao(pool, jogo, garantia = SORTEIO, premiadas = 1) {
  if (garantia !== SORTEIO) return null;
  const a = pool - jogo;
  const b = pool - SORTEIO;
  if (a === 0) return premiadas;
  if (a === 1) return premiadas <= b && SORTEIO + premiadas <= pool ? SORTEIO + premiadas : null;
  if (premiadas !== 1) return null;

  const g = Math.max(Math.floor((b - 1) / (a - 1)), 1);
  let total = 0;
  for (let i = 0; i < g; i++) {
    total += combinacoes(Math.floor(pool / g) + (i < pool % g ? 1 : 0), a);
  }
  return total;
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
  const cru = await resposta.json();
  // O formato 2 guarda complementos e vem embrulhado; o 1 era o mapa direto.
  banco = cru?.formato === 2 ? cru : { formato: 1, fechamentos: cru };
  return banco;
}

/**
 * O fechamento pronto para `(pool, jogo)`, traduzido para as dezenas escolhidas.
 *
 * `dezenas` é a seleção do usuário, em ordem crescente; a posição `i` do banco
 * vira `dezenas[i-1]`.
 *
 * ## Por que o banco guarda o que falta
 *
 * No formato 2 cada linha lista as posições **ausentes** do jogo, não as
 * presentes. É a mesma troca de ponto de vista que dá os valores exatos da
 * modalidade — um jogo de 17 num pool de 23 é o complemento de 6 — aplicada ao
 * armazenamento: guardar 6 números em vez de 17 corta o arquivo em 65%.
 *
 * O ganho não é o arquivo em si, e sim o que ele permite: com o mesmo espaço
 * cabem 37 das 38 combinações construíveis prontas de fábrica, contra as 28 de
 * antes. Quanto mais vem pronto, menos o celular precisa calcular.
 */
export async function fechamentoPara(pool, jogo, dezenas) {
  const { formato, fechamentos } = await carregarBanco();
  const bruto = fechamentos[`${pool},${jogo}`];
  if (!bruto) return null;

  if (formato === 1) {
    return bruto.map((linha) => linha.map((posicao) => dezenas[posicao - 1]));
  }

  return bruto.map((falta) => {
    const fora = new Set(falta.map((posicao) => dezenas[posicao - 1]));
    return dezenas.filter((d) => !fora.has(d));
  });
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
 * Usa máscaras de bits — `P ≤ 25` cabe num inteiro de 32 bits, e a interseção
 * entre jogo e sorteio vira um `&` seguido de uma contagem de bits. O pior caso
 * são os 3.268.760 sorteios de um pool de 25.
 *
 * Confere as duas exigências, e não só a cobertura: cada sorteio precisa ser
 * atendido por ao menos `premiadas` jogos, cada um com pelo menos `garantia`
 * das 15 dezenas. Um fechamento que prometa duas cartelas premiadas e entregue
 * uma passaria despercebido numa conferência que só perguntasse "alguém
 * cobre?".
 *
 * Devolve `{ total, cobertos, falha, minimoPremiadas }`, onde `falha` é o
 * primeiro sorteio malservido — porque "não cobre" sem dizer onde é impossível
 * de investigar — e `minimoPremiadas` é o pior caso encontrado, que responde
 * "quantas cartelas este fechamento de fato garante".
 */
export function conferirCobertura(
  dezenas,
  jogos,
  garantia = SORTEIO,
  premiadas = 1,
  { exaustivo = null } = {}
) {
  const pool = dezenas.length;
  const posicao = new Map(dezenas.map((d, i) => [d, i]));
  const mascaras = jogos.map((jogo) =>
    jogo.reduce((m, d) => m | (1 << posicao.get(d)), 0)
  );

  // Percorrer tudo custa `sorteios × jogos`, e isso passa de seis bilhões de
  // operações num pool de 25 com dois mil jogos — sete segundos de tela parada
  // num computador, muito mais num celular.
  //
  // Acima do orçamento, a conferência passa a sortear. O que **não** muda é o
  // que ela afirma: uma amostra nunca é anunciada como 100%, e quem quiser a
  // conferência inteira pede pelo botão.
  const sorteiosPossiveis = combinacoes(pool, SORTEIO);
  const varrerTudo = exaustivo ?? sorteiosPossiveis * jogos.length <= ORCAMENTO_DA_CONFERENCIA;

  if (!varrerTudo) {
    return conferirPorAmostra(dezenas, mascaras, garantia, premiadas, sorteiosPossiveis);
  }

  const indices = Array.from({ length: SORTEIO }, (_, i) => i);
  let total = 0;
  let cobertos = 0;
  let falha = null;
  let minimoPremiadas = Infinity;

  for (;;) {
    total += 1;
    const mascara = indices.reduce((m, i) => m | (1 << i), 0);

    // Conta quantos jogos atendem este sorteio, parando em `premiadas`: além
    // disso o número não muda a resposta, e o corte é o que mantém a
    // conferência viável nos fechamentos grandes.
    let atendem = 0;
    for (const j of mascaras) {
      if (bitsEm(j & mascara) >= garantia) {
        atendem += 1;
        if (atendem >= premiadas) break;
      }
    }

    if (atendem < minimoPremiadas) minimoPremiadas = atendem;
    if (atendem >= premiadas) {
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

  return { total, cobertos, falha, minimoPremiadas, exaustivo: true, possiveis: sorteiosPossiveis };
}

/** Quantas operações a conferência completa pode custar antes de virar amostra. */
const ORCAMENTO_DA_CONFERENCIA = 1_000_000_000;

/** Quantos sorteios a amostra examina. */
const TAMANHO_DA_AMOSTRA = 200_000;

/**
 * A mesma conferência, sobre sorteios tirados ao acaso.
 *
 * Não prova a cobertura — nenhuma amostra prova — mas encontra um fechamento
 * furado com folga: se um em mil sorteios estivesse descoberto, duzentos mil
 * sorteios o encontrariam com probabilidade praticamente 1.
 *
 * O sorteio é feito com um gerador próprio e semente fixa, para que conferir
 * duas vezes dê o mesmo resultado — uma conferência que muda de resposta a cada
 * toque não serve para investigar nada.
 */
function conferirPorAmostra(dezenas, mascaras, garantia, premiadas, possiveis) {
  const pool = dezenas.length;
  let semente = 0x9e3779b9 ^ (pool * 2654435761 + mascaras.length);
  const proximo = () => {
    semente ^= semente << 13; semente ^= semente >>> 17; semente ^= semente << 5;
    return (semente >>> 0) / 4294967296;
  };

  const urna = dezenas.map((_, i) => i);
  let cobertos = 0;
  let falha = null;
  let minimoPremiadas = Infinity;

  for (let n = 0; n < TAMANHO_DA_AMOSTRA; n++) {
    // Fisher-Yates parcial: as 15 primeiras posições viram o sorteio.
    for (let i = 0; i < SORTEIO; i++) {
      const j = i + Math.floor(proximo() * (pool - i));
      [urna[i], urna[j]] = [urna[j], urna[i]];
    }
    let mascara = 0;
    for (let i = 0; i < SORTEIO; i++) mascara |= 1 << urna[i];

    let atendem = 0;
    for (const j of mascaras) {
      if (bitsEm(j & mascara) >= garantia) {
        atendem += 1;
        if (atendem >= premiadas) break;
      }
    }
    if (atendem < minimoPremiadas) minimoPremiadas = atendem;
    if (atendem >= premiadas) cobertos += 1;
    else if (!falha) falha = urna.slice(0, SORTEIO).map((i) => dezenas[i]).sort((a, b) => a - b);
  }

  return {
    total: TAMANHO_DA_AMOSTRA,
    cobertos,
    falha,
    minimoPremiadas,
    exaustivo: false,
    possiveis,
  };
}

/** Quantos bits ligados há num inteiro de 32 bits. */
function bitsEm(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/* ─────────── o simulador ─────────── */

/**
 * Como o fechamento se sairia contra um resultado qualquer.
 *
 * Devolve a distribuição de acertos e quais jogos premiaram. Serve para testar
 * uma estrutura contra qualquer sorteio hipotético sem esperar o próximo.
 *
 * `garantia` diz o que conta como premiado nesta simulação. Na Lotinha só o
 * jogo que contém as **15** paga; quem fechou para 12 ou 13 está mirando a
 * Lotofácil, onde essas faixas premiam. A distribuição completa vem junto de
 * qualquer forma, para mostrar o quão perto se chegou.
 */
export function simular(jogos, resultado, garantia = SORTEIO) {
  const sorteadas = new Set(resultado);
  const distribuicao = new Map();
  const premiados = [];
  const comQuinze = [];

  jogos.forEach((jogo, i) => {
    const acertos = jogo.reduce((n, d) => n + (sorteadas.has(d) ? 1 : 0), 0);
    distribuicao.set(acertos, (distribuicao.get(acertos) ?? 0) + 1);
    if (acertos >= garantia) premiados.push({ indice: i + 1, acertos, jogo });
    if (acertos === SORTEIO) comQuinze.push({ indice: i + 1, jogo });
  });

  return { distribuicao, premiados, comQuinze };
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
export function economia({
  pool,
  jogo,
  quantidade,
  cotacao,
  valorDoJogo = 1,
  garantia = SORTEIO,
  premiadas = 1,
}) {
  const multiplicador = cotacao[jogo] ?? null;
  const custo = quantidade * valorDoJogo;
  const chanceDoPool = chanceDe(pool);
  const chanceDeUmJogo = chanceDe(jogo);

  // Fechar para menos de 15 acertos não compra prêmio nenhum **nesta**
  // modalidade: a Lotinha paga o jogo que contém as 15, e só ele. Quem escolhe
  // 12 ou 13 está mirando a Lotofácil, onde essas faixas premiam — e a tela
  // precisa dizer isso em vez de calcular um prêmio garantido que não existe.
  const garantePremio = garantia === SORTEIO;

  if (multiplicador === null) {
    return { custo, chanceDoPool, garantePremio, multiplicador: null };
  }

  const premioDeUm = multiplicador * valorDoJogo;

  // Quantos jogos ganham, em média, quando o sorteio cai dentro do pool.
  // O fechamento garante `premiadas`; costuma premiar mais.
  const ganhosEsperadosNoPool = (quantidade * chanceDeUmJogo) / chanceDoPool;

  return {
    custo,
    chanceDoPool,
    multiplicador,
    garantePremio,
    // Com `r` cartelas premiadas garantidas, o piso do prêmio multiplica por
    // `r`: são `r` jogos contendo as 15, cada um pagando por inteiro.
    premioMinimo: garantePremio ? premiadas * premioDeUm : 0,
    premiadas,
    premioMedioQuandoGanha: ganhosEsperadosNoPool * premioDeUm,
    // O que sai no bolso, em média, por real apostado. É fixo por jogo e apenas
    // soma: nem o arranjo do fechamento, nem a garantia escolhida, nem quantas
    // cartelas premiadas se exija alteram este número. Eles mudam **quando** se
    // ganha e quanto de cada vez, nunca a média.
    retornoEsperado: (quantidade * chanceDeUmJogo * premioDeUm) / custo,
    perdaQuandoPerde: custo,
    chanceDePerder: 1 - chanceDoPool,
  };
}
