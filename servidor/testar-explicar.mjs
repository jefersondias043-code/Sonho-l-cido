// Testes da regra que separa este produto de um chatbot de loteria.
//
// O modelo escreve palavras à vontade. **Números, só os que recebeu.** Uma frase
// que traga qualquer número que não veio no pedido é descartada — no servidor,
// antes de sair, e de novo no cliente, antes de tocar a tela. Sem essa regra, o
// critério "nenhum número que chega à tela passou por um modelo de linguagem"
// seria uma intenção; com ela, é uma verificação.
//
//     node servidor/testar-explicar.mjs

import { soUsaEstesNumeros } from './explicar.js';

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// O que o servidor autorizaria para um fechamento de 20 dezenas, jogos de 15,
// garantia de 13, 46 jogos por R$ 161,00 — com o piso em 16 e o degrau seguinte
// custando mais R$ 1.627,50.
const permitidos = new Set(['20', '15', '13', '46', '16100', '161', '16', '14', '162750', '1628']);

const passa = (frase) => soUsaEstesNumeros(frase, permitidos);

conferir('frase sem número nenhum passa',
  passa('Mais dinheiro compra mais certeza, e este é o ponto em que a conta ainda fecha.'));
conferir('frase só com números do pedido passa',
  passa('São 46 jogos de 15 dezenas para garantir 13 acertos entre as suas 20.'));
conferir('e com o preço em reais também',
  passa('Os 46 jogos custam 161 e garantem 13 acertos.'));

// O modo mais provável de um modelo errar aqui não é mentir: é **calcular**. Uma
// divisão inocente — o preço por jogo — já é um número que ninguém conferiu.
conferir('uma conta feita pelo modelo é recusada',
  !passa('Cada um dos 46 jogos sai por 3,50.'), 'passou o 3 e o 50');
conferir('um arredondamento é recusado',
  !passa('São cerca de 160 reais por 13 acertos garantidos.'));
conferir('um número inventado é recusado',
  !passa('Este fechamento cobre 87% dos resultados possíveis.'));
conferir('um ano, uma data, um concurso — tudo é número',
  !passa('Desde 2003 a Lotofácil sorteia 15 dezenas.'));

// E o caso mais perigoso de todos: a frase certa com um dígito trocado.
conferir('o mesmo texto com um dígito trocado é recusado',
  !passa('São 47 jogos de 15 dezenas para garantir 13 acertos entre as suas 20.'));

// Sem números autorizados, nenhuma frase com número passa.
conferir('conjunto vazio recusa qualquer número', !soUsaEstesNumeros('são 3', new Set()));
conferir('e ainda aceita frase sem número', soUsaEstesNumeros('vale a certeza', new Set()));

console.log(`${feitos} conferências`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHAS:`);
  for (const f of falhas) console.error(`  ${f}`);
  process.exit(1);
}
console.log('explicação: tudo confere');
