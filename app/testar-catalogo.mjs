// Testes de catalogo.js e volante.js — o que se baixa e o que se leva.
//
// A rede é substituída por leitura de disco: o que se cobra aqui é a conferência
// da soma, a tradução de posição para dezena, e o que o bolão põe num endereço.
//
//     node app/testar-catalogo.mjs

import { readFileSync } from 'node:fs';

const raiz = new URL('../catalogo/', import.meta.url);

// Rede trocada por disco, antes de o módulo ser carregado.
globalThis.fetch = async (caminho) => {
  const arquivo = new URL(String(caminho).replace(/^catalogo\//, ''), raiz);
  try {
    return new Response(readFileSync(arquivo));
  } catch {
    return new Response('', { status: 404 });
  }
};

const catalogo = await import('./catalogo.js');
const volante = await import('./volante.js');

let feitos = 0;
const falhas = [];
function conferir(nome, condicao, detalhe = '') {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

// ── a soma de verificação ───────────────────────────────────────────────────

// O valor de referência vem do algoritmo, não deste código: FNV-1a de 32 bits
// sobre "abc" é uma constante publicada.
conferir('FNV-1a bate com o valor publicado', catalogo.somaDeVerificacao('abc') === 0x1a47e90b,
  catalogo.somaDeVerificacao('abc').toString(16));
conferir('e a soma do vazio é a semente', catalogo.somaDeVerificacao('') === 0x811c9dc5);

// ── o índice ────────────────────────────────────────────────────────────────

const indice = await catalogo.carregarIndice();
conferir('o índice abre em 330 entradas', indice.entradas.length === 330);
conferir('cada entrada tem método em português',
  indice.entradas.every((e) => typeof e.metodo === 'string' && e.metodo.length > 3));

// ── os fechamentos ──────────────────────────────────────────────────────────

const publicadas = indice.entradas.filter((e) => e.soma !== 0);
conferir('há fechamentos publicados', publicadas.length > 250, `${publicadas.length}`);

// Arquivo adulterado não passa. É o defeito que o cache e a CDN produzem
// sozinhos, e é o mais perigoso: um fechamento truncado tem cara de fechamento.
// Vem antes do laço porque o que passa fica guardado em memória.
const alvo = publicadas.find((e) => e.jogos > 3);
const daRede = globalThis.fetch;
const comAdulteracao = async (mexer) => {
  globalThis.fetch = async (caminho) => {
    const resposta = await daRede(caminho);
    if (!String(caminho).includes('/f/')) return resposta;
    return new Response(JSON.stringify(mexer(JSON.parse(await resposta.text()))));
  };
  try {
    await catalogo.carregarFechamento(alvo);
    return false;
  } catch {
    return true;
  } finally {
    globalThis.fetch = daRede;
  }
};

conferir('arquivo truncado é recusado',
  await comAdulteracao((c) => ({ ...c, bilhetes: c.bilhetes.slice(0, -1) })));
conferir('bilhete trocado é recusado',
  await comAdulteracao((c) => ({ ...c, bilhetes: [...c.bilhetes.slice(1), c.bilhetes[0] + '0'] })));
conferir('bilhete com dezena fora do pool é recusado',
  await comAdulteracao((c) => {
    const bilhetes = [...c.bilhetes];
    bilhetes[0] = (2 ** 26).toString(36);
    return { ...c, bilhetes, soma: somaDe(bilhetes) };
  }));

function somaDe(bilhetes) {
  return catalogo.somaDeVerificacao(bilhetes.join(','));
}

for (const entrada of publicadas) {
  const mascaras = await catalogo.carregarFechamento(entrada);
  conferir(`${entrada.v}-${entrada.k}-${entrada.t}: quantidade bate`,
    mascaras.length === entrada.jogos);
  conferir(`${entrada.v}-${entrada.k}-${entrada.t}: todo bilhete tem k dezenas no pool`,
    mascaras.every((m) => catalogo.contarBits(m) === entrada.k && m >>> entrada.v === 0));
  conferir(`${entrada.v}-${entrada.k}-${entrada.t}: sem bilhete repetido`,
    new Set(mascaras).size === mascaras.length);
}

// ── as distribuições do acaso ───────────────────────────────────────────────

// Um arquivo do catálogo gerado por uma versão antiga do motor abre e lê como
// JSON válido — só falta um campo, e a tela quebra sem dizer o quê. Aqui os dois
// campos são cobrados por completo, para todo pool e todo tamanho de jogo que a
// lotérica aceita.
const acaso = await catalogo.carregarAcaso();
for (let v = 15; v <= 25; v++) {
  conferir(`a chance de o sorteio cair dentro de ${v} dezenas existe`,
    typeof acaso.dentro?.[v] === 'number' && acaso.dentro[v] > 0 && acaso.dentro[v] <= 1,
    String(acaso.dentro?.[v]));
  for (let k = 15; k <= Math.min(v, 20); k++) {
    const faixas = acaso.chegam?.[`${v}-${k}`];
    conferir(`a distribuição de ${v}-${k} existe`, faixas != null);
    for (let t = 11; t <= 15; t++) {
      conferir(`e cobre a garantia ${t}`,
        typeof faixas?.[t] === 'number' && faixas[t] >= 0 && faixas[t] <= 1);
    }
    conferir(`e desce conforme a garantia sobe (${v}-${k})`,
      [12, 13, 14, 15].every((t) => faixas[t] <= faixas[t - 1]));
  }
}

// A chance de cair dentro de 25 dezenas é o universo inteiro, e a de 15 é uma em
// C(25,15). Dois valores que a fórmula fixa, e que pegam um arquivo trocado.
conferir('com 25 dezenas a garantia vale sempre', acaso.dentro[25] === 1);
conferir('com 15 dezenas ela vale uma vez em 3.268.760',
  Math.round(1 / acaso.dentro[15]) === 3268760, String(Math.round(1 / acaso.dentro[15])));

// ── o retorno médio, que a tela mostra e que ninguém pode arredondar ────────
//
// `acaso.json` guarda "chega a t acertos **ou mais**"; a tela precisa de
// "exatamente t", e tira uma da outra por diferença. É uma conta de uma linha, e
// uma conta de uma linha errada aqui viraria uma promessa de dinheiro errada na
// tela. Então aqui a mesma média é refeita do zero, pela definição
// hipergeométrica, sem tocar no arquivo — e as duas têm de bater ao centavo.
const precos = await catalogo.carregarPrecos();
const combinacoes = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
};
for (let k = 15; k <= 20; k++) {
  const solto = acaso.chegam[`25-${k}`];
  const porDiferenca = [11, 12, 13].reduce(
    (soma, f) => soma + ((solto[f] ?? 0) - (solto[f + 1] ?? 0)) * precos.premio[f], 0);
  const daDefinicao = [11, 12, 13].reduce(
    (soma, f) => soma +
      (combinacoes(k, f) * combinacoes(25 - k, 15 - f)) / combinacoes(25, 15) * precos.premio[f], 0);
  conferir(`a média de um bilhete de ${k} bate com a definição`,
    Math.abs(porDiferenca - daDefinicao) < 0.01,
    `${porDiferenca.toFixed(4)} vs ${daDefinicao.toFixed(4)}`);
}

// E o número que a tela de fato mostra hoje, ancorado: um bilhete simples
// devolve 25,7% do que custa nas faixas fixas. Se um dia a tabela de prêmios ou
// a de preços mudar, este teste é quem avisa que a conta da tela mudou junto.
const deUmBilhete = [11, 12, 13].reduce(
  (soma, f) => soma + ((acaso.chegam['25-15'][f] ?? 0) - (acaso.chegam['25-15'][f + 1] ?? 0)) *
    precos.premio[f], 0);
conferir('um bilhete de 15 devolve, em média, cerca de 90 centavos dos R$ 3,50',
  Math.round(deUmBilhete) === 90, `${(deUmBilhete / 100).toFixed(4)}`);

// ── posições viram dezenas ──────────────────────────────────────────────────

const dezenas = [3, 7, 11, 19, 25, 2];
// máscara 0b000101 = posições 0 e 2 → a menor e a terceira menor das marcadas
conferir('a posição 0 é a menor dezena marcada',
  JSON.stringify(catalogo.emDezenas([0b101], dezenas)) === JSON.stringify([[2, 7]]),
  JSON.stringify(catalogo.emDezenas([0b101], dezenas)));

const doFechamento = await catalogo.carregarFechamento(publicadas.find((e) => e.v === 18));
const minhas = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 1, 3, 5, 7, 9];
const bilhetes = catalogo.emDezenas(doFechamento, minhas);
conferir('todo bilhete só usa dezenas marcadas',
  bilhetes.every((b) => b.every((d) => minhas.includes(d))));
conferir('e vem em ordem crescente',
  bilhetes.every((b) => b.every((d, i) => i === 0 || d > b[i - 1])));

// ── volante ─────────────────────────────────────────────────────────────────

const cem = Array.from({ length: 100 }, (_, i) => [i]);
for (const partes of [2, 3, 7, 13]) {
  const grupos = volante.dividir(cem, partes);
  conferir(`dividir em ${partes} não perde nem repete bilhete`,
    grupos.flat().length === 100 && new Set(grupos.flat().map((b) => b[0])).size === 100);
  const tamanhos = grupos.map((g) => g.length);
  conferir(`e as partes diferem em no máximo um (${partes})`,
    Math.max(...tamanhos) - Math.min(...tamanhos) <= 1, tamanhos.join(','));
}

const link = volante.linkDaParte('https://exemplo/', {
  dezenas: new Set([5, 1, 3, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
  v: 18, k: 16, t: 13, parte: 2, partes: 5,
});
const lido = volante.lerLink(new URL(link).hash);
conferir('o endereço do bolão volta inteiro',
  lido.v === 18 && lido.k === 16 && lido.t === 13 && lido.parte === 2 && lido.partes === 5);
conferir('e traz as dezenas ordenadas', lido.dezenas.length === 18 && lido.dezenas[0] === 1);

conferir('endereço sem sentido não vira estado', volante.lerLink('#d=1.2.3&f=lixo&p=x') === null);
conferir('endereço com dezena fora do universo é recusado',
  volante.lerLink('#d=' + Array.from({ length: 18 }, (_, i) => i + 10).join('.') + '&f=18-16-13&p=0.2')
    === null);
conferir('endereço vazio é recusado', volante.lerLink('') === null);
conferir('pool que não bate com as dezenas é recusado',
  volante.lerLink('#d=1.2.3.4.5.6.7.8.9.10.11.12.13.14.15&f=20-15-13&p=0.2') === null);

const tres = [[1, 2, 3], [4, 5, 6]];
conferir('texto sai com dois dígitos', volante.comoTexto(tres) === '01 02 03\n04 05 06');
conferir('CSV tem cabeçalho e uma linha por bilhete',
  volante.comoCsv(tres).split('\n').length === 3);
conferir('o volante marca só o que está no bilhete',
  (volante.comoVolante([1, 25], 25).match(/marcada/g) ?? []).length === 2);

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}
console.log('catálogo e volante: tudo confere');
