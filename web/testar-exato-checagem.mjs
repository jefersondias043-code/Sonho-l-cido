/*
 * Teste da aritmética da conferência do Construtor Exato.
 *
 * Roda em node puro, sem navegador e sem WebAssembly, porque é aritmética — e
 * aritmética errada numa ferramenta que diz quanto você ganhou é pior do que
 * ferramenta nenhuma. Alguém vai olhar o número "R$ 4.200,00" e acreditar.
 *
 * O que precisa ficar provado:
 *
 *   1. As faixas saem dos cinco parâmetros, e no caso da Lotinha dão
 *      exatamente 11 a 15 — a generalização tem de conter o caso conhecido.
 *   2. A contagem de acertos é exata, cartela por cartela, inclusive quando o
 *      resultado traz números que a pessoa não marcou.
 *   3. A soma da tabela fecha com o total: nenhuma cartela some entre as
 *      faixas mostradas e a linha de baixo.
 *   4. O dinheiro: quantidade × valor por faixa, soma, custo, líquido.
 *   5. Trocar preços depois de simular não repete a simulação e dá o mesmo
 *      número que teria dado se os preços fossem aqueles desde o começo.
 *
 *   node web/testar-exato-checagem.mjs
 */

import {
  faixasDe,
  mascaraDe,
  mascarasDe,
  bitsEm,
  interpretarResultado,
  sortearDe,
  urnaDoUniverso,
  conferir,
  valorDe,
  dinheiroDoSorteio,
  simularVarios,
  dinheiroDaSimulacao,
} from './exato-checagem.js';

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

console.log('Teste da conferência do Construtor Exato\n');

/* ─── 1. as faixas ─── */

const lotinha = faixasDe({ k: 17, j: 15, t: 15 });
marcar(
  lotinha.lista.join(',') === '11,12,13,14,15',
  'no formato da Lotinha as faixas são exatamente 11 a 15',
  lotinha.lista.join(', ')
);

const parcial = faixasDe({ k: 17, j: 15, t: 13 });
marcar(
  parcial.lista.join(',') === '11,12,13,14,15' && parcial.garantia === 13,
  'com garantia menor que o sorteio o topo continua sendo min(j,k)',
  `${parcial.piso} a ${parcial.maximo}`
);

const curto = faixasDe({ k: 3, j: 3, t: 2 });
marcar(
  curto.maximo === 3 && curto.piso === 0,
  'num problema pequeno as faixas encolhem em vez de inventar acertos impossíveis',
  `${curto.piso} a ${curto.maximo}`
);

const largo = faixasDe({ k: 15, j: 15, t: 3 });
marcar(
  largo.lista.length === 10 && largo.maximo === 15,
  'uma garantia muito baixa não abre quinze linhas: o limite de dez vence',
  `${largo.piso} a ${largo.maximo}, ${largo.lista.length} faixas`
);

const jogoCurto = faixasDe({ k: 5, j: 20, t: 2 });
marcar(
  jogoCurto.maximo === 5,
  'ninguém acerta mais números do que a cartela tem',
  `topo ${jogoCurto.maximo} com jogo de 5 e sorteio de 20`
);

/* ─── 2. a contagem ─── */

marcar(bitsEm(0) === 0 && bitsEm(mascaraDe([1, 2, 3])) === 3, 'contar bits é contar números');

marcar(
  mascaraDe([0, 32, 99, 5]) === 1 << 4,
  'números fora do universo são ignorados em vez de corromperem a máscara'
);

// Um fechamento à mão: as cartelas são posições, e `numeros` traduz.
const numeros = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const cartelas = [
  [1, 2, 3, 4, 5], // 2 4 6 8 10
  [1, 2, 3, 4, 6], // 2 4 6 8 12
  [6, 7, 8, 9, 10], // 12 14 16 18 20
];
const ms = mascarasDe(cartelas, numeros);
const faixas = faixasDe({ k: 5, j: 5, t: 3 });

const conf = conferir(ms, [2, 4, 6, 8, 10], faixas);
marcar(
  conf.contagem[5] === 1 && conf.contagem[4] === 1 && conf.contagem[0] === 1,
  'uma cartela igual ao resultado faz o máximo, uma que troca um número faz um a menos',
  `5 acertos: ${conf.contagem[5]} · 4: ${conf.contagem[4]} · 0: ${conf.contagem[0]}`
);
marcar(conf.melhor === 5, 'e o melhor resultado é o que de fato saiu', String(conf.melhor));

// Um resultado com números que a pessoa não marcou: eles simplesmente não
// contam. É o caso mais comum de todos e não pode ser recusado.
const forasteiro = conferir(ms, [2, 4, 6, 1, 3], faixas);
marcar(
  forasteiro.contagem[3] === 2 && forasteiro.melhor === 3,
  'números sorteados fora do fechamento não contam, e não derrubam a conferência',
  `${forasteiro.contagem[3]} cartelas com 3 acertos`
);

