// Testes de conferir.js — a varredura que o aplicativo oferece a quem duvidar.
//
// Esta é a **terceira** implementação da mesma pergunta. O gerador em Rust
// confere o que grava; o binário `conferir-tudo` confere de novo sem
// compartilhar uma linha com ele; e aqui é o código que roda no aparelho da
// pessoa, cobrado contra o catálogo publicado. Três caminhos independentes têm
// de chegar ao mesmo lugar.
//
//     node app/testar-conferir.mjs

import { readFileSync } from 'node:fs';
import { varrer, contraOSorteio, retorno } from './conferir.js';

let feitos = 0;
const falhas = [];
function conferir(nome, condicao, detalhe = '') {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

// ── casos montados à mão, com resposta sabida ───────────────────────────────

// Pool de 15: o único sorteio possível é o pool inteiro, e um bilhete de 15
// dezenas faz 15 acertos.
const umPool = await varrer([0b111111111111111], 15);
conferir('pool de 15 tem um sorteio só', umPool.sorteios === 1, `${umPool.sorteios}`);
conferir('e o bilhete faz os 15', umPool.pior === 15, `${umPool.pior}`);

// Pool de 16 com um bilhete de 15: são 16 sorteios, e o pior deixa 14 acertos —
// o sorteio que troca uma dezena do bilhete pela que faltou.
const dezesseis = await varrer([0b0111111111111111], 16);
conferir('pool de 16 tem 16 sorteios', dezesseis.sorteios === 16);
conferir('e o pior caso são 14 acertos', dezesseis.pior === 14, `${dezesseis.pior}`);
conferir('com 15 acertos em exatamente um deles', dezesseis.distribuicao[15] === 1);

// Sem bilhete nenhum, nada é coberto.
const vazio = await varrer([], 16);
conferir('sem bilhete o melhor é zero', vazio.pior === 0 && vazio.distribuicao[0] === 16);

// ── contra o catálogo publicado ─────────────────────────────────────────────

const raiz = new URL('../catalogo/', import.meta.url);
const bruto = JSON.parse(readFileSync(new URL('indice.json', raiz)));
const entradas = bruto.entradas
  .map(([v, k, t, piso, jogos, provado, metodo, soma]) => ({ v, k, t, piso, jogos, soma }))
  .filter((e) => e.soma !== 0);

const binomial = (n, k) => {
  if (k > n) return 0;
  let r = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
};

// A varredura completa de tudo levaria minutos em JavaScript. O que se varre
// aqui é todo caso cujo trabalho cabe no orçamento — e são a maioria. A
// varredura das 330 sem exceção é a do binário em Rust, que roda em CI.
const ORCAMENTO = Number(process.env.CONFERIR_ORCAMENTO ?? 4e8);
let varridas = 0;

for (const e of entradas) {
  const sorteios = binomial(e.v, 15);
  if (sorteios * e.jogos > ORCAMENTO) continue;

  const arquivo = JSON.parse(readFileSync(new URL(`f/${e.v}-${e.k}-${e.t}.json`, raiz)));
  const mascaras = arquivo.bilhetes.map((p) => parseInt(p, 36));
  const { pior, sorteios: contados } = await varrer(mascaras, e.v);

  conferir(`${e.v}-${e.k}-${e.t}: varreu C(${e.v},15) sorteios`, contados === sorteios,
    `${contados} ≠ ${sorteios}`);
  conferir(`${e.v}-${e.k}-${e.t}: a garantia de ${e.t} se sustenta no pior caso`, pior >= e.t,
    `pior = ${pior}`);
  varridas++;
}

conferir('a amostra varrida é a maior parte do catálogo', varridas > 200, `${varridas}`);

// ── conferência contra um sorteio de verdade ────────────────────────────────

const sorteadas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const bilhetes = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // 15 acertos
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16], // 14
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17], // 13
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18], // 12
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19], // 11
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20], // 10, sem prêmio
];
const { porBilhete, faixas, melhor } = contraOSorteio(bilhetes, sorteadas);
conferir('cada faixa é contada certo', porBilhete.join(',') === '15,14,13,12,11,10',
  porBilhete.join(','));
conferir('o melhor é 15', melhor === 15);
conferir('faixas abaixo de 11 não entram', !faixas.has(10) && faixas.size === 5);

const premios = { 11: 700, 12: 1400, 13: 3500, 14: 150000, 15: 170000000 };
conferir('o retorno soma as faixas',
  retorno(faixas, premios) === 700 + 1400 + 3500 + 150000 + 170000000,
  String(retorno(faixas, premios)));
conferir('faixa sem valor vale zero', retorno(new Map([[13, 2]]), { 13: 0 }) === 0);

// Bilhete repetido conta duas vezes: é o que o volante faria.
const dobrado = contraOSorteio([bilhetes[2], bilhetes[2]], sorteadas);
conferir('dois bilhetes iguais contam duas vezes', dobrado.faixas.get(13) === 2);

console.log(`${feitos} conferências · ${varridas} fechamentos varridos sorteio a sorteio`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}
console.log('conferência: tudo confere');
