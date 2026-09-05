// O coração do produto: dado o dinheiro e as dezenas, qual fechamento comprar.
//
// Função pura sobre o índice do catálogo. Sem rede, sem navegador, sem modelo
// de linguagem — o que entra é número e o que sai é número. É o único módulo
// que decide algo, e por isso é o único que precisa ser testável sozinho.

/// Só existe volante de 15 a 20 dezenas. O catálogo vai até 25 porque a
/// matemática vai, mas ninguém aposta um bilhete de 22 dezenas.
export const JOGOS_QUE_A_LOTERICA_ACEITA = [15, 16, 17, 18, 19, 20];

export function custoDe(entrada, precos) {
  const unitario = precos.aposta[entrada.k];
  if (!unitario || entrada.jogos == null) return null;
  return entrada.jogos * unitario;
}

/// A escada: em que valores de orçamento a resposta muda, e para o quê.
///
/// Só os degraus que alguém compraria. Uma opção que custa o mesmo (ou mais) e
/// garante menos que outra já listada não é degrau nenhum — é dinheiro jogado
/// fora, e mostrá-la faria a escada mentir sobre o que o dinheiro compra. Em 20
/// dezenas, garantir 11 e garantir 12 custam os mesmos R$ 14: só o 12 é degrau.
///
/// Daí sai uma propriedade que decide o resto do módulo: **preço e garantia
/// sobem juntos**, porque a lista é percorrida em ordem de preço e só entra
/// quem garante mais que todos os anteriores. Uma escada assim responde tudo
/// sem mais nenhuma busca — a escolha é o último degrau que cabe no bolso, o
/// próximo passo é o degrau seguinte, e o preço de uma garantia pedida é o
/// primeiro degrau que a alcança.
export function escada(indice, precos, dezenas) {
  const porGarantia = new Map();
  for (const e of indice.entradas) {
    if (e.v !== dezenas || e.soma === 0 || e.jogos == null) continue;
    if (!JOGOS_QUE_A_LOTERICA_ACEITA.includes(e.k) || !precos.aposta[e.k]) continue;
    const com = { ...e, custo: custoDe(e, precos) };
    const atual = porGarantia.get(e.t);
    if (!atual || com.custo < atual.custo) porGarantia.set(e.t, com);
  }
  const degraus = [];
  let melhorAteAqui = 0;
  for (const e of [...porGarantia.values()].sort((a, b) => a.custo - b.custo || b.t - a.t)) {
    if (e.t <= melhorAteAqui) continue;
    melhorAteAqui = e.t;
    degraus.push(e);
  }
  return degraus;
}

const passo = (degrau, orcamento) =>
  (degrau ? { ...degrau, falta: degrau.custo - orcamento } : null);

/// A resposta do aplicativo a "como gasto melhor este dinheiro".
///
/// `pedido` é `{ orcamento, dezenas, garantiaMinima? }`, com o orçamento em
/// centavos e `dezenas` sendo **quantas** dezenas a pessoa marcou.
export function melhorEstrategia(indice, precos, pedido) {
  const { orcamento, dezenas, garantiaMinima = 0 } = pedido;

  if (dezenas < 15) {
    return { motivo: 'poucas-dezenas', faltam: 15 - dezenas, escolha: null };
  }

  const degraus = escada(indice, precos, dezenas);
  if (degraus.length === 0) return { motivo: 'sem-catalogo', escolha: null };

  // A escada sobe de preço, então o que cabe no bolso é sempre um prefixo dela.
  const cabem = degraus.filter((e) => e.custo <= orcamento).length;
  if (cabem === 0) {
    // Nem o mais barato cabe. Dizer isso, e dizer quanto falta, vale mais do
    // que uma tela vazia.
    return {
      motivo: 'sem-dinheiro',
      escolha: null,
      maisBarato: degraus[0],
      falta: degraus[0].custo - orcamento,
    };
  }

  const escolha = degraus[cabem - 1];
  return {
    // Um bilhete só não é fechamento: não há jogos se completando para cobrir
    // o que falta a cada um. Chamar aquilo de garantia esconde da pessoa o que
    // ela comprou, que é um bilhete — e, se ela marcou mais dezenas do que
    // cabem nele, esconde também que parte do que ela escolheu não vai ser
    // jogada.
    motivo: escolha.jogos === 1 ? 'um-bilhete' : 'ok',
    escolha,
    sobra: orcamento - escolha.custo,
    // O próximo degrau: a garantia seguinte, e quanto falta para ela. É o
    // número que ensina a economia do problema sem uma linha de explicação
    // técnica — *"por mais R$ 118 você sobe de 13 para 14 acertos garantidos"*.
    degrau: passo(degraus[cabem], orcamento),
    // E o outro lado da mesma pergunta: quando a pessoa diz de quanto quer a
    // garantia, quanto custa exatamente isso. `degrau: null` aqui quer dizer
    // que o catálogo não alcança tanto com estas dezenas.
    pedido: garantiaMinima > escolha.t
      ? { t: garantiaMinima, degrau: passo(degraus.find((e) => e.t >= garantiaMinima), orcamento) }
      : null,
  };
}

/// Quantas dezenas marcar, quando a pessoa pede que o aplicativo escolha.
///
/// Não há dezena mais provável que outra — **quais** dezenas é sorteio puro. O
/// que dá para escolher bem é **quantas**, e a resposta é: o maior pool que o
/// dinheiro cobre.
///
/// Perseguir a maior garantia daria o contrário, e daria errado: garantir 15
/// acertos num pool de 15 dezenas custa um bilhete só, e vale quase nada —
/// o sorteio cai dentro de 15 dezenas escolhidas uma vez em 3.268.760. A
/// garantia só existe quando as 15 sorteadas caem no pool, então o que decide
/// não é o tamanho da promessa: é a chance de ela valer. E essa chance cresce
/// com o pool, sempre.
export function melhorPool(indice, precos, orcamento) {
  for (let v = indice.universo; v > 15; v--) {
    if (melhorEstrategia(indice, precos, { orcamento, dezenas: v }).escolha) return v;
  }
  return 15;
}
