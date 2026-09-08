// Testes de analise.js — a conta que diz se o fechamento é bom.
//
// Roda em node puro. O gerador de acaso entra por parâmetro, então tudo aqui é
// determinístico: uma simulação que não dá o mesmo número duas vezes não pode
// ser cobrada de estar certa.
//
//     node app/testar-analise.mjs

import { readFileSync } from 'node:fs';
import { apostasComAcertos, bilhetesAoAcaso, binomial, contarBits, mascaraDoSorteio, premioDe,
  premioDoBilhete, simular, sortearResultado, umSorteio } from './analise.js';

let feitos = 0;
const falhas = [];
function conferir(nome, condicao, detalhe = '') {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

// Um gerador previsível: a sequência é fixa, então o sorteio também é.
function acasoFixo(semente = 1) {
  let x = semente;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

// ── contar bits ─────────────────────────────────────────────────────────────

conferir('contarBits(0) é 0', contarBits(0) === 0);
conferir('contarBits de 15 bits ligados é 15', contarBits(0b111111111111111) === 15);
conferir('contarBits conta só o que está ligado', contarBits(0b1010101) === 4);

// ── sortear resultado ───────────────────────────────────────────────────────

const universo = Array.from({ length: 25 }, (_, i) => i + 1);
for (const quantas of [1, 15, 25]) {
  const s = sortearResultado(universo, quantas, acasoFixo(7));
  conferir(`sorteia exatamente ${quantas} dezenas`, s.length === quantas);
  conferir(`e nenhuma repetida (${quantas})`, new Set(s).size === quantas);
  conferir(`e todas do universo (${quantas})`, s.every((d) => d >= 1 && d <= 25));
  conferir(`e em ordem (${quantas})`, s.every((d, i) => i === 0 || s[i - 1] < d));
}

// Sorteado de dentro de um pool, nada de fora pode aparecer. É a diferença
// entre "o concurso da vida real" e "os concursos em que a garantia vale", e
// misturar os dois faria a simulação mentir para os dois lados.
const pool = [2, 3, 5, 7, 11, 13, 17, 19, 23, 4, 6, 8, 9, 10, 12, 14, 15, 16];
const noPool = sortearResultado(pool, 15, acasoFixo(3));
conferir('sorteando dentro do pool, nada de fora entra',
  noPool.every((d) => pool.includes(d)), noPool.join(','));

// O acaso é uniforme, e uma simulação que privilegia dezenas não serve para
// nada. Mil sorteios: nenhuma dezena pode aparecer muito longe da média.
{
  const contagem = new Map(universo.map((d) => [d, 0]));
  const acaso = acasoFixo(2026);
  for (let i = 0; i < 1000; i++) {
    for (const d of sortearResultado(universo, 15, acaso)) contagem.set(d, contagem.get(d) + 1);
  }
  const esperado = 1000 * 15 / 25;
  const piorDesvio = Math.max(...[...contagem.values()].map((n) => Math.abs(n - esperado)));
  conferir('nenhuma dezena é mais provável que outra', piorDesvio < esperado * 0.15,
    `pior desvio ${piorDesvio} sobre ${esperado}`);
}

// ── máscara do sorteio ──────────────────────────────────────────────────────

const ordenadas = [3, 7, 9, 12, 20];
conferir('a máscara acende a posição, não a dezena',
  mascaraDoSorteio([3, 9], ordenadas) === 0b00101);
conferir('dezena fora do pool não acende bit nenhum',
  mascaraDoSorteio([3, 9, 25], ordenadas) === 0b00101);
conferir('sorteio inteiro fora do pool dá máscara vazia',
  mascaraDoSorteio([1, 2, 25], ordenadas) === 0);

// ── um sorteio contra o fechamento ──────────────────────────────────────────

{
  // Três bilhetes de 15 posições num pool de 18, com sobreposição conhecida.
  const cheio = (1 << 15) - 1;
  const mascaras = [cheio, cheio << 1, cheio << 3];
  const r = umSorteio(mascaras, cheio);
  conferir('o melhor bilhete é o que mais cruza com o sorteio', r.melhor === 15);
  conferir('e as faixas contam cada cartela uma vez',
    [...r.faixas.values()].reduce((a, b) => a + b, 0) === 3, [...r.faixas].join(' '));
  conferir('e a faixa de cada uma é o tamanho do cruzamento',
    r.faixas.get(15) === 1 && r.faixas.get(14) === 1 && r.faixas.get(12) === 1,
    [...r.faixas].join(' '));
}

conferir('sem acerto nenhum não há faixa', umSorteio([0b111, 0b1000], 0b110000).faixas.size === 0);

// Os mesmos seis bilhetes que a suíte de conferência usava antes de estas duas
// funções mudarem de casa: um em cada faixa, do 15 ao 10 sem prêmio.
{
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  const bilhetes = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
  ].map((b) => mascaraDoSorteio(b, pool));
  const sorteadas = mascaraDoSorteio([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], pool);
  const r = umSorteio(bilhetes, sorteadas);
  conferir('o melhor é 15', r.melhor === 15);
  conferir('faixas abaixo de 11 não entram', !r.faixas.has(10) && r.faixas.size === 5);
  const p = { 11: 700, 12: 1400, 13: 3500, 14: 150000, 15: 170000000 };
  conferir('o retorno soma as faixas',
    premioDe(r.faixas, p) === 700 + 1400 + 3500 + 150000 + 170000000);
  conferir('faixa sem valor vale zero', premioDe(new Map([[13, 2]]), { 13: 0 }) === 0);
  // Bilhete repetido conta duas vezes: é o que o volante faria.
  conferir('dois bilhetes iguais contam duas vezes',
    umSorteio([bilhetes[2], bilhetes[2]], sorteadas).faixas.get(13) === 2);
}

// ── prêmio ──────────────────────────────────────────────────────────────────

const premios = { 11: 700, 12: 1400, 13: 3500, 14: 150000, 15: 170000000 };
conferir('o prêmio soma faixa por faixa',
  premioDe(new Map([[11, 3], [13, 2]]), premios) === 3 * 700 + 2 * 3500);
conferir('faixa sem prêmio na tabela vale zero',
  premioDe(new Map([[9, 100]]), premios) === 0);

// ── um bilhete de mais de 15 dezenas são várias apostas ─────────────────────
//
// É o que a lotérica cobra: um bilhete de 16 custa R$ 56,00, que são 16 apostas
// simples de R$ 3,50; um de 17 custa R$ 476,00, que são 136. Porque cobra
// assim, paga assim — e o aplicativo pagava um prêmio só por bilhete.

conferir('C(16,15) são 16 apostas', binomial(16, 15) === 16);
conferir('C(17,15) são 136', binomial(17, 15) === 136);
conferir('C(20,15) são 15.504', binomial(20, 15) === 15504);
conferir('C de k maior que n é zero', binomial(3, 7) === 0);

// Um bilhete de 16 com 15 acertos: uma aposta é o sorteio inteiro; as outras
// quinze trocam uma dezena certa pela errada e param em 14.
conferir('16 dezenas com 15 acertos dá uma quinze', apostasComAcertos(16, 15, 15) === 1);
conferir('e quinze catorzes', apostasComAcertos(16, 15, 14) === 15);
// Com 14 acertos há duas dezenas erradas: descartar uma delas mantém os 14.
conferir('16 dezenas com 14 acertos dá duas catorzes', apostasComAcertos(16, 14, 14) === 2);
conferir('e catorze trezes', apostasComAcertos(16, 14, 13) === 14);
// Um bilhete de 17 com 11 acertos: escolher as 11 certas e 4 das 6 erradas.
conferir('17 dezenas com 11 acertos dá quinze onzes', apostasComAcertos(17, 11, 11) === 15);

// Toda aposta de dentro do bilhete cai em alguma faixa: a soma sobre os acertos
// possíveis tem de dar exatamente C(k,15).
for (const k of [15, 16, 17, 18, 19, 20]) {
  for (const j of [11, 13, 15]) {
    const soma = Array.from({ length: 16 }, (_, i) => apostasComAcertos(k, j, i))
      .reduce((a, b) => a + b, 0);
    conferir(`as apostas de um bilhete de ${k} com ${j} acertos somam C(${k},15)`,
      soma === binomial(k, 15), `${soma} ≠ ${binomial(k, 15)}`);
  }
}

// O caso comum não pode ter mudado: com 15 dezenas, um bilhete é uma aposta.
for (let j = 11; j <= 15; j++) {
  conferir(`bilhete de 15 com ${j} acertos paga a faixa ${j} e nada mais`,
    premioDoBilhete(15, j, premios) === premios[j]);
}
conferir('bilhete de 16 com 14 acertos paga duas catorzes e catorze trezes',
  premioDoBilhete(16, 14, premios) === 2 * premios[14] + 14 * premios[13]);
conferir('bilhete de 17 com 11 acertos paga quinze onzes',
  premioDoBilhete(17, 11, premios) === 15 * premios[11]);
conferir('abaixo de 11 acertos nada paga, em qualquer tamanho',
  [15, 16, 17, 18, 19, 20].every((k) => premioDoBilhete(k, 10, premios) === 0));
conferir('e premioDe leva o tamanho do bilhete em conta',
  premioDe(new Map([[14, 3]]), premios, 16) === 3 * (2 * premios[14] + 14 * premios[13]));

// O que faz disto uma correção e não uma opinião: a expectativa de um bilhete
// de `k` dezenas é exatamente `C(k,15)` vezes a de uma aposta simples. Como o
// preço também é `C(k,15)` vezes, a **taxa de retorno é a mesma em todo
// tamanho de bilhete** — o fechamento compra cobertura, nunca vantagem.
{
  const hiper = (k, j) => (binomial(k, j) * binomial(25 - k, 15 - j)) / binomial(25, 15);
  const fixas = { 11: premios[11], 12: premios[12], 13: premios[13] };
  const esperado = (k) => Array.from({ length: 16 }, (_, j) => hiper(k, j)
    * premioDoBilhete(k, j, fixas)).reduce((a, b) => a + b, 0);
  const simples = esperado(15);
  for (const k of [16, 17, 18, 19, 20]) {
    const razao = esperado(k) / (binomial(k, 15) * simples);
    conferir(`a expectativa de um bilhete de ${k} é C(${k},15) vezes a de uma aposta`,
      Math.abs(razao - 1) < 1e-9, `razão ${razao}`);
  }
  conferir('e a aposta simples devolve 25,7% nas faixas fixas',
    Math.abs(simples / 350 - 0.2567) < 0.001, `${(simples / 350).toFixed(4)}`);
}

// ── simulação, contra o catálogo de verdade ─────────────────────────────────

const bruto = JSON.parse(readFileSync(new URL('../catalogo/indice.json', import.meta.url)));
const entradas = bruto.entradas.map(([v, k, t, piso, jogos, provado, metodo, soma]) =>
  ({ v, k, t, piso, jogos, provado: provado === 1, soma }));

function fechamento(v, k, t) {
  const e = entradas.find((x) => x.v === v && x.k === k && x.t === t);
  const arq = JSON.parse(readFileSync(new URL(`../catalogo/f/${v}-${k}-${t}.json`, import.meta.url)));
  return { entrada: e, mascaras: arq.bilhetes.map((p) => parseInt(p, 36)) };
}

// 20 dezenas garantindo 12 com cartelas de 15: pequeno, provado, e a promessa
// dele é conferível dentro da própria simulação.
{
  const { entrada, mascaras } = fechamento(20, 15, 12);
  const dezenas = Array.from({ length: 20 }, (_, i) => i + 1);

  // Sorteando **dentro** do pool, a garantia vale em todo sorteio. Se a
  // simulação mostrasse um só abaixo dela, ou o fechamento está furado ou a
  // conta está errada — e as duas coisas precisam ser vistas aqui.
  const dentro = simular({ mascaras, dezenas, quantos: 400, dentroDoPool: true,
    premios, custo: entrada.jogos * 350, aleatorio: acasoFixo(11) });
  conferir('dentro do pool, todo sorteio cai inteiro no pool',
    dentro.caiuNoPool === 400, `${dentro.caiuNoPool}`);
  const abaixoDaGarantia = [...dentro.distribuicao.keys()].filter((m) => m < entrada.t);
  conferir('e a garantia se cumpre em todos eles',
    abaixoDaGarantia.length === 0, `melhores abaixo de ${entrada.t}: ${abaixoDaGarantia}`);
  conferir('e o melhor bilhete nunca passa de 15', dentro.melhor <= 15);
  conferir('e a distribuição soma o número de sorteios',
    [...dentro.distribuicao.values()].reduce((a, b) => a + b, 0) === 400);
  conferir('e o gasto é o custo vezes os sorteios',
    dentro.gasto === entrada.jogos * 350 * 400);
  conferir('e o saldo é o prêmio menos o gasto',
    dentro.saldo === dentro.premio - dentro.gasto);
  conferir('e o melhor sorteio guardado tem 15 dezenas',
    dentro.melhorSorteio?.length === 15);

  // Sorteando entre as 25, quase nenhum concurso cai dentro do pool — e a
  // simulação tem de mostrar isso, ou vira propaganda. C(20,15)/C(25,15) ≈ 0,5%.
  const real = simular({ mascaras, dezenas, quantos: 2000, dentroDoPool: false,
    premios, custo: entrada.jogos * 350, aleatorio: acasoFixo(5) });
  conferir('na vida real quase nenhum concurso cai dentro do pool',
    real.caiuNoPool < 2000 * 0.03, `${real.caiuNoPool} de 2000`);
  conferir('e por isso o melhor resultado costuma ficar abaixo da garantia',
    (real.distribuicao.get(entrada.t) ?? 0) + (real.distribuicao.get(entrada.t + 1) ?? 0) < 2000);
  conferir('e mesmo assim a conta fecha',
    real.saldo === real.premio - real.gasto && real.gasto === entrada.jogos * 350 * 2000);
  conferir('as cartelas premiadas somam as faixas',
    real.premiadas === [...real.faixas.values()].reduce((a, b) => a + b, 0));
  conferir('e nenhum sorteio conta faixa duas vezes',
    [...real.sorteiosComFaixa.values()].every((n) => n <= 2000));
}

// Zero sorteios não é erro: é uma pergunta sem resposta, e ela devolve zeros em
// vez de NaN. Uma tela com "R$ NaN" é pior do que uma tela vazia.
{
  const { mascaras } = fechamento(20, 15, 12);
  const nada = simular({ mascaras, dezenas: Array.from({ length: 20 }, (_, i) => i + 1),
    quantos: 0, premios, custo: 1400 });
  conferir('zero sorteios devolve zeros, e não NaN',
    nada.premio === 0 && nada.gasto === 0 && nada.saldo === 0 && nada.melhor === 0
    && Number.isFinite(nada.saldo));
}

// O fechamento de um bilhete só: a simulação tem de tratá-lo como qualquer
// outro, e é o caso que mais aparece em quem monta à mão.
{
  const { mascaras } = fechamento(15, 15, 15);
  const um = simular({ mascaras, dezenas: Array.from({ length: 15 }, (_, i) => i + 1),
    quantos: 50, dentroDoPool: true, premios, custo: 350, aleatorio: acasoFixo(13) });
  conferir('com um bilhete só, dentro do pool ele acerta os 15 sempre',
    um.distribuicao.get(15) === 50, [...um.distribuicao].join(' '));
  conferir('e o prêmio é o da faixa de 15, vezes os sorteios',
    um.premio === 50 * premios[15]);
}

// ── o chute, medido contra o fechamento ─────────────────────────────────────

{
  const acaso = acasoFixo(31);
  const soltos = bilhetesAoAcaso(22, 15, 40, acaso);
  conferir('o chute dá a quantidade pedida', soltos.length === 40);
  conferir('cada bilhete tem o tamanho pedido', soltos.every((m) => contarBits(m) === 15));
  conferir('e nenhum sai do pool', soltos.every((m) => m >>> 22 === 0));
  // Bilhetes ao acaso repetem pouco, mas repetir não é erro — é o que acontece
  // quando alguém joga no chute. O que não pode é sair sempre o mesmo.
  conferir('e não são todos iguais', new Set(soltos).size > 30, `${new Set(soltos).size} distintos`);
}

// A comparação é o produto inteiro numa medição: contra os **mesmos** sorteios,
// o fechamento alcança a garantia sempre e o chute não — e mesmo assim os dois
// pagam quase o mesmo. É a frase que o aplicativo repete, aqui virando número.
{
  const { entrada, mascaras } = fechamento(20, 15, 12);
  const dezenas = Array.from({ length: 20 }, (_, i) => i + 1);
  const soltos = bilhetesAoAcaso(20, 15, entrada.jogos, acasoFixo(53));
  const r = simular({ mascaras, dezenas, quantos: 1500, dentroDoPool: true, premios,
    custo: entrada.jogos * 350, garantia: entrada.t, contra: soltos, aleatorio: acasoFixo(59) });

  conferir('a comparação devolve os dois lados', r.rival != null);
  conferir('e os dois correram os mesmos sorteios',
    [...r.distribuicao.values()].reduce((a, b) => a + b, 0)
    === [...r.rival.distribuicao.values()].reduce((a, b) => a + b, 0));
  conferir('o fechamento alcança a garantia em todos os sorteios de dentro do pool',
    r.alcancaram === 1500, `${r.alcancaram} de 1500`);
  conferir('e o chute não alcança em todos',
    r.rival.alcancaram < 1500, `${r.rival.alcancaram} de 1500`);
  conferir('e mesmo assim o chute alcança na maioria — o fechamento compra o resto',
    r.rival.alcancaram > 1500 * 0.5, `${r.rival.alcancaram} de 1500`);

  // O gasto é o mesmo: mesmo tamanho, mesma quantidade, mesmo preço.
  conferir('os dois custam o mesmo', r.gasto === r.rival.gasto);
  // E o prêmio fica perto. "Perto" é o que a matemática promete: mesma
  // esperança, variância diferente.
  //
  // Só as faixas de prêmio fixo — 11, 12 e 13. Um único acerto de 15 vale
  // R$ 1,7 milhão e, num total de R$ 2,7 mil, engole a comparação inteira: o
  // teste passaria a medir se alguém teve sorte, e não se os dois pagam igual.
  // É o mesmo recorte que a tela faz quando diz "em média os dois pagam o
  // mesmo", e pela mesma razão.
  const fixas = (placar) => [11, 12, 13]
    .reduce((soma, f) => soma + (placar.faixas.get(f) ?? 0) * premios[f], 0);
  const [meuFixo, doChute] = [fixas(r), fixas(r.rival)];
  const distancia = Math.abs(meuFixo - doChute) / Math.max(meuFixo, doChute);
  conferir('e os dois pagam quase o mesmo nas faixas fixas, que é o que a tela promete',
    distancia < 0.1, `fechamento ${meuFixo}, chute ${doChute} — ${(distancia * 100).toFixed(1)}%`);
}

// Sem `contra`, não há rival: quem não pediu comparação não recebe uma.
{
  const { mascaras } = fechamento(20, 15, 12);
  const r = simular({ mascaras, dezenas: Array.from({ length: 20 }, (_, i) => i + 1),
    quantos: 10, premios, aleatorio: acasoFixo(3) });
  conferir('sem pedir comparação, não vem rival', r.rival === null);
}

// A mesma semente dá o mesmo resultado: sem isto não há como cobrar nada.
{
  const { mascaras } = fechamento(20, 15, 12);
  const dezenas = Array.from({ length: 20 }, (_, i) => i + 1);
  const a = simular({ mascaras, dezenas, quantos: 100, premios, aleatorio: acasoFixo(99) });
  const b = simular({ mascaras, dezenas, quantos: 100, premios, aleatorio: acasoFixo(99) });
  conferir('a mesma semente dá a mesma simulação',
    a.premio === b.premio && a.premiadas === b.premiadas && a.melhor === b.melhor);
}

// As dezenas do pool não precisam ser as primeiras: o catálogo guarda posições,
// e a análise tem de valer para qualquer marcação.
{
  const { entrada, mascaras } = fechamento(18, 15, 13);
  const espalhadas = [2, 3, 5, 7, 11, 13, 17, 19, 23, 4, 8, 9, 10, 14, 16, 20, 22, 25];
  const r = simular({ mascaras, dezenas: espalhadas, quantos: 200, dentroDoPool: true,
    premios, custo: entrada.jogos * 350, aleatorio: acasoFixo(17) });
  const abaixo = [...r.distribuicao.keys()].filter((m) => m < entrada.t);
  conferir('com dezenas espalhadas a garantia continua valendo',
    abaixo.length === 0, `melhores abaixo de ${entrada.t}: ${abaixo}`);
}

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('análise: tudo confere');
