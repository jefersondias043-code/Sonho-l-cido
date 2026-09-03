//! Onde a garantia parcial está hoje, por degrau de `t'`.
use motor_exato::escalada::Escalada;
use motor_exato::{limites, Fase, Problema};

fn main() {
    println!("{:>18} {:>3} {:>6} {:>9} {:>8} {:>12}", "pedido", "t'", "piso", "cartelas", "cobre", "fase");
    for (v, k, j, t) in [
        (20, 17, 15, 13), (20, 17, 15, 14),
        (20, 16, 15, 13), (20, 16, 15, 14),
        (19, 16, 15, 13), (18, 16, 15, 14),
    ] {
        let p = Problema::novo(v, k, j, t, 1).unwrap();
        let tl = (t + v).saturating_sub(k + j);
        let piso = limites::sem_busca(&p).valor as usize;
        let mut e = Escalada::nova(&p, piso);
        let mut passo = e.avancar(20_000_000);
        while passo.trabalho < 1_500_000_000 && passo.fase != Fase::Fechada {
            passo = e.avancar(20_000_000);
        }
        println!(
            "{:>18} {tl:>3} {piso:>6} {:>9} {:>7.1}% {:>12}",
            format!("{v}/{k} saem {j} g{t}"), passo.completo, passo.melhor_cobertura * 100.0,
            format!("{:?}", passo.fase)
        );
    }
}
