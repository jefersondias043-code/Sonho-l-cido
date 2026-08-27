//! Varre os ajustes da trilha simétrica em 20/17 — a instância mais barata, e
//! aquela cujo fechamento no banco é cíclico e tem 240 cartelas.
//!
//! A pergunta: o Construtor chega a 240 com um passeio simples e um orçamento de
//! segundos. Existe ajuste em que a busca persistente ao menos empata?

use motor_busca::ciclica::{Ajuste, BuscaCiclica};
use motor_busca::orbitas::InstanciaCiclica;

fn main() {
    let inst = InstanciaCiclica::montar(20, 3, 5, None).unwrap();
    println!("20/17 — banco 240, ótimo cíclico desconhecido");
    println!("{:>8} {:>10} {:>8}  {:>8} {:>8}", "memória", "reinício", "ruína", "30k", "120k");

    for memoria in [1usize, 20, 120, 600] {
        for reinicio in [500u64, 5_000, u64::MAX] {
            for divisor in [4usize, 8, 20] {
                let ajuste = Ajuste { memoria, reinicio_apos: reinicio, divisor_da_ruina: divisor };
                let mut b = BuscaCiclica::com_ajuste(inst.clone(), 1, 7, ajuste);
                b.avancar(30_000);
                let em30 = b.melhor_em_cartelas();
                b.avancar(90_000);
                let em120 = b.melhor_em_cartelas();
                let marca = if em120 <= 240 { "  <<<" } else { "" };
                println!(
                    "{:>8} {:>10} {:>8}  {:>8} {:>8}{}",
                    memoria,
                    if reinicio == u64::MAX { "nunca".to_string() } else { reinicio.to_string() },
                    divisor,
                    em30,
                    em120,
                    marca
                );
            }
        }
    }
}
