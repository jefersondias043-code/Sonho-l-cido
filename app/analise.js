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
// popcount: mil sorteios contra as 3.634 cartelas do maior fechamento são 3,6
// milhões de operações de uma instrução, em vez de 54 milhões de comparações de
// número — 85 ms, ou 158 ms com o chute do lado.

// Uma palavra para cada coisa, aqui e na tela: **cartela** é o papel com `k`
// dezenas — é o que este módulo chama de bilhete no nome das variáveis, por
// história —, **aposta** é uma das `C(k,15)` apostas simples de 15 dezenas que
// cabem dentro de uma cartela, e **fechamento** é o conjunto delas. A distinção
// só aparece em `premioDoBilhete`, e é lá que ela paga.

/// Quantos bits ligados — quantos acertos, depois do `and`.
export function contarBits(n) {
  let c = 0;
  for (let m = n; m; m &= m - 1) c++;
  return c;
}

/// `C(n, k)`. Multiplicação e divisão alternadas para o valor intermediário não
/// estourar: os que interessam aqui vão até `C(25,15)`, que cabe folgado.
export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/// Quantas apostas simples de 15 dezenas, dentro de um bilhete de `k`, fazem
/// exatamente `i` acertos quando o bilhete cruza `j` dezenas com o sorteio.
///
/// Um bilhete de mais de 15 dezenas **é** o conjunto de todas as `C(k,15)`
/// apostas simples que cabem dentro dele. É assim que a lotérica cobra — um
/// bilhete de 16 custa R$ 56,00, que são 16 × R$ 3,50 — e, porque é assim que
/// cobra, é assim que paga: um bilhete de 16 com 14 acertos não paga uma
/// catorze, paga **duas catorzes e catorze trezes**.
///
/// Escolher `i` das `j` certas e as `15 − i` restantes das `k − j` erradas.
export function apostasComAcertos(k, j, i, sorteio = 15) {
  return binomial(j, i) * binomial(k - j, sorteio - i);
}

/// O que um bilhete de `k` dezenas com `j` acertos paga, pela tabela dada.
///
/// Para `k = 15` isto é exatamente `premios[j]` — a soma tem um termo só, e o
/// caso comum não muda. Para `k > 15` é a diferença entre o que o aplicativo
/// dizia e o que a lotérica deposita.
export function premioDoBilhete(k, j, premios, sorteio = 15) {
  let total = 0;
  for (const faixa of Object.keys(premios)) {
    const i = Number(faixa);
    total += apostasComAcertos(k, j, i, sorteio) * premios[faixa];
  }
  return total;
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

/// Quanto uma rodada de faixas paga, para bilhetes de `k` dezenas.
export function premioDe(faixas, premios, k = 15) {
  let total = 0;
  for (const [acertos, quantas] of faixas) total += quantas * premioDoBilhete(k, acertos, premios);
  return total;
}

/// Bilhetes tirados no chute: o mesmo tamanho e a mesma quantidade, do mesmo
/// pool. É o que a pessoa compraria com o mesmo dinheiro sem fechamento nenhum,
/// e é contra isto que o fechamento tem de se justificar.
export function bilhetesAoAcaso(v, k, quantos, aleatorio = Math.random) {
  const posicoes = Array.from({ length: v }, (_, i) => i);
  const saida = [];
  for (let i = 0; i < quantos; i++) {
    let m = 0;
    for (const p of sortearResultado(posicoes, k, aleatorio)) m |= 1 << p;
    saida.push(m);
  }
  return saida;
}

/// O que se acumula de um conjunto de bilhetes ao longo dos sorteios.
const novoPlacar = () => ({ faixas: new Map(), sorteiosComFaixa: new Map(),
  distribuicao: new Map(), melhor: 0, melhorSorteio: null, premio: 0, premiadas: 0,
  alcancaram: 0 });

function anotar(placar, mascaras, sorteio, sorteadas, premios, garantia, k) {
  const r = umSorteio(mascaras, sorteio);
  for (const [acertos, quantas] of r.faixas) {
    placar.faixas.set(acertos, (placar.faixas.get(acertos) ?? 0) + quantas);
    placar.sorteiosComFaixa.set(acertos, (placar.sorteiosComFaixa.get(acertos) ?? 0) + 1);
    placar.premiadas += quantas;
  }
  placar.premio += premioDe(r.faixas, premios, k);
  placar.distribuicao.set(r.melhor, (placar.distribuicao.get(r.melhor) ?? 0) + 1);
  if (garantia && r.melhor >= garantia) placar.alcancaram++;
  if (r.melhor > placar.melhor) [placar.melhor, placar.melhorSorteio] = [r.melhor, sorteadas];
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
  dentroDoPool = false, premios = {}, custo = 0, garantia = 0, contra = null,
  k = sorteio, aleatorio = Math.random }) {
  const ordenadas = [...dezenas].sort((a, b) => a - b);
  const urna = dentroDoPool
    ? ordenadas
    : Array.from({ length: universo }, (_, i) => i + 1);

  const meu = novoPlacar();
  // O mesmo número de bilhetes do mesmo tamanho, tirados no chute do mesmo
  // pool, e — o que faz a comparação valer — contra **os mesmos sorteios**.
  // Comparar contra outros sorteios mediria o acaso dos sorteios, não a
  // diferença entre os dois jeitos de escolher bilhete.
  const rival = contra ? novoPlacar() : null;
  let caiuNoPool = 0;

  for (let i = 0; i < quantos; i++) {
    const sorteadas = sortearResultado(urna, sorteio, aleatorio);
    const m = mascaraDoSorteio(sorteadas, ordenadas);
    if (contarBits(m) === sorteio) caiuNoPool++;
    anotar(meu, mascaras, m, sorteadas, premios, garantia, k);
    if (rival) anotar(rival, contra, m, sorteadas, premios, garantia, k);
  }

  const gasto = custo * quantos;
  const fechar = (p) => ({ ...p, gasto, saldo: p.premio - gasto });
  return { ...fechar(meu), quantos, caiuNoPool, dentroDoPool, garantia, k,
    rival: rival && fechar(rival) };
}
