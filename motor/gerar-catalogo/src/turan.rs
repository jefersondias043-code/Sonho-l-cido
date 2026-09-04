//! Construções fechadas para a garantia total (`t = 15`).
//!
//! Quando a garantia é o sorteio inteiro, o bilhete precisa **conter** as 15
//! dezenas. No avesso — `a = v − k` dezenas faltando ao bilhete, `b = v − 15`
//! faltando ao sorteio — isso vira *"as `a` que faltam ao bilhete estão entre as
//! `b` que faltam ao sorteio"*, que é um sistema de Turán.
//!
//! Este módulo escreve essa família por fórmula, sem busca nenhuma. Serve de
//! ponto de partida para o motor e, em `a ≤ 2`, já é o valor exato.
//!
//! O conteúdo é a mesma matemática do gerador da Lotinha, isolada aqui porque
//! agora ela é um caso particular — a linha `t = 15` de um catálogo que tem
//! quatro outras.

use std::collections::HashMap;

/// Impossível: não existe família que sirva. Longe do topo de `u64` para que
/// somas com este valor não estourem.
const INVIAVEL: u64 = u64::MAX / 4;

pub fn binomial(n: usize, k: usize) -> u64 {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    let mut total: u128 = 1;
    for i in 0..k {
        total = total * (n - i) as u128 / (i as u128 + 1);
        if total > u64::MAX as u128 {
            return u64::MAX;
        }
    }
    total as u64
}

/// Quantos `a`-subconjuntos de `[v]` bastam para que todo `b`-subconjunto
/// contenha um deles, pela melhor construção fechada que este programa conhece.
///
/// Três argumentos disputam, e vale o menor:
///
/// 1. **tudo** — todos os `C(v,a)`. Sempre serve, quase sempre é desperdício.
/// 2. **por um ponto** — `N(v,a,b) ≤ N(v−1,a,b) + N(v−1,a−1,b−1)`.
/// 3. **por grupos** — parta `[v]` em `g` partes; um `b`-conjunto deixa `⌈b/g⌉`
///    elementos em alguma parte pela casa dos pombos.
///
/// Mede antes de construir porque materializar o ramo perdedor custaria
/// centenas de milhares de conjuntos jogados fora.
pub fn tamanho(v: usize, a: usize, b: usize, memo: &mut HashMap<(usize, usize, usize), u64>) -> u64 {
    if a > b || b > v {
        return INVIAVEL;
    }
    if a == 0 || v == b {
        return 1;
    }
    if a == b {
        return binomial(v, b);
    }
    if a == 1 {
        return (v - b + 1) as u64;
    }
    if let Some(&pronto) = memo.get(&(v, a, b)) {
        return pronto;
    }

    let mut melhor = binomial(v, a);
    melhor = melhor.min(tamanho(v - 1, a, b, memo).saturating_add(tamanho(v - 1, a - 1, b - 1, memo)));

    for g in 2..=b {
        let alvo = b.div_ceil(g);
        if alvo < a {
            break; // partir mais só afrouxa a casa dos pombos
        }
        let mut total = 0u64;
        for i in 0..g {
            let tam = v / g + usize::from(i < v % g);
            total = total.saturating_add(tamanho(tam, a, alvo, memo));
            if total >= melhor {
                break;
            }
        }
        melhor = melhor.min(total);
    }

    memo.insert((v, a, b), melhor);
    melhor
}

/// A família que [`tamanho`] contou, agora materializada. Repete exatamente as
/// mesmas escolhas.
pub fn construir(
    pontos: &[usize],
    a: usize,
    b: usize,
    memo: &mut HashMap<(usize, usize, usize), u64>,
) -> Vec<Vec<usize>> {
    let v = pontos.len();
    if a == 0 {
        return vec![Vec::new()];
    }
    if v == b {
        return vec![pontos[..a].to_vec()];
    }
    if a == b {
        return combinacoes(pontos, a);
    }
    if a == 1 {
        return pontos[..v - b + 1].iter().map(|&p| vec![p]).collect();
    }

    let alvo = tamanho(v, a, b, memo);

    if alvo == binomial(v, a) {
        return combinacoes(pontos, a);
    }

    let por_ponto =
        tamanho(v - 1, a, b, memo).saturating_add(tamanho(v - 1, a - 1, b - 1, memo));
    if alvo == por_ponto {
        let x = pontos[0];
        let resto = &pontos[1..];
        let mut saida = construir(resto, a, b, memo);
        for mut menor in construir(resto, a - 1, b - 1, memo) {
            menor.push(x);
            menor.sort_unstable();
            saida.push(menor);
        }
        return saida;
    }

    for g in 2..=b {
        let alvo_do_grupo = b.div_ceil(g);
        if alvo_do_grupo < a {
            break;
        }
        let mut partes: Vec<Vec<usize>> = vec![Vec::new(); g];
        for (i, &p) in pontos.iter().enumerate() {
            partes[i % g].push(p);
        }
        let total: u64 = partes
            .iter()
            .map(|parte| tamanho(parte.len(), a, alvo_do_grupo, memo))
            .fold(0u64, |acc, n| acc.saturating_add(n));
        if total == alvo {
            let mut saida = Vec::new();
            for parte in &partes {
                saida.extend(construir(parte, a, alvo_do_grupo, memo));
            }
            return saida;
        }
    }

    unreachable!("a medida de Turán não bateu com nenhuma construção em ({v}, {a}, {b})");
}

