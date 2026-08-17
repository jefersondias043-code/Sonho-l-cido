//! Gera o banco de fechamentos da Lotinha.
//!
//! A modalidade: escolhem-se de 17 a 23 dezenas entre 25, o resultado da
//! Lotofácil é a referência, e ganha-se quando as 15 sorteadas caem **todas**
//! dentro do conjunto escolhido. São 28 combinações de `(pool, tamanho do jogo)`
//! com `17 ≤ jogo ≤ pool ≤ 23`.
//!
//! ## A transformação que resolve quase tudo
//!
//! Um jogo de `k` dezenas num pool de `P` é o **complemento** de `a = P − k`
//! dezenas; um sorteio de 15 é o complemento de `b = P − 15`. E
//!
//! > o jogo contém o sorteio ⟺ as `a` que faltam ao jogo estão entre as `b` que
//! > faltam ao sorteio.
//!
//! Ou seja: em vez de escolher jogos que **contenham** sorteios, escolhemos
//! `a`-subconjuntos que **caibam** em todo `b`-subconjunto. Isso é um sistema de
//! Turán, e muda a aritmética por completo — a cota de contagem, que vem de
//! dividir um número de combinações pelo outro, erra por duas a três vezes.
//!
//! ## O que sai de fórmula e o que exige busca
//!
//! - **`a = 0`** (jogo = pool): um jogo só. Sete casos.
//! - **`a = 1`**: bastam 16 jogos, sempre, qualquer que seja o pool. Prova no
//!   corpo de [`complementos_de_um`].
//! - **`a = 2`**: teorema de Turán, valor exato. Onze casos com `a ≤ 2`.
//! - **`a ≥ 3`**: **problema em aberto na matemática.** Dez casos. A construção
//!   por grupos dá um ponto de partida — entre 2× e 56× acima do piso conhecido
//!   — e o motor persistente trabalha a partir dele.
//!
//! Toda solução gerada é conferida por enumeração exaustiva antes de ser
//! gravada: percorre-se cada um dos `C(P,15)` sorteios possíveis e confirma-se
//! que algum jogo o contém. Um fechamento furado gravado aqui viraria uma
//! promessa falsa na tela do usuário.
//!
//! ```bash
//! cargo run --release --example gerar-lotinha -- [segundos-por-caso]
//! ```

use std::collections::BTreeMap;
use std::time::Duration;

use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca, Silencioso};
use motor_core::{Cartela, Objetivo, Problema, RegraCobertura};

const SORTEIO: usize = 15;
const DESTINO: &str = "web/lotinha.json";

fn main() {
    let segundos: u64 = std::env::args()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);

    println!("Banco de fechamentos da Lotinha ({segundos}s por caso em aberto)\n");
    println!(
        "{:>5} {:>5} {:>7} {:>9} {:>10} {:>12} {:>9}",
        "pool", "jogo", "piso", "partida", "final", "origem", "confere"
    );
    println!("{}", "─".repeat(64));

    let mut banco: BTreeMap<String, Vec<Vec<usize>>> = BTreeMap::new();

    for pool in 17..=23usize {
        for jogo in 17..=pool {
            let a = pool - jogo;
            let piso = piso_por_contagem(pool, jogo);

            let (inicial, origem) = construir(pool, jogo);
            let partida = inicial.len();

            let final_ = if a >= 3 {
                melhorar(pool, jogo, &inicial, Duration::from_secs(segundos))
            } else {
                inicial
            };

            // A conferência não é formalidade: é a única coisa que separa um
            // fechamento de uma lista de números com cara de fechamento.
            let ok = cobre_tudo(pool, jogo, &final_);
            assert!(
                ok,
                "pool {pool}, jogo {jogo}: a solução não cobre todos os sorteios"
            );
            assert!(
                final_.len() >= piso,
                "pool {pool}, jogo {jogo}: {} jogos fica abaixo do piso {piso} — \
                 isso é erro, não recorde",
                final_.len()
            );

            println!(
                "{pool:>5} {jogo:>5} {piso:>7} {partida:>9} {:>10} {origem:>12} {:>9}",
                final_.len(),
                if ok { "sim" } else { "NÃO" },
            );

            banco.insert(
                format!("{pool},{jogo}"),
                final_.iter().map(|c| c.indices().iter().map(|i| i + 1).collect()).collect(),
            );
        }
    }

    // JSON escrito à mão: é um objeto de listas de listas, e acrescentar uma
    // dependência de serialização a um exemplo custaria mais que as dez linhas.
    let mut json = String::from("{");
    for (i, (chave, jogos)) in banco.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!("\"{chave}\":["));
        for (j, jogo) in jogos.iter().enumerate() {
            if j > 0 {
                json.push(',');
            }
            json.push('[');
            for (n, dezena) in jogo.iter().enumerate() {
                if n > 0 {
                    json.push(',');
                }
                json.push_str(&dezena.to_string());
            }
            json.push(']');
        }
        json.push(']');
    }
    json.push('}');

    std::fs::write(DESTINO, &json).expect("gravar o banco");
    println!("\nescrito {DESTINO} — {:.1} KiB", json.len() as f64 / 1024.0);
}

/// Piso por contagem: cada jogo cobre `C(k,15)` dos `C(P,15)` sorteios.
///
/// É um piso válido e frouxo. Serve como travessa de segurança — nada gerado
/// aqui pode ficar abaixo dele — e como referência do quanto ainda há a ganhar.
fn piso_por_contagem(pool: usize, jogo: usize) -> usize {
    binomial(pool, SORTEIO).div_ceil(binomial(jogo, SORTEIO)) as usize
}

fn binomial(n: usize, k: usize) -> u64 {
    if k > n {
        return 0;
    }
    let mut r: u64 = 1;
    for i in 0..k.min(n - k) {
        r = r * (n - i) as u64 / (i as u64 + 1);
    }
    r
}

