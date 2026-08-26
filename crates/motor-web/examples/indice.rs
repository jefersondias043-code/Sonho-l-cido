//! Quanto custa reconstruir o índice de cobertura ao retomar.
//!
//! Ele não vai no arquivo — são centenas de megabytes nos pools grandes — e a
//! pergunta honesta é se reconstruí-lo é caro. Se for milissegundos, guardar
//! seria trocar um arquivo enorme por um ganho que ninguém percebe.
use motor_web::{ConfiguracaoEntrada, MotorWeb};
use std::time::Instant;
fn main() {
    for (pool, cartela) in [(19u32, 17usize), (20, 17), (22, 17), (23, 17), (25, 18)] {
        let cfg = serde_json::to_string(&ConfiguracaoEntrada {
            universo: pool, pool: (1..=pool).collect(), cartela,
            alvo: 15, intersecao: 15, premiadas: 1, orcamento: None, semente: 1,
        }).unwrap();
        let t = Instant::now();
        let m = MotorWeb::construir(&cfg).unwrap();
        let construir = t.elapsed();
        let v: serde_json::Value = serde_json::from_str(&m.estado()).unwrap();
        println!("{pool}/{cartela}: índice de {} alvos reconstruído em {:.0} ms",
            v["total_alvos"], construir.as_secs_f64() * 1000.0);
    }
}
