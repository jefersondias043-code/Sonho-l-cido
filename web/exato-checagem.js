/*
 * Conferir um fechamento do Construtor Exato contra um resultado — e dizer
 * quanto isso custou e quanto pagou.
 *
 * Este módulo não desenha nada e não guarda estado: recebe cartelas, um
 * resultado e uma tabela de preços, devolve contas. É o que permite testá-lo
 * sem navegador e reusá-lo dentro de um worker, que é onde as simulações
 * longas rodam.
 *
 * ## Por que não dá para reusar `checagem.js`
 *
 * Aquele módulo é da Lotinha, e a Lotinha é uma modalidade só: 25 dezenas,
 * sorteio de 15, faixas de 11 a 15, e uma única faixa que paga. Aqui nada
 * disso é fixo. O Construtor Exato trabalha com cinco números escolhidos por
 * quem usa — universo, tamanho do jogo, tamanho do sorteio, garantia e quantas
 * cartelas premiadas — e as faixas de acerto **saem** desses números em vez de
 * estarem escritas no código.
 *
 * ## A representação: uma cartela é um número
 *
 * O universo do Exato vai até 31, então uma cartela inteira cabe num inteiro de
 * 32 bits — o número `d` é o bit `d − 1`. Contar acertos vira
 * `popcount(cartela & sorteio)`: duas instruções, em vez de percorrer a cartela
 * procurando cada número numa lista.
 *
 * A diferença não é cosmética. Dez mil sorteios sobre um fechamento de vinte e
 * seis mil cartelas são 268 milhões de comparações; com máscaras isso leva
 * segundos, e com `Array.includes` levaria minutos e travaria a tela.
 *
 * ## O que este módulo não decide
 *
 * Quanto vale cada faixa. Na Lotinha só 15 paga, e essa regra é da modalidade;
 * aqui não há modalidade nenhuma, então os valores vêm de quem usa. Um prêmio
 * não informado vale zero, e zero é a resposta honesta: o aplicativo não sabe
 * quanto a sua loteria paga e não vai inventar.
 */

/** O maior universo que a tela do Exato aceita — e o que cabe num int32. */
export const UNIVERSO_MAXIMO = 31;

/**
 * Quais faixas de acerto mostrar, para um problema qualquer.
 *
 * O topo é fácil: com jogos de `k` e sorteios de `j`, ninguém acerta mais que
 * `min(j, k)`. O piso é que exige uma decisão, e ela é esta:
 *
 *   - **a garantia entra**, quando cabe. É a faixa que o fechamento promete, e
 *     uma conferência que a escondesse esconderia o que há para conferir;
 *   - **nunca menos de cinco faixas.** Com garantia colada no topo — "saem 15,
 *     garanto 15", o caso mais comum — só a faixa premiada apareceria, e as
 *     quatro logo abaixo são o que diz o quanto o fechamento chegou perto;
 *   - **nunca mais de dez**, e este limite vence os outros dois. Uma garantia
 *     muito baixa abriria quinze linhas de tabela e quinze campos de preço, e
 *     ninguém preenche quinze campos. Quando a garantia fica de fora por causa
 *     dele, a linha do rodapé — "abaixo de N" — continua fechando a soma com o
 *     total, então nenhuma cartela some da conta.
 *
 * Na Lotinha (`k=17, j=15, t=15`) isto devolve exatamente 11 a 15, que é a
 * tabela que aquela tela mostra há tempo. Não é coincidência: a regra foi
 * escolhida para generalizar o caso conhecido, não para inventar outro.
 */
export function faixasDe({ k, j, t }) {
  const maximo = Math.min(j, k);
  const comGarantia = Math.min(t, maximo - 4);
  const piso = Math.max(0, maximo - 9, comGarantia);

  const lista = [];
  for (let a = piso; a <= maximo; a += 1) lista.push(a);
  return { piso, maximo, lista, garantia: t };
}

/**
 * Converte uma lista de números em máscara de bits.
 *
 * Números fora de `1..31` são ignorados em vez de deslocarem bits para fora do
 * inteiro — um resultado estragado vindo do armazenamento não pode corromper a
 * conta dos outros.
 */
export function mascaraDe(numeros) {
  let m = 0;
  for (const d of numeros) {
    if (Number.isInteger(d) && d >= 1 && d <= UNIVERSO_MAXIMO) m |= 1 << (d - 1);
  }
  return m;
}

