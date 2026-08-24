//! Quanto o motor desce de cada vez, e o que a meta permite.
//!
//! A pergunta é objetiva: o motor está preso a tirar uma cartela por vez, ou já
//! aceita quedas maiores quando a otimização encontra uma? Isto registra o
//! tamanho de cada recorde e imprime a distribuição dos saltos.
//!
//!     cargo run --release --example saltos -- <segundos> [pool,jogo ...]

use std::collections::BTreeMap;
use std::time::Duration;

use motor_busca::{
    CondicoesDeParada, Configuracao, Controle, Evento, MotorBusca, Observador, PassoDaMeta,
};
use motor_core::{Cartela, MotorCobertura, Objetivo, Problema, RegraCobertura};

const SORTEIO: usize = 15;
const BANCO: &str = "web/lotinha.json";

struct Registro {
    tamanhos: Vec<usize>,
    metas: Vec<usize>,
}

impl Observador for Registro {
    fn ao_evento(&mut self, evento: &Evento) {
        match evento {
            Evento::NovoRecorde { avaliacao, .. } => self.tamanhos.push(avaliacao.cartelas),
            Evento::Progresso { alvo_cartelas, .. } => self.metas.push(*alvo_cartelas),
            _ => {}
        }
    }
}

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(60);
    let casos: Vec<(usize, usize)> = std::env::args()
        .skip(2)
        .filter_map(|a| {
            let (p, j) = a.split_once(',')?;
            Some((p.trim().parse().ok()?, j.trim().parse().ok()?))
        })
        .collect();
    let casos = if casos.is_empty() { vec![(22, 17), (23, 18), (25, 20)] } else { casos };
    let banco = ler_banco();

    println!("Saltos de recorde — {segundos}s por caso e por política\n");
    println!(
        "{:>7} {:>8} {:>8} {:>10} {:>10}",
        "caso", "partida", "piso", "unitário", "adaptativo"
    );
    println!("{}", "─".repeat(50));

    for (pool, jogo) in casos {
        let Some(partida) = banco.get(&format!("{pool},{jogo}")).cloned() else {
            println!("{pool},{jogo}: sem entrada no banco");
            continue;
        };
        let problema = problema_de(pool, jogo);
        let piso = motor_core::limite_inferior(&MotorCobertura::novo(&problema).unwrap()).valor;

        let mut resultados = Vec::new();
        let mut detalhes = Vec::new();
        for politica in [
            PassoDaMeta::Unitario,
            PassoDaMeta::Adaptativo {
                maximo: 64,
                iteracoes_para_dobrar: 20_000,
                iteracoes_para_recuar: 5_000,
            },
        ] {
            // Três sementes: um número só é sorteio, três já dizem alguma coisa.
            let mut soma = 0usize;
            let mut registro = Registro { tamanhos: Vec::new(), metas: Vec::new() };
            for semente in [7u64, 21, 99] {
                let (tamanho, r) =
                    rodar(&problema, &partida, Duration::from_secs(segundos), politica, semente);
                soma += tamanho;
                registro.tamanhos.extend(r.tamanhos);
            }
            let tamanho = soma / 3;
            resultados.push(tamanho);
            let mut saltos: BTreeMap<usize, usize> = BTreeMap::new();
            for par in registro.tamanhos.windows(2) {
                if par[0] > par[1] {
                    *saltos.entry(par[0] - par[1]).or_default() += 1;
                }
            }
            detalhes.push(format!(
                "{:?}: {} recordes, saltos {}",
                politica,
                registro.tamanhos.len(),
                if saltos.is_empty() {
                    "nenhum".to_string()
                } else {
                    saltos.iter().map(|(s, q)| format!("{s}x{q}")).collect::<Vec<_>>().join(" ")
                }
            ));
        }

        println!(
            "{:>7} {:>8} {piso:>8} {:>10} {:>10}",
            format!("{pool},{jogo}"),
            partida.len(),
            resultados[0],
            resultados[1]
        );
        for d in detalhes {
            println!("        {d}");
        }
    }
}

fn rodar(
    problema: &Problema,
    partida: &[Cartela],
    orcamento: Duration,
    passo_da_meta: PassoDaMeta,
    semente: u64,
) -> (usize, Registro) {
    let config = Configuracao {
        semente,
        intervalo_progresso: 0,
        passo_da_meta,
        ..Default::default()
    };
    let mut motor = MotorBusca::novo(problema.clone(), config).expect("problema válido");
    motor.semear(partida);
    let mut registro = Registro { tamanhos: Vec::new(), metas: Vec::new() };
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_duracao: Some(orcamento),
            parar_em_optimalidade: true,
            ..Default::default()
        },
        &mut registro,
    );
    (motor.melhor_cartelas().len(), registro)
}

fn problema_de(pool: usize, jogo: usize) -> Problema {
    Problema::com_pool_inicial(
        pool as u32,
        pool,
        jogo,
        RegraCobertura::cobrir_subconjuntos(SORTEIO),
        Objetivo::MinimizarCartelas,
    )
    .expect("configuração da Lotinha é válida")
}

fn ler_banco() -> BTreeMap<String, Vec<Cartela>> {
    let Ok(texto) = std::fs::read_to_string(BANCO) else {
        return BTreeMap::new();
    };
    let complementos = texto.contains("\"formato\":2");
    let mut saida = BTreeMap::new();
    for pedaco in texto.split('"').skip(1).collect::<Vec<_>>().chunks(2) {
        let [chave, resto] = pedaco else { continue };
        if !chave.contains(',') {
            continue;
        }
        let Some((pool_txt, _)) = chave.split_once(',') else { continue };
        let Ok(pool): Result<usize, _> = pool_txt.parse() else { continue };
        let Some(inicio) = resto.find('[') else { continue };
        let Some(fim) = resto.rfind(']') else { continue };
        let jogos: Vec<Cartela> = resto[inicio + 1..fim]
            .split('[')
            .skip(1)
            .filter_map(|linha| {
                let numeros: Vec<usize> = linha
                    .split(']')
                    .next()?
                    .split(',')
                    .filter_map(|n| n.trim().parse::<usize>().ok())
                    .map(|n| n - 1)
                    .collect();
                if complementos {
                    Some(Cartela::dos_indices(
                        &(0..pool).filter(|i| !numeros.contains(i)).collect::<Vec<_>>(),
                    ))
                } else {
                    (!numeros.is_empty()).then(|| Cartela::dos_indices(&numeros))
                }
            })
            .collect();
        if !jogos.is_empty() {
            saida.insert(chave.to_string(), jogos);
        }
    }
    saida
}
