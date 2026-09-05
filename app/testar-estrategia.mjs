// Testes de estrategia.js — o módulo que decide o que a pessoa compra.
//
// Roda em node puro, sem navegador e sem rede: é função pura sobre o índice, e
// se precisasse de qualquer uma das duas estaria errada.
//
//     node app/testar-estrategia.mjs

import { readFileSync } from 'node:fs';
import { melhorEstrategia, escada, fechamentosDe, melhorPool, custoDe } from './estrategia.js';

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

// O degrau **nunca** cabe no orçamento, e não por acaso: se coubesse, ele seria
// a resposta. A tela conta com isso — só sabe dizer "por mais X você sobe".
for (const dezenas of [16, 18, 20, 22, 25]) {
  for (const orcamento of [700, 3000, 15000, 90000, 900000]) {
    const plano = melhorEstrategia(indice, precos, { orcamento, dezenas });
    if (plano.motivo !== 'ok' || !plano.degrau) continue;
    conferir(`o degrau sempre falta dinheiro (${dezenas} dezenas, ${orcamento})`,
      plano.degrau.falta > 0, `falta ${plano.degrau.falta}`);
  }
}
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

conferir('quem consegue o que pediu não recebe cobrança nenhuma', pedindo14.pedido === null);

// Pedir mais do que cabe não é erro nem é ignorado: o aplicativo passa a
// responder **a pergunta que a pessoa fez** — quanto custa aquilo — em vez de
// só entregar o que coube e ficar calado sobre o resto.
const pedindoDemais = melhorEstrategia(indice, precos, {
  orcamento: 3000, dezenas: 20, garantiaMinima: 14,
});
conferir('pedir o que não cabe entrega o melhor que cabe', pedindoDemais.motivo === 'ok');
conferir('e a escolha fica abaixo do pedido', pedindoDemais.escolha.t < 14);
conferir('e o pedido volta com o preço do que se pediu', pedindoDemais.pedido?.t === 14);
conferir('que é o degrau mais barato que alcança 14',
  pedindoDemais.pedido.degrau.t >= 14 &&
  !escada(indice, precos, 20).some((e) => e.t >= 14 && e.custo < pedindoDemais.pedido.degrau.custo));
conferir('e que não cabe no bolso, senão já teria sido a resposta',
  pedindoDemais.pedido.degrau.falta > 0);

// E quando o catálogo não alcança, dizer isso é a resposta certa — melhor do
// que oferecer calado uma garantia menor como se fosse o que se pediu. Hoje o
// catálogo publicado alcança 15 acertos em todo pool, então este caminho só se
// cobra podando o índice: é defesa contra um catálogo futuro mais pobre, e uma
// defesa que nunca se testa é uma defesa que não existe.
const podado = {
  universo: indice.universo,
  entradas: indice.entradas.filter((e) => e.t <= 12),
};
const pedindoOImpossivel = melhorEstrategia(podado, precos, {
  orcamento: 100000000, dezenas: 25, garantiaMinima: 15,
});
conferir('o que o catálogo não alcança volta como pedido sem degrau',
  pedindoOImpossivel.pedido?.t === 15 && pedindoOImpossivel.pedido.degrau === null,
  JSON.stringify(pedindoOImpossivel.pedido));

// E o catálogo publicado, hoje, alcança tudo: em todo pool jogável a escada
// termina em 15 acertos garantidos. Se um dia deixar de terminar, este teste
// avisa antes de a tela dizer "não há" para alguém.
conferir('toda escada publicada chega aos 15 acertos',
  [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].every(
    (v) => escada(indice, precos, v).at(-1).t === 15));

// ── um bilhete não é fechamento ─────────────────────────────────────────────
//
// Com dinheiro para um bilhete só, chamar o resultado de "garantia" seria
// verdade e seria engano: um bilhete acerta o que acertar, e não há vários
// jogos se completando. O motivo é outro, e a tela conta com isso para trocar
// a manchete inteira.
const umBilhete = melhorEstrategia(indice, precos, { orcamento: 350, dezenas: 19 });
conferir('R$ 3,50 com 19 dezenas é um bilhete, não um fechamento',
  umBilhete.motivo === 'um-bilhete', umBilhete.motivo);
conferir('e ele custa o que um bilhete custa', umBilhete.escolha.jogos === 1);
conferir('e o degrau seguinte já tem mais de um jogo', umBilhete.degrau.jogos > 1);

conferir(
  'todo plano de um jogo só vem marcado como um bilhete, e nenhum outro',
  [15, 16, 18, 19, 20, 22, 25].every((v) =>
    [350, 1400, 6300, 20000, 200000, 2000000].every((o) => {
      const plano = melhorEstrategia(indice, precos, { orcamento: o, dezenas: v });
      return !plano.escolha || (plano.motivo === 'um-bilhete') === (plano.escolha.jogos === 1);
    })),
);

