/*
 * Teste do veredito do Construtor Exato.
 *
 * Este é o módulo que decide **o que o aplicativo tem direito de afirmar**, e
 * era o único sem teste próprio — só era exercitado de lado, pela suíte de
 * navegador, que confere a frase de dois ou três casos felizes. Foi por isso que
 * um defeito grave sobreviveu: parar a escalada no meio fazia a tela dizer "Com
 * 1537 cartelas, a melhor cobertura que alcancei foi 58,7%" para quem tinha
 * 911. O aplicativo afirmava 626 cartelas que não existiam, e apresentava
 * trabalho interrompido como conclusão matemática.
 *
 * A regra que se cobra aqui é uma só, e vale para todas as frases:
 *
 *   **nunca dizer mais do que os números autorizam.**
 *
 *   node web/testar-exato-veredito.mjs
 */

import {
  frase,
  folga,
  veredito,
  MINIMO,
  MINIMO_CICLICO,
  INTERVALO,
  PARCIAL,
  FALHA,
} from './exato-veredito.js';

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

console.log('Teste do veredito do Construtor Exato\n');

/* ─── 1. qual afirmação cada situação autoriza ─── */

const situacoes = [
  ['encostou no piso', { verificado: true, encontrado: 16, piso: 16, teto: 16 }, MINIMO],
  ['abaixo do piso', { verificado: true, encontrado: 15, piso: 16, teto: 16 }, MINIMO],
  [
    'só a simetria fechou',
    { verificado: true, encontrado: 20, piso: 16, ciclicaFechou: true, teto: 16 },
    MINIMO_CICLICO,
  ],
  ['sobrou distância', { verificado: true, encontrado: 20, piso: 16, teto: 16 }, INTERVALO],
  ['não cobriu, com teto', { verificado: false, encontrado: 12, piso: 16, teto: 16 }, PARCIAL],
  ['não cobriu, sem teto', { verificado: false, encontrado: 12, piso: 16, teto: 0 }, FALHA],
];
marcar(
  situacoes.every(([, dados, esperado]) => veredito(dados) === esperado),
  'cada situação autoriza exatamente uma afirmação',
  situacoes.map(([nome]) => nome).join(' · ')
);

/* ─── 2. a palavra "mínimo" é a mais cara de errar ─── */

marcar(
  /Mínimo exato/.test(frase({ verificado: true, encontrado: 16, piso: 16, teto: 16 })),
  'onde construção e prova se encontram, a frase diz "mínimo exato"'
);
const comFolga = frase({ verificado: true, encontrado: 20, piso: 16, teto: 16 });
marcar(
  !/[Mm]ínimo exato/.test(comFolga) && /≥/.test(comFolga),
  'onde sobra distância, ela nunca diz "mínimo" sobre o que só foi encontrado',
  comFolga
);
const soCiclica = frase({
  verificado: true,
  encontrado: 20,
  piso: 16,
  ciclicaFechou: true,
  teto: 16,
});
marcar(
  /simetria de rotação/.test(soCiclica) && !/[Mm]ínimo exato/.test(soCiclica),
  'e onde só a simetria fechou, ela diz em que espaço a afirmação vale',
  soCiclica
);

/* ─── 3. o defeito que este arquivo existe para não deixar voltar ─── */

const parouNoMeio = frase({
  verificado: false,
  encontrado: 911,
  piso: 1537,
  teto: 1537,
  cobertura: 0.587,
});
marcar(
  /911/.test(parouNoMeio),
  'parar no meio da subida relata as cartelas que a pessoa tem',
  parouNoMeio
);
marcar(
  !/Com 1\.?537 cartelas/.test(parouNoMeio),
  'e nunca as que ela teria se não tivesse parado'
);
marcar(
  /continuar/i.test(parouNoMeio) && /acrescentar/.test(parouNoMeio),
  'dizendo que é trabalho interrompido, e não uma conclusão'
);

const encostouNoTeto = frase({
  verificado: false,
  encontrado: 1537,
  piso: 1537,
  teto: 1537,
  cobertura: 0.766,
});
marcar(
  /o teto/.test(encostouNoTeto) && /não diz que 1\.537 basta/.test(encostouNoTeto),
  'encostar no teto sem fechar é outra frase: aí há o que concluir',
  encostouNoTeto
);
marcar(
  parouNoMeio !== encostouNoTeto,
  'e as duas situações nunca são descritas com a mesma frase'
);

/* ─── 4. os números são escritos como no resto da tela ─── */

const grandes = [
  frase({ verificado: true, encontrado: 27124, piso: 27124, teto: 27124 }),
  frase({ verificado: true, encontrado: 3712, piso: 1254, teto: 1254 }),
  frase({ verificado: false, encontrado: 0, piso: 10, teto: 0, descobertos: 2002 }),
  frase({ verificado: false, encontrado: 911, piso: 1537, teto: 1537, cobertura: 0.5 }),
];
marcar(
  grandes.every((f) => !/\d{4,}/.test(f)),
  'nenhum número de quatro dígitos sai sem separador de milhar',
  grandes[0]
);
marcar(
  /27\.124/.test(grandes[0]) && /2\.002/.test(grandes[2]),
  'e o separador é o do português',
  grandes[2]
);

/* ─── 5. a folga ─── */

marcar(
  folga(20, 16) === 4 && folga(16, 16) === 0 && folga(12, 16) === 0,
  'a folga é o que sobra, e nunca é negativa'
);

/* ─── 6. a cobertura aparece com uma casa, sempre ─── */

marcar(
  /100,0%/.test(frase({ verificado: false, encontrado: 5, piso: 9, teto: 9, cobertura: 1 })) &&
    /8,3%/.test(frase({ verificado: false, encontrado: 1, piso: 12, teto: 12, cobertura: 1 / 12 })),
  'a cobertura sai com uma casa decimal e vírgula, nunca arredondada a inteiro'
);

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
