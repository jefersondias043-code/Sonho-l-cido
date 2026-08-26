//! Custo por iteração ao longo de uma execução longa.
//!
//! ## A pergunta
//!
//! Uma busca que já está boa acha melhorias cada vez mais devagar. Isso tem
//! duas explicações possíveis, e elas exigem correções opostas:
//!
//! - **Dificuldade crescente** — cada tentativa custa o mesmo, mas são precisas
//!   cada vez mais tentativas para achar uma que sirva. É a matemática do
//!   problema, e a resposta é mudar de estratégia.
//! - **Degradação do motor** — cada tentativa vai ficando mais cara porque
//!   alguma estrutura interna cresce sem limite. É defeito de implementação, e a
//!   resposta é consertar.
//!
//! As duas podem acontecer juntas. Este perfil as separa: mede **milissegundos
//! por iteração** em janelas ao longo da execução, junto do tamanho da solução.
//!
//! ## Como ler
//!
//! O custo por iteração depende do tamanho da solução — uma solução menor tem
//! menos cartelas para mexer, mas o reparo trabalha mais para fechar a
//! cobertura. Então o número que interessa não é o custo bruto: é o custo
//! **comparado com o de antes, no mesmo tamanho**. Se a mesma cardinalidade sai
//! mais cara depois de duzentas mil iterações do que saía depois de dez mil, a
//! culpa é do motor.
//!
//!   cargo run --release -p motor-web --example perfil -- [iteracoes] [janela]

use std::time::Instant;

use motor_web::{ConfiguracaoEntrada, MotorWeb};
use serde_json::Value;

struct Janela {
    ate: u64,
    ms_por_iteracao: f64,
    melhor: usize,
    atual: usize,
    descobertos: u64,
    elites: usize,
    recordes: u64,
    diversificacoes: u64,
}

fn estado(motor: &MotorWeb) -> Value {
    serde_json::from_str(&motor.estado()).unwrap()
}

fn configuracao(pool: u32, cartela: usize, semente: u64) -> String {
    serde_json::to_string(&ConfiguracaoEntrada {
        universo: pool,
        pool: (1..=pool).collect(),
        cartela,
        alvo: 15,
        intersecao: 15,
        premiadas: 1,
        orcamento: None,
        semente,
    })
    .unwrap()
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let total: u64 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(300_000);
    let janela: u64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(10_000);

    let (pool, cartela) = (20u32, 17usize);
    let cfg = configuracao(pool, cartela, 7);
    let mut motor = MotorWeb::construir(&cfg).unwrap();
    motor.preparar();

    println!(
        "== {pool} dezenas, jogos de {cartela} — {total} iterações em janelas de {janela} ==\n"
    );
    println!(
        "{:>9}  {:>8}  {:>7}  {:>7}  {:>6}  {:>6}  {:>8}  {:>5}",
        "até", "ms/iter", "melhor", "atual", "desc.", "elites", "recordes", "div."
    );

    let mut janelas: Vec<Janela> = Vec::new();
    let (mut rec_antes, mut div_antes) = (0u64, 0u64);

    while janelas.last().map_or(0, |j| j.ate) < total {
        let comeco = estado(&motor)["iteracoes"].as_u64().unwrap();
        let relogio = Instant::now();
        while estado(&motor)["iteracoes"].as_u64().unwrap() < comeco + janela {
            motor.avancar(500, 600_000);
        }
        let gasto = relogio.elapsed();

        let e = estado(&motor);
        let feitas = e["iteracoes"].as_u64().unwrap() - comeco;
        let (recordes, diversificacoes) = (
            e["recordes"].as_u64().unwrap(),
            e["diversificacoes"].as_u64().unwrap(),
        );

        let j = Janela {
            ate: e["iteracoes"].as_u64().unwrap(),
            ms_por_iteracao: gasto.as_secs_f64() * 1000.0 / feitas as f64,
            melhor: e["melhor_cartelas"].as_u64().unwrap() as usize,
            atual: e["atual_cartelas"].as_u64().unwrap() as usize,
            descobertos: e["atual_descobertos"].as_u64().unwrap(),
            elites: e["elites"].as_u64().unwrap() as usize,
            recordes: recordes - rec_antes,
            diversificacoes: diversificacoes - div_antes,
        };
        rec_antes = recordes;
        div_antes = diversificacoes;

        println!(
            "{:>9}  {:>8.3}  {:>7}  {:>7}  {:>6}  {:>6}  {:>8}  {:>5}",
            j.ate, j.ms_por_iteracao, j.melhor, j.atual, j.descobertos, j.elites,
            j.recordes, j.diversificacoes
        );
        janelas.push(j);
    }

    // ── o veredito ──
    //
    // Agrupa as janelas por tamanho da solução e compara a primeira vez que
    // aquele tamanho apareceu com a última. Mesma cardinalidade, momentos
    // diferentes da execução: se ficou mais caro, a culpa é do motor.
    println!("\n== o mesmo tamanho, no começo e no fim ==\n");
    println!(
        "{:>7}  {:>12}  {:>12}  {:>9}",
        "melhor", "1ª vez", "última vez", "variação"
    );
    let mut tamanhos: Vec<usize> = janelas.iter().map(|j| j.melhor).collect();
    tamanhos.sort_unstable();
    tamanhos.dedup();
    let mut piores = 0;
    let mut comparados = 0;
    for t in tamanhos {
        let iguais: Vec<&Janela> = janelas.iter().filter(|j| j.melhor == t).collect();
        if iguais.len() < 2 {
            continue;
        }
        let (primeira, ultima) = (iguais[0], iguais[iguais.len() - 1]);
        let variacao = (ultima.ms_por_iteracao / primeira.ms_por_iteracao - 1.0) * 100.0;
        comparados += 1;
        if variacao > 15.0 {
            piores += 1;
        }
        println!(
            "{t:>7}  {:>12.3}  {:>12.3}  {:>+8.1}%",
            primeira.ms_por_iteracao, ultima.ms_por_iteracao, variacao
        );
    }

    let recordes_totais: u64 = janelas.iter().map(|j| j.recordes).sum();
    println!(
        "\n{comparados} tamanhos com mais de uma janela; {piores} ficaram mais de 15% mais caros.\n\
         {recordes_totais} recordes no total; a primeira janela achou {}, a última achou {}.",
        janelas.first().map_or(0, |j| j.recordes),
        janelas.last().map_or(0, |j| j.recordes)
    );
}