const soma = conf.porFaixa.reduce((s, f) => s + f.quantas, 0) + conf.abaixo;
marcar(
  soma === conf.total && conf.total === 3,
  'a soma das faixas mais a linha de baixo fecha com o total de cartelas',
  `${soma} de ${conf.total}`
);

/* ─── 3. a leitura do resultado ─── */

const vazio = interpretarResultado('', { universo: 25, sorteio: 15 });
marcar(/Digite os 15/.test(vazio.erro ?? ''), 'sem nada digitado, a recusa diz quantos faltam');

const poucos = interpretarResultado('1 2 3', { universo: 25, sorteio: 15 });
marcar(
  /15 números, e você digitou 3/.test(poucos.erro ?? ''),
  'com números a menos, a recusa diz quantos vieram',
  poucos.erro
);

const alto = interpretarResultado('1 2 3 4 5 6 7 8 9 10 11 12 13 14 99', {
  universo: 25,
  sorteio: 15,
});
marcar(/99 está fora/.test(alto.erro ?? ''), 'um número fora do universo é apontado pelo nome', alto.erro);

const repetido = interpretarResultado('1 1 2 3 4', { universo: 25, sorteio: 5 });
marcar(/1 apareceu duas vezes/.test(repetido.erro ?? ''), 'e um número repetido também', repetido.erro);

const misto = interpretarResultado('10,3;7\n1 5', { universo: 25, sorteio: 5 });
marcar(
  (misto.numeros ?? []).join(' ') === '1 3 5 7 10',
  'qualquer separador serve, e a saída sai ordenada',
  (misto.numeros ?? []).join(' ')
);

/* ─── 4. o sorteio simulado ─── */

let semente = 12345;
const pseudo = () => {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
};

const sorteado = sortearDe(urnaDoUniverso(25), 15, pseudo);
marcar(
  sorteado.length === 15 &&
    new Set(sorteado).size === 15 &&
    sorteado.every((n) => n >= 1 && n <= 25),
  'um sorteio simulado tem o tamanho pedido, sem repetir e dentro do universo',
  sorteado.join(' ')
);

const doMeuBolso = sortearDe(numeros, 5, pseudo);
marcar(
  doMeuBolso.every((n) => numeros.includes(n)),
  'e um sorteio tirado só dos meus números não traz nenhum de fora',
  doMeuBolso.join(' ')
);

// Toda combinação com a mesma chance: em muitos sorteios, cada número aparece
// com frequência parecida. Um viés de posição apareceria aqui.
const contagemPorNumero = new Array(26).fill(0);
for (let i = 0; i < 4000; i += 1) {
  for (const n of sortearDe(urnaDoUniverso(25), 15, pseudo)) contagemPorNumero[n] += 1;
}
const esperado = (4000 * 15) / 25;
const desvio = Math.max(
  ...contagemPorNumero.slice(1).map((c) => Math.abs(c - esperado) / esperado)
);
marcar(desvio < 0.06, 'nenhum número é sorteado com preferência', `maior desvio ${(desvio * 100).toFixed(1)}%`);

/* ─── 5. o dinheiro de um sorteio ─── */

marcar(
  valorDe('2,50') === 2.5 && valorDe('R$ 1.234,56') === 1234.56 && valorDe('3.00') === 3,
  'preços são lidos com vírgula decimal, como se digita em português',
  `2,50 → ${valorDe('2,50')} · R$ 1.234,56 → ${valorDe('R$ 1.234,56')}`
);
marcar(
  valorDe('') === 0 && valorDe('abc') === 0 && valorDe('-5') === 0,
  'e um campo vazio, sujo ou negativo vale zero, sem quebrar a conta'
);

// Dez cartelas com 11 acertos a R$ 6,00 = R$ 60,00. É o exemplo do pedido.
const faixasL = faixasDe({ k: 17, j: 15, t: 15 });
const precos = new Map([
  [11, 6],
  [12, 12],
  [13, 30],
  [14, 1500],
  [15, 60000],
]);
const fingido = {
  porFaixa: [
    { acertos: 11, quantas: 10 },
    { acertos: 12, quantas: 4 },
    { acertos: 13, quantas: 1 },
    { acertos: 14, quantas: 0 },
    { acertos: 15, quantas: 0 },
  ],
  total: 100,
  abaixo: 85,
};
const conta = dinheiroDoSorteio(fingido, { custoUnitario: 2.5, premios: precos });
marcar(
  conta.linhas[0].total === 60 && conta.linhas[1].total === 48 && conta.linhas[2].total === 30,
  'cada faixa é quantidade × valor, separada das outras',
  conta.linhas
    .filter((l) => l.quantas)
    .map((l) => `${l.acertos}: ${l.quantas}×${l.valor}=${l.total}`)
    .join(' · ')
);
marcar(conta.premioTotal === 138, 'o total premiado é a soma das faixas', String(conta.premioTotal));
marcar(
  conta.custoTotal === 250,
  'o custo é o fechamento inteiro, e não só as cartelas premiadas',
  `100 cartelas × 2,50 = ${conta.custoTotal}`
);
marcar(conta.liquido === -112, 'e o líquido é o que sobrou', String(conta.liquido));

