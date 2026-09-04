// Varredura exaustiva, no aparelho de quem duvidar.
//
// Esta é a única conta pesada do cliente, e ela existe por um motivo: a
// promessa do aplicativo é "está garantido", e quem promete deve poder ser
// cobrado na hora. O que roda aqui não consulta o catálogo, não confia no
// índice e não fala com servidor nenhum — percorre **todos** os sorteios
// possíveis dentro das dezenas marcadas e mede o pior caso.
//
// Sem web worker: a varredura cede o processador a cada fatia, então a tela
// continua respondendo enquanto ela roda.

const FATIA = 150000;

/// Percorre os `C(v,15)` sorteios possíveis e devolve o pior resultado.
///
/// `mascaras` são os bilhetes como bits sobre as posições do pool.
export async function varrer(mascaras, v, sorteio = 15) {
  const teto = 1 << v;
  const distribuicao = new Array(16).fill(0);
  let x = (1 << sorteio) - 1;
  let total = 0;
  let desdeAPausa = 0;

  while (x < teto) {
    let melhor = 0;
    for (let i = 0; i < mascaras.length; i++) {
      const acertos = contar(mascaras[i] & x);
      if (acertos > melhor) melhor = acertos;
      if (melhor === sorteio) break;
    }
    distribuicao[melhor]++;
    total++;

    const menor = x & -x;
    const soma = x + menor;
    x = soma | ((((x ^ soma) >>> 2) / menor) | 0);

    if (++desdeAPausa >= FATIA) {
      desdeAPausa = 0;
      await new Promise((pronto) => setTimeout(pronto, 0));
    }
  }

  const pior = distribuicao.findIndex((n) => n > 0);
  return { sorteios: total, pior, distribuicao };
}

function contar(n) {
  let c = 0;
  for (let m = n; m; m &= m - 1) c++;
  return c;
}

/// Quantos acertos cada bilhete fez num sorteio de verdade.
///
/// `bilhetes` são listas de dezenas; `sorteadas`, as 15 que saíram. Devolve as
/// faixas de 11 a 15 e o total por faixa.
export function contraOSorteio(bilhetes, sorteadas) {
  const saiu = new Set(sorteadas);
  const faixas = new Map();
  const porBilhete = bilhetes.map((b) => {
    const acertos = b.reduce((soma, d) => soma + (saiu.has(d) ? 1 : 0), 0);
    if (acertos >= 11) faixas.set(acertos, (faixas.get(acertos) ?? 0) + 1);
    return acertos;
  });
  return {
    porBilhete,
    faixas,
    melhor: porBilhete.length ? Math.max(...porBilhete) : 0,
  };
}

/// Quanto voltou: soma dos prêmios das faixas premiadas.
export function retorno(faixas, premios) {
  let total = 0;
  for (const [acertos, quantos] of faixas) total += quantos * (premios[acertos] ?? 0);
  return total;
}
