//! Quanto a trilha simétrica alcança, e em quantas iterações.
//!
//! ```text
//! cargo run --release -p motor-busca --example ciclica-perfil
//! ```

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::orbitas::InstanciaCiclica;

fn main() {
    // As instâncias cabem em tamanhos muito diferentes — 776 alvos em 20/17
    // contra 54.484 em 24/21 —, e uma iteração custa proporcional aos alvos.
    // Estas três são as que dão para medir fundo em tempo razoável.
    let casos: Vec<(usize, usize, u64)> = vec![
        (20, 17, 240),  // banco cíclico; 57 órbitas, 776 alvos
        (21, 18, 182),  // banco NÃO cíclico; 64 órbitas, 2.586 alvos
        (22, 19, 126),  // banco não cíclico, e o ótimo cíclico é 132 — provado
    ];
    let marcos = [1_000u64, 5_000, 20_000, 60_000];

    print!("{:>9} {:>7}", "pool,jogo", "banco");
    for m in marcos {
        print!(" {:>8}", m);
    }
    println!("  reinícios");

    for (pool, jogo, banco) in casos {
        let Some(inst) = InstanciaCiclica::montar(pool, pool - jogo, pool - 15, None) else {
            continue;
        };
        let mut busca = BuscaCiclica::nova(inst, 1, 7);
        print!("{:>9} {:>7}", format!("{pool},{jogo}"), banco);
        let mut feitas = 0u64;
        for m in marcos {
            busca.avancar(m - feitas);
            feitas = m;
            let r = busca.melhor_em_cartelas();
            let marca = if r < banco { "*" } else if r == banco { "=" } else { " " };
            print!(" {:>7}{}", r, marca);
        }
        println!("  {}", busca.reinicios());
    }
}
