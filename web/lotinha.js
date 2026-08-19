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
 * ## A cotação, e o que ela decide
 *
 * [`COTACAO_PADRAO`] traz a tabela de uma banca real, como ponto de partida
 * editável. Ela não entra em conta combinatória nenhuma — a separação continua
 * inteira, e trocar a tabela não mexe num único fechamento.
 *
 * O que ela permite é [`veredito`]: dizer se aquele fechamento **paga**. São
 * duas perguntas diferentes, e confundi-las é o erro que custa dinheiro:
 *
 * - **no longo prazo**, o retorno por real depende só do tamanho do jogo, e é
 *   negativo em todas as combinações. O número de cartelas cancela na conta, e
 *   otimizar não muda isso em nada. [`economia`] calcula esse número.
 * - **no ramo em que se ganha** — quando as 15 caem dentro do pool — o
 *   fechamento garante ao menos uma cartela premiada, que paga `mult`. O custo
 *   foi `N` cartelas. Aí sim o tamanho do fechamento decide, e `N < mult` é a
 *   fronteira entre lucrar ao acertar e perder mesmo acertando.
 */

export const UNIVERSO = 25;
export const SORTEIO = 15;
export const MENOR_POOL = 17;
export const MAIOR_POOL = 25;

/** Menor garantia de acertos oferecida — é a faixa mais baixa que a Lotofácil paga. */
export const MENOR_GARANTIA = 11;

/**
 * Quanto uma banca paga, por tamanho da cartela apostada.
 *
 * A banca enxerga o bilhete, não o seu fechamento: uma cartela de 17 dezenas
 * paga 7000× a aposta se as 15 sorteadas caírem dentro dela, venha ela de um
 * pool de 18 ou de 23. E cada bilhete premiado é pago por inteiro — duas
 * cartelas com as 15 são dois prêmios.
 *
 * Vem preenchida por conveniência, e não por autoridade: cotações mudam de
 * banca para banca e ao longo do tempo, e a tela deixa cada uma editável. Quem
 * conhece a sua é o usuário.
 *
 * Não há 24 nem 25 aqui, e não é omissão: banca nenhuma aceita uma cartela
 * desse tamanho. Nesses casos [`economia`] devolve `multiplicador: null` e a
 * tela mostra a estrutura sem inventar um preço.
 */
export const COTACAO_PADRAO = Object.freeze({
  17: 7000,
  18: 1300,
  19: 300,
  20: 100,
  21: 30,
  22: 10,
  23: 4,
});

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
 * Cota de Schönheim para cobrir todo subconjunto de `t` dentro de `v`, com `k`,
 * ao menos `r` vezes cada.
 *
 *     L_r(v, k, 1) = ⌈r·v / k⌉
 *     L_r(v, k, t) = ⌈ (v / k) · L_r(v−1, k−1, t−1) ⌉
 *
 * O argumento: fixe uma dezena `x`. Os jogos que contêm `x`, tirado `x`,
 * precisam cobrir `r` vezes todos os `(t−1)`-subconjuntos das outras `v−1`, e
 * cada jogo contribui com `k−1` delas. Somando os graus, `k·N ≥ v·L_r(v−1,…)`.
 *
 * ## Por que a garantia entra só na base
 *
 * Porque é lá que ela é uma exigência sobre dezenas, e não sobre jogos: cada
 * dezena precisa aparecer em `r` jogos, então `N·k ≥ r·v`. O passo seguinte já
 * herda `r` pelo valor que carrega, e multiplicá-lo de novo contaria duas vezes.
 *
 * Vale a pena o cuidado: durante muito tempo esta função ignorou `r`, e o piso
 * que ela devolvia era o de uma cartela premiada. Em 23 dezenas com jogos de 21
 * e duas premiadas isso dizia 27 quando o mínimo verdadeiro é 33 — e 33 é
 * exatamente o que a construção entrega, ou seja, a combinação era **exata** e
 * o aplicativo a anunciava como problema em aberto.
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
function schonheim(v, k, t, premiadas = 1) {
  if (t < 1 || k < 1 || t > k || k > v) return 0;
  let valor = Math.ceil((premiadas * (v - t + 1)) / (k - t + 1));
  for (let i = 2; i <= t; i++) {
    valor = Math.ceil(((v - t + i) * valor) / (k - t + i));
  }
  return valor;
}

