//! O que a divisão entrega nos fechamentos reais do banco, e quanto ela custa.
//!
//! ```text
//! cargo run --release -p motor-web --example divisao-perfil
//! ```

use std::time::Instant;

use motor_core::cartela::Cartela;
use motor_core::cobertura::MotorCobertura;
use motor_core::divisao::dividir;
use motor_core::problema::{Objetivo, Problema, RegraCobertura};

fn main() {
    let bruto = std::fs::read_to_string("web/lotinha.json").expect("rodar da raiz do repositório");
    let banco: serde_json::Value = serde_json::from_str(&bruto).unwrap();
    let fechamentos = banco["fechamentos"].as_object().unwrap();

    let casos = ["20,17", "21,18", "22,19", "23,20", "23,18", "24,17"];
    println!(
        "{:>9} {:>8} {:>7}  {:>7} {:>11} {:>8}",
        "pool,jogo", "cartelas", "partes", "1/k", "pior bloco", "tempo"
    );

    for chave in casos {
        let Some(blocos) = fechamentos.get(chave) else { continue };
        let mut it = chave.split(',');
        let pool: usize = it.next().unwrap().parse().unwrap();
        let jogo: usize = it.next().unwrap().parse().unwrap();

        // O banco guarda a forma complementar: as dezenas que faltam ao jogo.
        let cartelas: Vec<Cartela> = blocos
            .as_array()
            .unwrap()
            .iter()
            .map(|b| {
                let fora: Vec<usize> =
                    b.as_array().unwrap().iter().map(|d| d.as_u64().unwrap() as usize - 1).collect();
                let dentro: Vec<usize> = (0..pool).filter(|d| !fora.contains(d)).collect();
                Cartela::dos_indices(&dentro)
            })
            .collect();

        let problema = Problema::novo(
            25,
            (1..=pool as u32).collect(),
            jogo,
            RegraCobertura { alvo: 15, intersecao: 15, premiadas: 1 },
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let motor = MotorCobertura::novo(&problema).unwrap();

        for partes in [2usize, 4, 10] {
            if partes > cartelas.len() {
                continue;
            }
            let t = Instant::now();
            let d = dividir(&motor, &cartelas, partes).unwrap();
            let ms = t.elapsed().as_millis();
            println!(
                "{:>9} {:>8} {:>7}  {:>6.1}% {:>10.1}% {:>6}ms",
                chave,
                cartelas.len(),
                partes,
                100.0 / partes as f64,
                100.0 * d.pior_cobertura(),
                ms
            );
        }
    }
}
