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

// Candidatas a resposta: mesmo pool, bilhetes publicados, tamanho de jogo que
// a lotérica aceita, preço conhecido.
function candidatas(indice, precos, dezenas) {
  return indice.entradas
    .filter(
      (e) =>
        e.v === dezenas &&
        e.soma !== 0 &&
        e.jogos != null &&
        JOGOS_QUE_A_LOTERICA_ACEITA.includes(e.k) &&
        precos.aposta[e.k],
    )
    .map((e) => ({ ...e, custo: custoDe(e, precos) }))
    // Mais garantia primeiro. Empatada a garantia, o mais barato — é o que
    // deixa a escada fazer sentido: o degrau seguinte é sempre mais caro
    // porque garante mais, nunca porque a resposta atual foi mal escolhida.
    // E empatado o preço, quem tem mais bilhetes, que é mais chance pelo mesmo
    // dinheiro.
    .sort((a, b) => b.t - a.t || a.custo - b.custo || b.jogos - a.jogos);
}

/// A resposta do aplicativo a "como gasto melhor este dinheiro".
///
/// `pedido` é `{ orcamento, dezenas, garantiaMinima? }`, com o orçamento em
/// centavos e `dezenas` sendo **quantas** dezenas a pessoa marcou.
export function melhorEstrategia(indice, precos, pedido) {
  const { orcamento, dezenas, garantiaMinima = 0 } = pedido;

  if (dezenas < 15) {
    return { motivo: 'poucas-dezenas', faltam: 15 - dezenas, escolha: null };
  }

  const lista = candidatas(indice, precos, dezenas);
  if (lista.length === 0) {
    return { motivo: 'sem-catalogo', escolha: null };
  }

  const cabem = lista.filter((e) => e.custo <= orcamento);
  if (cabem.length === 0) {
    // Nem o mais barato cabe. Dizer isso, e dizer quanto falta, vale mais do
    // que uma tela vazia.
    const maisBarato = lista.reduce((a, b) => (b.custo < a.custo ? b : a));
    return {
      motivo: 'sem-dinheiro',
      escolha: null,
      maisBarato,
      falta: maisBarato.custo - orcamento,
    };
  }

  // O pedido de garantia mínima é uma preferência, não uma ordem: se não couber
  // no dinheiro, a resposta é a melhor que cabe, dizendo que ficou abaixo.
  const noPedido = cabem.filter((e) => e.t >= garantiaMinima);
  const escolha = (noPedido.length ? noPedido : cabem)[0];

  return {
    motivo: 'ok',
    escolha,
    sobra: orcamento - escolha.custo,
    abaixoDoPedido: garantiaMinima > escolha.t,
    degrau: degrauSeguinte(lista, escolha, orcamento),
  };
}

/// O próximo degrau: a garantia seguinte mais barata, e quanto falta para ela.
///
/// É o número que ensina a economia do problema sem uma linha de explicação
/// técnica — *"por mais R$ 118 você sobe de 13 para 14 acertos garantidos"*.
function degrauSeguinte(lista, escolha, orcamento) {
  const acima = lista.filter((e) => e.t > escolha.t);
  if (acima.length === 0) return null;
  const alvo = acima.reduce((a, b) => (b.custo < a.custo ? b : a));
  return { ...alvo, falta: Math.max(0, alvo.custo - orcamento), de: escolha.t };
}

/// A escada: em que valores de orçamento a resposta muda, e para o quê.
///
/// Só os degraus que alguém compraria. Uma opção que custa o mesmo (ou mais) e
/// garante menos que outra já listada não é degrau nenhum — é dinheiro jogado
/// fora, e mostrá-la faria a escada mentir sobre o que o dinheiro compra. Em 20
/// dezenas, garantir 11 e garantir 12 custam os mesmos R$ 14: só o 12 é degrau.
export function escada(indice, precos, dezenas) {
  const porGarantia = new Map();
  for (const e of candidatas(indice, precos, dezenas)) {
    const atual = porGarantia.get(e.t);
    if (!atual || e.custo < atual.custo) porGarantia.set(e.t, e);
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
