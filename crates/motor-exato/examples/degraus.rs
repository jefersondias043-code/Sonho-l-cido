//! Quantos degraus inviáveis a busca em órbitas varria antes do primeiro que dá.
//!
//! Só aritmética: piso, tamanho da órbita e melhor conhecido. Não roda busca
//! nenhuma, e por isso responde em milissegundos para qualquer escala — é a
//! projeção que dispensa medir o caso grande.
use motor_exato::{limites, Problema};

fn main() {
    // (pool, jogo, melhor publicado)
    let familia: [(usize, usize, usize); 13] = [
        (18, 17, 16), (19, 17, 51), (19, 18, 16),
        (20, 17, 240), (20, 18, 40), (20, 19, 16),
        (21, 17, 1095), (21, 18, 182), (21, 19, 34), (21, 20, 16),
        (22, 19, 126), (22, 20, 30), (23, 20, 100),
    ];
    println!("{:>5} {:>5} {:>7} {:>7} {:>8} {:>8} {:>9}", "pool", "jogo", "piso", "melhor", "m_piso", "m_bom", "degraus");
    for (v, k, melhor) in familia {
        let p = Problema::novo(v, k, 15, 15, 1).unwrap();
        let piso = limites::sem_busca(&p).valor as usize;
        // A maior órbita sob a rotação de Z_v tem v elementos.
        let m_piso = piso.div_ceil(v).max(1);
        let m_bom = melhor.div_ceil(v).max(1);
        let degraus = m_bom.saturating_sub(m_piso);
        println!("{v:>5} {k:>5} {piso:>7} {melhor:>7} {m_piso:>8} {m_bom:>8} {degraus:>9}");
    }
}
