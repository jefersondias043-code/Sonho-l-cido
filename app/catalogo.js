// Busca e cache dos arquivos do catálogo.
//
// O catálogo é estático: 330 combinações resolvidas e conferidas antes de
// existirem, um arquivo por fechamento. Este módulo só sabe baixar, conferir a
// soma e traduzir posições em dezenas. Nada aqui calcula fechamento nenhum.

const guardados = new Map();
let raiz = 'catalogo/';

export function usarRaiz(nova) {
  raiz = nova;
}

async function baixar(caminho) {
  const resposta = await fetch(raiz + caminho, { cache: 'default' });
  if (!resposta.ok) throw new Error(`${caminho}: ${resposta.status}`);
  return resposta.json();
}

/// FNV-1a de 32 bits — a mesma que o gerador gravou no índice.
export function somaDeVerificacao(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/// O índice, com as 330 linhas abertas em objetos.
export async function carregarIndice() {
  if (guardados.has('indice')) return guardados.get('indice');
  const bruto = await baixar('indice.json');
  const indice = {
    versao: bruto.versao,
    sorteio: bruto.sorteio,
    universo: bruto.universo,
    entradas: bruto.entradas.map(([v, k, t, piso, jogos, provado, metodo, soma]) => ({
      v,
      k,
      t,
      piso,
      jogos,
      provado: provado === 1,
      metodo: bruto.metodos[metodo],
      soma,
    })),
  };
  guardados.set('indice', indice);
  return indice;
}

export async function carregarPrecos() {
  if (!guardados.has('precos')) guardados.set('precos', await baixar('precos.json'));
  return guardados.get('precos');
}

export async function carregarAcaso() {
  if (!guardados.has('acaso')) guardados.set('acaso', await baixar('acaso.json'));
  return guardados.get('acaso');
}

/// Os bilhetes de um fechamento, como máscaras sobre as posições do pool.
///
/// A soma de verificação é conferida contra o índice antes de qualquer coisa:
/// CDN serve arquivo velho, cache guarda arquivo truncado, e um fechamento
/// truncado é um fechamento furado com cara de fechamento.
export async function carregarFechamento(entrada) {
  const chave = `${entrada.v}-${entrada.k}-${entrada.t}`;
  if (guardados.has(chave)) return guardados.get(chave);

  const arquivo = await baixar(`f/${chave}.json`);
  if (somaDeVerificacao(arquivo.bilhetes.join(',')) !== entrada.soma) {
    throw new Error('o arquivo do fechamento não confere com o índice');
  }
  if (arquivo.bilhetes.length !== entrada.jogos) {
    throw new Error('o arquivo do fechamento tem outra quantidade de bilhetes');
  }

  const mascaras = arquivo.bilhetes.map((palavra) => parseInt(palavra, 36));
  for (const m of mascaras) {
    if (contarBits(m) !== entrada.k || m >>> entrada.v !== 0) {
      throw new Error('há bilhete com dezenas fora do pool');
    }
  }
  guardados.set(chave, mascaras);
  return mascaras;
}

export function contarBits(n) {
  let c = 0;
  for (let m = n; m; m &= m - 1) c++;
  return c;
}

/// Traduz máscaras de posição para as dezenas que a pessoa marcou.
///
/// O catálogo guarda posições, não dezenas: a posição 0 é sempre a menor
/// dezena marcada. É isso que faz 330 arquivos bastarem para todos os pedidos
/// possíveis — o mesmo fechamento de pool 20 serve a quem marcou as vinte
/// primeiras e a quem marcou vinte outras.
export function emDezenas(mascaras, dezenas) {
  const ordenadas = [...dezenas].sort((a, b) => a - b);
  return mascaras.map((m) => {
    const bilhete = [];
    for (let i = 0; i < ordenadas.length; i++) if (m >>> i & 1) bilhete.push(ordenadas[i]);
    return bilhete;
  });
}
