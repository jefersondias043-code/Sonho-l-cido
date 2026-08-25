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

    println!("Saltos de recorde — {segundos}s por caso, política e semente\n");
    println!(
        "{:>7} {:>8} {:>8}   {:>28}   {:>28}",
        "caso", "partida", "piso", "passo de uma", "passo adaptativo"
    );
    println!("{}", "─".repeat(90));

    const SEMENTES: [u64; 6] = [7, 21, 99, 123, 404, 777];

    let mut vitorias = [0usize; 3]; // unitário, calibrado, empate
    for (pool, jogo) in casos {
        let Some(partida) = banco.get(&format!("{pool},{jogo}")).cloned() else {
            println!("{pool},{jogo}: sem entrada no banco");
            continue;
        };
        let problema = problema_de(pool, jogo);
        let piso = motor_core::limite_inferior(&MotorCobertura::novo(&problema).unwrap()).valor;

        let politicas = [
            PassoDaMeta::Unitario,
            PassoDaMeta::Adaptativo {
                maximo: 64,
                iteracoes_para_dobrar: 20_000,
                iteracoes_para_recuar: 5_000,
            },
        ];
        let mut por_politica: Vec<Vec<usize>> = Vec::new();
        let mut saltos_por_politica: Vec<BTreeMap<usize, usize>> = Vec::new();
        for politica in politicas {
            let mut tamanhos = Vec::new();
            let mut saltos: BTreeMap<usize, usize> = BTreeMap::new();
            for semente in SEMENTES {
                let (tamanho, r) =
                    rodar(&problema, &partida, Duration::from_secs(segundos), politica, semente);
                tamanhos.push(tamanho);
                for par in r.tamanhos.windows(2) {
                    if par[0] > par[1] {
                        *saltos.entry(par[0] - par[1]).or_default() += 1;
                    }
                }
            }
            por_politica.push(tamanhos);
            saltos_por_politica.push(saltos);
        }

        let resumo = |v: &Vec<usize>| {
            let mut o = v.clone();
            o.sort_unstable();
            // O mínimo é a estatística que importa numa execução longa: o motor
            // guarda o melhor de sempre, então uma sorte grande não se perde e
            // um azar não fica.
            format!("melhor {} med {} pior {}", o[0], o[o.len() / 2], o[o.len() - 1])
        };
        // Vitória por semente: comparar par a par é o que tira a sorte do meio.
        let mut ganhos = [0usize; 3];
        for (&a, &b) in por_politica[0].iter().zip(&por_politica[1]) {
            if a < b {
                ganhos[0] += 1;
            } else if b < a {
                ganhos[1] += 1;
            } else {
                ganhos[2] += 1;
            }
        }
        for i in 0..3 {
            vitorias[i] += ganhos[i];
        }

        println!(
            "{:>7} {:>8} {piso:>8}   {:>28}   {:>28}",
            format!("{pool},{jogo}"),
            partida.len(),
            resumo(&por_politica[0]),
            resumo(&por_politica[1])
        );
        println!(
            "        por semente: uma {:?} | adaptativo {:?} | placar {}x{} ({} empates)",
            por_politica[0], por_politica[1], ganhos[0], ganhos[1], ganhos[2]
        );
        for (nome, saltos) in ["uma", "adaptativo"].iter().zip(&saltos_por_politica) {
            let txt = if saltos.is_empty() {
                "nenhum".to_string()
            } else {
                saltos.iter().map(|(s, q)| format!("{s}x{q}")).collect::<Vec<_>>().join(" ")
            };
            println!("        saltos {nome}: {txt}");
        }
    }
    println!(
        "\nPlacar geral por semente: passo de uma {} × {} passo calibrado ({} empates)",
        vitorias[0], vitorias[1], vitorias[2]
    );
}

fn rodar(
    problema: &Problema,
    partida: &[Cartela],
    orcamento: Duration,
    passo_da_meta: PassoDaMeta,
    semente: u64,
) -> (usize, Registro) {
    let config =
        Configuracao { semente, intervalo_progresso: 0, passo_da_meta, ..Default::default() };
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
