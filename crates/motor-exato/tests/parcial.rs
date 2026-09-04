//! Bancada da garantia parcial.
//!
//! `cargo test --release -p motor-exato --test parcial -- --ignored --nocapture`
//!
//! ## Por que ela existe
//!
//! A garantia parcial não tem tabela publicada contra a qual comparar: a
//! literatura de covering designs fala de `t = j`, e é por isso que
//! `qualidade.rs` só cobre a garantia cheia. O caminho `t < j` — que é o que a
//! Lotofácil premia a partir de 11 acertos — não tinha guarda nenhuma.
//!
//! Então o que se cobra aqui não é o tamanho e sim as duas coisas que dá para
//! afirmar sem referência externa:
//!
//! 1. **o motor entrega** — um fechamento completo existe ao fim do caminho que
//!    a tela percorre, com os dois botões;
//! 2. **o que ele entrega cobre** — conferido por força bruta, varrendo todos
//!    os `C(v,j)` sorteios sem reusar uma linha do motor.
//!
//! A segunda é a que importa. Um fechamento que se diz completo e não cobre é a
//! pior falha que este aplicativo pode ter, e é invisível para qualquer
//! conferência que reuse a mesma aritmética que o produziu.
use motor_exato::escalada::{Escalada, Fase};
use motor_exato::limites;
use motor_exato::problema::Problema;

/// A conferência mais burra que existe, e por isso a que vale.
///
/// Percorre **todos** os `C(v,j)` sorteios e exige que algum bloco encontre
/// cada um em ao menos `t` posições. Não usa nada do motor: nem a tabela de
/// alvos por cartela, nem o avesso, nem a instância de Turán. Um erro na
/// transformação do avesso — que é onde mora o risco desta mudança — passaria
/// batido por qualquer conferência que a reusasse.
fn confere_na_marra(v: usize, j: usize, t: usize, blocos: &[u32]) -> bool {
    let mut alvo: Vec<usize> = (0..j).collect();
    loop {
        let mascara: u32 = alvo.iter().fold(0u32, |m, &i| m | 1 << i);
        if !blocos.iter().any(|b| (b & mascara).count_ones() as usize >= t) {
            return false;
        }
        // Próximo `j`-subconjunto de `[v]`, em ordem lexicográfica.
        let mut i = j;
        while i > 0 {
            i -= 1;
            if alvo[i] != i + v - j {
                alvo[i] += 1;
                for k in i + 1..j {
                    alvo[k] = alvo[k - 1] + 1;
                }
                break;
            }
            if i == 0 {
                return true;
            }
        }
        if j == 0 {
            return true;
        }
    }
}

/// Percorre o caminho que a tela percorre, com o botão.
///
/// Com garantia parcial o motor **não** passa do piso sozinho: passar troca um
/// mínimo provado por uma solução que apenas funciona, e essa decisão é de quem
/// está olhando. A escalada avisa quando o piso se esgotou; daí em diante o que
/// acontece depende de alguém tocar em "ativar construção avançada", que é
/// exatamente o que `liberar_o_teto` faz.
///
/// Medir sem tocar no botão mediria uma tela que ninguém usou.
fn medir(v: usize, k: usize, j: usize, t: usize, orcamento: u64) -> (usize, f64, usize, bool, Fase) {
    let p = Problema::novo(v, k, j, t, 1).unwrap();
    let piso = limites::sem_busca(&p).valor as usize;
    let mut escalada = Escalada::nova(&p, piso);

    let mut passo = escalada.avancar(2_000_000);
    while !passo.piso_esgotado && !passo.fechou && passo.trabalho < orcamento / 4 {
        passo = escalada.avancar(2_000_000);
    }
    if !passo.fechou {
        escalada.liberar_o_teto();
    }
    while !passo.fechou && passo.trabalho < orcamento / 2 && passo.fase != Fase::Fechada {
        passo = escalada.avancar(2_000_000);
    }

    // E então o segundo botão, o que aperta o número.
    let antes_de_apertar = escalada.melhor_completo().len();
    escalada.otimizar();
    // Apertar nunca pode devolver mais do que já havia — é a promessa do botão,
    // e é o que se confere logo abaixo.
    while passo.trabalho < orcamento && passo.fase != Fase::Fechada {
        passo = escalada.avancar(2_000_000);
    }
    assert!(
        escalada.melhor_completo().len() <= antes_de_apertar || antes_de_apertar == 0,
        "apertar devolveu {} onde havia {antes_de_apertar}",
        escalada.melhor_completo().len()
    );

    let entregue = escalada.melhor_completo().to_vec();
    let confere = !entregue.is_empty() && confere_na_marra(v, j, t, &entregue);
    (piso, passo.melhor_cobertura, entregue.len(), confere, passo.fase)
}