// ── escolher por mim ────────────────────────────────────────────────────────

let poolAnterior = 0;
for (const orcamento of [400, 500, 2000, 5000, 30000, 500000]) {
  const quantas = melhorPool(indice, precos, orcamento);
  conferir(`o pool escolhido é jogável (R$ ${orcamento / 100})`, quantas >= 15 && quantas <= 25);
  conferir(`e tem resposta dentro do orçamento (R$ ${orcamento / 100})`,
    melhorEstrategia(indice, precos, { orcamento, dezenas: quantas }).escolha != null);
  for (let v = quantas + 1; v <= 25; v++) {
    conferir(
      `nenhum pool maior caberia (R$ ${orcamento / 100}, ${v} dezenas)`,
      melhorEstrategia(indice, precos, { orcamento, dezenas: v }).escolha == null,
    );
  }
  conferir(`mais dinheiro nunca escolhe pool menor (R$ ${orcamento / 100})`,
    quantas >= poolAnterior, `${poolAnterior} → ${quantas}`);
  poolAnterior = quantas;
}

// ── a lista do modo manual ──────────────────────────────────────────────────
//
// A escada existe para responder "o que este dinheiro compra" e por isso
// esconde de propósito o que é caro sem ser melhor. Quem monta do próprio jeito
// quer ver tudo — inclusive o que a escada esconde.

const ACEITOS = [15, 16, 17, 18, 19, 20];

for (let v = 15; v <= 25; v++) {
  const lista = fechamentosDe(indice, precos, v);
  conferir(`a lista de ${v} dezenas só tem fechamentos desse pool`,
    lista.every((e) => e.v === v));
  conferir(`a lista de ${v} dezenas só tem cartelas que a lotérica aceita`,
    lista.every((e) => ACEITOS.includes(e.k)));
  conferir(`a lista de ${v} dezenas só tem fechamento com bilhetes`,
    lista.every((e) => e.jogos > 0 && e.soma !== 0));
  conferir(`a lista de ${v} dezenas vem do mais barato ao mais caro`,
    lista.every((e, i) => i === 0 || lista[i - 1].custo <= e.custo));
  conferir(`todo item da lista de ${v} dezenas traz o próprio custo`,
    lista.every((e) => e.custo === e.jogos * precos.aposta[e.k]));

  // O ponto da lista: ela contém a escada inteira, e mais.
  const degraus = escada(indice, precos, v);
  const naLista = new Set(lista.map((e) => `${e.k}-${e.t}`));
  conferir(`a lista de ${v} dezenas contém todos os degraus`,
    degraus.every((d) => naLista.has(`${d.k}-${d.t}`)),
    `${degraus.length} degraus, ${lista.length} na lista`);
  conferir(`a lista de ${v} dezenas não é menor que a escada`,
    lista.length >= degraus.length);
}

// Com 15 dezenas só existe um bilhete possível, e ele acerta tudo o que der
// para acertar. O catálogo guarda as cinco garantias separadas — 11 a 15 —
// porque são cinco perguntas diferentes; a lista traz as cinco e o filtro da
// tela deixa a única que interessa, a de 15.
const lista15 = fechamentosDe(indice, precos, 15);
conferir('com 15 dezenas toda a lista é o mesmo bilhete',
  lista15.length === 5 && lista15.every((e) => e.jogos === 1 && e.k === 15));
conferir('e o filtro da tela reduz isso a uma linha só',
  lista15.filter((e) => !lista15.some(
    (o) => o.k === e.k && o.custo <= e.custo && o.t > e.t)).length === 1);

// A lista maior que a escada é o que justifica ela existir: se as duas fossem
// sempre iguais, o modo manual não estaria mostrando nada de novo.
conferir('em algum pool a lista mostra mais do que a escada',
  [...Array(11)].some((_, i) => fechamentosDe(indice, precos, 15 + i).length
    > escada(indice, precos, 15 + i).length));

// O filtro da tela: nada de mesmo tamanho de cartela, mesmo preço ou mais caro,
// e garantia pior. É o único descarte que o modo manual faz, e é descarte de
// coisa que ninguém escolheria sabendo.
for (let v = 16; v <= 25; v++) {
  const lista = fechamentosDe(indice, precos, v);
  const visivel = lista.filter((e) => !lista.some(
    (o) => o.k === e.k && o.custo <= e.custo && o.t > e.t));
  conferir(`o filtro de ${v} dezenas nunca esconde a melhor garantia de um preço`,
    ACEITOS.every((k) => {
      const doK = lista.filter((e) => e.k === k);
      if (!doK.length) return true;
      const melhorT = Math.max(...doK.map((e) => e.t));
      return visivel.some((e) => e.k === k && e.t === melhorT);
    }));
  conferir(`o filtro de ${v} dezenas deixa alguma coisa`, visivel.length > 0);
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
