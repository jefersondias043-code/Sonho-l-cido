// Números já calculados → uma frase.
//
// O que entra aqui já foi decidido pelo catálogo: pool, tamanho de jogo,
// garantia, quantidade de bilhetes, custo, e o degrau seguinte. O modelo
// escreve **uma frase** sobre a troca entre dinheiro e garantia, e não está
// autorizado a introduzir número nenhum.
//
// A regra é cobrada duas vezes: aqui, antes de a frase sair do servidor, e de
// novo no cliente, antes de ela tocar a tela. Frase com um número que não veio
// no pedido é descartada, e a frase determinística fica no lugar.

const TEMPO_LIMITE = 4000;
const MODELO = 'claude-haiku-4-5-20251001';

export default {
  async fetch(pedido, ambiente) {
    if (pedido.method !== 'POST') return new Response('use POST', { status: 405 });

    const dados = await pedido.json().catch(() => null);
    const numeros = numerosDe(dados);
    if (!numeros) return new Response(null, { status: 204 });

    const frase = await escrever(dados, ambiente?.ANTHROPIC_API_KEY);
    if (!frase || !soUsaEstesNumeros(frase, numeros)) return new Response(null, { status: 204 });

    return new Response(JSON.stringify({ frase }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};

/// Todo número que a frase tem direito de usar, como texto.
///
/// Devolve `null` quando o pedido não é um pedido — assim nenhuma chamada sai
/// daqui com dado inventado.
///
/// Exportada para a suíte: um teste que monta o conjunto à mão testa o conjunto
/// que ele mesmo montou. Foi assim que passou despercebido por dias que nenhuma
/// frase com preço em reais chegava à tela.
export function numerosDe(d) {
  if (!d || typeof d !== 'object') return null;
  // Dois assuntos, um contrato: só entram números, e a frase só pode usar os
  // que entraram. A escolha traz a combinação e o preço; o sorteio, o que saiu.
  //
  // Contagem e dinheiro entram por portas diferentes, e isso não é asseio: o
  // que é dinheiro chega em centavos e vai ser escrito em reais, com vírgula.
  const [contas, dinheiros] = d.assunto === 'sorteio'
    ? [[d.melhor, d.jogos], [d.custo, d.voltou]]
    : [[d.v, d.k, d.t, d.jogos, d.piso, d.degrauT], [d.custo, d.degrauFalta]];
  const obrigatorios = d.assunto === 'sorteio'
    ? [d.melhor, d.jogos, d.custo, d.voltou]
    : [d.v, d.k, d.t, d.jogos];
  if (obrigatorios.some((n) => !Number.isFinite(n))) return null;
  return new Set([
    ...contas.filter(Number.isFinite).map(String),
    ...dinheiros.filter(Number.isFinite).flatMap(comoSeEscreve),
  ]);
}

const CENTAVOS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/// Um valor em centavos, em toda forma exata de escrevê-lo — e só nas exatas.
///
/// "R$ 199,50" é como o Brasil escreve dinheiro, e é onde a regra falhava: a
/// frase virava os números 199 e 50, nenhum dos dois autorizado, e era
/// descartada justamente quando dizia o que o modelo foi chamado a explicar.
///
/// Reais inteiros só entram quando o valor **é** inteiro. Antes entrava o
/// arredondamento, e arredondar é calcular: com R$ 199,50 no pedido, "200
/// reais" passava — o mesmo tipo de conta que a suíte recusa em "cerca de 160".
const comoSeEscreve = (centavos) => [
  String(centavos),
  (centavos / 100).toLocaleString('pt-BR', CENTAVOS),
  ...(centavos % 100 === 0 ? [String(centavos / 100)] : []),
];

/// Como um número aparece num texto em português: com ponto separando milhar e
/// vírgula separando centavos. O ponto só conta como separador quando vêm três
/// dígitos atrás dele — senão o ponto final de "são 15." entraria no número.
const NUMEROS = /\d+(?:\.\d{3})*(?:,\d+)?/g;

/// A frase pode escrever palavras à vontade. Números, só os que recebeu.
export function soUsaEstesNumeros(frase, permitidos) {
  return (frase.match(NUMEROS) ?? []).every((n) => permitidos.has(n));
}

async function escrever(d, chave) {
  if (!chave) return null;
  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(TEMPO_LIMITE),
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 150,
        system:
          `Escreva UMA frase em português do Brasil, no máximo 30 palavras, sobre ${
            d.assunto === 'sorteio'
              ? 'o que este fechamento de loteria rendeu no sorteio que acabou de sair'
              : 'a troca entre dinheiro e garantia neste fechamento de loteria'
          }. Use apenas os números que estiverem no pedido; não calcule, não some, não ` +
          'arredonde e não invente nenhum outro. Sem promessa de lucro, sem consolo e sem ' +
          'previsão do próximo concurso. Sem exclamação.',
        messages: [{ role: 'user', content: JSON.stringify(d) }],
      }),
    });
    const corpo = await resposta.json();
    const texto = corpo?.content?.find((p) => p.type === 'text')?.text?.trim();
    return typeof texto === 'string' && texto.length > 0 && texto.length <= 300 ? texto : null;
  } catch {
    return null;
  }
}
