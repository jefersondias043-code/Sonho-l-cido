//! Bancada de comparação entre estratégias de redução.
//!
//! Roda duas buscas a partir **do mesmo fechamento de partida** e pelo mesmo
//! tempo, e imprime até onde cada uma chegou. Sem isso, "o motor melhorou" é
//! opinião.
//!
//!     cargo run --release --example bancada -- <segundos> [pool,jogo ...]

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca, Oficina, Silencioso};
use motor_core::combinatoria::subconjunto_do_indice;
use motor_core::{Cartela, MotorCobertura, Objetivo, Problema, RegraCobertura, Solucao};
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

const SORTEIO: usize = 15;
const BANCO: &str = "web/lotinha.json";

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(60);
    let casos: Vec<(usize, usize)> = std::env::args()
        .skip(2)
        .filter_map(|a| {
            let (p, j) = a.split_once(',')?;
            Some((p.trim().parse().ok()?, j.trim().parse().ok()?))
        })
        .collect();
    let casos = if casos.is_empty() {
        vec![(22, 17), (23, 18), (24, 20), (25, 19), (25, 20), (25, 22)]
    } else {
        casos
    };

    let banco = ler_banco();
    let orcamento = Duration::from_secs(segundos);

    println!("Bancada — {segundos}s por estratégia, mesma partida\n");
    println!(
        "{:>5} {:>5} {:>8} {:>9} {:>10} {:>10} {:>10} {:>8}",
        "pool", "jogo", "piso", "partida", "atual", "troca", "guloso", "ganho"
    );
    println!("{}", "─".repeat(76));

    for (pool, jogo) in casos {
        let Some(partida) = banco.get(&format!("{pool},{jogo}")).cloned() else {
            println!("{pool:>5} {jogo:>5}   sem entrada no banco");
            continue;
        };
        let problema = problema_de(pool, jogo);
        let piso = motor_core::limite_inferior(&MotorCobertura::novo(&problema).unwrap()).valor;

        // `BANCADA_SO=guloso` mede só a estratégia nova, para não gastar o
        // relógio nas duas que já se sabe como se comportam.
        let so_guloso = std::env::var("BANCADA_SO").as_deref() == Ok("guloso");
        let atual = if so_guloso { 0 } else { com_o_motor_de_hoje(&problema, &partida, orcamento) };
        let troca = if so_guloso { 0 } else { com_troca_de_ponto(&problema, &partida, orcamento) };
        let relogio = Instant::now();
        let guloso = com_guloso_global(&problema, orcamento);
        let gasto = relogio.elapsed();

        let ganho = if troca < atual {
            format!("-{}", atual - troca)
        } else if troca > atual {
            format!("+{}", troca - atual)
        } else {
            "=".to_string()
        };
        let guloso_txt = guloso.map_or("—".to_string(), |g| g.to_string());
        println!(
            "{pool:>5} {jogo:>5} {piso:>8} {:>9} {atual:>10} {troca:>10} {guloso_txt:>10} {ganho:>8}  {:.0}s",
            partida.len(),
            gasto.as_secs_f64(),
        );
    }
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

/// A estratégia de hoje: destruir, reconstruir, podar.
fn com_o_motor_de_hoje(problema: &Problema, partida: &[Cartela], orcamento: Duration) -> usize {
    let config = Configuracao { semente: 7, intervalo_progresso: 0, ..Default::default() };
    let Ok(mut motor) = MotorBusca::novo(problema.clone(), config) else {
        return usize::MAX;
    };
    motor.semear(partida);
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_duracao: Some(orcamento),
            parar_em_optimalidade: true,
            ..Default::default()
        },
        &mut Silencioso,
    );
    motor.melhor_cartelas().len()
}

