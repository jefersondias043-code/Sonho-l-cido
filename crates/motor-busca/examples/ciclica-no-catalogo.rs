//! A busca por simetria, medida contra o catálogo da Lotofácil.
//!
//! ```bash
//! cargo run --release --example ciclica-no-catalogo -p motor-busca -- [segundos] [v-k-t ...]
//! ```
//!
//! O gerador do catálogo nunca chamou a busca cíclica: ela nasceu para a
//! Lotinha, e `gerar-catalogo` só conhece a construção de Turán, que vale na
//! linha `t = 15`. Mas `montar_com_intersecao` já aceita garantia parcial — a
//! peça existe, e ninguém tinha medido o que ela faz nas outras quatro linhas.
//!
//! Este exemplo mede. Para cada caso pedido monta a instância cíclica, roda com
//! algumas sementes, **confere na força bruta** e compara com o catálogo.
use std::time::{Duration, Instant};

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::orbitas::InstanciaCiclica;

const SORTEIO: usize = 15;

/// Confere na força bruta, sem reusar nada do motor: todo sorteio possível
/// encontra alguma cartela em ao menos `t` dezenas.
fn confere(cartelas: &[u32], v: usize, t: usize) -> bool {
    let mut alvo: Vec<usize> = (0..SORTEIO).collect();
    loop {
        let m: u32 = alvo.iter().fold(0u32, |acc, &i| acc | 1 << i);
        if !cartelas.iter().any(|c| (c & m).count_ones() as usize >= t) {
            return false;
        }
        let mut i = SORTEIO;
        loop {
            if i == 0 {
                return true;
            }
            i -= 1;
            if alvo[i] != i + v - SORTEIO {
                alvo[i] += 1;
                for k in i + 1..SORTEIO {
                    alvo[k] = alvo[k - 1] + 1;
                }
                break;
            }
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let segundos: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(60);
    let casos: Vec<(usize, usize, usize)> = args
        .filter_map(|a| {
            let mut p = a.split('-');
            Some((p.next()?.parse().ok()?, p.next()?.parse().ok()?, p.next()?.parse().ok()?))
        })
        .collect();

    println!("{:>10} {:>4} {:>4} {:>9} {:>9} {:>8}", "caso", "a", "t'", "órbitas", "cartelas", "confere");
    for (v, k, t) in casos {
        let (a, b) = (v - k, v - SORTEIO);
        let t_linha = (t + v).saturating_sub(k + SORTEIO);
        if t_linha == 0 || t_linha > a.min(b) {
            println!("{v:>4}/{k:>2}/{t:<3} {a:>4} {t_linha:>4}   fora do alcance da simetria");
            continue;
        }
        let comeco = Instant::now();
        let Some(inst) =
            InstanciaCiclica::montar_com_intersecao(v, a, b, t_linha, 400_000_000, None)
        else {
            println!("{v:>4}/{k:>2}/{t:<3} {a:>4} {t_linha:>4}   a instância não cabe");
            continue;
        };
        let orbitas = inst.candidatos();
        let mut melhor = usize::MAX;
        let mut ok_final = false;
        for semente in [7u64, 4243] {
            let mut busca = BuscaCiclica::nova(inst.clone(), 1, semente);
            let ate = Instant::now() + Duration::from_secs(segundos);
            while Instant::now() < ate {
                busca.avancar(50);
            }
            let quantas = busca.melhor_em_cartelas() as usize;
            if quantas == 0 || quantas >= melhor {
                continue;
            }
            let mascaras: Vec<u32> = busca
                .melhor_solucao()
                .iter()
                .map(|c| c.indices().iter().fold(0u32, |m, &i| m | 1 << i))
                .collect();
            if confere(&mascaras, v, t) {
                melhor = quantas;
                ok_final = true;
            }
        }
        println!(
            "{v:>4}/{k:>2}/{t:<3} {a:>4} {t_linha:>4} {orbitas:>9} {:>9} {:>8}   {:.0}s",
            if melhor == usize::MAX { "—".to_string() } else { melhor.to_string() },
            if ok_final { "sim" } else { "—" },
            comeco.elapsed().as_secs_f64()
        );
    }
}
