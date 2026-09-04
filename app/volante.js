// Os bilhetes prontos: como se lê, como se copia, como se imprime, como se
// divide entre várias pessoas.

const doisDigitos = (d) => String(d).padStart(2, '0');

export function comoTexto(bilhetes) {
  return bilhetes.map((b) => b.map(doisDigitos).join(' ')).join('\n');
}

export function comoCsv(bilhetes) {
  const colunas = Array.from({ length: 15 }, (_, i) => `d${i + 1}`).join(',');
  return [colunas, ...bilhetes.map((b) => b.join(','))].join('\n');
}

/// Uma cartela desenhada como o volante: cinco colunas, 1 a 25, marcadas.
export function comoVolante(bilhete, universo = 25) {
  const marcadas = new Set(bilhete);
  const celulas = [];
  for (let d = 1; d <= universo; d++) {
    celulas.push(`<i class="${marcadas.has(d) ? 'marcada' : ''}">${doisDigitos(d)}</i>`);
  }
  return `<div class="volante">${celulas.join('')}</div>`;
}

/// Divide o fechamento em `partes` de cobertura equilibrada.
///
/// Equilibrar a cobertura é equilibrar a contagem, e isso não é aproximação: no
/// mesmo fechamento todos os bilhetes têm o mesmo tamanho, e um bilhete de `k`
/// dezenas atende sempre a mesma quantidade de sorteios, quaisquer que sejam as
/// dezenas nele. Então partes com o mesmo número de bilhetes carregam o mesmo
/// peso de cobertura.
///
/// A distribuição é alternada sobre a lista ordenada: cada pessoa leva bilhetes
/// espalhados por todo o fechamento, e não um bloco contíguo — bilhetes vizinhos
/// na ordem se parecem, e um bloco contíguo concentraria a semelhança numa
/// pessoa só. As partes diferem em no máximo um bilhete.
export function dividir(bilhetes, partes) {
  const grupos = Array.from({ length: partes }, () => []);
  bilhetes.forEach((b, i) => grupos[i % partes].push(b));
  return grupos;
}

/// O endereço de uma parte do bolão.
///
/// Leva só o que descreve o pedido — dezenas, combinação e qual parte. Os
/// bilhetes daquela pessoa saem do mesmo catálogo, no aparelho dela.
export function linkDaParte(base, { dezenas, v, k, t, parte, partes }) {
  const busca = new URLSearchParams({
    d: [...dezenas].sort((a, b) => a - b).join('.'),
    f: `${v}-${k}-${t}`,
    p: `${parte}.${partes}`,
  });
  return `${base}#${busca}`;
}

/// Lê um endereço de bolão. Devolve `null` quando não há um, ou quando o que
/// há não passa na validação — endereço estranho não pode virar estado.
export function lerLink(hash, universo = 25) {
  if (!hash || hash.length < 2) return null;
  const busca = new URLSearchParams(hash.slice(1));
  const dezenas = (busca.get('d') ?? '')
    .split('.')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= universo);
  const combinacao = (busca.get('f') ?? '').split('-').map(Number);
  const divisao = (busca.get('p') ?? '').split('.').map(Number);

  if (new Set(dezenas).size !== dezenas.length || dezenas.length < 15) return null;
  if (combinacao.length !== 3 || combinacao.some((n) => !Number.isInteger(n))) return null;
  const [v, k, t] = combinacao;
  if (v !== dezenas.length) return null;

  const [parte, partes] = divisao;
  const temParte = Number.isInteger(parte) && Number.isInteger(partes) && partes > 1
    && parte >= 0 && parte < partes;
  return { dezenas, v, k, t, parte: temParte ? parte : null, partes: temParte ? partes : null };
}

/// Copia para a área de transferência, com caminho alternativo para quando o
/// navegador não deixa.
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.setAttribute('readonly', '');
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.append(campo);
    campo.select();
    const deu = document.execCommand?.('copy') ?? false;
    campo.remove();
    return deu;
  }
}

/// Oferece um arquivo para salvar.
export function baixar(nome, conteudo, tipo = 'text/plain') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
  const alvo = document.createElement('a');
  alvo.href = url;
  alvo.download = nome;
  alvo.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
