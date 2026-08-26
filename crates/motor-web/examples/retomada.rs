//! O que se perde ao interromper e retomar uma otimização — e quanto custa.
//!
//! ## Duas perguntas, dois instrumentos
//!
//! **Perdeu estado?** Tem resposta determinística. Uma corrida vai até a
//! iteração `N`, exporta pelo mesmo `exportar()` da tela, e um motor novo a
//! retoma por `retomar_com()`. Se a retomada devolvesse o estado inteiro, as
//! duas seguiriam pelo mesmo caminho. O modo `divergencia` mostra em que
//! iteração elas se separam e em qual campo.
//!
//! **Custou desempenho?** Aí é medição, e medição precisa de controle. O modo
//! `desempenho` roda a mesma primeira metade **uma vez** e a retoma em várias
//! versões, cada uma perdendo de propósito uma parte do estado — apagando
//! campos do arquivo exportado. Como todo campo novo é opcional na leitura,
//! apagar um reproduz exatamente o comportamento de antes dele existir. É um
//! experimento controlado de verdade: mesma máquina, mesma semente, mesma
//! primeira metade, e uma variável por vez.
//!
//!   cargo run --release -p motor-web --example retomada -- divergencia [ate] [depois]
//!   cargo run --release -p motor-web --example retomada -- desempenho  [ate] [depois] [sementes]

use motor_web::{ConfiguracaoEntrada, MotorWeb};
use serde_json::Value;

/// Os campos do estado que descrevem a busca — sem relógio, que não é dela.
const CAMPOS: [&str; 9] = [
    "iteracoes",
    "aceitas",
    "recordes",
    "diversificacoes",
    "melhor_cartelas",
    "atual_cartelas",
    "atual_descobertos",
    "meta_cartelas",
    "elites",
];

fn estado(motor: &MotorWeb) -> Value {
    serde_json::from_str(&motor.estado()).unwrap()
}