/** Quantos bits ligados — o algoritmo de Wegner, sem laço sobre 32 posições. */
export function bitsEm(n) {
  let conta = 0;
  let x = n;
  while (x) {
    x &= x - 1;
    conta += 1;
  }
  return conta;
}

/**
 * As máscaras de um fechamento inteiro, calculadas uma vez.
 *
 * O motor devolve cartelas em **posições** — `1` é o primeiro número marcado,
 * `2` o segundo. A tradução para os números de verdade acontece aqui, e é ela
 * que faz a conferência falar a mesma língua do resultado que a pessoa digita.
 *
 * Guardar num `Int32Array` e não num array comum importa: são dezenas de
 * milhares de entradas percorridas dez mil vezes numa simulação longa.
 */
export function mascarasDe(cartelas, numeros) {
  const saida = new Int32Array(cartelas.length);
  for (let i = 0; i < cartelas.length; i += 1) {
    let m = 0;
    for (const p of cartelas[i]) {
      const d = numeros[p - 1];
      if (Number.isInteger(d) && d >= 1 && d <= UNIVERSO_MAXIMO) m |= 1 << (d - 1);
    }
    saida[i] = m;
  }
  return saida;
}

/**
 * Lê os números que a pessoa digitou.
 *
 * Aceita qualquer separador — espaço, vírgula, ponto e vírgula, quebra de linha
 * — porque copiar um resultado de outro lugar traz o separador de lá, e recusar
 * por causa disso seria implicância.
 *
 * O resultado é conferido contra o **universo inteiro**, e não contra os
 * números escolhidos: um sorteio de verdade sai de todos os números da
 * modalidade, e nada obriga o que saiu a estar entre os que você jogou. Recusar
 * um resultado oficial por conter um número que a pessoa não marcou seria
 * recusar o caso mais comum de todos.
 *
 * Devolve `{ numeros }` ou `{ erro }`. O erro é uma frase pronta: quem chama
 * mostra, não interpreta.
 */
export function interpretarResultado(texto, { universo, sorteio }) {
  const lidos = (String(texto ?? '').match(/\d+/g) ?? []).map(Number);

  if (lidos.length === 0) {
    return { erro: `Digite os ${sorteio} números do resultado.` };
  }
  if (lidos.length !== sorteio) {
    return {
      erro: `Este sorteio tem ${sorteio} números, e você digitou ${lidos.length}.`,
    };
  }

  const fora = lidos.filter((n) => n < 1 || n > universo);
  if (fora.length) {
    return {
      erro:
        `Os números vão de 1 a ${universo}, e ` +
        `${[...new Set(fora)].join(', ')} está fora.`,
    };
  }

  const repetidos = [...new Set(lidos.filter((n, i) => lidos.indexOf(n) !== i))];
  if (repetidos.length) {
    return {
      erro: `Um sorteio não repete número, e ${repetidos.join(', ')} apareceu duas vezes.`,
    };
  }

  return { numeros: [...lidos].sort((a, b) => a - b) };
}

/**
 * Um sorteio ao acaso: `quantos` números distintos tirados de `urna`.
 *
 * Embaralhamento de Fisher-Yates e corte no início. É o único jeito que dá a
 * mesma probabilidade a toda combinação — sortear um por um e descartar
 * repetidos dá o mesmo conjunto, mas com um laço que pode não terminar.
 */
export function sortearDe(urna, quantos, aleatorio = Math.random) {
  const copia = [...urna];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, quantos).sort((a, b) => a - b);
}

/** A urna inteira da modalidade: 1 a `universo`. */
export function urnaDoUniverso(universo) {
  return Array.from({ length: universo }, (_, i) => i + 1);
}

/**
 * Confere um fechamento contra um resultado.
 *
 * Devolve:
 *
 * - `contagem[a]` — quantas cartelas fizeram exatamente `a` acertos, para todo
 *   `a` de 0 ao tamanho do jogo;
 * - `porFaixa` — só as faixas que a tela mostra, já em ordem;
 * - `abaixo` — quantas ficaram abaixo da menor faixa mostrada, para que a soma
 *   da tabela feche com o total e ninguém precise confiar;
 * - `indices` — quais cartelas, por faixa mostrada. É o que permite ver as
 *   cartelas premiadas em vez de só saber que existem;
 * - `melhor` — o maior número de acertos alcançado, ou `-1` sem cartelas.
 */