/**
 * A cotação neutra: quanto uma banca precisaria pagar para o jogo não ter
 * vantagem para lado nenhum.
 *
 * É o inverso da chance: uma cartela de `k` dezenas contém as 15 uma vez em
 * `C(25,15)/C(k,15)` sorteios, então pagar exatamente isso devolve, no longo
 * prazo, o que foi apostado.
 *
 * ## A identidade que isto torna visível
 *
 *     retorno por real = multiplicador / cotação justa
 *
 * O retorno esperado que [`economia`] calcula **é** a fração do justo que a
 * banca paga. R$ 0,29 por real e "paga 29% do justo" são o mesmo número dito
 * de dois jeitos — e o segundo jeito é o que permite avaliar uma tabela de
 * cotações sem fazer conta nenhuma.
 *
 * É também a única alavanca que muda o retorno. Nem o tamanho do fechamento,
 * nem o pool, nem a garantia escolhida entram aqui: quem decide quanto volta é
 * quanto a banca paga, e por isso vale saber medir uma oferta.
 */
export function cotacaoJusta(jogo) {
  const chance = chanceDe(jogo);
  return chance > 0 ? 1 / chance : Infinity;
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
  // o sorteio, e uma garantia parcial não exige isso. Dentro da garantia cheia
  // ela acompanha `premiadas`, pela recursão generalizada.
  const porSchonheim =
    garantia === SORTEIO ? schonheim(pool, jogo, SORTEIO, premiadas) : 0;
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

  // Faltam duas ou mais: quem responde é a construção fechada, e ela é o mínimo
  // **provado** exatamente quando encosta no piso — uma é limite superior, o
  // outro é limite inferior, e iguais só podem ser o mínimo.
  //
  // Esta regra substituiu um ramo que tratava `a = 2` à mão, pelo teorema de
  // Turán, e só valia para uma cartela premiada. A regra geral recupera aquele
  // caso (as nove combinações com `a = 2` continuam exatas, com os mesmos
  // números) e acrescenta os que a garantia maior torna exatos: em 23 dezenas
  // com jogos de 21 são 27, 33, 42 e 55 para uma a quatro cartelas premiadas,
  // todos comprovados.
  const daConstrucao = tamanhoDaConstrucao(pool, jogo, garantia, premiadas);
  if (daConstrucao !== null && daConstrucao === piso) {
    return { jogos: daConstrucao, exato: true, piso };
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
/** Impossível: não existe família que sirva. */
const INVIAVEL = Infinity;

/**
 * O memo de [`turanTamanho`], no módulo e não por chamada.
 *
 * A função é determinística e o espaço de chaves é minúsculo — `v ≤ 25`,
 * `a ≤ 10`, `b ≤ 10` e a garantia até algumas dezenas —, então guardar entre
 * chamadas custa alguns milhares de entradas e poupa refazer a recursão inteira
 * a cada repintura da tela. Era um `new Map()` por chamada, o que jogava fora
 * todo o trabalho entre uma combinação e a seguinte.
 */
const memoDeTuran = new Map();

/**
 * Quantos blocos o pior `b`-conjunto encontra quando cada uma das `g` partes
 * guarda **todos** os seus `a`-subconjuntos.
 *
 * O pior caso é a divisão mais uniforme, e isso é um teorema, não uma
 * suposição: `C(·,a)` é convexa, então espalhar minimiza a soma. É o que
 * autoriza parar o laço de `g` assim que a garantia cai abaixo do pedido —
 * dividir em mais partes só espalha mais.
 */
function garantiaDoAgrupamento(b, g, a) {
  const base = Math.floor(b / g);
  const sobra = b % g;
  return sobra * combinacoes(base + 1, a) + (g - sobra) * combinacoes(base, a);
}

/**
 * Quantos `a`-subconjuntos de `v` pontos bastam para que todo `b`-subconjunto
 * contenha um deles — pela melhor construção fechada que este aplicativo conhece.
 *
 * É o problema de Turán, na forma complementar em que a modalidade vive: um
 * jogo de `k` dezenas é o complemento de `a = P − k`, um sorteio de 15 é o
 * complemento de `b = P − 15`, e *o jogo contém o sorteio* ⟺ *as `a` que faltam
 * ao jogo estão entre as `b` que faltam ao sorteio*.
 *
 * Três argumentos disputam, e vale o menor:
 *
 * 1. **tudo** — todos os `C(v,a)`. Sempre serve, quase sempre desperdiça.
 * 2. **por um ponto** — escolha `x`. Os `b`-conjuntos sem `x` são
 *    `b`-conjuntos dos outros `v−1`; os com `x` viram `(b−1)`-conjuntos dos
 *    outros que precisam conter um `(a−1)`-conjunto, ao qual se junta `x`.
 *    Daí `N(v,a,b) ≤ N(v−1,a,b) + N(v−1,a−1,b−1)`.
 * 3. **por grupos** — parta em `g` partes. Um `b`-conjunto deixa `⌈b/g⌉`
 *    pontos em alguma parte pela casa dos pombos, então cada parte só precisa
 *    de uma família boa para `⌈b/g⌉` no lugar de `b`. Com `⌈b/g⌉ = a` isto vira
 *    "todos os `a`-subconjuntos de cada grupo", que era a construção usada
 *    sozinha até aqui.
 *
 * O ganho de somar as três é grande e foi medido conferindo sorteio a sorteio
 * as 45 combinações da modalidade: em 25 dezenas com jogos de 19 a construção
 * por grupos pede 177.100 jogos e esta pede 6.072 — vinte e nove vezes menos,
 * sem busca nenhuma. E nas 15 combinações de mínimo conhecido ela **alcança o
 * mínimo**, as 15.
 *
 * ## O que foi tentado e não rendeu
 *
 * Partes de tamanhos desiguais, e grupos menores que `⌈b/g⌉` custando zero em
 * vez de serem proibidos — um grupo pequeno demais nunca pode ser a testemunha
 * da casa dos pombos, então dispensaria família. As duas são válidas, foram
 * medidas nas 21 combinações em aberto, e não melhoraram nenhuma. A partição
 * mais igual possível já é a melhor desta família.
 */
function turanTamanho(v, a, b, premiadas = 1) {
  if (a > b || b > v) return INVIAVEL;
  // Nem tomando **todos** os `a`-subconjuntos: um `b`-conjunto contém `C(b,a)`
  // deles, e nenhum sorteio pode ser atendido mais vezes do que isso.
  if (combinacoes(b, a) < premiadas) return INVIAVEL;
  // Daqui para baixo a guarda acima já garantiu `premiadas = 1` sempre que só
  // existe um bloco possível dentro de cada `b`-conjunto.
  if (a === 0) return 1;
  if (v === b) return premiadas; // um único `b`-conjunto: `r` blocos quaisquer
  if (a === b) return combinacoes(v, b);
  if (a === 1) return v - b + premiadas;

  const chave = `${v},${a},${b},${premiadas}`;
  const pronto = memoDeTuran.get(chave);
  if (pronto !== undefined) return pronto;

  let melhor = combinacoes(v, a);
  melhor = Math.min(
    melhor,
    turanTamanho(v - 1, a, b, premiadas) +
      turanTamanho(v - 1, a - 1, b - 1, premiadas)
  );

  for (let g = 2; g <= b; g++) {
    let total = 0;
    if (premiadas === 1) {
      const alvo = Math.ceil(b / g);
      if (alvo < a) break; // partir mais só afrouxa a casa dos pombos
      for (let i = 0; i < g && total < melhor; i++) {
        total += turanTamanho(Math.floor(v / g) + (i < v % g ? 1 : 0), a, alvo, 1);
      }
    } else {
      // A casa dos pombos entrega **uma** parte com `⌈b/g⌉` pontos, não várias,
      // e o adversário concentra o sorteio numa parte só — então a forma
      // recursiva acima não se generaliza. O que se generaliza é a forma
      // achatada: cada parte guarda todos os seus `a`-subconjuntos, e a
      // garantia é a soma sobre a divisão mais uniforme.
      if (garantiaDoAgrupamento(b, g, a) < premiadas) break;
      for (let i = 0; i < g && total < melhor; i++) {
        total += combinacoes(Math.floor(v / g) + (i < v % g ? 1 : 0), a);
      }
    }
    melhor = Math.min(melhor, total);
  }

  memoDeTuran.set(chave, melhor);
  return melhor;
}

/**
 * A família que [`turanTamanho`] contou, agora materializada.
 *
 * Repete exatamente as mesmas escolhas: mede as três alternativas e constrói a
 * vencedora. Devolve o que **falta** a cada jogo, não o jogo.
 */
function turanFaltas(pontos, a, b, premiadas = 1) {
  const v = pontos.length;
  if (a === 0) return [[]];
  if (v === b) {
    const saida = [];
    for (const bloco of subconjuntos(pontos, a)) {
      saida.push(bloco);
      if (saida.length === premiadas) break;
    }
    return saida;
  }
  if (a === b) return [...subconjuntos(pontos, a)];
  if (a === 1) return pontos.slice(0, v - b + premiadas).map((p) => [p]);

  const alvo = turanTamanho(v, a, b, premiadas);
  if (alvo === combinacoes(v, a)) return [...subconjuntos(pontos, a)];

  const porPonto =
    turanTamanho(v - 1, a, b, premiadas) +
    turanTamanho(v - 1, a - 1, b - 1, premiadas);
  if (alvo === porPonto) {
    const x = pontos[0];
    const resto = pontos.slice(1);
    return [
      ...turanFaltas(resto, a, b, premiadas),
      ...turanFaltas(resto, a - 1, b - 1, premiadas).map((menor) => [...menor, x]),
    ];
  }

  for (let g = 2; g <= b; g++) {
    const partes = Array.from({ length: g }, () => []);
    // Rodízio: a parte `i` fica com `⌊v/g⌋ + (i < v mod g)` pontos, exatamente
    // os tamanhos que [`turanTamanho`] mediu. As duas contas precisam concordar,
    // senão a família construída não é a que foi escolhida.
    pontos.forEach((p, i) => partes[i % g].push(p));

    if (premiadas === 1) {
      const alvoDoGrupo = Math.ceil(b / g);
      if (alvoDoGrupo < a) break;
      const total = partes.reduce(
        (soma, parte) => soma + turanTamanho(parte.length, a, alvoDoGrupo, 1),
        0
      );
      if (total === alvo) {
        return partes.flatMap((parte) => turanFaltas(parte, a, alvoDoGrupo, 1));
      }
    } else {
      if (garantiaDoAgrupamento(b, g, a) < premiadas) break;
      const total = partes.reduce(
        (soma, parte) => soma + combinacoes(parte.length, a),
        0
      );
      if (total === alvo) {
        return partes.flatMap((parte) => [...subconjuntos(parte, a)]);
      }
    }
  }

  // A medida não bateu com nenhuma construção: só pode ser erro de programação,
  // e devolver a família trivial esconderia o defeito atrás de um resultado
  // grande porém correto.
  throw new Error(
    `medida de Turán sem construção em (${v}, ${a}, ${b}, r=${premiadas})`
  );
}

const TETO_PARA_CONSTRUIR = 25_000;

/**
 * O fechamento montado por fórmula, sem busca nenhuma.
 *
 * Esta é a resposta rápida, e na maior parte da modalidade ela é também a
 * resposta certa: em 24 das 45 combinações a construção **é** o mínimo
 * comprovado. Medido em 25 dezenas com jogos de 22: a fórmula dá 78 jogos num
 * piscar, e o guloso do motor gasta seis segundos para chegar a 139.
 *
 * ## Por que funciona
 *
 * Um jogo de `k` dezenas é o complemento de `a = P − k`; um sorteio de 15 é o
 * complemento de `b = P − 15`. Então *o jogo contém o sorteio* ⟺ *as `a` que
 * faltam ao jogo estão entre as `b` que faltam ao sorteio*.
 *
 * O que sobra é escolher poucas `a`-uplas que nenhum sorteio consiga evitar, e
 * disso cuida [`turanFaltas`].
 *
 * A garantia vem do argumento, não de uma varredura. O validador independente
 * do aplicativo confere assim mesmo, porque um argumento certo não protege
 * contra um erro de digitação — e conferiu: as 45 combinações da modalidade
 * foram varridas sorteio a sorteio, sem um único descoberto.
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

  if (turanTamanho(pool, a, b, premiadas) > TETO_PARA_CONSTRUIR) return null;

  return turanFaltas(dezenas, a, b, premiadas).map((fora) => {
    const excluir = new Set(fora);
    return dezenas.filter((d) => !excluir.has(d));
  });
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

  const medida = turanTamanho(pool, a, b, premiadas);
  return medida === INVIAVEL ? null : medida;
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
 * cabem 44 das 45 combinações da modalidade prontas de fábrica, contra as 28 de
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

/**
 * Quantos jogos esta configuração vai entregar — antes de entregar.
 *
 * Devolve `{ quantidade, origem, piso, exato }`. `origem` diz de onde o número
 * sai, e é isso que muda o significado dele:
 *
 * - `'minimo'` — há teorema fechado, e a quantidade é o mínimo provado.
 * - `'banco'` — veio de fábrica, achado pelo motor rodando por horas.
 * - `'formula'` — a construção por grupos, calculada na hora. Correta e
 *   instantânea, mas crua: em 25 dezenas com jogos de 19 ela pede 177.100
 *   jogos contra um piso de 1.261.
 * - `'motor'` — nem banco nem fórmula cabem; só se sabe depois de buscar.
 *
 * Precisa do banco já carregado para responder `'banco'`; sem ele, cai na
 * fórmula, que é sempre maior. Quem chama deve ter chamado [`carregarBanco`]
 * antes e repintado quando ele chegar.
 */
export function previsao(pool, jogo, garantia = SORTEIO, premiadas = 1) {
  const { jogos, exato, piso } = minimo(pool, jogo, garantia, premiadas);
  if (exato) return { quantidade: jogos, origem: 'minimo', piso, exato };

  const doBanco =
    garantia === SORTEIO && premiadas === 1
      ? banco?.fechamentos?.[`${pool},${jogo}`]?.length ?? null
      : null;
  if (doBanco) return { quantidade: doBanco, origem: 'banco', piso, exato };

  const daFormula = tamanhoDaConstrucao(pool, jogo, garantia, premiadas);
  if (daFormula && daFormula <= TETO_PARA_CONSTRUIR) {
    return { quantidade: daFormula, origem: 'formula', piso, exato };
  }

  return { quantidade: null, origem: 'motor', piso, exato };
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

/**
 * Este fechamento paga? — e, quando não paga, por que não.
 *
 * ## A pergunta que isto responde, e a que não responde
 *
 * **Não** responde "vale a pena apostar". No longo prazo nenhuma combinação
 * devolve o que custa: o retorno por real é `mult · C(k,15) / C(25,15)`, vai de
 * R$ 0,29 a R$ 0,60, e o número de cartelas **cancela** nessa conta. Otimizar o
 * fechamento não muda uma vírgula disso, e [`economia`] continua sendo quem diz
 * esse número.
 *
 * Responde outra coisa, que depende inteiramente do fechamento: quando as 15
 * caírem dentro do pool, o que se recebe cobre o que se gastou? O fechamento
 * garante `r` cartelas com as 15, que pagam `r · mult`; o custo foi `N`
 * cartelas. Então:
 *
 *     N < r · mult   →  lucra sempre que o sorteio cair no pool
 *     N ≥ r · mult   →  perde mesmo acertando o pool
 *
 * ## Por que o piso entra
 *
 * Porque separa "ainda não conseguimos" de "ninguém vai conseguir". Se o
 * **mínimo matemático** já custa mais que o prêmio, nenhum otimizador salva
 * aquela combinação — e dizer isso é mais útil que deixar o usuário esperando
 * uma melhora que não existe. É o caso de 25 dezenas com jogos de 20: o piso é
 * 317 cartelas para um prêmio de 100×.
 *
 * Devolve `{ classe, multiplicador, folga, faltamCortar, custoDoPiso }`, onde
 * `classe` é uma de:
 *
 * - `'sem-premio'` — garantia menor que 15, que nesta modalidade não compra
 *   prêmio nenhum;
 * - `'sem-cotacao'` — jogos de 24 ou 25 dezenas, que banca nenhuma aceita;
 * - `'lucra'` — `folga` é quanto sobra, em múltiplos da aposta;
 * - `'possivel'` — `faltamCortar` é quantas cartelas precisam sair para cruzar
 *   a linha;
 * - `'impossivel'` — `custoDoPiso` é quantas vezes o prêmio custa o mínimo
 *   matemático.
 */
export function veredito({
  jogo,
  quantidade,
  piso,
  garantia = SORTEIO,
  premiadas = 1,
  cotacao = COTACAO_PADRAO,
}) {
  if (garantia !== SORTEIO) return { classe: 'sem-premio', multiplicador: null };

  const multiplicador = cotacao?.[jogo] ?? null;
  if (!multiplicador) return { classe: 'sem-cotacao', multiplicador: null };

  // Com `r` cartelas premiadas garantidas, o piso do prêmio multiplica por `r`:
  // são `r` bilhetes contendo as 15, cada um pago por inteiro.
  const premio = premiadas * multiplicador;

  if (Number.isFinite(quantidade) && quantidade < premio) {
    return { classe: 'lucra', multiplicador, premio, folga: premio - quantidade };
  }

  // O piso é conferido depois de `lucra` de propósito: se o fechamento já cabe
  // no prêmio, não há o que discutir sobre o mínimo.
  if (Number.isFinite(piso) && piso >= premio) {
    return { classe: 'impossivel', multiplicador, premio, piso, custoDoPiso: piso / premio };
  }

  return {
    classe: 'possivel',
    multiplicador,
    premio,
    piso,
    // Cruzar a linha é ficar **abaixo** do prêmio, não empatar com ele.
    faltamCortar: Number.isFinite(quantidade) ? quantidade - premio + 1 : null,
  };
}

/* ─────────── escolher a configuração pelo bolso ─────────── */

/**
 * O retorno que nenhum fechamento desta dupla passa, com nenhum número de
 * cartelas e nenhuma garantia.
 *
 *     teto = multiplicador · C(jogo,15) / C(pool,15)
 *
 * Sai de uma contagem só: cada cartela de `k` dezenas contém `C(k,15)` dos
 * `C(P,15)` sorteios que cabem no pool, então atender todos `r` vezes exige
 * `N ≥ r · C(P,15)/C(k,15)` cartelas, e o retorno `r·mult/N` fica preso abaixo
 * de `mult · C(k,15)/C(P,15)`. O `r` cancela — é por isso que subir a garantia
 * aproxima do teto e nunca o ultrapassa.
 *
 * ## Para que serve na prática
 *
 * Responde "isto pode pagar algum dia?" sem busca nenhuma, e a resposta é
 * definitiva. Num pool de 25 o sorteio sempre cai dentro, `C(pool,15)` é o
 * universo inteiro, e o teto vira o próprio retorno esperado: de R$ 0,29 a
 * R$ 0,60 conforme o tamanho da cartela. Nenhuma das sete combinações do pool
 * 25 chega a 1, e por isso nenhuma delas paga — com um bilhete premiado, com
 * dez, ou com todos.
 *
 * Devolve `null` quando a banca não cota jogos daquele tamanho.
 */
export function tetoDoRetorno(pool, jogo, cotacao = COTACAO_PADRAO) {
  const multiplicador = cotacao?.[jogo] ?? null;
  if (!multiplicador) return null;
  return (multiplicador * chanceDe(jogo)) / chanceDe(pool);
}

/**
 * Qual fechamento comprar, dado o quanto se pode gastar.
 *
 * ## A pergunta invertida
 *
 * O resto do aplicativo pergunta "quantas cartelas custa garantir isto?". Esta
 * função pergunta o contrário: **dado um orçamento, o que vale a pena comprar?**
 * E trata a garantia como resposta, não como pergunta — varre `premiadas` de 1
 * até o teto de cada dupla, porque é justamente aí que mora o que a busca por
 * uma cartela premiada escondia.
 *
 * O caso que motivou isto: 24 dezenas com jogos de 23. Com uma cartela premiada
 * são 16 jogos para um prêmio de 4×, e o aplicativo dizia "impossível" — o piso
 * já custava mais que o prêmio. Com **nove** premiadas são 24 jogos, todos os
 * que cabem no pool, e o prêmio é 36×: todo sorteio dentro das 24 deixa nove
 * dezenas de fora, e são exatamente essas nove cartelas que o contêm. Paga 1,50×
 * fixo, e o pool acerta 40% dos concursos — a configuração que paga com mais
 * frequência da modalidade inteira, escondida atrás de um padrão.
 *
 * ## Por que a ordenação é por frequência, e não por retorno
 *
 * Ordenar por retorno degenera. O topo vira `17/17`: uma cartela só de 17
 * dezenas, prêmio de 7000×, retorno 7000× — e 0,004% de chance de o pool
 * acertar, o que é comprar um bilhete e chamar de fechamento. O número grande
 * não vem de fechar bem, vem de quase nunca ganhar.
 *
 * A ordem primária é **com que frequência o fechamento paga**, entre os que
 * pagam; o retorno desempata, e o custo desempata o desempate. Quem quiser a
 * outra leitura reordena a lista, que vem inteira.
 *
 * ## O que isto não é
 *
 * Não é conselho de aposta, e o ranking não contém nenhuma combinação com
 * retorno esperado positivo, porque não existe nenhuma: `retornoEsperado` vem
 * junto em cada linha, é sempre menor que 1, e não depende de nada que esta
 * função escolha. O que muda entre uma linha e outra é **quando** se ganha e
 * **quanto** de cada vez.
 *
 * ## O bilhete único, e por que ele ganha quase sempre
 *
 * Num pool de até 23 dezenas a resposta ótima é constrangedora: **uma cartela
 * só**, com as 23 dezenas do pool. Ela paga 4× sempre que o sorteio cai dentro,
 * contra 1,82× do melhor fechamento de 21 dezenas com 33 cartelas — e paga
 * sozinha, sem variação. Não há diversificação a comprar: todas as cartelas de
 * um fechamento ganham e perdem juntas, com o mesmo pool.
 *
 * Fechar só passa a valer quando a banca **não aceita** a cartela do tamanho do
 * pool. É o caso do pool 24: não há cotação para 24 dezenas, então o jeito de
 * apostar nas 24 é aproximá-las com cartelas de 23 — e aí o fechamento aparece
 * como a única forma de comprar aquela frequência de acerto.
 *
 * As linhas trazem `bilheteUnico`, e `minimoDeCartelas` permite pedir só
 * fechamentos de verdade a quem quiser comparar dentro do pool.
 *
 * Devolve `{ opcoes, melhor, semTeto }`, onde `semTeto` lista as duplas
 * descartadas sem sequer olhar a garantia, com o teto de cada uma — é o que
 * permite à tela explicar por que o pool 25 nunca aparece.
 */
export function melhorConfiguracao({
  cotacao = COTACAO_PADRAO,
  orcamento = Infinity,
  valorDoJogo = 1,
  chanceMinima = 0,
  minimoDeCartelas = 1,
  garantia = SORTEIO,
} = {}) {
  const opcoes = [];
  const semTeto = [];

  for (let pool = MENOR_POOL; pool <= MAIOR_POOL; pool++) {
    const chanceDoPool = chanceDe(pool);
    if (chanceDoPool < chanceMinima) continue;

    for (let jogo = MENOR_POOL; jogo <= pool; jogo++) {
      const multiplicador = cotacao?.[jogo] ?? null;
      if (!multiplicador) continue;

      // O teto decide a dupla inteira antes de olhar uma única garantia. É a
      // poda que torna a varredura barata e, mais que isso, é a que dá a
      // resposta honesta para quem insiste numa dupla que não tem como pagar.
      const teto = tetoDoRetorno(pool, jogo, cotacao);
      if (teto <= 1) {
        semTeto.push({ pool, jogo, multiplicador, teto });
        continue;
      }

      for (let premiadas = 1; premiadas <= maximoPremiadas(pool, jogo, garantia); premiadas++) {
        const { quantidade, origem, piso, exato } = previsao(pool, jogo, garantia, premiadas);
        if (quantidade === null || quantidade > orcamento) continue;
        if (quantidade < minimoDeCartelas) continue;

        const premio = premiadas * multiplicador;
        const retorno = premio / quantidade;
        if (retorno <= 1) continue;

        opcoes.push({
          pool,
          jogo,
          premiadas,
          quantidade,
          origem,
          piso,
          exato,
          multiplicador,
          teto,
          chanceDoPool,
          // Jogar o pool inteiro numa cartela só não é fechamento nenhum, e
          // marcar isso evita que a tela venda um bilhete como estratégia.
          bilheteUnico: jogo === pool,
          custo: quantidade * valorDoJogo,
          premioGarantido: premio * valorDoJogo,
          retorno,
          folga: (premio - quantidade) * valorDoJogo,
          // Igual a `mult · chanceDe(jogo)`: o pool cancela, e por isso este
          // número não é afetado por nada que a varredura escolha.
          retornoEsperado: chanceDoPool * teto,
        });
      }
    }
  }

  const fronteira = semDominadas(opcoes);
  fronteira.sort(
    (x, y) =>
      y.chanceDoPool - x.chanceDoPool ||
      y.retorno - x.retorno ||
      x.quantidade - y.quantidade
  );

  return { opcoes: fronteira, melhor: fronteira[0] ?? null, semTeto };
}

/**
 * Tira da lista o que outra linha do **mesmo pool** faz melhor e mais barato.
 *
 * Sem isto a varredura devolve lixo com aparência de opção: em 24 dezenas com
 * jogos de 22, as garantias de 33 a 36 cartelas premiadas custam as mesmas 276
 * cartelas, porque a construção é a mesma família — só a de 36 interessa, as
 * outras três pedem o mesmo dinheiro por menos prêmio. E pagar 132 cartelas por
 * 1,21× não faz sentido quando 24 cartelas do mesmo pool pagam 1,50×.
 *
 * A comparação é dentro do pool de propósito. Entre pools ela seria injusta:
 * um pool maior paga menos por acertar muito mais vezes, e essa troca é a
 * decisão do usuário, não uma dominância.
 */
function semDominadas(opcoes) {
  return opcoes.filter(
    (x) =>
      !opcoes.some(
        (y) =>
          y !== x &&
          y.pool === x.pool &&
          y.quantidade <= x.quantidade &&
          y.retorno >= x.retorno &&
          (y.quantidade < x.quantidade || y.retorno > x.retorno)
      )
  );
}

/**
 * A menor garantia em que esta dupla passa a pagar — ou `null` se nenhuma paga.
 *
 * Separa três situações que a tela mostrava como uma só:
 *
 * - **paga já com uma cartela premiada** — devolve `{ premiadas: 1, … }`;
 * - **paga, mas só pedindo mais** — é o caso de 23 dezenas com jogos de 20, que
 *   empata em 100 cartelas para um prêmio de 100× e vira lucro em 147 cartelas
 *   para 200×. Chamar isso de "não paga" mandava o usuário embora de uma
 *   combinação que paga;
 * - **não paga com garantia nenhuma** — e aí [`tetoDoRetorno`] já resolve sem
 *   varrer nada, porque o teto não depende da garantia.
 */
export function garantiaQuePaga(pool, jogo, cotacao = COTACAO_PADRAO, garantia = SORTEIO) {
  const multiplicador = cotacao?.[jogo] ?? null;
  if (!multiplicador) return null;
  if (tetoDoRetorno(pool, jogo, cotacao) <= 1) return null;

  for (let premiadas = 1; premiadas <= maximoPremiadas(pool, jogo, garantia); premiadas++) {
    const { quantidade, origem, exato } = previsao(pool, jogo, garantia, premiadas);
    const premio = premiadas * multiplicador;
    if (quantidade !== null && quantidade < premio) {
      return { premiadas, quantidade, premio, origem, exato, retorno: premio / quantidade };
    }
  }
  return null;
}