/// A alternativa: tamanho fixo, e o que se minimiza é o que falta cobrir.
///
/// ## Por que trocar o que se minimiza
///
/// A busca de hoje anda pelo espaço das soluções **completas**: toda iteração
/// termina numa cobertura fechada, e reduzir significa remover uma cartela e
/// conseguir recobrir tudo com as que sobraram. Isso é caro — cada
/// reconstrução monta cartelas gulosamente, e montar uma cartela de 20 dezenas
/// custa avaliar `C(20,15) = 15.504` alvos **por candidato testado** — e é
/// raro dar certo.
///
/// Esta anda por soluções **incompletas**. Tira-se um punhado de cartelas e o
/// custo passa a ser quantos sorteios ficaram de fora; o movimento é mínimo,
/// uma cartela troca uma dezena por outra. Quando o custo volta a zero, aquele
/// tamanho bastou — e tira-se mais.
///
/// É o método de Nurmela e Östergård para covering designs. O que o faz andar
/// é o tamanho do passo: uma troca mexe em duas cartelas, não em dezenas de
/// candidatos montados do zero.
fn com_troca_de_ponto(problema: &Problema, partida: &[Cartela], orcamento: Duration) -> usize {
    let motor = MotorCobertura::novo(problema).expect("motor de cobertura");
    let mut rng = Pcg64Mcg::seed_from_u64(7);
    let comeco = Instant::now();
    let mut oficina = Oficina::nova();

    let mut solucao = Solucao::vazia(&motor);
    for &c in partida {
        solucao.adicionar(&motor, c, &mut oficina.rascunho);
    }
    let mut melhor: Vec<Cartela> = partida.to_vec();

    // Quantas cartelas tirar por rodada. Começa proporcional ao tamanho — num
    // fechamento de trinta mil, tirar de uma em uma levaria dias só de
    // contabilidade — e se ajusta pelo resultado: fechou, tira mais da próxima
    // vez; não fechou, tira menos.
    let mut lote = 1usize;
    let mut rodadas = 0u64;
    let mut fechadas = 0u64;

    while comeco.elapsed() < orcamento && melhor.len() > 1 {
        rodadas += 1;
        let quantas = lote.min(solucao.quantidade().saturating_sub(1)).max(1);
        for _ in 0..quantas {
            let i = rng.gen_range(0..solucao.quantidade());
            solucao.remover(&motor, i, &mut oficina.rascunho);
        }

        let sobra = orcamento.saturating_sub(comeco.elapsed());
        let fatia = sobra.min(Duration::from_millis(2_000));
        if recozer(&motor, &mut solucao, fatia, &mut rng, &mut oficina) {
            fechadas += 1;
            melhor.clear();
            melhor.extend_from_slice(solucao.cartelas());
            lote = (lote * 2).min(melhor.len() / 8 + 1);
        } else {
            solucao.restaurar_de(
                &motor,
                &melhor,
                &mut oficina.restaurador,
                &mut oficina.rascunho,
            );
            lote /= 2;
            if lote == 0 {
                lote = 1;
            }
        }
    }

    if std::env::var("BANCADA_DETALHE").is_ok() {
        let trocas = TROCAS.swap(0, std::sync::atomic::Ordering::Relaxed);
        eprintln!(
            "    {rodadas} rodadas, {fechadas} fecharam, {trocas} trocas em {:.1}s ({:.0} trocas/s)",
            comeco.elapsed().as_secs_f64(),
            trocas as f64 / comeco.elapsed().as_secs_f64().max(1e-9),
        );
    }
    melhor.len()
}

