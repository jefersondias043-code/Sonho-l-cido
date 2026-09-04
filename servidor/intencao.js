// Texto livre → pedido, sob esquema estrito.
//
// A pessoa escreve "trezentos reais, vinte dezenas, quero garantir 14" e o que
// sai daqui é `{orcamento, dezenas[], garantiaMinima}` — três números e nada
// mais. O modelo **não** escolhe bilhetes, não calcula mínimo, não estima
// cobertura e não vê o catálogo: ele traduz português para três campos.
//
// A chave nunca sai do servidor. Resposta fora do esquema é descartada em
// silêncio, e o caminho alternativo — um leitor determinístico, sem modelo
// nenhum — responde no lugar. O aplicativo funciona inteiro sem esta função.
//
// Handler no formato Web padrão: serve em Cloudflare Workers, Deno Deploy,
// Vercel Edge e qualquer runtime que fale `Request`/`Response`.

const TEMPO_LIMITE = 4000;
const MODELO = 'claude-haiku-4-5-20251001';

const ESQUEMA = {
  type: 'object',
  properties: {
    orcamento: { type: 'number', description: 'Quanto gastar, em reais.' },
    dezenas: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 25 },
      description: 'Dezenas escolhidas. Vazio quando a pessoa não nomeou nenhuma.',
    },
    quantasDezenas: {
      type: 'integer',
      minimum: 0,
      maximum: 25,
      description: 'Quantas dezenas jogar, quando a pessoa diz o número mas não quais.',
    },
    garantiaMinima: { type: 'integer', minimum: 0, maximum: 15 },
  },
  required: ['orcamento', 'dezenas', 'quantasDezenas', 'garantiaMinima'],
  additionalProperties: false,
};

export default {
  async fetch(pedido, ambiente) {
    if (pedido.method !== 'POST') return new Response('use POST', { status: 405 });

    const { texto } = await pedido.json().catch(() => ({}));
    if (typeof texto !== 'string' || texto.length === 0 || texto.length > 500) {
      return json({ erro: 'texto ausente ou longo demais' }, 400);
    }

    const doModelo = await perguntarAoModelo(texto, ambiente?.ANTHROPIC_API_KEY);
    const resposta = validar(doModelo) ?? ler(texto);
    return resposta ? json(resposta) : new Response(null, { status: 204 });
  },
};

const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function perguntarAoModelo(texto, chave) {
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
        max_tokens: 300,
        tools: [{ name: 'pedido', description: 'O pedido da pessoa.', input_schema: ESQUEMA }],
        tool_choice: { type: 'tool', name: 'pedido' },
        system:
          'Traduza o pedido para os campos da ferramenta. Não invente dezenas que a pessoa ' +
          'não disse, não escolha fechamento, não calcule nada. Valores em reais.',
        messages: [{ role: 'user', content: texto }],
      }),
    });
    const corpo = await resposta.json();
    return corpo?.content?.find((p) => p.type === 'tool_use')?.input ?? null;
  } catch {
    return null;
  }
}

/// Só passa o que couber no esquema, campo a campo. Nada de "quase certo".
function validar(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const { orcamento, dezenas, quantasDezenas, garantiaMinima } = bruto;
  if (typeof orcamento !== 'number' || !Number.isFinite(orcamento) || orcamento <= 0) return null;
  if (!Array.isArray(dezenas)) return null;
  const limpas = dezenas.filter((d) => Number.isInteger(d) && d >= 1 && d <= 25);
  if (limpas.length !== dezenas.length || new Set(limpas).size !== limpas.length) return null;
  if (!inteiroEntre(quantasDezenas, 0, 25) || !inteiroEntre(garantiaMinima, 0, 15)) return null;
  return { orcamento, dezenas: limpas, quantasDezenas, garantiaMinima };
}

const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/// O caminho alternativo: lê o pedido sem modelo nenhum.
///
/// Não entende tudo, e não precisa — precisa nunca inventar. O que ele não
/// achar fica de fora, e a tela continua com os controles normais.
export function ler(texto) {
  const minusculo = texto.toLowerCase();
  const dinheiro = minusculo.match(/(?:r\$\s*)?(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|conto|pila)?/);
  const escrito = { cem: 100, duzentos: 200, trezentos: 300, quinhentos: 500, mil: 1000 };
  const porExtenso = Object.entries(escrito).find(([palavra]) => minusculo.includes(palavra));

  const orcamento = dinheiro
    ? Number(dinheiro[1].replace(/\./g, '').replace(',', '.'))
    : (porExtenso?.[1] ?? 0);
  if (!orcamento) return null;

  const quantas = minusculo.match(/(\d{2})\s*dezenas/);
  const garantia = minusculo.match(/garantir?\s*(?:de\s*)?(\d{2})/);
  return {
    orcamento,
    dezenas: [],
    quantasDezenas: quantas ? Math.min(25, Number(quantas[1])) : 0,
    garantiaMinima: garantia ? Math.min(15, Number(garantia[1])) : 0,
  };
}
