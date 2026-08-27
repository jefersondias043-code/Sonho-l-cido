//! A pergunta que decide se a trilha simétrica merece ir para a tela.
//!
//! Em `20/17` ela empata com o Construtor e nunca passa dele — 240, em 120 mil
//! iterações, com qualquer dos 36 ajustes varridos. Mas `20/17` é o caso mais
//! barato que existe, e o Construtor teve folga de sobra ali.
//!
//! Estes são os casos em que o banco é cíclico **e** grande, onde o orçamento de
//! 300 s do gerador foi mais apertado. Se a busca persistente vai render alguma
//! coisa, é aqui.

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::orbitas::InstanciaCiclica;

fn main() {
    let casos: Vec<(usize, usize, u64)> =
        vec![(22, 18, 660), (23, 18, 2162), (24, 18, 5884)];
    let marcos = [5_000u64, 30_000, 120_000];

    print!("{:>9} {:>7} {:>8} {:>8}", "pool,jogo", "banco", "órbitas", "alvos");
    for m in marcos {
        print!(" {:>9}", m);
    }
    println!();

    for (pool, jogo, banco) in casos {
        let Some(inst) = InstanciaCiclica::montar(pool, pool - jogo, pool - 15, None) else {
            continue;
        };
        print!(
            "{:>9} {:>7} {:>8} {:>8}",
            format!("{pool},{jogo}"),
            banco,
            inst.candidatos(),
            inst.alvos()
        );
        let mut busca = BuscaCiclica::nova(inst, 1, 7);
        let mut feitas = 0u64;
        for m in marcos {
            busca.avancar(m - feitas);
            feitas = m;
            let r = busca.melhor_em_cartelas();
            let marca = if r < banco { "*" } else if r == banco { "=" } else { " " };
            print!(" {:>8}{}", r, marca);
        }
        println!();
    }
}
