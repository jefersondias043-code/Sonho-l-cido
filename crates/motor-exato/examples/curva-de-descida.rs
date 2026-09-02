//! Curva de descida: em que ponto do orçamento cada melhora aparece.
//!
//! A bancada de qualidade mede **onde** a construção chega; esta sonda mede
//! **quando**, e as duas perguntas têm respostas independentes. Um motor que
//! chega ao número publicado depois de cinco minutos sem mostrar nada passa na
//! bancada e falha na mão de quem está olhando — foi exatamente o que aconteceu
//! com a busca em órbitas começando no piso e subindo, e nenhum teste pegava.
//!
//!     cargo run --release -p motor-exato --example curva-de-descida -- 20 17

use motor_exato::escalada::Escalada;
use motor_exato::{limites, Fase, Problema};

fn main() {
    let mut a = std::env::args().skip(1);
    let v: usize = a.next().and_then(|s| s.parse().ok()).unwrap_or(20);
    let k: usize = a.next().and_then(|s| s.parse().ok()).unwrap_or(17);
    let teto: u64 = a.next().and_then(|s| s.parse().ok()).unwrap_or(80_000_000_000);

    let p = Problema::novo(v, k, 15, 15, 1).unwrap();
    let piso = limites::sem_busca(&p).valor as usize;
    println!("pool {v} · jogos de {k} · piso {piso} · teto de trabalho {teto}");

    let mut escalada = Escalada::nova(&p, piso);
    let comeco = std::time::Instant::now();
    let mut passo = escalada.avancar(20_000_000);
    let mut melhor = usize::MAX;
    loop {
        if passo.completo > 0 && passo.completo < melhor {
            melhor = passo.completo;
            println!(
                "  {melhor:>5} cartelas · trabalho {:>13} · {:>7.1}s · fase {:?}",
                passo.trabalho,
                comeco.elapsed().as_secs_f64(),
                passo.fase
            );
        }
        if passo.trabalho >= teto || passo.fase == Fase::Fechada {
            break;
        }
        passo = escalada.avancar(20_000_000);
    }
    println!("fim: {melhor} cartelas em {:.1}s", comeco.elapsed().as_secs_f64());
}
