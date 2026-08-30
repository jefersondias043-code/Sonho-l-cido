//! Quanto custa construir nos tamanhos que a tela vai receber.
//!
//! ```text
//! cargo run --release -p motor-exato --example tamanho-real
//! ```

use motor_exato::construtor::Construtor;
use motor_exato::limites;
use motor_exato::problema::Problema;

fn main() {
    let casos: &[(usize, usize, usize, usize, usize)] = &[
        (18, 17, 15, 15, 1),
        (20, 17, 15, 15, 1),
        (20, 17, 15, 15, 2),
        (20, 15, 15, 13, 1),
        (22, 17, 15, 15, 1),
        (23, 18, 15, 15, 1),
        (25, 20, 15, 15, 1),
        (25, 17, 15, 15, 1),
        (25, 16, 15, 11, 1),
    ];
    println!(
        "{:>22} {:>11} {:>11} {:>7} {:>7} {:>8}",
        "pool/jogo/sort/gar/r", "alvos", "cartelas", "achou", "piso", "tempo"
    );
    for &(v, k, j, t, r) in casos {
        let p = match Problema::novo(v, k, j, t, r) {
            Ok(p) => p,
            Err(e) => {
                println!("{v}/{k}/{j}/{t}/{r}: {e}");
                continue;
            }
        };
        let inicio = std::time::Instant::now();
        let mut construtor = Construtor::novo(&p);
        while !construtor.terminou() {
            construtor.avancar(20_000_000);
        }
        let c = construtor.construcao();
        let ok = p.cobre(&c.blocos);
        println!(
            "{:>22} {:>11} {:>11} {:>7} {:>7} {:>6}ms{}",
            format!("{v}/{k}/{j}/{t}/{r}"),
            p.total_de_alvos(),
            p.total_de_blocos(),
            c.tamanho(),
            limites::sem_busca(&p).valor,
            inicio.elapsed().as_millis(),
            if ok { "" } else { "  NÃO COBRE" }
        );
    }
}
