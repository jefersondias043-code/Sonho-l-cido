//! Roda a trilha simétrica longe, nos casos em que o banco é cíclico, e escreve
//! os fechamentos que ela melhorar.
//!
//! ## Por que só nesses
//!
//! Um fechamento perfeitamente invariante por rotação no banco é a construção
//! por órbitas intacta — a busca livre nunca aceitou um movimento nele. São
//! esses os casos onde a trilha simétrica pode acrescentar alguma coisa, e
//! medindo em `23/18` ela acrescenta: 2.139 cartelas contra as 2.162 do banco.
//!
//! Nos casos em que o banco **não** é cíclico não há o que buscar aqui: em
//! `23/20` o melhor fechamento cíclico que existe tem 138 cartelas, provado ao
//! certo, e o banco tem 100.
//!
//! ## O que ele escreve
//!
//! Um JSON com as entradas melhoradas, na mesma forma complementar do
//! `web/lotinha.json` — blocos das dezenas que **faltam** a cada jogo. Quem
//! confere se cobrem é a suíte do navegador, sorteio a sorteio.
//!
//! ## Orçamento por tempo, e não por iteração
//!
//! As instâncias variam em três ordens de grandeza: `20/17` tem 776 alvos e
//! `25/18` tem 130.750, e uma iteração custa proporcional a isso. Contar
//! iterações daria segundos para uma e dias para a outra.
//!
//! ```text
//! cargo run --release -p motor-busca --example melhorar-banco -- [segundos_por_caso]
//! ```

use std::io::Write;
use std::time::{Duration, Instant};

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::orbitas::InstanciaCiclica;

const SORTEIO: usize = 15;

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(600);

    // As oito em que o fechamento do banco é invariante por rotação, com o que
    // ele entrega hoje.
    let ciclicas: Vec<(usize, usize, u64)> = vec![
        (20, 17, 240),
        (24, 21, 80),
        (22, 18, 660),
        (23, 18, 2162),
        (22, 17, 3454),
        (24, 18, 5884),
        (23, 17, 10051),
        (25, 18, 14875),
    ];

    let mut melhoradas: Vec<(usize, usize, u64, Vec<Vec<u32>>)> = Vec::new();

    println!("orçamento de {segundos}s por combinação");
    println!("{:>9} {:>8} {:>9} {:>10}  desfecho", "pool,jogo", "banco", "cíclica", "iterações");
    for (pool, jogo, banco) in ciclicas {
        eprint!("{pool},{jogo}… ");
        let _ = std::io::stderr().flush();

        let Some(inst) = InstanciaCiclica::montar(pool, pool - jogo, pool - SORTEIO, None) else {
            println!(
                "{:>9} {:>8} {:>9} {:>10}  instância não cabe",
                format!("{pool},{jogo}"),
                banco,
                "-",
                "-"
            );
            continue;
        };
        let mut busca = BuscaCiclica::nova(inst, 1, 7);
        let ate = Instant::now() + Duration::from_secs(segundos);
        while Instant::now() < ate {
            busca.avancar(50);
        }
        let achou = busca.melhor_em_cartelas();

        let veredito = if achou < banco {
            // A forma complementar: cada cartela é o pool menos algumas dezenas,
            // e o banco guarda justamente as que faltam.
            let blocos: Vec<Vec<u32>> = busca
                .melhor_solucao()
                .iter()
                .map(|c| {
                    let dentro = c.indices();
                    (0..pool)
                        .filter(|d| !dentro.contains(d))
                        .map(|d| d as u32 + 1)
                        .collect()
                })
                .collect();
            assert_eq!(blocos.len() as u64, achou, "expansão divergiu do recorde");
            melhoradas.push((pool, jogo, achou, blocos));
            format!("MELHORA em {}", banco - achou)
        } else if achou == banco {
            "empata".to_string()
        } else {
            format!("fica {} atrás", achou - banco)
        };
        println!(
            "{:>9} {:>8} {:>9} {:>10}  {}",
            format!("{pool},{jogo}"),
            banco,
            achou,
            busca.iteracoes(),
            veredito
        );
        let _ = std::io::stdout().flush();
    }

    if melhoradas.is_empty() {
        eprintln!("\nnenhuma melhora — o banco fica como está");
        return;
    }

    let mut json = String::from("{");
    for (i, (pool, jogo, _, blocos)) in melhoradas.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!("\"{pool},{jogo}\":["));
        for (j, b) in blocos.iter().enumerate() {
            if j > 0 {
                json.push(',');
            }
            json.push('[');
            for (k, d) in b.iter().enumerate() {
                if k > 0 {
                    json.push(',');
                }
                json.push_str(&d.to_string());
            }
            json.push(']');
        }
        json.push(']');
    }
    json.push('}');
    std::fs::write("melhoradas.json", &json).expect("escrever melhoradas.json");
    eprintln!("\n{} entrada(s) em melhoradas.json", melhoradas.len());
}
