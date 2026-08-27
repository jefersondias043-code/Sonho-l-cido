//! Varre as famílias em aberto da modalidade, resolve os `n` pequenos ao certo e
//! imprime a tabela que levanta o piso.
//!
//! Não roda no celular e não entra no aplicativo: o que entra é a tabela que ele
//! imprime, colada em `motor-core::limites`. Rodar com `--release`.
//!
//! ```text
//! cargo run --release -p motor-busca --example turan-exatos
//! ```

use motor_busca::exato::{resolver, Desfecho, Instancia};
use motor_core::limites::{elevar_turan, schonheim};
use std::io::Write;

const SORTEIO: usize = 15;
/// Um teto alto faz o caso difícil demorar horas para dizer "não sei". O valor
/// exato de um `n` grande vale pouco mais que o de um `n` médio — a recorrência
/// perde pouco por degrau — e vale muito menos que a varredura terminar.
const TETO_DE_NOS: u64 = 3_000_000;
/// Acima disto a instância não cabe na memória de forma honesta — e o ponto da
/// varredura é achar onde parar, não empurrar até o limite.
const TETO_DE_ALVOS: usize = 400_000;

fn combinacoes(n: usize, k: usize) -> Vec<u32> {
    let mut saida = Vec::new();
    if k > n {
        return saida;
    }
    let mut indices: Vec<usize> = (0..k).collect();
    loop {
        let mut m = 0u32;
        for &i in &indices {
            m |= 1 << i;
        }
        saida.push(m);
        let mut i = k;
        loop {
            if i == 0 {
                return saida;
            }
            i -= 1;
            if indices[i] != i + n - k {
                break;
            }
            if i == 0 {
                return saida;
            }
        }
        indices[i] += 1;
        for j in (i + 1)..k {
            indices[j] = indices[j - 1] + 1;
        }
    }
}

/// `T(n, b, a)` exato: menor família de `a`-conjuntos tal que todo `b`-conjunto
/// contém algum dela. Sem restrição de simetria — é isso que faz do resultado um
/// limite inferior legítimo.
fn turan_exato(n: usize, a: usize, b: usize) -> Option<u64> {
    if a > b || b > n {
        return None;
    }
    let blocos = combinacoes(n, a);
    let alvos = combinacoes(n, b);
    if alvos.len() > TETO_DE_ALVOS {
        return None;
    }
    let cobre: Vec<Vec<u32>> = blocos
        .iter()
        .map(|&bl| {
            alvos
                .iter()
                .enumerate()
                .filter(|(_, &al)| bl & al == bl)
                .map(|(i, _)| i as u32)
                .collect()
        })
        .collect();
    let peso = vec![1u64; cobre.len()];
    let inst = Instancia::nova(cobre, peso, alvos.len())?;
    match resolver(&inst, TETO_DE_NOS) {
        Desfecho::Otimo { peso, .. } => Some(peso),
        _ => None,
    }
}

fn main() {
    // As vinte combinações sem mínimo conhecido, na forma (pool, jogo).
    let abertas: Vec<(usize, usize)> = vec![
        (20, 17),
        (21, 17),
        (21, 18),
        (22, 17),
        (22, 18),
        (22, 19),
        (23, 17),
        (23, 18),
        (23, 19),
        (23, 20),
        (24, 17),
        (24, 18),
        (24, 19),
        (24, 20),
        (24, 21),
        (25, 18),
        (25, 19),
        (25, 20),
        (25, 21),
        (25, 22),
    ];

    println!("{:>9} {:>3} {:>3}  {:>28}  {:>8} {:>8}", "pool,jogo", "a", "b", "exatos provados", "hoje", "novo");
    let mut tabela: Vec<(usize, usize, usize, u64)> = Vec::new();

    for (pool, jogo) in abertas {
        eprint!("\n{pool},{jogo}:");
        let _ = std::io::stderr().flush();
        let a = pool - jogo;
        let b = pool - SORTEIO;

        // Sobe em `n` enquanto o resolvedor fechar. O primeiro `n` que não
        // fecha encerra a família: adiante só piora.
        let mut base = None;
        let mut vistos = Vec::new();
        for n in b..pool {
            match turan_exato(n, a, b) {
                Some(v) => {
                    vistos.push(format!("{n}:{v}"));
                    base = Some((n, v));
                    eprint!(" {n}:{v}");
                    let _ = std::io::stderr().flush();
                }
                None => break,
            }
        }

        let hoje = schonheim(pool, jogo, SORTEIO);
        let novo = match base {
            Some((n, v)) => elevar_turan(n, v, pool, a),
            None => 0,
        };
        if let Some((n, v)) = base {
            tabela.push((a, b, n, v));
        }
        let marca = if novo > hoje { " <<<" } else { "" };
        println!(
            "{:>9} {:>3} {:>3}  {:>28}  {:>8} {:>8}{}",
            format!("{pool},{jogo}"),
            a,
            b,
            vistos.join(" "),
            hoje,
            novo,
            marca
        );
    }

    println!("\n─── para colar em motor-core::limites ───");
    println!("const TURAN_EXATOS: &[(u8, u8, u8, u32)] = &[");
    for (a, b, n, v) in &tabela {
        println!("    ({a}, {b}, {n}, {v}),");
    }
    println!("];");
}
