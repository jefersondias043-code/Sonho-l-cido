//! Onde a prova alcança, e onde ela para.
//!
//! Roda o caminho inteiro numa faixa de problemas e mostra os dois números que
//! o aplicativo mostra — o encontrado e o provado — mais a origem do piso. É
//! com esta tabela na mão que se decide o que a tela pode prometer.
//!
//! ```text
//! cargo run --release -p motor-exato --example fronteira
//! ```

use motor_exato::{
    problema::Problema,
    veredito::{self, Esforco},
};

fn main() {
    let casos: &[(usize, usize, usize)] = &[
        (7, 3, 2),
        (9, 3, 2),
        (10, 3, 2),
        (9, 4, 2),
        (10, 4, 2),
        (12, 4, 2),
        (13, 5, 2),
        (8, 4, 3),
        (10, 4, 3),
        (10, 5, 3),
        (11, 5, 3),
        (11, 5, 4),
    ];
    println!(
        "{:>11} {:>7} {:>5} {:>14} {:>7}  origem do piso",
        "C(v,k,t)", "achou", "piso", "veredito", "tempo"
    );
    for &(v, k, t) in casos {
        let Ok(p) = Problema::novo(v, k, t) else { continue };
        let inicio = std::time::Instant::now();
        let r = veredito::resolver(&p, Esforco::default());
        assert!(r.verificado, "C({v},{k},{t}) não cobre");
        println!(
            "{:>11} {:>7} {:>5} {:>14} {:>5}ms  {}",
            format!("C({v},{k},{t})"),
            r.encontrado,
            r.piso,
            format!("{:?}", r.veredito),
            inicio.elapsed().as_millis(),
            r.origem_do_piso
        );
    }
}
