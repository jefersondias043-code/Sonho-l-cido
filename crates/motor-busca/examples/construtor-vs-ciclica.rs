//! O passeio por órbitas que o Construtor já tem, contra a busca cíclica
//! persistente — com o mesmo tempo de relógio para os dois.
//!
//! É a comparação que decide de quem é o mérito das soluções simétricas do
//! banco, e se vale promover a segunda a estágio de primeira classe.

use std::time::{Duration, Instant};

use motor_busca::ciclica::BuscaCiclica;
use motor_busca::construtor::{construir_o_menor, Achado};
use motor_busca::oficina::Oficina;
use motor_busca::orbitas::InstanciaCiclica;
use motor_core::{MotorCobertura, Objetivo, Problema, RegraCobertura};

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(60);
    let casos: Vec<(usize, usize, u64)> =
        vec![(20, 17, 240), (22, 18, 660), (21, 18, 182), (22, 19, 126)];

    println!("orçamento de {segundos}s por lado");
    println!("{:>9} {:>7} {:>12} {:>12}", "pool,jogo", "banco", "Construtor", "cíclica");

    for (pool, jogo, banco) in casos {
        let regra = RegraCobertura { alvo: 15, intersecao: 15, premiadas: 1 };
        let dezenas: Vec<u32> = (1..=pool as u32).collect();
        let problema =
            Problema::novo(25, dezenas, jogo, regra, Objetivo::MinimizarCartelas)
                .expect("problema válido");
        let cobertura = MotorCobertura::novo(&problema).expect("cobertura cabe");
        let mut oficina = Oficina::nova();

        let achado: Option<Achado> = construir_o_menor(
            &cobertura,
            &problema,
            Duration::from_secs(segundos),
            7,
            &mut oficina,
            &mut |_| {},
            None,
        );
        let do_construtor = achado.map(|a| a.cartelas.len() as u64).unwrap_or(0);

        // A trilha persistente, no mesmo relógio.
        let inst = InstanciaCiclica::montar(pool, pool - jogo, pool - 15, None).unwrap();
        let mut busca = BuscaCiclica::nova(inst, 1, 7);
        let ate = Instant::now() + Duration::from_secs(segundos);
        while Instant::now() < ate {
            busca.avancar(200);
        }
        let da_ciclica = busca.melhor_em_cartelas();

        let m = |v: u64| {
            if v == 0 {
                " (nada)".to_string()
            } else if v < banco {
                format!("{v} *")
            } else if v == banco {
                format!("{v} =")
            } else {
                format!("{v}  ")
            }
        };
        println!(
            "{:>9} {:>7} {:>12} {:>12}",
            format!("{pool},{jogo}"),
            banco,
            m(do_construtor),
            m(da_ciclica)
        );
    }
}
