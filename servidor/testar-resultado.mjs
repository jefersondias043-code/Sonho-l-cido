// Testes de resultado.js — a única função do servidor que traz número de fora.
//
// Ela busca o sorteio oficial e o entrega ao aplicativo, que compara os
// bilhetes de alguém contra ele. Um número errado aqui não é um texto feio na
// tela: é uma conferência que diz que você não ganhou quando ganhou.
//
// Era a única das três sem suíte, e é a que fala com um servidor de terceiros —
// justamente onde o formato muda sem avisar. O `fetch` global é trocado por um
// que devolve o que o teste quiser, então nada aqui sai para a rede.
//
//     node servidor/testar-resultado.mjs

import resultado from './resultado.js';

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const OFICIAL = {
  numero: 3210,
  dataApuracao: '04/09/2026',
  listaDezenas: ['02', '25', '01', '13', '07', '19', '04', '11', '23', '08', '15', '20', '05',
    '17', '09'],
};

/// Troca o `fetch` global por um que devolve `corpo`, e chama a função.
async function perguntar(corpo, { ok = true, url = 'https://x/api/resultado', explodir = false } = {}) {
  const antes = globalThis.fetch;
  globalThis.fetch = async () => {
    if (explodir) throw new Error('rede caiu');
    return { ok, status: ok ? 200 : 500, json: async () => corpo };
  };
  try {
    const resposta = await resultado.fetch(new Request(url));
    return { status: resposta.status, corpo: await resposta.json(), cabecalhos: resposta.headers };
  } finally {
    globalThis.fetch = antes;
  }
}

// ── o caminho feliz ─────────────────────────────────────────────────────────

const bom = await perguntar(OFICIAL);
conferir('um resultado válido volta com 200', bom.status === 200, String(bom.status));
conferir('e traz o número do concurso', bom.corpo.concurso === 3210, String(bom.corpo.concurso));
conferir('e as quinze dezenas', bom.corpo.dezenas.length === 15);
conferir('em ordem crescente',
  bom.corpo.dezenas.every((d, i) => i === 0 || d > bom.corpo.dezenas[i - 1]),
  bom.corpo.dezenas.join(' '));
conferir('e a data da apuração', bom.corpo.data === '04/09/2026');
conferir('e nada além disso', Object.keys(bom.corpo).sort().join(',') === 'concurso,data,dezenas',
  Object.keys(bom.corpo).join(','));
conferir('e pode ficar em cache por um dia',
  (bom.cabecalhos.get('cache-control') ?? '').includes('86400'),
  bom.cabecalhos.get('cache-control'));

// A origem também já respondeu com o outro nome de campo, em ordem de sorteio.
const emOrdemDeSorteio = await perguntar({
  numero: 3210,
  dezenasSorteadasOrdemSorteio: OFICIAL.listaDezenas,
});
conferir('o campo alternativo da origem também é lido',
  emOrdemDeSorteio.status === 200 && emOrdemDeSorteio.corpo.dezenas.length === 15);
conferir('e sai ordenado do mesmo jeito',
  emOrdemDeSorteio.corpo.dezenas.join(' ') === bom.corpo.dezenas.join(' '));

// ── o que não pode virar sorteio ────────────────────────────────────────────
//
// Nenhum destes pode chegar à tela. O aplicativo tem caminho alternativo — o
// último concurso guardado no aparelho, ou as dezenas digitadas à mão —, então
// recusar custa pouco e inventar custa uma conferência errada.

const semDezenaSuficiente = await perguntar({ numero: 3210, listaDezenas: ['01', '02', '03'] });
conferir('menos de quinze dezenas não vira resultado', semDezenaSuficiente.status === 503);

const comRepetida = await perguntar({
  numero: 3210,
  // catorze distintas e uma repetida: quinze itens, e um sorteio que não houve
  listaDezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13',
    '14', '14'],
});
conferir('uma dezena repetida não completa quinze', comRepetida.status === 503,
  JSON.stringify(comRepetida.corpo));

const foraDoUniverso = await perguntar({
  numero: 3210,
  listaDezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13',
    '14', '26'],
});
conferir('dezena fora de 1 a 25 não conta', foraDoUniverso.status === 503);

const semConcurso = await perguntar({ listaDezenas: OFICIAL.listaDezenas });
conferir('sem número de concurso não vira resultado', semConcurso.status === 503);

const concursoZero = await perguntar({ numero: 0, listaDezenas: OFICIAL.listaDezenas });
conferir('concurso zero também não', concursoZero.status === 503);

const origemForaDoAr = await perguntar(OFICIAL, { ok: false });
conferir('origem com erro não vira resultado', origemForaDoAr.status === 503);

const redeCaiu = await perguntar(OFICIAL, { explodir: true });
conferir('rede caída não vira resultado', redeCaiu.status === 503);
conferir('e a recusa diz que é indisponibilidade, não resultado',
  redeCaiu.corpo.erro != null && redeCaiu.corpo.dezenas === undefined,
  JSON.stringify(redeCaiu.corpo));

// ── o que o chamador pede ───────────────────────────────────────────────────

const concursoEstranho = await perguntar(OFICIAL, { url: 'https://x/api/resultado?concurso=abc' });
conferir('concurso não numérico é recusado antes de sair para a rede',
  concursoEstranho.status === 400, String(concursoEstranho.status));

const concursoLongo = await perguntar(OFICIAL, { url: 'https://x/api/resultado?concurso=1234567' });
conferir('e um número absurdamente longo também', concursoLongo.status === 400);

const concursoPedido = await perguntar(OFICIAL, { url: 'https://x/api/resultado?concurso=3000' });
conferir('um concurso válido é aceito', concursoPedido.status === 200);

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('resultado: tudo confere');