export function conferir(mascaras, resultado, faixas) {
  const alvo = mascaraDe(resultado);
  const contagem = new Array(UNIVERSO_MAXIMO + 1).fill(0);
  const indices = new Map(faixas.lista.map((a) => [a, []]));

  let melhor = -1;
  for (let i = 0; i < mascaras.length; i += 1) {
    const acertos = bitsEm(mascaras[i] & alvo);
    contagem[acertos] += 1;
    if (acertos > melhor) melhor = acertos;
    if (acertos >= faixas.piso && indices.has(acertos)) indices.get(acertos).push(i);
  }

  let abaixo = 0;
  for (let a = 0; a < faixas.piso; a += 1) abaixo += contagem[a];

  return {
    contagem,
    porFaixa: faixas.lista.map((a) => ({ acertos: a, quantas: contagem[a] })),
    abaixo,
    indices,
    melhor,
    total: mascaras.length,
    resultado: [...resultado].sort((a, b) => a - b),
  };
}

/* ─────────── o dinheiro ─────────── */

/**
 * Um preço lido de um campo de tela.
 *
 * Vírgula é separador decimal em português, e quem digita "2,50" quer dois
 * reais e cinquenta. Aceitar só o ponto transformaria isso em duzentos e
 * cinquenta — um erro de cem vezes, silencioso, no número que mais importa.
 */
