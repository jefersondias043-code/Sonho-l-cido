// Testes da regra que separa este produto de um chatbot de loteria.
//
// O modelo escreve palavras à vontade. **Números, só os que recebeu.** Uma frase
// que traga qualquer número que não veio no pedido é descartada — no servidor,
// antes de sair, e de novo no cliente, antes de tocar a tela. Sem essa regra, o
// critério "nenhum número que chega à tela passou por um modelo de linguagem"
// seria uma intenção; com ela, é uma verificação.
//
//     node servidor/testar-explicar.mjs

import { numerosDe, soUsaEstesNumeros } from './explicar.js';

let feitos = 0;
const falhas = [];
const conferir = (nome, condicao, detalhe = '') => {
  feitos++;
  if (!condicao) falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// O que o servidor autoriza para um fechamento de 20 dezenas, jogos de 15,
// garantia de 13, 46 jogos por R$ 161,00 — com o piso em 16 e o degrau seguinte
// custando mais R$ 1.627,50.
//
// Montado pelo próprio servidor, e não à mão: um conjunto escrito aqui testa o
// conjunto escrito aqui. Foi exatamente assim que passou despercebido que
// nenhuma frase com preço em reais chegava à tela — o teste autorizava "161"
// porque quem o escreveu sabia que aquilo era R$ 161,00, e o servidor, que só
// autorizava "16100" e "161", descartava toda frase que escrevesse "161,00".
const permitidos = numerosDe({
  v: 20, k: 15, t: 13, jogos: 46, custo: 16100, piso: 16, degrauT: 14, degrauFalta: 162750,
});

const passa = (frase) => soUsaEstesNumeros(frase, permitidos);

// ── dinheiro escrito como o Brasil escreve ──────────────────────────────────

conferir('o preço em reais e centavos passa',
  passa('Os 46 jogos custam R$ 161,00 e garantem 13 acertos entre as suas 20 dezenas.'));
conferir('e o degrau com separador de milhar também',
  passa('Por mais R$ 1.627,50 você sobe de 13 para 14 acertos garantidos.'));
conferir('e o valor em centavos, como veio no pedido', passa('São 16100 centavos.'));

// Reais inteiros só quando o valor é inteiro. R$ 161,00 é inteiro e "161"
// passa; um valor com centavos não autoriza o inteiro mais próximo, porque
// arredondar é calcular — que é o que a suíte já recusava em "cerca de 160".
conferir('reais inteiros passam quando o valor é inteiro',
  passa('Os 46 jogos custam 161 e garantem 13 acertos.'));
conferir('e o arredondamento de um valor com centavos não passa',
  !soUsaEstesNumeros('custa 1628 reais', permitidos), 'R$ 1.627,50 não autoriza 1628');

// O ponto final de uma frase não pode virar parte do número.
conferir('um número no fim da frase ainda é o número',
  passa('A garantia é de 13 acertos entre as suas 20.'));
conferir('e um dígito trocado no fim continua sendo recusado',
  !passa('A garantia é de 13 acertos entre as suas 21.'));

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
