//! O que cada motor consegue **depois** que o motor de hoje trava.
//!
//! ## Por que a comparação anterior não valia
//!
//! Medir duas políticas do começo ao fim dá vantagem de graça à de hoje. No
//! início sobra redundância, cartelas saem quase de graça, e quem for melhor
//! nessa fase abre uma dianteira que a outra não recupera — mesmo que a outra
//! seja justamente a que continua andando quando a redundância acaba.
//!
//! A pergunta que importa não é quem corre mais rápido na largada. É **quem
//! ainda anda quando o outro parou**.
//!
//! ## O desenho
//!
//! 1. O motor de hoje corre sozinho até estacionar — sem recorde por muito
//!    tempo. Esse é o estado difícil, e ele é produzido **uma vez**.
//! 2. Cada variante parte exatamente dali: mesmas cartelas, mesma solução em
//!    curso, mesmos contadores, mesmos pesos aprendidos, mesmo estado do
//!    gerador. A partida é idêntica, bit a bit.
//! 3. Todas correm o mesmo relógio. O que se compara é quanto cada uma ainda
//!    conseguiu tirar dali para baixo.
//!
//! A partida pareada usa o mesmo caminho de retomada de sessão do aplicativo —
//! o que também é uma prova a mais de que ele devolve o estado inteiro.
//!
//!   cargo run --release -p motor-busca --example depois -- [segundos] [sementes] [pool,cartela]

use std::time::Duration;

use motor_busca::{
    CondicoesDeParada, Configuracao, Controle, Evento, MotorBusca, Observador,
    TETO_DE_ELITES,
};
use motor_core::{Cartela, Objetivo, Problema, RegraCobertura};

struct Calado;
impl Observador for Calado {
    fn ao_evento(&mut self, _: &Evento) {}
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

/// O estado em que o motor de hoje parou de achar melhorias.
struct Travado {
    melhor: Vec<Cartela>,
    atual: Vec<Cartela>,
    retrato: motor_busca::RetratoDoMotor,
    elites: Vec<Vec<Cartela>>,
    cartelas: usize,
    iteracoes: u64,
    parada_ha: u64,
}

/// Roda o motor de hoje até ele ficar `parar_apos` iterações sem recorde.
fn ate_travar(pool: u32, cartela: usize, semente: u64, parar_apos: u64, teto: Duration) -> Travado {
    // O estado difícil é produzido pelo motor **de hoje**, sem correção nenhuma:
    // é o ponto em que ele para, e é dele que todas as variantes partem.
    // O estado difícil é produzido pelo motor de antes destas correções: é o
    // ponto em que ele para, e é dele que todas as variantes partem.
    let config = Configuracao {
        semente,
        intervalo_progresso: 0,
        teto_de_trocas_por_iteracao: u64::MAX,
        iteracoes_ate_diversificar: 50_000,
        ..Default::default()
    };
    let mut motor = MotorBusca::novo(problema(pool, cartela), config).unwrap();

    // Em fatias, para conferir a condição de parada entre elas.
    let fatia = Duration::from_secs(5);
    let mut gasto = Duration::ZERO;
    while gasto < teto && motor.retrato().iteracoes_sem_recorde < parar_apos {
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada {
                max_iteracoes: None,
                max_duracao: Some(fatia),
                parar_em_optimalidade: false,
            },
            &mut Calado,
        );
        gasto += fatia;
    }

    let retrato = motor.retrato();
    Travado {
        cartelas: motor.melhor_avaliacao().cartelas,
        iteracoes: retrato.iteracoes,
        parada_ha: retrato.iteracoes_sem_recorde,
        melhor: motor.melhor_cartelas().to_vec(),
        atual: motor.cartelas_atuais().to_vec(),
        elites: motor.elites_ate(TETO_DE_ELITES),
        retrato,
    }
}

/// Continua do estado travado, com a configuração da variante.
fn continuar(
    pool: u32,
    cartela: usize,
    travado: &Travado,
    config: Configuracao,
    segundos: u64,
) -> (usize, u64, u64) {
    let mut motor = MotorBusca::novo(problema(pool, cartela), config).unwrap();
    motor.retomar_sessao(&travado.melhor, &travado.atual, &travado.retrato);
    motor.repor_elites(&travado.elites);

    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_iteracoes: None,
            max_duracao: Some(Duration::from_secs(segundos)),
            parar_em_optimalidade: false,
        },
        &mut Calado,
    );
    (
        motor.melhor_avaliacao().cartelas,
        motor.estatisticas().iteracoes - travado.iteracoes,
        motor.estatisticas().diversificacoes - travado.retrato.diversificacoes,
    )
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let segundos: u64 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(240);
    let sementes: u64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
    let (pool, cartela) = a
        .get(3)
        .and_then(|s| {
            let (p, c) = s.split_once(',')?;
            Some((p.trim().parse::<u32>().ok()?, c.trim().parse::<usize>().ok()?))
        })
        .unwrap_or((20, 17));

    // As duas correções que o perfil justificou, isoladas e juntas. O padrão de
    // hoje é a referência: qualquer uma delas só entra se ganhar dele **no
    // estágio difícil**, que é onde ele para.
    // Confirmação do limiar, agora **com** o teto de trocas — que é o que
    // tornava cada diversificação cara. A medição anterior de limiares foi
    // feita sem ele, e por isso não vale mais.
    let base = || Configuracao { intervalo_progresso: 0, ..Default::default() };
    let variantes: Vec<(&str, Configuracao)> = vec![
        ("limiar 50.000 (o de antes)", Configuracao {
            iteracoes_ate_diversificar: 50_000,
            ..base()
        }),
        ("limiar 10.000 (o novo)", Configuracao {
            iteracoes_ate_diversificar: 10_000,
            ..base()
        }),
        ("limiar 5.000", Configuracao { iteracoes_ate_diversificar: 5_000, ..base() }),
    ];

    println!(
        "== {pool} dezenas, jogos de {cartela} ==\n\n\
         O motor de hoje corre até ficar 45.000 iterações sem recorde. Desse ponto —\n\
         idêntico bit a bit para todas — cada variante continua por {segundos} s.\n\
         O que se compara é quanto ainda saiu **depois** do travamento.\n"
    );

    let mut ganhos: Vec<Vec<i64>> = vec![Vec::new(); variantes.len()];

    for semente in 1..=sementes {
        let travado = ate_travar(pool, cartela, semente, 45_000, Duration::from_secs(900));
        println!(
            "  semente {semente} — travou em {} cartelas, na iteração {}, parada há {}",
            travado.cartelas, travado.iteracoes, travado.parada_ha
        );

        for (i, (nome, config)) in variantes.iter().enumerate() {
            let mut config = config.clone();
            config.semente = semente;
            let (cartelas, iteracoes, divs) = continuar(pool, cartela, &travado, config, segundos);
            let ganho = travado.cartelas as i64 - cartelas as i64;
            ganhos[i].push(ganho);
            println!(
                "    {nome:<28} {cartelas:>5} cartelas · tirou {ganho:>3} · {iteracoes:>7} iter · {divs:>2} div"
            );
        }
        println!();
    }

    println!("  quanto cada variante ainda tirou depois do travamento:");
    for (i, (nome, _)) in variantes.iter().enumerate() {
        let soma: i64 = ganhos[i].iter().sum();
        let media = soma as f64 / ganhos[i].len() as f64;
        let lista = ganhos[i].iter().map(|g| format!("{g:>3}")).collect::<Vec<_>>().join(" ");
        println!("    {nome:<28} {lista}   média {media:>5.1}");
    }
}
