//! Aferição do motor contra a tabela mundial de coberturas.
//!
//! É a resposta honesta para "esse otimizador é bom?" — não a opinião de quem
//! escreveu o código, mas a distância medida até um resultado externo.
//!
//! Os números de comparação vêm de [`motor_core::referencia`], que embute a La
//! Jolla Covering Repository: para cada `C(v,k,t)`, o melhor resultado que
//! alguém já produziu no mundo e o melhor limite inferior já provado. Nenhum
//! valor é escrito à mão aqui — se a tabela for atualizada, a aferição acompanha
//! sozinha.
//!
//! ```bash
//! cargo run --release --example aferir
//! ```

use std::time::{Duration, Instant};

use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca, Silencioso};
use motor_core::{referencia, Objetivo, Problema, RegraCobertura};

/// Configurações clássicas, com a razão de cada uma ser interessante.
///
/// O número a alcançar não está aqui — vem da tabela. O que está escrito é só
/// por que este caso merece um lugar na lista.
const CLASSICOS: &[(usize, usize, usize, &str)] = &[
    (7, 3, 2, "plano de Fano"),
    (9, 3, 2, "sistema de Steiner S(2,3,9)"),
    (10, 3, 2, "cota de Schönheim exata"),
    (11, 3, 2, "cota de Schönheim exata"),
    (12, 3, 2, "cota de Schönheim exata"),
    (13, 3, 2, "sistema de Steiner S(2,3,13)"),
    (8, 4, 3, "valor clássico C(8,4,3)"),
    (13, 4, 2, "plano projetivo de ordem 3"),
    (16, 4, 2, "sistema de Steiner S(2,4,16)"),
    (21, 5, 2, "plano projetivo de ordem 4"),
    (25, 5, 2, "plano afim de ordem 5"),
];

const TEMPO_POR_CASO: Duration = Duration::from_secs(3);

/// Orçamento por configuração na varredura ampla.
///
/// Um segundo por padrão, para a aferição inteira caber em minutos. Dá para
/// afrouxar com `SEGUNDOS_POR_CASO=10`, e a diferença entre os dois números
/// responde a uma pergunta que importa: quanto do que falta é o motor, e quanto
/// é só falta de tempo.
fn tempo_na_varredura() -> Duration {
    let segundos = std::env::var("SEGUNDOS_POR_CASO")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1);
    Duration::from_secs(segundos.max(1))
}

fn main() {
    println!("Aferição contra a tabela mundial ({} configurações catalogadas)", referencia::quantidade_catalogada());
    println!();
    aferir_classicos();
    varrer_a_faixa();
}

struct Medida {
    achado: usize,
    melhor_do_mundo: u64,
    provado: bool,
    iteracoes: u64,
    origem: String,
    segundos: f64,
}

fn medir(pool: usize, cartela: usize, t: usize, orcamento: Duration) -> Option<Medida> {
    let referencia = referencia::consultar(pool, cartela, t)?;

    let problema = Problema::com_pool_inicial(
        pool as u32,
        pool,
        cartela,
        RegraCobertura::cobrir_subconjuntos(t),
        Objetivo::MinimizarCartelas,
    )
    .ok()?;

    let config = Configuracao { semente: 20260816, intervalo_progresso: 0, ..Default::default() };
    let mut motor = MotorBusca::novo(problema, config).ok()?;

    let inicio = Instant::now();
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_duracao: Some(orcamento),
            parar_em_optimalidade: true,
            ..Default::default()
        },
        &mut Silencioso,
    );
    let segundos = inicio.elapsed().as_secs_f64();

    // A solução precisa ser válida de verdade, não só ter o tamanho certo.
    assert!(
        motor.melhor_solucao().cobertura_total(),
        "C({pool},{cartela},{t}): a solução apresentada não cobre tudo"
    );
    // E jamais pode ficar abaixo do que já se provou impossível de superar.
    assert!(
        motor.melhor_avaliacao().cartelas as u64 >= referencia.limite_publicado,
        "C({pool},{cartela},{t}): {} cartelas fica abaixo do limite provado {}",
        motor.melhor_avaliacao().cartelas,
        referencia.limite_publicado
    );

    Some(Medida {
        achado: motor.melhor_avaliacao().cartelas,
        melhor_do_mundo: referencia.melhor_conhecido,
        provado: motor.optimalidade_provada(),
        iteracoes: motor.estatisticas().iteracoes,
        origem: motor.origem_do_inicio().to_string(),
        segundos,
    })
}

