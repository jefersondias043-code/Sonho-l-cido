// Testes do leitor determinístico de intenção.
//
// É o caminho alternativo do primeiro uso da IA: quando o modelo não responde,
// não existe, ou responde fora do esquema, é ele que lê o pedido. Não entende
// tudo, e não precisa — precisa **nunca inventar**. Um pedido que ele não
// entende vira `null`, e a tela segue pelos controles normais.
//
//     node servidor/testar-intencao.mjs

import { ler } from './intencao.js';

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const igual = (nome, achado, esperado) =>
  conferir(nome, JSON.stringify(achado) === JSON.stringify(esperado),
    `${JSON.stringify(achado)} ≠ ${JSON.stringify(esperado)}`);

// O exemplo da especificação, palavra por palavra.
igual('o pedido do documento', ler('trezentos reais, vinte dezenas, quero garantir 14'),
  { orcamento: 300, dezenas: [], quantasDezenas: 20, garantiaMinima: 14 });

// ── dinheiro ────────────────────────────────────────────────────────────────

igual('cifrão', ler('R$ 300'), { orcamento: 300, dezenas: [], quantasDezenas: 0, garantiaMinima: 0 });
igual('unidade escrita', ler('150 reais'),
  { orcamento: 150, dezenas: [], quantasDezenas: 0, garantiaMinima: 0 });
igual('gíria', ler('80 pila'), { orcamento: 80, dezenas: [], quantasDezenas: 0, garantiaMinima: 0 });
conferir('milhar com ponto e centavos com vírgula', ler('r$ 1.250,50').orcamento === 1250.5,
  String(ler('r$ 1.250,50')?.orcamento));
conferir('por extenso', ler('quinhentos reais').orcamento === 500);

// A regra que separa este leitor de um que chuta: número sem unidade não é
// dinheiro. Ler o 14 de "garantir 14" como catorze reais seria pior do que não
// entender o pedido.
conferir('número solto não vira dinheiro', ler('quero 20 dezenas') === null);
conferir('nem o número da garantia', ler('quero garantir 14') === null);
conferir('texto sem nada dentro devolve nada', ler('bom dia') === null);
conferir('texto vazio devolve nada', ler('') === null);

// ── quantas dezenas ─────────────────────────────────────────────────────────

conferir('em algarismo', ler('R$ 300 com 22 dezenas').quantasDezenas === 22);
conferir('por extenso', ler('R$ 300 com dezoito dezenas').quantasDezenas === 18);
conferir('composto vem antes do simples',
  ler('R$ 300 em vinte e cinco dezenas').quantasDezenas === 25,
  String(ler('R$ 300 em vinte e cinco dezenas').quantasDezenas));
conferir('nunca passa de 25', ler('R$ 300 com 99 dezenas').quantasDezenas === 25);
conferir('sem dizer quantas, fica zero', ler('R$ 300').quantasDezenas === 0);

// ── garantia ────────────────────────────────────────────────────────────────

for (const jeito of ['garantir 13', 'garantindo 13', 'garanto 13', 'garantia de 13']) {
  conferir(`"${jeito}" é lido`, ler(`R$ 300, ${jeito}`).garantiaMinima === 13,
    String(ler(`R$ 300, ${jeito}`).garantiaMinima));
}
conferir('nunca passa de 15', ler('R$ 300 garantir 99').garantiaMinima === 15);

// ── nada inventado ──────────────────────────────────────────────────────────

// O leitor jamais escolhe dezenas: dizer quais jogar é do usuário, e um leitor
// por expressão regular que "adivinhasse" dezenas estaria inventando aposta.
for (const texto of ['R$ 300 nos números 1 2 3', 'R$ 300 na minha sorte', 'R$ 300 dezenas boas']) {
  igual(`nenhuma dezena inventada em "${texto}"`, ler(texto).dezenas, []);
}

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('intenção: tudo confere');