const semPreco = dinheiroDoSorteio(fingido, {});
marcar(
  semPreco.configurado === false && semPreco.liquido === 0,
  'sem preço nenhum informado, o balanço se declara não configurado em vez de mentir zero'
);

/* ─── 6. a simulação, e trocar preços sem repeti-la ─── */

const grandeNumeros = urnaDoUniverso(18);
const grandeCartelas = [];
for (let i = 0; i < 30; i += 1) {
  const c = [];
  for (let n = 1; n <= 18 && c.length < 6; n += 1) if ((i + n) % 3 === 0) c.push(n);
  while (c.length < 6) c.push(((c.length + i) % 18) + 1);
  grandeCartelas.push([...new Set(c)].slice(0, 6));
}
const msGrande = mascarasDe(grandeCartelas, grandeNumeros);
const faixasG = faixasDe({ k: 6, j: 6, t: 4 });

semente = 999;
const resumo = simularVarios(msGrande, 300, {
  urna: grandeNumeros,
  sorteio: 6,
  faixas: faixasG,
  aleatorio: pseudo,
});

marcar(
  resumo.sorteios === 300 && resumo.porSorteio.length === 300 * faixasG.lista.length,
  'a simulação guarda a contagem de cada faixa em cada sorteio',
  `${resumo.porSorteio.length} números guardados`
);

const somaDaMatriz = resumo.lista.map((_, f) => {
  let s = 0;
  for (let i = 0; i < resumo.sorteios; i += 1) s += resumo.porSorteio[i * resumo.lista.length + f];
  return s;
});
marcar(
  somaDaMatriz.every((s, f) => s === resumo.faixas[f].soma),
  'e a matriz bate com as somas por faixa, sorteio a sorteio'
);

const precoA = new Map(faixasG.lista.map((a, i) => [a, (i + 1) * 10]));
const contaA = dinheiroDaSimulacao(resumo, { custoUnitario: 1, premios: precoA });
const esperadoA = somaDaMatriz.reduce((s, n, f) => s + n * (f + 1) * 10, 0);
marcar(
  contaA.recebido === esperadoA,
  'o recebido da simulação é a soma de todas as faixas de todos os sorteios',
  `${contaA.recebido}`
);
marcar(
  contaA.investido === 30 * 300,
  'e o investido é o fechamento inteiro, uma vez por sorteio',
  `30 cartelas × 300 sorteios = ${contaA.investido}`
);
marcar(
  Math.abs(contaA.liquido - (contaA.recebido - contaA.investido)) < 1e-9 &&
    Math.abs(contaA.mediaLiquida * 300 - contaA.liquido) < 1e-6,
  'o líquido e a média por sorteio são consistentes entre si'
);

// A promessa que faz a tela valer: dobrar todos os prêmios dobra o recebido,
// sem simular de novo.
const precoB = new Map(faixasG.lista.map((a, i) => [a, (i + 1) * 20]));
const contaB = dinheiroDaSimulacao(resumo, { custoUnitario: 1, premios: precoB });
marcar(
  contaB.recebido === contaA.recebido * 2,
  'trocar os preços refaz o balanço sem repetir a simulação',
  `${contaA.recebido} → ${contaB.recebido}`
);

const contaZero = dinheiroDaSimulacao(resumo, { custoUnitario: 0, premios: new Map() });
marcar(
  contaZero.retorno === null && contaZero.configurado === false,
  'sem custo informado não há retorno a calcular, e a tela é obrigada a dizer isso'
);

let melhorConferido = -Infinity;
const largura = resumo.lista.length;
for (let s = 0; s < resumo.sorteios; s += 1) {
  let p = 0;
  for (let f = 0; f < largura; f += 1) p += resumo.porSorteio[s * largura + f] * (f + 1) * 10;
  melhorConferido = Math.max(melhorConferido, p - 30);
}
marcar(
  contaA.melhor === melhorConferido,
  'o melhor sorteio é o melhor líquido de um sorteio, e não a soma de todos',
  String(contaA.melhor)
);

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