export function valorDe(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) && texto > 0 ? texto : 0;
  const limpo = String(texto ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * O que um sorteio conferido custou e pagou.
 *
 * `premios` é um mapa de acertos para valor unitário. Faixa sem valor vale
 * zero: o aplicativo não sabe quanto a sua loteria paga, e chutar seria pior
 * que não responder.
 *
 * O custo é o do fechamento inteiro — todas as cartelas, porque todas foram
 * compradas. Contar só as premiadas daria um lucro que não existe.
 */
export function dinheiroDoSorteio(conferencia, { custoUnitario = 0, premios = new Map() } = {}) {
  const linhas = conferencia.porFaixa.map(({ acertos, quantas }) => {
    const valor = premios.get(acertos) ?? 0;
    return { acertos, quantas, valor, total: quantas * valor };
  });

  const premioTotal = linhas.reduce((s, l) => s + l.total, 0);
  const custoTotal = conferencia.total * custoUnitario;

  return {
    linhas,
    custoTotal,
    premioTotal,
    liquido: premioTotal - custoTotal,
    cartelas: conferencia.total,
    custoUnitario,
    // Sem preço nenhum informado a tela não deve fingir um balanço de zero
    // reais: ela deve dizer que o dinheiro não foi configurado.
    configurado: custoUnitario > 0 || linhas.some((l) => l.valor > 0),
  };
}

/**
 * Muitos sorteios independentes, e o que se aprende com eles.
 *
 * Para cada faixa devolve: em quantos sorteios apareceu ao menos uma cartela, a
 * soma para tirar a média, e o maior e o menor número de cartelas num mesmo
 * sorteio.
 *
 * Devolve também `porSorteio`: a contagem de cada faixa em cada sorteio, um
 * `Int32Array` achatado. É o que permite **mudar os preços sem simular de
 * novo** — trocar o valor de uma faixa refaz o balanço inteiro em
 * milissegundos, em vez de repetir dez mil sorteios. Sem isso, experimentar
 * dois cenários de premiação custaria duas simulações, e ninguém experimentaria.
 *
 * `aoProgresso` é chamado a cada `lote` sorteios com quantos já foram — é o que
 * permite mostrar andamento sem que quem chama precise saber do laço.
 *
 * **Isto é simulação, não previsão.** Cada sorteio é sorteado do zero, com a
 * mesma chance para toda combinação; o que sai daqui descreve o comportamento
 * do fechamento, não o próximo resultado da loteria.
 */
export function simularVarios(
  mascaras,
  quantos,
  { urna, sorteio, faixas, aleatorio = Math.random, aoProgresso = null, lote = 200 } = {}
) {
  const lista = faixas.lista;
  const piso = faixas.piso;
  const largura = lista.length;
  const porSorteio = new Int32Array(quantos * largura);

  const estatistica = lista.map((a) => ({
    acertos: a,
    sorteiosComAlguma: 0,
    soma: 0,
    maximo: 0,
    minimo: Infinity,
  }));

  const conta = new Int32Array(largura);

  for (let s = 0; s < quantos; s += 1) {
    const alvo = mascaraDe(sortearDe(urna, sorteio, aleatorio));

    conta.fill(0);
    for (let i = 0; i < mascaras.length; i += 1) {
      const acertos = bitsEm(mascaras[i] & alvo);
      // `acertos - piso` só é índice válido dentro da janela mostrada; acima do
      // topo é impossível por construção, abaixo do piso não interessa.
      if (acertos >= piso) conta[acertos - piso] += 1;
    }

    porSorteio.set(conta, s * largura);

    for (let f = 0; f < largura; f += 1) {
      const e = estatistica[f];
      const n = conta[f];
      e.soma += n;
      if (n > 0) e.sorteiosComAlguma += 1;
      if (n > e.maximo) e.maximo = n;
      if (n < e.minimo) e.minimo = n;
    }

    if (aoProgresso && (s + 1) % lote === 0) aoProgresso(s + 1, quantos);
  }

  for (const e of estatistica) {
    if (e.minimo === Infinity) e.minimo = 0;
    e.media = quantos > 0 ? e.soma / quantos : 0;
    e.proporcao = quantos > 0 ? e.sorteiosComAlguma / quantos : 0;
  }

  if (aoProgresso) aoProgresso(quantos, quantos);

  return {
    sorteios: quantos,
    cartelas: mascaras.length,
    faixas: estatistica,
    lista,
    porSorteio,
  };
}

/**
 * O balanço de uma simulação inteira, aos preços de agora.
 *
 * Roda sobre `porSorteio`, então trocar o valor de uma faixa e chamar de novo
 * custa milissegundos — a simulação não se repete.
 *
 * `melhor` e `pior` são o líquido do melhor e do pior sorteio, e não a soma:
 * é a diferença entre "no total dá para viver disso" e "num sorteio bom dá".
 * `comLucro` conta em quantos sorteios o prêmio superou o custo, que é a
 * pergunta que o usuário faz de verdade.
 */
export function dinheiroDaSimulacao(resumo, { custoUnitario = 0, premios = new Map() } = {}) {
  const largura = resumo.lista.length;
  const valores = resumo.lista.map((a) => premios.get(a) ?? 0);
  const custoPorSorteio = resumo.cartelas * custoUnitario;

  let recebido = 0;
  let melhor = -Infinity;
  let pior = Infinity;
  let comLucro = 0;
  let empatados = 0;

  for (let s = 0; s < resumo.sorteios; s += 1) {
    let premio = 0;
    for (let f = 0; f < largura; f += 1) {
      premio += resumo.porSorteio[s * largura + f] * valores[f];
    }
    recebido += premio;
    const liquido = premio - custoPorSorteio;
    if (liquido > melhor) melhor = liquido;
    if (liquido < pior) pior = liquido;
    if (liquido > 0) comLucro += 1;
    else if (liquido === 0) empatados += 1;
  }

  const investido = custoPorSorteio * resumo.sorteios;

  // A soma por faixa, para a tabela dizer de onde veio cada real.
  const porFaixa = resumo.lista.map((a, f) => {
    const cartelas = resumo.faixas[f].soma;
    return { acertos: a, cartelas, valor: valores[f], total: cartelas * valores[f] };
  });

  return {
    porFaixa,
    custoPorSorteio,
    investido,
    recebido,
    liquido: recebido - investido,
    melhor: resumo.sorteios > 0 ? melhor : 0,
    pior: resumo.sorteios > 0 ? pior : 0,
    comLucro,
    empatados,
    mediaRecebida: resumo.sorteios > 0 ? recebido / resumo.sorteios : 0,
    mediaLiquida: resumo.sorteios > 0 ? (recebido - investido) / resumo.sorteios : 0,
    // Quanto voltou para cada real gasto. Sem custo informado não há retorno a
    // calcular, e `null` obriga a tela a dizer isso em vez de mostrar zero.
    retorno: investido > 0 ? recebido / investido : null,
    configurado: custoUnitario > 0 || valores.some((v) => v > 0),
  };
}