/// Recozimento por troca de ponto até fechar a cobertura, ou até o tempo acabar.
///
/// Devolve `true` quando fechou. A aceitação é tardia: guarda os últimos `L`
/// custos e aceita o que não for pior que o de `L` passos atrás. Um parâmetro
/// só, e nenhuma temperatura para calibrar por instância.
fn recozer(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    orcamento: Duration,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> bool {
    const HISTORIA: usize = 512;
    const TORNEIO: usize = 16;

    let comeco = Instant::now();
    let mut custo = solucao.total_descobertos();
    let mut historia = vec![custo; HISTORIA];
    let mut passo = 0usize;
    let mut trocas = 0u64;
    let mut dentro: Vec<usize> = Vec::new();
    let mut alvo: Vec<usize> = Vec::new();
    let mut faltam: Vec<usize> = Vec::new();

    while custo > 0 {
        if passo % 128 == 0 && comeco.elapsed() >= orcamento {
            TROCAS.fetch_add(trocas, std::sync::atomic::Ordering::Relaxed);
            return false;
        }
        passo += 1;
        trocas += 1;

        // Um sorteio ainda descoberto guia o movimento: sem guia, quase toda
        // troca é indiferente quando falta pouco.
        let descobertos = solucao.descobertos();
        let Some(sorteado) = descobertos.em(rng.gen_range(0..descobertos.len())) else {
            return false;
        };
        subconjunto_do_indice(motor.binomiais(), sorteado as u64, motor.alvo(), &mut alvo);
        let mascara_do_alvo = Cartela::dos_indices(&alvo);

        // Torneio: com dezenas de milhares de cartelas, uma sorteada ao acaso
        // quase nunca tem o que ver com o sorteio descoberto, e a troca vira
        // ruído. Amostrar algumas e ficar com a que mais já acerta o sorteio
        // custa uns poucos testes de bit e transforma o movimento em progresso.
        let mut indice = rng.gen_range(0..solucao.quantidade());
        let mut melhor_acertos = usize::MIN;
        for _ in 0..TORNEIO {
            let i = rng.gen_range(0..solucao.quantidade());
            let acertos = solucao.cartelas()[i].tamanho_intersecao(mascara_do_alvo);
            if acertos > melhor_acertos {
                melhor_acertos = acertos;
                indice = i;
            }
        }

        let cartela = solucao.cartelas()[indice];

        // Testar pertinência por bit em vez de varrer o vetor do sorteio: com
        // 17 dezenas na cartela e 15 no sorteio, `Vec::contains` fazia 255
        // comparações por troca — mais caro que atualizar a cobertura inteira.
        faltam.clear();
        faltam.extend(alvo.iter().copied().filter(|&e| !cartela.contem(e)));
        if faltam.is_empty() {
            continue;
        }
        let entra = faltam[rng.gen_range(0..faltam.len())];

        cartela.indices_em(&mut dentro);
        dentro.retain(|&e| !mascara_do_alvo.contem(e));
        if dentro.is_empty() {
            continue;
        }
        let sai = dentro[rng.gen_range(0..dentro.len())];

        let mut nova = cartela;
        nova.remover(sai);
        nova.inserir(entra);

        solucao.remover(motor, indice, &mut oficina.rascunho);
        solucao.adicionar(motor, nova, &mut oficina.rascunho);
        let depois = solucao.total_descobertos();

        if depois <= custo || depois <= historia[passo % HISTORIA] {
            custo = depois;
        } else {
            let ultimo = solucao.quantidade() - 1;
            solucao.remover(motor, ultimo, &mut oficina.rascunho);
            solucao.adicionar(motor, cartela, &mut oficina.rascunho);
        }
        historia[passo % HISTORIA] = custo;
    }
    TROCAS.fetch_add(trocas, std::sync::atomic::Ordering::Relaxed);
    true
}

/// Trocas tentadas em toda a execução, para medir a vazão do laço quente.
static TROCAS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Guloso global — a implementação de verdade, em `construcao::construir_guloso_global`.
fn com_guloso_global(problema: &Problema, orcamento: Duration) -> Option<usize> {
    let motor = MotorCobertura::novo(problema).expect("motor de cobertura");
    let mut oficina = Oficina::nova();
    // Melhor de algumas sementes: o guloso é determinístico dada a semente, e
    // trocar o desempate muda o caminho inteiro. Cinco tentativas cabem no
    // mesmo orçamento nos casos rápidos e o relógio corta nos lentos.
    let mut melhor: Option<usize> = None;
    let comeco = Instant::now();
    for semente in 0..5u64 {
        let sobra = orcamento.saturating_sub(comeco.elapsed());
        if sobra.is_zero() {
            break;
        }
        let mut solucao = Solucao::vazia(&motor);
        if motor_busca::construcao::construir_guloso_global(
            &motor,
            &mut solucao,
            sobra,
            semente,
            &mut oficina,
            None,
        ) {
            melhor = Some(melhor.map_or(solucao.quantidade(), |m: usize| m.min(solucao.quantidade())));
        }
    }
    melhor
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
