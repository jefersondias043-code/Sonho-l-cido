//! Quanto o Motor Construtor melhora o ponto de partida.
//!
//! Compara a partida de hoje — a que o motor monta ao arrancar — com a que o
//! estágio 0 produz no mesmo problema, e diz quantas cartelas de vantagem a
//! busca recebe antes da primeira iteração.
//!
//!     cargo run --release --example construtor -- <segundos> [pool,jogo ...]

use std::time::{Duration, Instant};

use motor_busca::construcao::{construir_do_zero, podar};
use motor_busca::construtor::construir_o_menor;
use motor_busca::{Configuracao, MotorBusca, Oficina};
use motor_core::{MotorCobertura, Objetivo, Problema, RegraCobertura, Solucao};
use rand::SeedableRng;
use rand_pcg::Pcg64Mcg;

const SORTEIO: usize = 15;

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(20);
    let casos: Vec<(usize, usize)> = std::env::args()
        .skip(2)
        .filter_map(|a| {
            let (p, j) = a.split_once(',')?;
            Some((p.trim().parse().ok()?, j.trim().parse().ok()?))
        })
        .collect();
    let casos = if casos.is_empty() {
        vec![(20, 17), (21, 17), (22, 17), (23, 18), (23, 17)]
    } else {
        casos
    };

    println!("Motor Construtor — {segundos}s por caso\n");
    println!(
        "{:>9} {:>8} {:>12} {:>12} {:>9}  origem",
        "caso", "piso", "partida hoje", "construtor", "ganho"
    );
    println!("{}", "─".repeat(74));

    for (pool, jogo) in casos {
        let problema = problema_de(pool, jogo);
        let cobertura = MotorCobertura::novo(&problema).expect("problema válido");
        let piso = motor_core::limite_inferior(&cobertura).valor;
        let mut oficina = Oficina::nova();

        // A partida de hoje: o guloso por cartela, que é o que o motor monta
        // quando não há banco nem fórmula fechada.
        let mut hoje = Solucao::vazia(&cobertura);
        let mut rng = Pcg64Mcg::seed_from_u64(7);
        construir_do_zero(&cobertura, &mut hoje, 0.25, usize::MAX, &mut rng, &mut oficina, None);
        podar(&cobertura, &mut hoje, &mut oficina);
        let antes = hoje.quantidade();

        let relogio = Instant::now();
        let achado = construir_o_menor(
            &cobertura,
            &problema,
            Duration::from_secs(segundos),
            7,
            &mut oficina,
            &mut |_| {},
            None,
        );
        let gasto = relogio.elapsed().as_secs_f64();

        match achado {
            Some(a) => {
                let ganho = antes as i64 - a.cartelas.len() as i64;
                println!(
                    "{:>9} {piso:>8} {antes:>12} {:>12} {:>+9}  {} ({gasto:.0}s)",
                    format!("{pool},{jogo}"),
                    a.cartelas.len(),
                    -ganho,
                    a.origem
                );
                // A prova: a construção entregue cobre tudo mesmo.
                let mut confere = Solucao::vazia(&cobertura);
                for c in &a.cartelas {
                    confere.adicionar(&cobertura, *c, &mut oficina.rascunho);
                }
                assert!(
                    confere.cobertura_total(),
                    "{pool},{jogo}: a construção entregue não cobre tudo"
                );
            }
            None => println!("{:>9}  nenhuma construção", format!("{pool},{jogo}")),
        }
    }

    // E o motor inteiro, para ver a partida real que ele passa a receber.
    let _ = MotorBusca::novo(problema_de(20, 17), Configuracao::default());
}

fn problema_de(pool: usize, jogo: usize) -> Problema {
    Problema::com_pool_inicial(
        pool as u32,
        pool,
        jogo,
        RegraCobertura::cobrir_subconjuntos(SORTEIO),
        Objetivo::MinimizarCartelas,
    )
    .expect("configuração da Lotinha é válida")
}
