//! O que a divisão entrega nos fechamentos reais do banco, e quanto ela custa.
//!
//! ```text
//! cargo run --release -p motor-web --example divisao-perfil
//! ```

use std::time::Instant;

use motor_core::cartela::Cartela;
use motor_core::cobertura::MotorCobertura;
use motor_core::divisao::{dividir, melhor_bloco_com};
use motor_core::problema::{Objetivo, Problema, RegraCobertura};

fn main() {
    let bruto = std::fs::read_to_string("web/lotinha.json").expect("rodar da raiz do repositório");
    let banco: serde_json::Value = serde_json::from_str(&bruto).unwrap();
    let fechamentos = banco["fechamentos"].as_object().unwrap();

    let casos = ["20,17", "21,18", "22,19", "23,20"];
    println!(
        "{:>9} {:>8} {:>7} {:>7} {:>11} {:>10} {:>8} {:>10} {:>9}",
        "pool,jogo", "cartelas", "partes", "tamanho", "melhor de k", "guloso", "tempo", "com troca", "tempo"
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

        for partes in [2usize, 4, 10, 50] {
            if partes > cartelas.len() {
                continue;
            }
            let a = dividir(&motor, &cartelas, partes).unwrap();

            // O tamanho tem de ser o mesmo dos dois lados. Comparar um bloco de
            // quatro cartelas com um de cinco não diz nada sobre o método.
            let tamanho = a
                .blocos
                .iter()
                .max_by_key(|b| b.cobertos)
                .map(|b| b.cartelas.len())
                .unwrap();

            let t = Instant::now();
            let g = melhor_bloco_com(&motor, &cartelas, tamanho, 0).unwrap();
            let mg = t.elapsed().as_millis();
            let t = Instant::now();
            let b = melhor_bloco_com(&motor, &cartelas, tamanho, 12).unwrap();
            let mb = t.elapsed().as_millis();

            println!(
                "{:>9} {:>8} {:>7} {:>7} {:>10.2}% {:>9.2}% {:>6}ms {:>9.2}% {:>7}ms",
                chave,
                cartelas.len(),
                partes,
                tamanho,
                100.0 * a.melhor_cobertura(),
                100.0 * g.cobertura(a.total_alvos),
                mg,
                100.0 * b.cobertura(a.total_alvos),
                mb
            );
        }
    }
}
