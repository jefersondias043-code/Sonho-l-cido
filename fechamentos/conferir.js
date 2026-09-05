// Varredura exaustiva, no aparelho de quem duvidar.
//
// A promessa do aplicativo é "está garantido", e quem promete deve poder ser
// cobrado na hora. O que roda aqui não consulta o catálogo, não confia no índice
// e não fala com servidor nenhum: percorre **todos** os resultados possíveis
// dentro das dezenas marcadas e mede o pior caso.
//
// O caminho óbvio — para cada um dos `C(v,15)` sorteios, procurar um bilhete que
// o atenda — custa `sorteios × bilhetes`, e no pior caso do catálogo isso dá
// catorze bilhões de operações. Aqui o laço é ao contrário: para cada bilhete
// geram-se **só** os sorteios que ele atende (escolhendo `i ≥ t` dezenas dentro
// dele e as `15 − i` restantes fora) e marca-se cada um num vetor de bits
// indexado pela própria máscara do sorteio. São vinte milhões de operações no
// lugar de catorze bilhões, e no fim basta contar os bits: se são `C(v,15)`,
// não sobrou sorteio nenhum descoberto.
//
// Sem web worker: o laço cede o processador a cada fatia, então a tela continua
// respondendo enquanto ele roda.

const FATIA = 2000000;

/// Percorre todos os sorteios possíveis e devolve o pior resultado: quantos
/// existem, quantos acertos o melhor bilhete faz no pior deles, em quantos
/// alguém acerta os 15, e — se a promessa falhar — um sorteio descoberto.
export async function varrer(mascaras, v, garantia, sorteio = 15) {
  const sorteios = binomial(v, sorteio);
  const comQuinze = quantosBits(await marcar(mascaras, v, sorteio, sorteio));

  let pior = garantia - 1;
  let descoberto = null;
  for (let alvo = garantia; alvo <= sorteio; alvo++) {
    const bits = await marcar(mascaras, v, alvo, sorteio);
    if (quantosBits(bits) < sorteios) {
      if (alvo === garantia) descoberto = primeiroDescoberto(bits, v, sorteio);
      break;
    }
    pior = alvo;
  }

  // A promessa não se sustentou. Aí sim vale medir o sorteio que a derrubou,
  // um só, do jeito caro — para dizer exatamente quanto ele rende.
  if (descoberto !== null) {
    pior = Math.max(0, ...mascaras.map((b) => contar(b & descoberto)));
  }
  return { sorteios, pior, comQuinze, descoberto };
}

/// Marca todos os sorteios em que algum bilhete faz `alvo` acertos ou mais.
async function marcar(mascaras, v, alvo, sorteio) {
  const bits = new Uint32Array(2 ** v / 32);
  let desdeAPausa = 0;

  for (const bilhete of mascaras) {
    const dentro = [];
    const fora = [];
    for (let i = 0; i < v; i++) (bilhete >>> i & 1 ? dentro : fora).push(i);

    const menor = Math.max(alvo, sorteio - fora.length);
    for (let i = menor; i <= Math.min(sorteio, dentro.length); i++) {
      // O lado de fora é pequeno e vira lista; o de dentro chega a mais de um
      // milhão de máscaras e é percorrido sem nunca virar lista — materializá-lo
      // custava mais em alocação do que a marcação inteira.
      const dali = subconjuntos(fora, sorteio - i);
      combinar(dentro, i, (a) => {
        for (let j = 0; j < dali.length; j++) {
          const m = a | dali[j];
          bits[m >>> 5] |= 1 << (m & 31);
        }
      });
      desdeAPausa += binomial(dentro.length, i) * dali.length;
    }

    if (desdeAPausa >= FATIA) {
      desdeAPausa = 0;
      await new Promise((pronto) => setTimeout(pronto, 0));
    }
  }
  return bits;
}

/// Chama `aoAchar` com a máscara de cada subconjunto de `tamanho` elementos.
function combinar(elementos, tamanho, aoAchar, mascara = 0, i = 0) {
  if (tamanho === 0) return aoAchar(mascara);
  if (elementos.length - i < tamanho) return;
  combinar(elementos, tamanho - 1, aoAchar, mascara | (1 << elementos[i]), i + 1);
  combinar(elementos, tamanho, aoAchar, mascara, i + 1);
}

function subconjuntos(elementos, tamanho) {
  const saida = [];
  combinar(elementos, tamanho, (m) => saida.push(m));
  return saida;
}

/// O primeiro sorteio que ninguém atende, em ordem crescente de máscara.
function primeiroDescoberto(bits, v, sorteio) {
  const teto = 1 << v;
  let x = (1 << sorteio) - 1;
  while (x < teto) {
    if (!(bits[x >>> 5] >>> (x & 31) & 1)) return x;
    const menor = x & -x;
    const soma = x + menor;
    x = soma | ((((x ^ soma) >>> 2) / menor) | 0);
  }
  return null;
}

function quantosBits(bits) {
  let total = 0;
  for (let i = 0; i < bits.length; i++) {
    let x = bits[i];
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    total += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

const contar = (n) => { let c = 0; for (let m = n; m; m &= m - 1) c++; return c; };

function binomial(n, k) {
  let r = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) r = (r * (n - i)) / (i + 1);
  return k > n ? 0 : Math.round(r);
}

/// Quantos acertos cada bilhete fez num sorteio de verdade. `bilhetes` são
/// listas de dezenas; `sorteadas`, as 15 que saíram.
export function contraOSorteio(bilhetes, sorteadas) {
  const saiu = new Set(sorteadas);
  const faixas = new Map();
  const porBilhete = bilhetes.map((b) => {
    const acertos = b.reduce((soma, d) => soma + (saiu.has(d) ? 1 : 0), 0);
    if (acertos >= 11) faixas.set(acertos, (faixas.get(acertos) ?? 0) + 1);
    return acertos;
  });
  return { porBilhete, faixas, melhor: porBilhete.length ? Math.max(...porBilhete) : 0 };
}

/// Quanto voltou: soma dos prêmios das faixas premiadas.
export function retorno(faixas, premios) {
  let total = 0;
  for (const [acertos, quantos] of faixas) total += quantos * (premios[acertos] ?? 0);
  return total;
}
