//! A busca cíclica com garantia parcial, no caso pedido.
//!
//! ```bash
//! cargo run --release --example ciclica-parcial -p motor-busca -- [segundos]
//! ```
//!
//! 23 dezenas, jogos de 17, saem 15, garante 13 — `t' = 13 + 23 − 17 − 15 = 4`
//! contra `a = 6`. Em Z₂₃, que é primo, toda órbita tem exatamente 23 elementos:
//! uma solução cíclica custa 23, 46, 69 cartelas. A busca livre chega a 62, e a
//! pergunta que este exemplo responde é se 46 fecha.
use std::time::{Duration, Instant};

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::orbitas::InstanciaCiclica;

const V: usize = 23;
const K: usize = 17;
const J: usize = 15;
const T: usize = 13;

/// Confere na força bruta: todo `J`-subconjunto encontra alguma cartela em ao
/// menos `T` posições. Não reusa nada do motor.
fn confere(cartelas: &[u32]) -> bool {
    let mut alvo: Vec<usize> = (0..J).collect();
    loop {
        let m: u32 = alvo.iter().fold(0u32, |acc, &i| acc | 1 << i);
        if !cartelas.iter().any(|c| (c & m).count_ones() as usize >= T) {
            return false;
        }
        let mut i = J;
        loop {
            if i == 0 {
                return true;
            }
            i -= 1;
            if alvo[i] != i + V - J {
                alvo[i] += 1;
                for k in i + 1..J {
                    alvo[k] = alvo[k - 1] + 1;
                }
                break;
            }
        }
    }
}

fn main() {
    let segundos: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(300);

    let (a, b) = (V - K, V - J);
    let t_linha = T + V - K - J;
    println!("v={V} k={K} j={J} t={T} → a={a} b={b} t'={t_linha}");

    let comeco = Instant::now();
    let Some(inst) = InstanciaCiclica::montar_com_intersecao(V, a, b, t_linha, 200_000_000, None)
    else {
        println!("a instância cíclica não cabe");
        return;
    };
    println!(
        "  {} órbitas de {a} · {} órbitas de {b} · montada em {:.0}s",
        inst.candidatos(),
        inst.alvos(),
        comeco.elapsed().as_secs_f64()
    );

    let mut melhor = usize::MAX;
    for semente in [7u64, 101, 4243, 90210] {
        let mut busca = BuscaCiclica::nova(inst.clone(), 1, semente);
        let ate = Instant::now() + Duration::from_secs(segundos);
        while Instant::now() < ate {
            busca.avancar(50);
        }
        let quantas = busca.melhor_em_cartelas() as usize;
        let mascaras: Vec<u32> = busca
            .melhor_solucao()
            .iter()
            .map(|c| c.indices().iter().fold(0u32, |m, &i| m | 1 << i))
            .collect();
        let ok = confere(&mascaras);
        println!(
            "  semente {semente:>6}: {quantas} cartelas ({} órbitas) · confere {} · {:.0}s",
            quantas / V,
            if ok { "sim" } else { "NÃO" },
            comeco.elapsed().as_secs_f64()
        );
        if ok && quantas < melhor {
            melhor = quantas;
        }
    }
    println!("\n  melhor cíclico conferido: {melhor}");
}
