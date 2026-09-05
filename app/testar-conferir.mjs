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
const umPool = await varrer([0b111111111111111], 15, 15);
conferir('pool de 15 tem um sorteio só', umPool.sorteios === 1, `${umPool.sorteios}`);
conferir('e o bilhete faz os 15', umPool.pior === 15, `${umPool.pior}`);

// Pool de 16 com um bilhete de 15: são 16 sorteios, e o pior deixa 14 acertos —
// o sorteio que troca uma dezena do bilhete pela que faltou.
const dezesseis = await varrer([0b0111111111111111], 16, 14);
conferir('pool de 16 tem 16 sorteios', dezesseis.sorteios === 16);
conferir('e o pior caso são 14 acertos', dezesseis.pior === 14, `${dezesseis.pior}`);
conferir('com 15 acertos em exatamente um deles', dezesseis.comQuinze === 1);

// Sem bilhete nenhum, nada é coberto — e a varredura aponta o sorteio que ficou
// de fora em vez de dizer "está tudo bem".
const vazio = await varrer([], 16, 11);
conferir('sem bilhete o melhor é zero', vazio.pior === 0);
conferir('e a varredura mostra um sorteio descoberto', vazio.descoberto !== null);

// Cobrindo de menos: um bilhete de 15 num pool de 17 não garante 14 acertos —
// o sorteio que troca as duas dezenas de fora deixa 13.
const curto = await varrer([0b00111111111111111], 17, 14);
conferir('a varredura reprova a garantia que não se sustenta', curto.pior === 13, `${curto.pior}`);
conferir('e aponta qual sorteio a derruba', curto.descoberto !== null);

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

// Todos os fechamentos publicados, sem amostragem: o laço por bilhete deixou a
// varredura barata o bastante para isso caber em menos de um minuto. O que o
// binário em Rust acrescenta não é cobertura — é independência.
let varridas = 0;
let maisLento = { nome: '', ms: 0 };

for (const e of entradas) {
  const sorteios = binomial(e.v, 15);
  const arquivo = JSON.parse(readFileSync(new URL(`f/${e.v}-${e.k}-${e.t}.json`, raiz)));
  const mascaras = arquivo.bilhetes.map((p) => parseInt(p, 36));
  const comeco = Date.now();
  const { pior, sorteios: contados } = await varrer(mascaras, e.v, e.t);
  const ms = Date.now() - comeco;
  if (ms > maisLento.ms) maisLento = { nome: `${e.v}-${e.k}-${e.t}`, ms };

  conferir(`${e.v}-${e.k}-${e.t}: varreu C(${e.v},15) sorteios`, contados === sorteios,
    `${contados} ≠ ${sorteios}`);
  conferir(`${e.v}-${e.k}-${e.t}: a garantia de ${e.t} se sustenta no pior caso`, pior >= e.t,
    `pior = ${pior}`);
  varridas++;
}

conferir('todos os fechamentos publicados foram varridos', varridas > 300, `${varridas}`);

// O alvo de performance da especificação: a varredura mais cara do catálogo
// cabe em três segundos. Aqui roda em node, sem a folga de um aparelho ocioso,
// e a margem que sobrar é a que o celular vai gastar.
conferir(`a varredura mais cara cabe em 3 s (${maisLento.nome}, ${maisLento.ms} ms)`,
  maisLento.ms < 3000);

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

console.log(
  `${feitos} conferências · ${varridas} fechamentos varridos sorteio a sorteio · ` +
  `mais cara: ${maisLento.nome} em ${maisLento.ms} ms`,
);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}
console.log('conferência: tudo confere');
