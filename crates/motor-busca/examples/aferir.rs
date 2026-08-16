//! Aferição do motor contra ótimos publicados.
//!
//! Roda uma bateria de covering designs cujo número de cobertura mínimo já foi
//! provado na literatura e compara com o que o motor encontra sozinho. É a
//! resposta honesta para "esse otimizador é bom?" — não a opinião de quem
//! escreveu o código, mas a distância medida até um resultado externo.
//!
//! ```bash
//! cargo run --release --example aferir
//! ```

use std::time::{Duration, Instant};

use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca, Silencioso};
use motor_core::{Objetivo, Problema, RegraCobertura};

/// `(pool, cartela, t, ótimo conhecido, descrição da fonte)`
const REFERENCIAS: &[(usize, usize, usize, usize, &str)] = &[
    (7, 3, 2, 7, "plano de Fano"),
    (9, 3, 2, 12, "sistema de Steiner S(2,3,9)"),
    (10, 3, 2, 17, "cota de Schönheim exata"),
    (11, 3, 2, 19, "cota de Schönheim exata"),
    (12, 3, 2, 24, "cota de Schönheim exata"),
    (13, 3, 2, 26, "sistema de Steiner S(2,3,13)"),
    (8, 4, 3, 14, "valor clássico C(8,4,3)"),
    (13, 4, 2, 13, "plano projetivo de ordem 3"),
    (16, 4, 2, 20, "sistema de Steiner S(2,4,16)"),
    (21, 5, 2, 21, "plano projetivo de ordem 4"),
    (25, 5, 2, 30, "sistema de Steiner S(2,5,25)"),
];

/// Orçamento de tempo por configuração.
const TEMPO_POR_CASO: Duration = Duration::from_secs(3);

fn main() {
    println!("Aferição do motor contra ótimos conhecidos");
    println!("{}", "=".repeat(96));
    println!(
        "{:<14} {:>6} {:>7} {:>7} {:>8} {:>12} {:>11}  referência",
        "configuração", "ótimo", "achado", "gap", "prova", "iterações", "iter/s"
    );
    println!("{}", "-".repeat(96));

    let mut alcancou_o_otimo = 0;
    let mut total = 0;

    for &(pool, cartela, t, otimo, fonte) in REFERENCIAS {
        let problema = Problema::com_pool_inicial(
            pool as u32,
            pool,
            cartela,
            RegraCobertura::cobrir_subconjuntos(t),
            Objetivo::MinimizarCartelas,
        )
        .expect("configuração de referência precisa ser válida");

        let config = Configuracao { semente: 20260816, intervalo_progresso: 0, ..Default::default() };
        let mut motor = MotorBusca::novo(problema, config).expect("configuração viável");

        let inicio = Instant::now();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada { max_duracao: Some(TEMPO_POR_CASO), parar_em_optimalidade: true, ..Default::default() },
            &mut Silencioso,
        );
        let decorrido = inicio.elapsed();

        let achado = motor.melhor_avaliacao().cartelas;
        let iteracoes = motor.estatisticas().iteracoes;
        let por_segundo = iteracoes as f64 / decorrido.as_secs_f64().max(1e-9);
        let gap = (achado as f64 - otimo as f64) / otimo as f64 * 100.0;

        total += 1;
        if achado <= otimo {
            alcancou_o_otimo += 1;
        }

        // A solução precisa ser válida de verdade, não só ter o tamanho certo.
        let solucao = motor.melhor_solucao();
        assert!(
            solucao.cobertura_total(),
            "C({pool},{cartela},{t}): solução apresentada não cobre tudo"
        );

        println!(
            "{:<14} {:>6} {:>7} {:>6.1}% {:>8} {:>12} {:>11.0}  {}",
            format!("C({pool},{cartela},{t})"),
            otimo,
            achado,
            gap,
            if motor.optimalidade_provada() { "sim" } else { "—" },
            iteracoes,
            por_segundo,
            fonte,
        );
    }

    println!("{}", "-".repeat(96));
    println!(
        "Alcançou o ótimo conhecido em {alcancou_o_otimo} de {total} configurações \
         (até {}s por caso).",
        TEMPO_POR_CASO.as_secs()
    );

    medir_velocidade_bruta();
}

/// Mede o desempenho numa configuração grande, do tamanho que o motor
/// encontraria em uso real.
fn medir_velocidade_bruta() {
    println!();
    println!("Velocidade em configuração de porte real");
    println!("{}", "=".repeat(96));

    for (universo, pool, cartela, alvo, intersecao) in
        [(60u32, 20usize, 6usize, 6usize, 4usize), (25, 18, 15, 15, 11), (60, 24, 7, 3, 3)]
    {
        let problema = Problema::com_pool_inicial(
            universo,
            pool,
            cartela,
            RegraCobertura::garantia(alvo, intersecao),
            Objetivo::MinimizarCartelas,
        )
        .expect("configuração válida");

        let config = Configuracao { semente: 7, intervalo_progresso: 0, ..Default::default() };
        let Ok(mut motor) = MotorBusca::novo(problema, config) else {
            println!("universo {universo}, pool {pool}: configuração acima do limite de memória");
            continue;
        };

        let alvos = motor.cobertura().total_alvos();
        let inicio = Instant::now();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada { max_duracao: Some(TEMPO_POR_CASO), ..Default::default() },
            &mut Silencioso,
        );
        let decorrido = inicio.elapsed();
        let iteracoes = motor.estatisticas().iteracoes;

        println!(
            "universo {universo:>3}, pool {pool:>2}, cartela {cartela:>2}, garantia {intersecao} em {alvo}  \
             →  {alvos:>9} alvos | {:>3} cartelas | limite ≥ {:>3} | {iteracoes:>10} iter em {:.1}s ({:.0} iter/s)",
            motor.melhor_avaliacao().cartelas,
            motor.limite_inferior().valor,
            decorrido.as_secs_f64(),
            iteracoes as f64 / decorrido.as_secs_f64().max(1e-9),
        );
    }
}
