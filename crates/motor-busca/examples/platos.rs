//! Como sair de um platô sem se enterrar noutro.
//!
//! ## O que o perfil mostrou
//!
//! Duas coisas, e a segunda é pior que a primeira.
//!
//! 1. O motor insiste 50.000 iterações antes de mudar de região. É um número
//!    fixo, e o perfil pegou quarenta mil iterações paradas em 308 cartelas
//!    esperando o gatilho — que, quando disparou, destravou 38 cartelas.
//!
//! 2. Quando a diversificação constrói do zero, ela deixa a busca pior do que
//!    encontrou. A construção sai com 364 cartelas onde a meta é 244; o corte
//!    que vem a seguir abre um buraco de 240 sorteios, e a busca passa a gastar
//!    16 ms por iteração — dez vezes o normal — sem achar nada, sem saída.
//!
//! ## O experimento
//!
//! O orçamento é de **tempo**, e não de iterações: a pergunta é sobre melhoria
//! por unidade de processamento, e uma política que faz iterações dez vezes
//! mais caras precisa pagar por isso.
//!
//!   cargo run --release -p motor-busca --example platos -- [segundos] [sementes]

use std::time::Duration;

use motor_busca::{
    CondicoesDeParada, Configuracao, Controle, MotorBusca, Observador, ReinicioDaDiversificacao,
};
use motor_core::{Objetivo, Problema, RegraCobertura};

struct Calado;
impl Observador for Calado {
    fn ao_evento(&mut self, _: &motor_busca::Evento) {}
}

fn problema(pool: u32, cartela: usize) -> Problema {
    Problema::com_pool_inicial(
        pool,
        pool as usize,
        cartela,
        RegraCobertura::garantia(15, 15),
        Objetivo::MinimizarCartelas,
    )
    .unwrap()
}

struct Resultado {
    cartelas: usize,
    iteracoes: u64,
    diversificacoes: u64,
}

fn correr(
    pool: u32,
    cartela: usize,
    semente: u64,
    limiar: u64,
    reinicio: ReinicioDaDiversificacao,
    segundos: u64,
) -> Resultado {
    let config = Configuracao {
        semente,
        iteracoes_ate_diversificar: limiar,
        reinicio_da_diversificacao: reinicio,
        intervalo_progresso: 0,
        ..Default::default()
    };
    let mut motor = MotorBusca::novo(problema(pool, cartela), config).unwrap();
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_iteracoes: None,
            max_duracao: Some(Duration::from_secs(segundos)),
            parar_em_optimalidade: false,
        },
        &mut Calado,
    );
    Resultado {
        cartelas: motor.melhor_avaliacao().cartelas,
        iteracoes: motor.estatisticas().iteracoes,
        diversificacoes: motor.estatisticas().diversificacoes,
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let segundos: u64 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(90);
    let sementes: u64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);

    // Só a política de hoje. A alternativa já foi medida duas vezes e perdeu nas
    // duas — com um evento por corrida e com cinco — então gastar máquina com
    // ela de novo seria pagar para reconfirmar o que já está confirmado.
    let politicas = [("constrói do zero", ReinicioDaDiversificacao::DoZero)];
    // Os limiares vêm por argumento porque um limiar só é testável se a corrida
    // chegar a ele: em `(20,17)` são cerca de 590 iterações por segundo, então
    // 50.000 exigem um minuto e meio só para o gatilho disparar uma vez.
    let limiares: Vec<u64> = a
        .get(3)
        .map(|s| s.split(',').filter_map(|n| n.trim().parse().ok()).collect())
        .unwrap_or_else(|| vec![50_000]);
    // A configuração vem por argumento (`20,17`). Uma configuração só não basta
    // para mudar um padrão que vale para todas.
    let casos: Vec<(u32, usize)> = a
        .get(4)
        .and_then(|s| {
            let (p, c) = s.split_once(',')?;
            Some(vec![(p.trim().parse::<u32>().ok()?, c.trim().parse::<usize>().ok()?)])
        })
        .unwrap_or_else(|| vec![(20, 17)]);

    println!(
        "Cada linha corre {segundos} s por semente. Menos cartelas é melhor.\n\
         O limiar de 50.000 é o de hoje; 'constrói do zero' é o comportamento de hoje.\n"
    );

    for &(pool, cartela) in &casos {
        println!("== {pool} dezenas, jogos de {cartela} ==");
        println!(
            "{:<20} {:>8}  {:>28}  {:>8}  {:>7}  {:>5}",
            "reinício", "limiar", "por semente", "média", "iter.", "div."
        );

        for (nome, reinicio) in politicas {
            for &limiar in &limiares {
                let mut cartelas = Vec::new();
                let (mut it, mut dv) = (0u64, 0u64);
                for semente in 1..=sementes {
                    let r = correr(pool, cartela, semente, limiar, reinicio, segundos);
                    cartelas.push(r.cartelas);
                    it += r.iteracoes;
                    dv += r.diversificacoes;
                }
                let media = cartelas.iter().sum::<usize>() as f64 / cartelas.len() as f64;
                let lista = cartelas.iter().map(|c| format!("{c:>5}")).collect::<Vec<_>>().join(" ");
                println!(
                    "{nome:<20} {limiar:>8}  {lista:>28}  {media:>8.1}  {:>7}  {:>5}",
                    it / sementes,
                    dv / sementes
                );
            }
        }
        println!();
    }
}