/// (v, k, j, t) — `t' = t + v − k − j` é o que decide a dificuldade.
const CASOS: [(usize, usize, usize, usize); 7] = [
    (10, 6, 5, 3),    // t' = 2
    (12, 7, 6, 4),    // t' = 3
    (14, 9, 7, 4),    // t' = 2
    (16, 11, 8, 5),   // t' = 2
    (18, 13, 9, 6),   // t' = 2
    (20, 17, 15, 14), // t' = 2 — a Lotinha garantindo 14
    (20, 16, 15, 13), // t' = 2 — a Lotinha garantindo 13
];

/// Casos maiores, onde a subida tem mais espaço para desperdiçar.
///
/// Eles não afirmam tamanho nenhum: servem para uma mudança futura no motor ter
/// contra o que ser comparada, e para o caminho grande não passar despercebido.
const GRANDES: [(usize, usize, usize, usize); 5] = [
    (21, 17, 15, 12), // t' = 1
    (22, 18, 15, 13), // t' = 2
    (23, 19, 15, 14), // t' = 3
    (22, 17, 15, 12), // t' = 2
    (24, 20, 15, 13), // t' = 2
];

#[test]
#[ignore]
fn os_casos_grandes_tambem_entregam() {
    let orcamento: u64 = std::env::var("ORCAMENTO")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2_000_000_000);
    let mut falhas = Vec::new();
    for (v, k, j, t) in GRANDES {
        let (piso, cob, quantas, confere, fase) = medir(v, k, j, t, orcamento);
        println!(
            "({v},{k},{j},{t}) t'={} piso={piso:<4} cobertura={:>6.2}% entregue={quantas:<5} \
             confere={} fase={fase:?}",
            t + v - k - j,
            cob * 100.0,
            if confere { "sim" } else { "NÃO" }
        );
        if quantas == 0 || !confere {
            falhas.push(format!("({v},{k},{j},{t})"));
        }
    }
    assert!(falhas.is_empty(), "não entregaram ou não cobrem: {}", falhas.join(", "));
}

#[test]
#[ignore]
fn a_garantia_parcial_entrega_e_o_que_entrega_confere() {
    let orcamento: u64 = std::env::var("ORCAMENTO")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(300_000_000);

    let mut falhas = Vec::new();
    for (v, k, j, t) in CASOS {
        let (piso, cob, quantas, confere, fase) = medir(v, k, j, t, orcamento);
        let t_linha = t + v - k - j;
        println!(
            "({v},{k},{j},{t}) t'={t_linha} piso={piso:<3} cobertura={:>6.2}% \
             entregue={quantas:<4} confere={} fase={fase:?}",
            cob * 100.0,
            if confere { "sim" } else { "NÃO" }
        );
        if quantas == 0 {
            falhas.push(format!("({v},{k},{j},{t}) não entregou fechamento nenhum"));
        } else if !confere {
            falhas.push(format!("({v},{k},{j},{t}) entregou {quantas} que NÃO cobrem"));
        } else if quantas < piso {
            falhas.push(format!("({v},{k},{j},{t}) entregou {quantas} abaixo do piso {piso}"));
        }
    }
    assert!(falhas.is_empty(), "{}", falhas.join("; "));
}