fn diferencas(a: &Value, b: &Value) -> Vec<String> {
    CAMPOS
        .iter()
        .filter(|c| a[**c] != b[**c])
        .map(|c| format!("{c} {} ≠ {}", a[*c], b[*c]))
        .collect()
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

/// O fechamento do banco, expandido: o arquivo guarda as posições de fora.
fn do_banco(pool: u32, cartela: usize) -> String {
    let bruto = std::fs::read_to_string("web/lotinha.json").expect("web/lotinha.json");
    let v: Value = serde_json::from_str(&bruto).unwrap();
    let cartelas: Vec<Vec<u32>> = v["fechamentos"][&format!("{pool},{cartela}")]
        .as_array()
        .expect("configuração no banco")
        .iter()
        .map(|fora| {
            let fora: Vec<u32> =
                fora.as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect();
            (1..=pool).filter(|n| !fora.contains(n)).collect()
        })
        .collect();
    serde_json::to_string(&cartelas).unwrap()
}

fn ate_a_iteracao(motor: &mut MotorWeb, ate: u64, lote: u32) {
    while estado(motor)["iteracoes"].as_u64().unwrap() < ate {
        motor.avancar(lote, 600_000);
    }
}

/// Um arquivo de sessão sem os campos indicados — a retomada de antes deles.
fn sem(arquivo: &str, campos: &[&str]) -> String {
    let mut v: Value = serde_json::from_str(arquivo).unwrap();
    for campo in campos {
        if *campo == "elites" {
            v.as_object_mut().unwrap().remove("elites");
        } else {
            v["motor"].as_object_mut().unwrap().remove(*campo);
        }
    }
    v.to_string()
}

fn divergencia(ate: u64, depois: u64) {
    let casos: Vec<(&str, u32, usize, bool)> = vec![
        ("20 dezenas, jogos de 17, começando do zero", 20, 17, false),
        ("20 dezenas, jogos de 17, partindo do banco", 20, 17, true),
        ("19 dezenas, jogos de 17, partindo do banco", 19, 17, true),
    ];

    for (nome, pool, cartela, usar_banco) in casos {
        println!("== {nome} ==");
        let cfg = configuracao(pool, cartela, 7);
        let banco = usar_banco.then(|| do_banco(pool, cartela));

        let mut continua = MotorWeb::construir(&cfg).unwrap();
        if let Some(b) = &banco {
            continua.semear_do_banco_com(b).unwrap();
        }
        continua.preparar();
        ate_a_iteracao(&mut continua, ate, 200);
        let no_corte = estado(&continua);
        println!(
            "  no corte: {} iterações · {} cartelas · {} elites · meta {}",
            no_corte["iteracoes"], no_corte["melhor_cartelas"], no_corte["elites"],
            no_corte["meta_cartelas"]
        );

        let arquivo = continua.exportar();
        let mut retomada = MotorWeb::construir(&cfg).unwrap();
        retomada.retomar_com(&arquivo).unwrap();

        let logo_apos = diferencas(&no_corte, &estado(&retomada));
        println!(
            "  logo após retomar: {}",
            if logo_apos.is_empty() { "o estado visível é o mesmo".to_string() }
            else { format!("já difere em {}", logo_apos.join(" · ")) }
        );

        let mut divergiu = None;
        let mut andadas = 0u64;
        while andadas < depois {
            let passo = if andadas < 60 { 1 } else { 200 };
            continua.avancar(passo, 600_000);
            retomada.avancar(passo, 600_000);
            andadas += u64::from(passo);
            let d = diferencas(&estado(&continua), &estado(&retomada));
            if !d.is_empty() && divergiu.is_none() {
                divergiu = Some((andadas, d));
            }
        }
        match &divergiu {
            Some((i, campos)) => {
                println!("  separaram-se {i} iterações depois: {}", campos.join(" · "))
            }
            None => println!("  seguiram idênticas pelas {depois} iterações seguintes"),
        }
        println!();
    }
}

/// Quantas iterações a busca leva sem recorde — o relógio da diversificação.
fn parada_ha(motor: &MotorWeb) -> u64 {
    let r: Value = serde_json::from_str(&motor.retrato_de_sessao()).unwrap();
    r["iteracoes_sem_recorde"].as_u64().unwrap()
}

fn desempenho(ate_parar: u64, depois: u64, sementes: u64) {
    // Cada versão perde de propósito uma parte do estado. Apagar um campo do
    // arquivo reproduz o comportamento de antes de ele existir, porque a leitura
    // trata todo campo novo como opcional. É um experimento controlado: mesma
    // máquina, mesma semente, mesma primeira metade, uma variável por vez.
    let versoes: Vec<(&str, Vec<&str>)> = vec![
        ("retomada completa", vec![]),
        ("sem o relógio da diversificação", vec!["iteracoes_sem_recorde"]),
        ("sem o estado do gerador", vec!["gerador"]),
        ("sem o arquivo de elites", vec!["elites"]),
        ("sem a memória da aceitação", vec!["memoria_aceitacao", "passo_da_aceitacao"]),
        (
            "como era antes (sem nada disso)",
            vec![
                "iteracoes_sem_recorde", "elites", "memoria_aceitacao", "passo_da_aceitacao",
                "gerador", "melhor_assinatura", "pontos_do_segmento", "usos_do_segmento",
                "passo_no_segmento",
            ],
        ),
    ];

    let (pool, cartela) = (20u32, 17usize);
    println!(
        "== {pool} dezenas, jogos de 17 ==\n\n\
         O corte não é numa iteração fixa: é quando a busca está parada há\n\
         {ate_parar} iterações sem recorde. É o regime que o usuário descreve — uma\n\
         otimização já avançada — e é onde o relógio da diversificação importa,\n\
         porque ela dispara em 50.000 e falta pouco. Cada versão continua por\n\
         {depois} iterações.\n"
    );

    let mut totais = vec![(0u64, 0usize); versoes.len()];
    let (mut rec_continua, mut fim_continua) = (0u64, 0usize);

    for semente in 1..=sementes {
        let cfg = configuracao(pool, cartela, semente);

        let mut continua = MotorWeb::construir(&cfg).unwrap();
        continua.preparar();
        while parada_ha(&continua) < ate_parar {
            continua.avancar(500, 600_000);
        }

        let corte = estado(&continua);
        let arquivo = continua.exportar();
        let (div0, rec0) = (
            corte["diversificacoes"].as_u64().unwrap(),
            corte["recordes"].as_u64().unwrap(),
        );
        let ate = corte["iteracoes"].as_u64().unwrap();
        println!(
            "  semente {semente} — cortada na iteração {ate}, com {} cartelas, {} elites, \
             parada há {} iterações",
            corte["melhor_cartelas"], corte["elites"], parada_ha(&continua)
        );

        let mut relatar = |nome: &str, m: &MotorWeb| -> (u64, usize) {
            let f = estado(m);
            let (d, r, c) = (
                f["diversificacoes"].as_u64().unwrap() - div0,
                f["recordes"].as_u64().unwrap() - rec0,
                f["melhor_cartelas"].as_u64().unwrap() as usize,
            );
            println!("    {nome:<34} {d:>2} diversificações · {r:>2} recordes · chegou a {c}");
            (r, c)
        };

        continua.avancar(0, 1);
        let mut alvo = ate + depois;
        while estado(&continua)["iteracoes"].as_u64().unwrap() < alvo {
            continua.avancar(500, 600_000);
        }
        let (r, c) = relatar("corrida contínua (referência)", &continua);
        rec_continua += r;
        fim_continua += c;

        for (i, (nome, apagar)) in versoes.iter().enumerate() {
            let mut m = MotorWeb::construir(&cfg).unwrap();
            m.retomar_com(&sem(&arquivo, apagar)).unwrap();
            alvo = ate + depois;
            while estado(&m)["iteracoes"].as_u64().unwrap() < alvo {
                m.avancar(500, 600_000);
            }
            let (r, c) = relatar(nome, &m);
            totais[i].0 += r;
            totais[i].1 += c;
        }
        println!();
    }

    println!("  soma de {sementes} sementes — recordes achados depois do corte, e cartelas ao fim:");
    println!(
        "    {:<34} {rec_continua:>3} recordes · {fim_continua} cartelas somadas",
        "corrida contínua (referência)"
    );
    for (i, (nome, _)) in versoes.iter().enumerate() {
        println!(
            "    {nome:<34} {:>3} recordes · {} cartelas somadas",
            totais[i].0, totais[i].1
        );
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let modo = a.get(1).cloned().unwrap_or_else(|| "divergencia".to_string());
    match modo.as_str() {
        "desempenho" => desempenho(
            a.get(2).and_then(|s| s.parse().ok()).unwrap_or(30_000),
            a.get(3).and_then(|s| s.parse().ok()).unwrap_or(30_000),
            a.get(4).and_then(|s| s.parse().ok()).unwrap_or(3),
        ),
        _ => divergencia(
            a.get(2).and_then(|s| s.parse().ok()).unwrap_or(10_000),
            a.get(3).and_then(|s| s.parse().ok()).unwrap_or(1_500),
        ),
    }
}