fn combinacoes(itens: &[usize], k: usize) -> Vec<Vec<usize>> {
    let mut saida = Vec::new();
    let mut atual = Vec::with_capacity(k);
    fn passo(
        itens: &[usize],
        k: usize,
        i: usize,
        atual: &mut Vec<usize>,
        saida: &mut Vec<Vec<usize>>,
    ) {
        if atual.len() == k {
            saida.push(atual.clone());
            return;
        }
        for j in i..itens.len() {
            atual.push(itens[j]);
            passo(itens, k, j + 1, atual, saida);
            atual.pop();
        }
    }
    passo(itens, k, 0, &mut atual, &mut saida);
    saida
}

/// Todos os `k`-subconjuntos de `[0, v)`, como listas de índices.
pub fn todos_os_subconjuntos(v: usize, k: usize) -> Vec<Vec<usize>> {
    combinacoes(&(0..v).collect::<Vec<_>>(), k)
}

#[cfg(test)]
mod testes {
    use super::*;

    /// Toda família construída de fato cobre, e tem o tamanho que a medida
    /// prometeu.
    ///
    /// A construção é recursiva e escolhe entre três ramos comparando números;
    /// um erro de contagem faria `construir` materializar um ramo diferente do
    /// que `tamanho` mediu, e o resultado sairia grande demais — ou, pior, com
    /// buraco. Aqui os dois são cobrados por força bruta: para cada
    /// `b`-subconjunto de `[v]`, algum membro da família precisa estar contido
    /// nele.
    #[test]
    fn a_construcao_cobre_e_tem_o_tamanho_medido() {
        let mut memo = HashMap::new();
        for v in 2..=12usize {
            for b in 1..=v.min(6) {
                for a in 1..=b {
                    let pontos: Vec<usize> = (0..v).collect();
                    let familia = construir(&pontos, a, b, &mut memo);
                    let medida = tamanho(v, a, b, &mut memo);

                    assert_eq!(
                        familia.len() as u64,
                        medida,
                        "({v},{a},{b}): construiu {} e mediu {medida}",
                        familia.len()
                    );

                    let mascaras: Vec<u32> =
                        familia.iter().map(|c| c.iter().fold(0u32, |m, &i| m | 1 << i)).collect();
                    for alvo in 0..(1u32 << v) {
                        if alvo.count_ones() as usize != b {
                            continue;
                        }
                        assert!(
                            mascaras.iter().any(|&f| f & alvo == f),
                            "({v},{a},{b}): o alvo {alvo:b} não contém membro nenhum"
                        );
                    }
                }
            }
        }
    }

    /// Os três casos em que o valor exato é conhecido de fórmula.
    #[test]
    fn os_casos_de_formula() {
        let mut memo = HashMap::new();
        for v in 2..=14usize {
            for b in 1..=v {
                // `a = b`: todo `b`-conjunto é ele mesmo, e nada menos serve.
                assert_eq!(tamanho(v, b, b, &mut memo), binomial(v, b), "({v},{b},{b})");
                // `a = 1`: escolher `v − b + 1` pontos garante que algum caia
                // em qualquer `b`-conjunto, e um a menos deixa um buraco.
                assert_eq!(tamanho(v, 1, b, &mut memo), (v - b + 1) as u64, "({v},1,{b})");
            }
            // `b = v`: o único `b`-conjunto é tudo, e um membro qualquer basta.
            assert_eq!(tamanho(v, 2, v, &mut memo), 1, "({v},2,{v})");
        }
    }

    /// Alargar o alvo nunca pode exigir mais membros: toda família que serve
    /// para `b` também serve para `b + 1`, porque um `(b+1)`-conjunto contém um
    /// `b`-conjunto.
    #[test]
    fn alvo_maior_nunca_custa_mais() {
        let mut memo = HashMap::new();
        for v in 3..=14usize {
            for a in 1..=5usize.min(v) {
                for b in a..v {
                    assert!(
                        tamanho(v, a, b, &mut memo) >= tamanho(v, a, b + 1, &mut memo),
                        "({v},{a},{b}) menor que ({v},{a},{})",
                        b + 1
                    );
                }
            }
        }
    }
}
