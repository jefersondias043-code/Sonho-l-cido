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
 *   PARCIAL          a cobertura não fechou. Tem três leituras, e a frase
 *                    distingue as três: parou no meio da subida ao piso; chegou
 *                    ao piso e ele não bastou; ou já estava na construção
 *                    avançada, acrescentando cartelas acima do piso. Só a
 *                    segunda autoriza concluir alguma coisa.
 *
 * Passando do piso, a coleção deixa de ser candidata a mínima e o veredito cai
 * para INTERVALO — "encontrado 344, mínimo comprovado ≥ 160" —, que é a verdade
 * e a única coisa que pode ser dita ali.
 *
 * O quinto, FALHA, é para quando não havia teto e a coleção mesmo assim não
 * cobre: aí é defeito, e aparece em vez de ser engolido.
 */

export const MINIMO = 'minimo';
export const MINIMO_CICLICO = 'minimo-ciclico';
export const INTERVALO = 'intervalo';
export const PARCIAL = 'parcial';
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
export function veredito({ verificado, encontrado, piso, ciclicaFechou, teto }) {
  // Não fechou dentro do teto. Não é defeito: é o resultado de um pedido em que
  // o número de cartelas está preso ao piso, e o piso pode simplesmente não
  // bastar. O que se tem é a melhor cobertura alcançada com aquele número.
  if (!verificado) return teto ? PARCIAL : FALHA;
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
export function frase({
  verificado,
  encontrado,
  piso,
  ciclicaFechou,
  descobertos = 0,
  teto = 0,
  cobertura = 0,
  alemDoPiso = false,
}) {
  const alcancado = `${(cobertura * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
  switch (veredito({ verificado, encontrado, piso, ciclicaFechou, teto })) {
    case PARCIAL:
      return fraseParcial(encontrado, piso, teto, alcancado, alemDoPiso);
    case FALHA:
      return `A construção deixou ${milhar(descobertos)} alvos descobertos.`;
    case MINIMO:
      return `Mínimo exato: ${milhar(encontrado)} cartelas — provado, nada menor existe.`;
    case MINIMO_CICLICO:
      return (
        `Solução encontrada: ${milhar(encontrado)} · Mínimo comprovado: ≥ ${milhar(piso)} · ` +
        `Nenhuma solução com simetria de rotação é menor.`
      );
    default:
      return `Solução encontrada: ${milhar(encontrado)} · Mínimo comprovado: ≥ ${milhar(piso)}`;
  }
}

/**
 * A cobertura não fechou — e há duas razões muito diferentes para isso.
 *
 * **Parou no meio.** Alguém mandou parar antes de a escalada chegar ao teto. O
 * conjunto tem menos cartelas do que ainda pode ter, e a cobertura baixa é
 * consequência disso: faltam cartelas a acrescentar. Não há conclusão
 * matemática nenhuma aqui, só trabalho interrompido.
 *
 * **Encostou no teto e não bastou.** A escalada usou todas as cartelas que o
 * piso permite e a cobertura ainda não fechou. Aí sim há o que afirmar: nada
 * menor que o piso existe, e o piso não basta.
 *
 * A versão anterior escrevia a segunda frase nos dois casos, sempre com o
 * **teto** no lugar da quantidade de cartelas. Quem parasse com 911 de um teto
 * de 1.537 lia "Com 1537 cartelas, a melhor cobertura que alcancei foi 58,7%" —
 * o aplicativo afirmando que a pessoa tinha 626 cartelas que ela não tinha, e
 * apresentando trabalho interrompido como conclusão. Num aplicativo que existe
 * para nunca afirmar o que não pode provar, é o pior tipo de defeito.
 */
function fraseParcial(encontrado, piso, teto, alcancado, alemDoPiso) {
  // Na construção avançada não há teto: o piso se esgotou e a subida voltou a
  // acrescentar cartelas até fechar. Falar em teto aqui seria inventar um
  // limite que não existe mais.
  if (alemDoPiso) {
    return (
      `Parei com ${milhar(encontrado)} cartelas, cobrindo ${alcancado}. ` +
      `O piso de ${milhar(piso)} não bastou, e a construção avançada estava ` +
      `acrescentando cartelas — continuar retoma daqui.`
    );
  }
  if (teto > 0 && encontrado < teto) {
    return (
      `Parei com ${milhar(encontrado)} cartelas de um teto de ${milhar(teto)}, ` +
      `cobrindo ${alcancado}. Ainda há cartelas a acrescentar — continuar retoma daqui.`
    );
  }
  return (
    `Com ${milhar(encontrado)} cartelas — o teto —, a melhor cobertura que alcancei ` +
    `foi ${alcancado}. O piso diz que nada menor que ${milhar(piso)} existe; ` +
    `não diz que ${milhar(piso)} basta.`
  );
}

/**
 * Números como o resto da tela os escreve.
 *
 * Sem isto a frase mais lida do aplicativo dizia "27124 cartelas" logo acima de
 * um quadro que dizia "27.124" — o mesmo número em duas grafias, na única linha
 * que alguém lê se for ler uma só.
 */
function milhar(n) {
  return Number(n).toLocaleString('pt-BR');
}