/// O ponto de partida, pela melhor construção fechada que existe para o caso.
fn construir(pool: usize, jogo: usize) -> (Vec<Cartela>, &'static str) {
    let a = pool - jogo;
    let b = pool - SORTEIO;

    match a {
        0 => (vec![Cartela::dos_indices(&(0..pool).collect::<Vec<_>>())], "único"),
        1 => (complementos_de_um(pool), "exato"),
        _ => (por_grupos(pool, a, b), if a == 2 { "exato" } else { "grupos" }),
    }
}

/// `a = 1`: dezesseis jogos bastam, e não menos.
///
/// Cada jogo é o pool menos uma dezena. O jogo contém o sorteio quando a dezena
/// que falta ao jogo está entre as `b = P − 15` que faltam ao sorteio. Se
/// escolhermos 16 dezenas para remover, sobram `P − 16` fora dessa escolha — e
/// como o sorteio deixa `b = P − 15` de fora, ao menos uma delas está entre as
/// 16 escolhidas. Sempre. Independe do tamanho do pool, o que surpreende à
/// primeira vista e é o que torna esta família barata.
fn complementos_de_um(pool: usize) -> Vec<Cartela> {
    (0..16)
        .map(|removida| {
            Cartela::dos_indices(&(0..pool).filter(|&i| i != removida).collect::<Vec<_>>())
        })
        .collect()
}

/// Construção por grupos, que cobre `a = 2` de forma exata e `a ≥ 3` de forma
/// apenas razoável.
///
/// Divide o pool em `g` grupos e toma todos os `a`-subconjuntos dentro de cada
/// grupo. Um sorteio deixa `b` dezenas de fora; se `g·(a−1) < b`, algum grupo
/// recebe `a` dessas dezenas pelo princípio da casa dos pombos, e o jogo
/// correspondente contém o sorteio.
///
/// Para `a = 2` isto é o extremo do teorema de Turán — não existe melhor. Para
/// `a ≥ 3` fica folgado, e é justamente aí que o motor tem trabalho.
fn por_grupos(pool: usize, a: usize, b: usize) -> Vec<Cartela> {
    let g = if a > 1 { (b - 1) / (a - 1) } else { pool };
    let g = g.max(1);

    let mut grupos: Vec<Vec<usize>> = vec![Vec::new(); g];
    for i in 0..pool {
        grupos[i % g].push(i);
    }

    let mut jogos = Vec::new();
    for grupo in &grupos {
        for fora in combinacoes(grupo, a) {
            let dentro: Vec<usize> = (0..pool).filter(|i| !fora.contains(i)).collect();
            jogos.push(Cartela::dos_indices(&dentro));
        }
    }
    jogos
}

fn combinacoes(itens: &[usize], k: usize) -> Vec<Vec<usize>> {
    let mut saida = Vec::new();
    let mut atual = Vec::with_capacity(k);
    fn passo(itens: &[usize], k: usize, i: usize, atual: &mut Vec<usize>, saida: &mut Vec<Vec<usize>>) {
        if atual.len() == k {
            saida.push(atual.clone());
            return;
        }
        for j in i..itens.len() {
            atual.push(itens[j]);
            passo(itens, k, j + 1, atual, saida);
            atual.pop();
        }
    }
    passo(itens, k, 0, &mut atual, &mut saida);
    saida
}

/// Põe o motor persistente para trabalhar a partir da construção.
fn melhorar(pool: usize, jogo: usize, inicial: &[Cartela], orcamento: Duration) -> Vec<Cartela> {
    let problema = Problema::com_pool_inicial(
        pool as u32,
        pool,
        jogo,
        RegraCobertura::cobrir_subconjuntos(SORTEIO),
        Objetivo::MinimizarCartelas,
    )
    .expect("configuração da Lotinha é válida");

    let config = Configuracao { semente: 20260818, intervalo_progresso: 0, ..Default::default() };
    let Ok(mut motor) = MotorBusca::novo(problema, config) else {
        return inicial.to_vec();
    };

    motor.semear(inicial);
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada { max_duracao: Some(orcamento), parar_em_optimalidade: true, ..Default::default() },
        &mut Silencioso,
    );

    let achado = motor.melhor_cartelas().to_vec();
    if achado.is_empty() || achado.len() > inicial.len() {
        inicial.to_vec()
    } else {
        achado
    }
}

/// Confere, por enumeração exaustiva, que todo sorteio possível dentro do pool
/// está contido em algum jogo.
///
/// Usa máscaras de bits: `pool ≤ 23` cabe folgado num `u32`, e "o jogo contém o
/// sorteio" vira uma única operação. São até 490.314 sorteios (pool 23), o que
/// torna a conferência completa barata o bastante para rodar sempre.
fn cobre_tudo(pool: usize, _jogo: usize, jogos: &[Cartela]) -> bool {
    let mascaras: Vec<u32> = jogos
        .iter()
        .map(|c| c.indices().iter().fold(0u32, |m, &i| m | (1 << i)))
        .collect();

    let mut sorteio: Vec<usize> = (0..SORTEIO).collect();

    loop {
        let mascara = sorteio.iter().fold(0u32, |m, &i| m | (1 << i));
        if !mascaras.iter().any(|&j| j & mascara == mascara) {
            return false;
        }

        // Próxima combinação em ordem lexicográfica.
        let mut i = SORTEIO;
        loop {
            if i == 0 {
                return true;
            }
            i -= 1;
            if sorteio[i] != i + pool - SORTEIO {
                break;
            }
        }
        sorteio[i] += 1;
        for j in (i + 1)..SORTEIO {
            sorteio[j] = sorteio[j - 1] + 1;
        }
    }
}
