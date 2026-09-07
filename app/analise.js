// Analisar o fechamento que já está na mão: quanto ele acerta, com que
// frequência, e o que isso dá em dinheiro.
//
// Nada aqui resolve fechamento nenhum — resolver é procurar **quais** bilhetes
// usar, e isso segue inteiro no motor em Rust, fora do aparelho. O que se faz
// aqui é contar acertos de bilhetes que já existem: trabalho linear sobre o que
// o catálogo entregou pronto.
//
// A conta é sobre máscaras de bit, e não sobre listas de dezenas. Um sorteio
// vira uma máscara sobre as posições do pool, e cada bilhete custa um `and` e um
// popcount: mil sorteios contra 3.678 bilhetes são 3,7 milhões de operações de
// uma instrução, em vez de 55 milhões de comparações de número.

/// Quantos bits ligados — quantos acertos, depois do `and`.
export function contarBits(n) {
  let c = 0;
  for (let m = n; m; m &= m - 1) c++;
  return c;
}

/// Um sorteio ao acaso: `quantas` dezenas distintas tiradas de `de`.
///
/// Nenhuma dezena é mais provável que outra, e a simulação não pode fingir que
/// alguma é. Embaralhamento de Fisher–Yates sobre uma cópia, que é uniforme; o
/// gerador entra por parâmetro para o teste poder fixá-lo.
export function sortearResultado(de, quantas, aleatorio = Math.random) {
  const urna = [...de];
  for (let i = urna.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [urna[i], urna[j]] = [urna[j], urna[i]];
  }
  return urna.slice(0, quantas).sort((a, b) => a - b);
}

/// O sorteio como máscara sobre as posições do pool. Dezena sorteada que está
/// fora do pool simplesmente não acende bit nenhum — é o que faz a conta valer
/// para o sorteio da vida real, em que boa parte do resultado cai fora.
export function mascaraDoSorteio(sorteadas, ordenadas) {
  let m = 0;
  const posicao = new Map(ordenadas.map((d, i) => [d, i]));
  for (const d of sorteadas) {
    const i = posicao.get(d);
    if (i !== undefined) m |= 1 << i;
  }
  return m;
}

/// Um sorteio contra o fechamento inteiro: quantas cartelas em cada faixa, e
/// qual foi o melhor bilhete.
export function umSorteio(mascaras, sorteio) {
  const faixas = new Map();
  let melhor = 0;
  for (const b of mascaras) {
    const acertos = contarBits(b & sorteio);
    if (acertos > melhor) melhor = acertos;
    if (acertos >= 11) faixas.set(acertos, (faixas.get(acertos) ?? 0) + 1);
  }
  return { faixas, melhor };
}

/// Quanto uma rodada de faixas paga.
export function premioDe(faixas, premios) {
  let total = 0;
  for (const [acertos, quantas] of faixas) total += quantas * (premios[acertos] ?? 0);
  return total;
}

/// Muitos sorteios de uma vez, consolidados.
///
/// `dentroDoPool` escolhe a pergunta, e as duas são legítimas e diferentes:
///
///   - `false` é o concurso da vida real, sorteado entre as 25. A garantia do
///     fechamento quase nunca se aplica, porque ela só vale quando as 15 caem
///     todas no pool — e é isso que o número tem de mostrar, ou a simulação
///     vira propaganda.
///   - `true` sorteia **dentro** do pool: são exatamente os concursos em que a
///     garantia vale, e servem para ver a promessa se cumprir.
export function simular({ mascaras, dezenas, universo = 25, sorteio = 15, quantos,
  dentroDoPool = false, premios = {}, custo = 0, aleatorio = Math.random }) {
  const ordenadas = [...dezenas].sort((a, b) => a - b);
  const urna = dentroDoPool
    ? ordenadas
    : Array.from({ length: universo }, (_, i) => i + 1);

  const faixas = new Map();          // acertos → quantas cartelas, somando tudo
  const sorteiosComFaixa = new Map();// acertos → em quantos sorteios houve ao menos uma
  const distribuicao = new Map();    // melhor bilhete do sorteio → quantos sorteios
  let melhor = 0;
  let premio = 0;
  let premiadas = 0;
  let caiuNoPool = 0;
  let melhorSorteio = null;

  for (let i = 0; i < quantos; i++) {
    const sorteadas = sortearResultado(urna, sorteio, aleatorio);
    const m = mascaraDoSorteio(sorteadas, ordenadas);
    if (contarBits(m) === sorteio) caiuNoPool++;
    const r = umSorteio(mascaras, m);
    for (const [acertos, quantas] of r.faixas) {
      faixas.set(acertos, (faixas.get(acertos) ?? 0) + quantas);
      sorteiosComFaixa.set(acertos, (sorteiosComFaixa.get(acertos) ?? 0) + 1);
      premiadas += quantas;
    }
    premio += premioDe(r.faixas, premios);
    distribuicao.set(r.melhor, (distribuicao.get(r.melhor) ?? 0) + 1);
    if (r.melhor > melhor) [melhor, melhorSorteio] = [r.melhor, sorteadas];
  }

  const gasto = custo * quantos;
  return { quantos, faixas, sorteiosComFaixa, distribuicao, melhor, melhorSorteio,
    premiadas, premio, gasto, saldo: premio - gasto, caiuNoPool, dentroDoPool };
}
