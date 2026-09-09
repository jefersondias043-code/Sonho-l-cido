//! Construções fechadas, para **qualquer** garantia.
//!
//! No avesso — `a = v − k` dezenas faltando ao bilhete, `b = v − 15` faltando ao
//! sorteio — a regra do fechamento vira uma só:
//!
//! ```text
//! |K ∩ S| ≥ t   ⟺   |M ∩ T| ≥ t + a − 15 =: t'
//! ```
//!
//! Com `t' = a` isso é *"as `a` que faltam ao bilhete estão entre as `b` que
//! faltam ao sorteio"* — um sistema de Turán, e é a linha `t = 15`. Com
//! `t' < a` a exigência afrouxa: basta que `t'` delas estejam ali.
//!
//! ## Por que o módulo deixou de ser só de Turán
//!
//! Ele escrevia família por fórmula só para `t' = a`, e nas outras quatro
//! linhas do catálogo o gerador não tinha construção nenhuma: partia do
//! catálogo anterior e entregava tudo ao motor. Medido no catálogo publicado,
//! é justamente ali que a distância até o piso é maior — **92 das 112 entradas
//! acima do piso têm `t < 15`**, com razão mediana de 3,9× em `t = 13` contra
//! 2,0× em `t = 15`.
//!
//! As três ideias de sempre valem inteiras com `t' < a`, e entrou uma quarta.
//! Medida contra o catálogo publicado, a família assim construída **já nasce
//! menor em nove entradas** — `25/19/12` cai de 9 para 4 cartelas, `24/18/12`
//! de 8 para 4, e `25/22/14` de 11 para 8, que é o piso provado.
//!
//! O conteúdo é a mesma matemática do gerador da Lotinha, generalizada.

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

/// A chave do memo: `(v, a, b, t')`.
pub type Chave = (usize, usize, usize, usize);
pub type Memo = HashMap<Chave, u64>;

/// Quantos `a`-subconjuntos de `[v]` bastam para que todo `b`-subconjunto
/// encontre algum deles em ao menos `t'` elementos, pela melhor construção
/// fechada que este programa conhece.
///
/// Quatro argumentos disputam, e vale o menor:
///
/// 1. **tudo** — todos os `C(v,a)`. Sempre serve, quase sempre é desperdício.
/// 2. **por um ponto** — fixa-se `x`. Ou `x` está no `b`-conjunto, e aí sobra um
///    `(b−1)`-conjunto do resto para uma família de `(a−1)` com garantia `t'−1`,
///    com `x` acrescentado a cada membro; ou não está, e serve uma família do
///    resto inteira:
///    `N(v,a,b,t') ≤ N(v−1,a−1,b−1,t'−1) + N(v−1,a,b,t')`.
/// 3. **por grupos** — parta `[v]` em `g` partes; um `b`-conjunto deixa `⌈b/g⌉`
///    elementos em alguma parte pela casa dos pombos, e ali dentro o problema é
///    o mesmo, menor.
/// 4. **por grupos com sobra** — `g` grupos disjuntos de `s` dezenas que **não
///    cobrem tudo**. As `v − g·s` de fora não recebem cartela nenhuma, e é
///    justamente isso que concentra o sorteio nos grupos que existem em vez de
///    diluí-lo em partes demais. Onde a partição inteira exige `g` grande — e
///    `⌈b/g⌉` pequeno —, deixar dezenas de fora paga.
///
/// A monotonia fecha a conta: uma família que serve para uma cartela menor, um
/// sorteio menor ou uma garantia maior também serve aqui, então os três vizinhos
/// entram na disputa. É de graça e às vezes é o que ganha.
///
/// Mede antes de construir porque materializar o ramo perdedor custaria
/// centenas de milhares de conjuntos jogados fora.
pub fn tamanho(v: usize, a: usize, b: usize, t_linha: usize, memo: &mut Memo) -> u64 {
    if t_linha == 0 {
        return 1; // nada a exigir: um membro qualquer serve
    }
    if a > v || b > v || t_linha > a.min(b) {
        return INVIAVEL; // `|M ∩ T| ≤ min(a, b)`
    }
    if a + b >= v + t_linha {
        return 1; // toda interseção já é grande o bastante
    }
    if let Some(&pronto) = memo.get(&(v, a, b, t_linha)) {
        return pronto;
    }
    // Guarda contra a recursão que se encontra: a monotonia e os grupos com
    // sobra chamam estados vizinhos, e sem uma marca no memo um ciclo entre
    // dois deles não teria fim.
    memo.insert((v, a, b, t_linha), INVIAVEL);

    let mut melhor = binomial(v, a);

    // 2 — por um ponto
    let esquerda = tamanho(v - 1, a.saturating_sub(1), b - 1, t_linha - 1, memo);
    let direita = tamanho(v - 1, a, b, t_linha, memo);
    if a >= 1 {
        melhor = melhor.min(esquerda.saturating_add(direita));
    }

    // 3 — por grupos
    for g in 2..=b {
        let alvo = b.div_ceil(g);
        if alvo < t_linha {
            break; // partir mais só afrouxa a casa dos pombos
        }
        let mut total = 0u64;
        for i in 0..g {
            let tam = v / g + usize::from(i < v % g);
            total = total.saturating_add(tamanho(tam, a, alvo.min(tam), t_linha, memo));
            if total >= melhor {
                break;
            }
        }
        melhor = melhor.min(total);
    }

    // 4 — por grupos com sobra
    for g in 1..=v {
        if g as u64 >= melhor {
            break; // já são cartelas demais, mesmo que uma por grupo bastasse
        }
        for s in a..=v / g {
            if g == 1 && s == v {
                continue; // seria o próprio estado
            }
            let fora = v - g * s;
            if b <= fora {
                continue; // o sorteio inteiro pode ficar fora dos grupos
            }
            let alvo = (b - fora).div_ceil(g);
            if alvo < t_linha {
                continue;
            }
            let dentro = tamanho(s, a, alvo.min(s), t_linha, memo);
            melhor = melhor.min(dentro.saturating_mul(g as u64));
        }
    }

    // A monotonia, de graça.
    for vizinho in [(v, a - 1, b, t_linha), (v, a, b - 1, t_linha), (v, a, b, t_linha + 1)] {
        if vizinho.1 >= 1 && vizinho.2 >= 1 {
            melhor = melhor.min(tamanho(vizinho.0, vizinho.1, vizinho.2, vizinho.3, memo));
        }
    }

    memo.insert((v, a, b, t_linha), melhor);
    melhor
}

