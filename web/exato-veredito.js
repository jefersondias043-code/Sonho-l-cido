/*
 * A leitura honesta dos dois números.
 *
 * Este módulo não toca na tela e não chama o motor: recebe números e devolve
 * qual afirmação eles autorizam. Está separado porque é a regra que o
 * aplicativo inteiro existe para respeitar, e uma regra assim precisa poder ser
 * testada sozinha, sem navegador e sem WebAssembly.
 *
 * Os três estados que importam:
 *
 *   MINIMO           encontrado == piso. Construção e prova se encontraram.
 *   MINIMO_CICLICO   nenhuma solução com simetria de rotação é menor. Fora da
 *                    simetria, não se sabe — e a frase diz isso.
 *   INTERVALO        achou X, provou ≥ Y, e sobrou distância.
 *
 * O quarto, FALHA, é para quando a construção não cobre: é defeito, e aparece
 * em vez de ser engolido.
 */

export const MINIMO = 'minimo';
export const MINIMO_CICLICO = 'minimo-ciclico';
export const INTERVALO = 'intervalo';
export const FALHA = 'falha';

/** O que sobra entre o que se tem e o que se provou. Nunca negativo. */
export function folga(encontrado, piso) {
  return Math.max(0, encontrado - piso);
}

/**
 * Qual afirmação os números autorizam.
 *
 * A ordem das perguntas é a própria hierarquia das afirmações: uma construção
 * que não cobre não autoriza nada; encostar no piso é a afirmação mais forte;
 * a simetria vem depois, porque vale num espaço menor; e o intervalo é o que
 * resta quando nenhuma das duas fecha.
 */
export function veredito({ verificado, encontrado, piso, ciclicaFechou }) {
  if (!verificado) return FALHA;
  if (encontrado <= piso) return MINIMO;
  if (ciclicaFechou) return MINIMO_CICLICO;
  return INTERVALO;
}

/**
 * A frase que a tela mostra.
 *
 * Nunca escreve "mínimo" sobre um número que só foi encontrado. Onde há folga,
 * os dois números aparecem separados, com o sinal de maior-ou-igual à vista —
 * é a diferença entre o que se sabe e o que se conseguiu.
 */
export function frase({ verificado, encontrado, piso, ciclicaFechou, descobertos = 0 }) {
  switch (veredito({ verificado, encontrado, piso, ciclicaFechou })) {
    case FALHA:
      return `A construção deixou ${descobertos} alvos descobertos.`;
    case MINIMO:
      return `Mínimo exato: ${encontrado} cartelas — provado, nada menor existe.`;
    case MINIMO_CICLICO:
      return (
        `Solução encontrada: ${encontrado} · Mínimo comprovado: ≥ ${piso} · ` +
        `Nenhuma solução com simetria de rotação é menor.`
      );
    default:
      return `Solução encontrada: ${encontrado} · Mínimo comprovado: ≥ ${piso}`;
  }
}
