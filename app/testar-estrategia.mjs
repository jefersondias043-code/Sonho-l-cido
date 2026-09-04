// Testes de estrategia.js — o módulo que decide o que a pessoa compra.
//
// Roda em node puro, sem navegador e sem rede: é função pura sobre o índice, e
// se precisasse de qualquer uma das duas estaria errada.
//
//     node app/testar-estrategia.mjs

import { readFileSync } from 'node:fs';
import { melhorEstrategia, escada, melhorPool, custoDe } from './estrategia.js';

let feitos = 0;
const falhas = [];
function conferir(nome, condicao, detalhe = '') {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const precos = JSON.parse(readFileSync(new URL('../catalogo/precos.json', import.meta.url)));
const bruto = JSON.parse(readFileSync(new URL('../catalogo/indice.json', import.meta.url)));
const indice = {
  universo: bruto.universo,
  entradas: bruto.entradas.map(([v, k, t, piso, jogos, provado, metodo, soma]) => ({
    v, k, t, piso, jogos, provado: provado === 1, metodo: bruto.metodos[metodo], soma,
  })),
};

// ── o formato do índice ─────────────────────────────────────────────────────

conferir('o índice tem as 330 combinações', indice.entradas.length === 330, `${indice.entradas.length}`);

const chaves = new Set(indice.entradas.map((e) => `${e.v}-${e.k}-${e.t}`));
conferir('nenhuma combinação repetida', chaves.size === 330);

conferir(
  'toda entrada com bilhetes tem tamanho e piso coerentes',
  indice.entradas.every((e) => e.soma === 0 || (e.jogos >= e.piso && e.jogos > 0)),
);

conferir(
  'a marca de prova aparece exatamente onde os limites se encontram',
  indice.entradas.every((e) => e.provado === (e.jogos != null && e.jogos === e.piso)),
);

// ── pedidos que não dão resposta ────────────────────────────────────────────

conferir(
  'menos de 15 dezenas não é pedido',
  melhorEstrategia(indice, precos, { orcamento: 100000, dezenas: 10 }).motivo === 'poucas-dezenas',
);

const semDinheiro = melhorEstrategia(indice, precos, { orcamento: 100, dezenas: 20 });
conferir('sem dinheiro para nada, o aplicativo diz quanto falta',
  semDinheiro.motivo === 'sem-dinheiro' && semDinheiro.falta > 0);
conferir('e diz qual é o mais barato', semDinheiro.maisBarato.custo > 100);

// ── a resposta ──────────────────────────────────────────────────────────────

const cinquenta = melhorEstrategia(indice, precos, { orcamento: 5000, dezenas: 18 });
conferir('R$ 50 com 18 dezenas tem resposta', cinquenta.motivo === 'ok');
conferir('e a resposta cabe no orçamento', cinquenta.escolha.custo <= 5000);
conferir('e sobra é o que ficou', cinquenta.sobra === 5000 - cinquenta.escolha.custo);

// A regra que organiza tudo: nenhuma outra opção do catálogo, dentro do mesmo
// dinheiro e das mesmas dezenas, garante mais acertos.
for (const dezenas of [16, 18, 20, 22, 25]) {
  for (const orcamento of [1000, 5000, 20000, 100000, 1000000]) {
    const plano = melhorEstrategia(indice, precos, { orcamento, dezenas });
    if (plano.motivo !== 'ok') continue;
    const melhores = indice.entradas.filter(
      (e) =>
        e.v === dezenas && e.soma !== 0 && precos.aposta[e.k] &&
        custoDe(e, precos) <= orcamento && e.t > plano.escolha.t,
    );
    conferir(
      `nada garante mais que a escolha (${dezenas} dezenas, ${orcamento})`,
      melhores.length === 0,
      melhores.map((e) => `${e.v}-${e.k}-${e.t}`).join(' '),
    );
    conferir(
      `empatada a garantia, a escolha é a mais barata (${dezenas}, ${orcamento})`,
      !indice.entradas.some(
        (e) =>
          e.v === dezenas && e.t === plano.escolha.t && e.soma !== 0 && precos.aposta[e.k] &&
          custoDe(e, precos) < plano.escolha.custo,
      ),
    );
  }
}

// ── a escada e o degrau ─────────────────────────────────────────────────────

const escadaDe20 = escada(indice, precos, 20);
conferir('a escada sobe em preço', escadaDe20.every((e, i) => i === 0 || e.custo >= escadaDe20[i - 1].custo));
conferir('e sobe em garantia junto', escadaDe20.every((e, i) => i === 0 || e.t > escadaDe20[i - 1].t));

const comDegrau = melhorEstrategia(indice, precos, { orcamento: 5000, dezenas: 20 });
conferir('há degrau seguinte quando não se está no topo', comDegrau.degrau != null);
conferir('o degrau garante mais', comDegrau.degrau.t > comDegrau.escolha.t);
conferir('e custa mais do que se tem', comDegrau.degrau.falta > 0);
conferir('e o degrau é o mais barato que garante mais',
  !indice.entradas.some(
    (e) => e.v === 20 && e.soma !== 0 && precos.aposta[e.k] && e.t > comDegrau.escolha.t &&
      custoDe(e, precos) < comDegrau.degrau.custo,
  ));

// Com dinheiro de sobra a resposta chega ao topo e o degrau some.
const rico = melhorEstrategia(indice, precos, { orcamento: 100000000, dezenas: 18 });
conferir('com muito dinheiro se chega ao topo', rico.escolha.t === 15);
conferir('e no topo não há degrau', rico.degrau === null);

// ── a régua muda a resposta, e sempre para melhor ───────────────────────────

let anterior = 0;
for (let reais = 5; reais <= 100000; reais = Math.ceil(reais * 1.35)) {
  const plano = melhorEstrategia(indice, precos, { orcamento: reais * 100, dezenas: 20 });
  if (plano.motivo !== 'ok') continue;
  conferir(`mais dinheiro nunca garante menos (R$ ${reais})`, plano.escolha.t >= anterior);
  anterior = plano.escolha.t;
}

// ── garantia mínima pedida ──────────────────────────────────────────────────

const pedindo14 = melhorEstrategia(indice, precos, {
  orcamento: 100000000, dezenas: 20, garantiaMinima: 14,
});
conferir('pedir garantia 14 e poder pagar entrega ao menos 14', pedindo14.escolha.t >= 14);

const pedindoDemais = melhorEstrategia(indice, precos, {
  orcamento: 3000, dezenas: 20, garantiaMinima: 15,
});
conferir('pedir o que não cabe entrega o melhor que cabe', pedindoDemais.motivo === 'ok');
conferir('e diz que ficou abaixo do pedido', pedindoDemais.abaixoDoPedido === true);

// ── escolher por mim ────────────────────────────────────────────────────────

let poolAnterior = 0;
for (const orcamento of [400, 500, 2000, 5000, 30000, 500000]) {
  const quantas = melhorPool(indice, precos, orcamento);
  conferir(`o pool escolhido é jogável (R$ ${orcamento / 100})`, quantas >= 15 && quantas <= 25);
  conferir(`e tem resposta dentro do orçamento (R$ ${orcamento / 100})`,
    melhorEstrategia(indice, precos, { orcamento, dezenas: quantas }).motivo === 'ok');
  for (let v = quantas + 1; v <= 25; v++) {
    conferir(
      `nenhum pool maior caberia (R$ ${orcamento / 100}, ${v} dezenas)`,
      melhorEstrategia(indice, precos, { orcamento, dezenas: v }).motivo !== 'ok',
    );
  }
  conferir(`mais dinheiro nunca escolhe pool menor (R$ ${orcamento / 100})`,
    quantas >= poolAnterior, `${poolAnterior} → ${quantas}`);
  poolAnterior = quantas;
}

// ── preço editado pelo usuário muda a resposta ──────────────────────────────

const caro = { ...precos, aposta: { ...precos.aposta, 15: 100000 } };
const comPrecoCaro = melhorEstrategia(indice, caro, { orcamento: 5000, dezenas: 18 });
conferir(
  'com a aposta a R$ 1.000 quase nada cabe',
  comPrecoCaro.motivo === 'sem-dinheiro' || comPrecoCaro.escolha.k !== 15,
);

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('estratégia: tudo confere');