/// A família que [`tamanho`] contou, agora materializada. Repete exatamente as
/// mesmas escolhas.
pub fn construir(
    pontos: &[usize],
    a: usize,
    b: usize,
    t_linha: usize,
    memo: &mut Memo,
) -> Vec<Vec<usize>> {
    let v = pontos.len();
    if t_linha == 0 || a + b >= v + t_linha {
        return vec![pontos[..a.min(v)].to_vec()];
    }

    let alvo = tamanho(v, a, b, t_linha, memo);

    if alvo == binomial(v, a) {
        return combinacoes(pontos, a);
    }

    if a >= 1 {
        let esquerda = tamanho(v - 1, a - 1, b - 1, t_linha - 1, memo);
        let direita = tamanho(v - 1, a, b, t_linha, memo);
        if alvo == esquerda.saturating_add(direita) {
            let x = pontos[0];
            let resto = &pontos[1..];
            let mut saida = construir(resto, a, b, t_linha, memo);
            for mut menor in construir(resto, a - 1, b - 1, t_linha - 1, memo) {
                menor.push(x);
                menor.sort_unstable();
                saida.push(menor);
            }
            return saida;
        }
    }

    for g in 2..=b {
        let alvo_do_grupo = b.div_ceil(g);
        if alvo_do_grupo < t_linha {
            break;
        }
        let mut partes: Vec<Vec<usize>> = vec![Vec::new(); g];
        for (i, &p) in pontos.iter().enumerate() {
            partes[i % g].push(p);
        }
        let total: u64 = partes
            .iter()
            .map(|parte| tamanho(parte.len(), a, alvo_do_grupo.min(parte.len()), t_linha, memo))
            .fold(0u64, |acc, n| acc.saturating_add(n));
        if total == alvo {
            let mut saida = Vec::new();
            for parte in &partes {
                saida.extend(construir(parte, a, alvo_do_grupo.min(parte.len()), t_linha, memo));
            }
            return saida;
        }
    }

    for g in 1..=v {
        for s in a..=v / g {
            if g == 1 && s == v {
                continue;
            }
            let fora = v - g * s;
            if b <= fora {
                continue;
            }
            let alvo_do_grupo = (b - fora).div_ceil(g);
            if alvo_do_grupo < t_linha {
                continue;
            }
            let dentro = tamanho(s, a, alvo_do_grupo.min(s), t_linha, memo);
            if dentro.saturating_mul(g as u64) == alvo {
                let mut saida = Vec::new();
                for i in 0..g {
                    let parte = &pontos[i * s..(i + 1) * s];
                    saida.extend(construir(parte, a, alvo_do_grupo.min(s), t_linha, memo));
                }
                return saida;
            }
        }
    }

    for vizinho in [(v, a - 1, b, t_linha), (v, a, b - 1, t_linha), (v, a, b, t_linha + 1)] {
        if vizinho.1 == 0 || vizinho.2 == 0 {
            continue;
        }
        if tamanho(vizinho.0, vizinho.1, vizinho.2, vizinho.3, memo) != alvo {
            continue;
        }
        let mut familia = construir(pontos, vizinho.1, vizinho.2, vizinho.3, memo);
        // Só o vizinho de `a` devolve conjuntos menores; completá-los com
        // qualquer ponto de fora nunca diminui uma interseção.
        for membro in &mut familia {
            let mut i = 0;
            while membro.len() < a {
                if !membro.contains(&pontos[i]) {
                    membro.push(pontos[i]);
                }
                i += 1;
            }
            membro.sort_unstable();
        }
        return familia;
    }

    unreachable!("a medida não bateu com nenhuma construção em ({v}, {a}, {b}, {t_linha})");
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

    /// Confere na força bruta: todo `b`-subconjunto de `[v]` encontra algum
    /// membro da família em ao menos `t'` elementos.
    fn cobre(familia: &[Vec<usize>], v: usize, b: usize, t_linha: usize) -> bool {
        let mascaras: Vec<u32> =
            familia.iter().map(|m| m.iter().fold(0u32, |acc, &i| acc | 1 << i)).collect();
        combinacoes(&(0..v).collect::<Vec<_>>(), b).iter().all(|alvo| {
            let m = alvo.iter().fold(0u32, |acc, &i| acc | 1 << i);
            mascaras.iter().any(|&x| (x & m).count_ones() as usize >= t_linha)
        })
    }

    /// Toda família construída de fato cobre, e tem o tamanho que a medida
    /// prometeu — agora para toda garantia, e não só para `t' = a`.
    ///
    /// A construção é recursiva e escolhe entre quatro ramos mais a monotonia,
    /// comparando números; um erro de contagem faria `construir` materializar um
    /// ramo diferente do que `tamanho` mediu, e o resultado sairia grande demais
    /// — ou, pior, com buraco.
    #[test]
    fn a_construcao_cobre_e_tem_o_tamanho_medido() {
        let mut memo = Memo::new();
        for v in 2..=11usize {
            for a in 1..=v.min(5) {
                for b in 1..=v {
                    for t_linha in 1..=a.min(b) {
                        let medido = tamanho(v, a, b, t_linha, &mut memo);
                        if medido == INVIAVEL || medido > 4_000 {
                            continue;
                        }
                        let familia = construir(&(0..v).collect::<Vec<_>>(), a, b, t_linha, &mut memo);
                        assert_eq!(
                            familia.len() as u64, medido,
                            "({v},{a},{b},{t_linha}) construiu {} onde mediu {medido}",
                            familia.len()
                        );
                        assert!(
                            familia.iter().all(|m| m.len() == a),
                            "({v},{a},{b},{t_linha}) tem membro de outro tamanho"
                        );
                        assert!(
                            cobre(&familia, v, b, t_linha),
                            "({v},{a},{b},{t_linha}) deixou buraco"
                        );
                    }
                }
            }
        }
    }

    /// Os casos fechados que a aritmética já resolve, cobrados um a um.
    #[test]
    fn os_casos_de_borda_batem_com_a_aritmetica() {
        let mut memo = Memo::new();
        for v in 3..=12usize {
            for b in 2..v {
                // `t' = a = b`: todo `b`-conjunto é ele mesmo, e nada menos serve.
                assert_eq!(tamanho(v, b, b, b, &mut memo), binomial(v, b), "({v},{b},{b},{b})");
                // `a = t' = 1`: escolher `v − b + 1` pontos garante que algum
                // caia em qualquer `b`-conjunto, e um a menos deixa um buraco.
                assert_eq!(tamanho(v, 1, b, 1, &mut memo), (v - b + 1) as u64, "({v},1,{b},1)");
            }
            // `b = v`: o único `b`-conjunto é tudo, e um membro qualquer basta.
            assert_eq!(tamanho(v, 2, v, 2, &mut memo), 1, "({v},2,{v},2)");
        }
    }

    /// Alargar o alvo, alargar a cartela ou afrouxar a garantia nunca pode
    /// exigir mais membros.
    #[test]
    fn afrouxar_nunca_custa_mais() {
        let mut memo = Memo::new();
        for v in 3..=13usize {
            for a in 1..=5usize.min(v) {
                for b in 1..v {
                    for t_linha in 1..=a.min(b) {
                        let aqui = tamanho(v, a, b, t_linha, &mut memo);
                        if b + 1 <= v {
                            assert!(
                                aqui >= tamanho(v, a, b + 1, t_linha, &mut memo),
                                "({v},{a},{b},{t_linha}) menor que com alvo maior"
                            );
                        }
                        if a + 1 <= v {
                            assert!(
                                aqui >= tamanho(v, a + 1, b, t_linha, &mut memo),
                                "({v},{a},{b},{t_linha}) menor que com cartela maior"
                            );
                        }
                        assert!(
                            aqui <= tamanho(v, a, b, t_linha + 1, &mut memo),
                            "({v},{a},{b},{t_linha}) maior que com garantia maior"
                        );
                    }
                }
            }
        }
    }
}