fn aferir_classicos() {
    println!("Configurações clássicas");
    println!("{}", "=".repeat(104));
    println!(
        "{:<14} {:>7} {:>7} {:>7} {:>8} {:>11}  {:<24} referência",
        "configuração", "mundo", "achado", "gap", "prova", "iterações", "partida"
    );
    println!("{}", "-".repeat(104));

    let mut alcancou = 0;
    for &(pool, cartela, t, fonte) in CLASSICOS {
        let Some(m) = medir(pool, cartela, t, TEMPO_POR_CASO) else {
            println!("C({pool},{cartela},{t}): fora da tabela");
            continue;
        };

        if m.achado as u64 <= m.melhor_do_mundo {
            alcancou += 1;
        }
        let gap = (m.achado as f64 - m.melhor_do_mundo as f64) / m.melhor_do_mundo as f64 * 100.0;

        println!(
            "{:<14} {:>7} {:>7} {:>6.1}% {:>8} {:>11}  {:<24} {}",
            format!("C({pool},{cartela},{t})"),
            m.melhor_do_mundo,
            m.achado,
            gap,
            if m.provado { "sim" } else { "—" },
            m.iteracoes,
            m.origem,
            fonte,
        );
    }

    println!("{}", "-".repeat(104));
    println!(
        "Alcançou o melhor conhecido no mundo em {alcancou} de {} configurações (até {}s cada).",
        CLASSICOS.len(),
        TEMPO_POR_CASO.as_secs()
    );
    println!();
}

/// Varre uma faixa ampla da tabela e reporta a distribuição das distâncias.
///
/// A lista de clássicos é escolhida a dedo, e casos escolhidos a dedo tendem a
/// favorecer quem os escolheu. Esta varredura não pergunta nada: pega tudo que
/// couber no orçamento de memória e de tempo, e conta quantas vezes o motor
/// empata com o mundo, chega perto, ou fica longe.
fn varrer_a_faixa() {
    let orcamento = tempo_na_varredura();
    println!("Varredura da faixa ({}s por configuração)", orcamento.as_secs());
    println!("{}", "=".repeat(104));

    let mut empatou = 0;
    let mut ate_5 = 0;
    let mut ate_20 = 0;
    let mut acima_de_20 = 0;
    let mut piores: Vec<(String, usize, u64, f64)> = Vec::new();
    let mut total = 0;

    for t in 2..=3 {
        for cartela in 3..=7 {
            for pool in (cartela + 1)..=30 {
                let Some(m) = medir(pool, cartela, t, orcamento) else { continue };
                total += 1;

                let gap =
                    (m.achado as f64 - m.melhor_do_mundo as f64) / m.melhor_do_mundo as f64 * 100.0;
                if m.achado as u64 <= m.melhor_do_mundo {
                    empatou += 1;
                } else if gap <= 5.0 {
                    ate_5 += 1;
                } else if gap <= 20.0 {
                    ate_20 += 1;
                } else {
                    acima_de_20 += 1;
                }

                if gap > 0.0 {
                    piores.push((format!("C({pool},{cartela},{t})"), m.achado, m.melhor_do_mundo, gap));
                }
                let _ = m.segundos;
            }
        }
    }

    let porcento = |n: usize| n as f64 / total.max(1) as f64 * 100.0;
    println!("{total} configurações medidas:");
    println!("  empatou ou superou o mundo : {empatou:>4}  ({:>5.1}%)", porcento(empatou));
    println!("  até 5% acima               : {ate_5:>4}  ({:>5.1}%)", porcento(ate_5));
    println!("  de 5% a 20% acima          : {ate_20:>4}  ({:>5.1}%)", porcento(ate_20));
    println!("  mais de 20% acima          : {acima_de_20:>4}  ({:>5.1}%)", porcento(acima_de_20));

    if !piores.is_empty() {
        piores.sort_by(|a, b| b.3.total_cmp(&a.3));
        println!();
        println!("Onde o motor mais fica atrás:");
        for (nome, achado, mundo, gap) in piores.iter().take(10) {
            println!("  {nome:<14} achou {achado:>4}, o mundo tem {mundo:>4}  (+{gap:.1}%)");
        }
    }
}
