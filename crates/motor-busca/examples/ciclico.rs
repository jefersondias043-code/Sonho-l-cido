//! Busca de fechamentos **invariantes sob rotação** — órbitas em vez de cartelas.
//!
//! ## A ideia, e por que ela muda a ordem de grandeza
//!
//! A busca de sempre escolhe cartelas uma a uma, entre `C(pool, jogo)` delas. Esta
//! escolhe **órbitas**: fixa o grupo cíclico `Z_pool` — girar as dezenas
//! `1 → 2 → … → pool → 1` — e cada cartela escolhida traz de graça todas as suas
//! rotações. Escolher fica `pool` vezes mais barato, e conferir também.
//!
//! Em `23/17`, que é o pior caso do banco:
//!
//! | | soltas | por órbita |
//! |---|---:|---:|
//! | candidatas a escolher | 100.947 | **4.389** |
//! | alvos a cobrir        | 490.314 | **21.318** |
//!
//! É outro problema, não o mesmo problema mais rápido.
//!
//! ## Onde ela trabalha
//!
//! No espaço dos **complementos**, que é onde a Lotinha fica pequena. Uma cartela
//! de `jogo` dezenas é o complemento de `a = pool − jogo` dezenas que faltam a
//! ela; um sorteio de 15 é o complemento de `b = pool − 15`. "A cartela contém o
//! sorteio" vira "as `a` que faltam à cartela estão entre as `b` que faltam ao
//! sorteio" — ou seja, `A ⊆ B`. Em `23/17` são conjuntos de 6 dentro de 8, em vez
//! de 17 dentro de 15 sobre 23.
//!
//! ## Onde ela paga, e onde não
//!
//! Medido. A simetria custa granularidade: uma órbita é indivisível, então o
//! fechamento só pode ter múltiplos do tamanho dela. Isso é barato quando há
//! muitas órbitas e caro quando há poucas.
//!
//! | pool, jogo | banco | cíclico | |
//! |---|---:|---:|---|
//! | 23, 17 | 10.122 | **10.051** | 437 órbitas — passo fino |
//! | 24, 19 |  1.506 |   1.560 | 65 órbitas — passo grosso demais |
//!
//! A regra que sai daí: vale nos fechamentos **grandes**, onde o número de
//! órbitas é alto e cada passo do ajuste é pequeno perto do total. Nos pequenos,
//! a busca por cartelas soltas ajusta melhor.
//!
//! Se o menor fechamento não tiver essa simetria, ela não o encontra — e não se
//! perde nada por isso: o banco continua sendo o incumbente e só é trocado
//! quando o cíclico vem menor. A técnica não é chute: é como boa parte da tabela
//! mundial que este projeto já embute para os limites foi construída.
//!
//!     cargo run --release --example ciclico -- <pool> <jogo> [segundos] [semente]

use std::collections::HashMap;
use std::time::{Duration, Instant};

use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

const SORTEIO: usize = 15;

/// A menor rotação de um conjunto — o nome pelo qual a órbita inteira atende.
///
/// Duas cartelas na mesma órbita precisam receber o mesmo nome, senão a busca
/// contaria a mesma escolha várias vezes. A menor das rotações serve, e é barata.
fn canonico(mascara: u32, v: u32) -> u32 {
    let mut menor = mascara;
    let mut atual = mascara;
    for _ in 1..v {
        atual = girar(atual, v);
        if atual < menor {
            menor = atual;
        }
    }
    menor
}

/// Gira o conjunto uma posição: `i → i + 1 (mod v)`.
fn girar(mascara: u32, v: u32) -> u32 {
    let cheia = (1u32 << v) - 1;
    ((mascara << 1) | (mascara >> (v - 1))) & cheia
}

/// Quantas cartelas distintas a órbita tem. Divide `v`, e só é menor que `v`
/// quando o conjunto se repete ao girar — o que acontece em pools compostos.
fn tamanho_da_orbita(mascara: u32, v: u32) -> u32 {
    let mut atual = mascara;
    for passo in 1..v {
        atual = girar(atual, v);
        if atual == mascara {
            return passo;
        }
    }
    v
}

/// Todos os subconjuntos de tamanho `k` de `{0..v}`, como máscaras.
fn subconjuntos(v: u32, k: u32) -> Vec<u32> {
    let mut saida = Vec::new();
    if k == 0 || k > v {
        return saida;
    }
    let cheia = if v >= 32 { u32::MAX } else { (1u32 << v) - 1 };
    let mut atual = (1u32 << k) - 1;
    while atual <= cheia {
        saida.push(atual);
        if atual == 0 {
            break;
        }
        // Próxima combinação com a mesma quantidade de bits.
        let menor = atual & atual.wrapping_neg();
        let ondulacao = atual.wrapping_add(menor);
        let uns = atual ^ ondulacao;
        let uns = (uns >> 2) / menor;
        atual = ondulacao | uns;
        if atual > cheia || atual == 0 {
            break;
        }
    }
    saida
}

/// Os representantes de órbita de tamanho `k`, e o tamanho de cada órbita.
fn orbitas(v: u32, k: u32) -> Vec<(u32, u32)> {
    let mut vistas: HashMap<u32, u32> = HashMap::new();
    for m in subconjuntos(v, k) {
        let c = canonico(m, v);
        vistas.entry(c).or_insert_with(|| tamanho_da_orbita(c, v));
    }
    let mut saida: Vec<(u32, u32)> = vistas.into_iter().collect();
    saida.sort_unstable();
    saida
}

fn main() {
    let mut args = std::env::args().skip(1);
    let pool: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(23);
    let jogo: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(17);

    assert!(jogo >= SORTEIO as u32 && jogo <= pool && pool <= 25, "configuração fora da Lotinha");
    let a = pool - jogo;
    let b = pool - SORTEIO as u32;

    println!("Busca cíclica em {pool}/{jogo} — complementos de {a} dentro de {b}\n");

    let relogio = std::time::Instant::now();
    let orb_a = orbitas(pool, a);
    let orb_b = orbitas(pool, b);
    println!(
        "  órbitas de cartela: {} (de {} cartelas)",
        orb_a.len(),
        subconjuntos(pool, a).len()
    );
    println!(
        "  órbitas de sorteio: {} (de {} sorteios)",
        orb_b.len(),
        subconjuntos(pool, b).len()
    );

    let indice_b: HashMap<u32, usize> =
        orb_b.iter().enumerate().map(|(i, &(m, _))| (m, i)).collect();
    let peso_b: Vec<u32> = orb_b.iter().map(|&(_, t)| t).collect();

    // Quais órbitas de sorteio cada órbita de cartela cobre.
    //
    // Só é preciso olhar a partir do representante: girar a cartela e girar o
    // sorteio junto dá a mesma órbita de sorteio, então as `v` rotações não
    // acrescentam nada. Sobram os `C(pool − a, b − a)` jeitos de completar o
    // conjunto — 136 em `23/17`.
    let fora_de = |m: u32| -> Vec<u32> { (0..pool).filter(|&i| m & (1 << i) == 0).collect() };
    let mut cobertura: Vec<Vec<u32>> = Vec::with_capacity(orb_a.len());
    for &(rep, _) in &orb_a {
        let livres = fora_de(rep);
        let mut alvos = Vec::new();
        combinar(&livres, (b - a) as usize, &mut |extra: &[u32]| {
            let mut m = rep;
            for &e in extra {
                m |= 1 << e;
            }
            alvos.push(indice_b[&canonico(m, pool)] as u32);
        });
        alvos.sort_unstable();
        alvos.dedup();
        cobertura.push(alvos);
    }
    // O índice invertido é o que torna a reparação barata. Para fechar um alvo
    // descoberto só interessam as órbitas que o cobrem — são no máximo `C(b, a)`
    // delas, 28 em `23/17`, contra as 4.389 candidatas de uma varredura cega.
    let mut inverso: Vec<Vec<u32>> = vec![Vec::new(); orb_b.len()];
    for (i, alvos) in cobertura.iter().enumerate() {
        for &t in alvos {
            inverso[t as usize].push(i as u32);
        }
    }
    let total_ligacoes: usize = cobertura.iter().map(|c| c.len()).sum();
    println!("  ligações: {total_ligacoes} | montagem em {:.1}s\n", relogio.elapsed().as_secs_f64());

    // ─── guloso, e depois um laço que destrói e repara ───
    //
    // O guloso sozinho chega perto e é instantâneo. O que faltava era poder
    // **buscar**: com 441 órbitas escolhidas entre 4.389, tirar um punhado e
    // remontar custa milissegundos, e cabem dezenas de milhares de tentativas no
    // tempo que a busca por cartelas soltas gasta numa só.
    let segundos: u64 = std::env::args()
        .nth(3)
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let semente: u64 = std::env::args().nth(4).and_then(|v| v.parse().ok()).unwrap_or(7);
    let mut rng = Pcg64Mcg::seed_from_u64(semente);

    let custo_de = |esc: &[usize]| -> u64 { esc.iter().map(|&i| orb_a[i].1 as u64).sum() };

    // A partida vem do guloso **amplo**, que a cada escolha olha todas as
    // candidatas: é lento — um segundo — e por isso não serve para as dezenas de
    // milhares de reparações do laço, mas é a melhor primeira solução, e começar
    // dezoito órbitas abaixo vale o segundo que custa.
    let mut melhor = guloso_amplo(&cobertura, &peso_b, &orb_a);
    podar(&cobertura, &orb_a, &mut melhor);
    let mut melhor_custo = custo_de(&melhor);
    println!(
        "  guloso: {} órbitas = {melhor_custo} cartelas ({:.1}s)",
        melhor.len(),
        relogio.elapsed().as_secs_f64()
    );

    // O passeio anda sobre a solução em curso, não sempre a partir da melhor.
    // Aceitar empate é o que permite atravessar o platô: num problema de
    // cobertura há muitas soluções do mesmo tamanho, e é andando entre elas que
    // se chega à borda de onde cabe uma a menos.
    let mut atual = melhor.clone();
    let mut custo_atual = melhor_custo;

    let prazo = Duration::from_secs(segundos);
    let inicio_da_busca = Instant::now();
    let mut tentativas: u64 = 0;
    let mut melhorias: u64 = 0;
    let mut empates: u64 = 0;
    while inicio_da_busca.elapsed() < prazo {
        tentativas += 1;
        let quantas = 1 + rng.gen_range(0..(atual.len() / 8).max(1));
        let mut semente_da_vez = atual.clone();
        for _ in 0..quantas {
            if semente_da_vez.is_empty() {
                break;
            }
            let fora = rng.gen_range(0..semente_da_vez.len());
            semente_da_vez.swap_remove(fora);
        }

        let mut refeita =
            guloso(&cobertura, &inverso, &peso_b, &orb_a, &semente_da_vez, &mut rng, 0.15);
        podar(&cobertura, &orb_a, &mut refeita);
        let custo = custo_de(&refeita);
        if custo <= custo_atual {
            if custo == custo_atual {
                empates += 1;
            }
            custo_atual = custo;
            atual = refeita;
            if custo_atual < melhor_custo {
                melhor_custo = custo_atual;
                melhor = atual.clone();
                melhorias += 1;
                println!(
                    "  {melhor_custo} cartelas em {} órbitas ({:.0}s, tentativa {tentativas})",
                    melhor.len(),
                    inicio_da_busca.elapsed().as_secs_f64()
                );
            }
        }
    }
    let sobrando = melhor;
    let cartelas_finais = melhor_custo;
    println!(
        "\n  {tentativas} tentativas, {melhorias} melhorias, {empates} passos no platô \
         — {} órbitas = {cartelas_finais} cartelas\n",
        sobrando.len()
    );

    // ─── a prova: conferir todos os sorteios, não só os representantes ───
    let mut familia: Vec<u32> = Vec::new();
    for &i in &sobrando {
        let mut m = orb_a[i].0;
        for _ in 0..orb_a[i].1 {
            familia.push(m);
            m = girar(m, pool);
        }
    }
    familia.sort_unstable();
    familia.dedup();
    assert_eq!(familia.len() as u64, cartelas_finais, "a expansão não bate com a conta");

    // Conferir cada sorteio contra cada cartela seria meio bilhão de comparações.
    // O caminho barato usa a estrutura: um sorteio está coberto quando **algum
    // subconjunto de `a` dele** é uma das cartelas escolhidas — são `C(b, a)`
    // consultas numa tabela, 28 em `23/17`, contra dez mil comparações.
    let escolhidas_em_tabela: std::collections::HashSet<u32> = familia.iter().copied().collect();
    let todos_os_sorteios = subconjuntos(pool, b);
    let descobertos = todos_os_sorteios
        .iter()
        .filter(|&&s| {
            let dentro: Vec<u32> = (0..pool).filter(|&i| s & (1 << i) != 0).collect();
            let mut coberto = false;
            combinar(&dentro, a as usize, &mut |sub: &[u32]| {
                if coberto {
                    return;
                }
                let m = sub.iter().fold(0u32, |acc, &e| acc | (1 << e));
                if escolhidas_em_tabela.contains(&m) {
                    coberto = true;
                }
            });
            !coberto
        })
        .count();
    println!(
        "  conferência exaustiva: {descobertos} sorteios descobertos de {}",
        todos_os_sorteios.len()
    );
    assert_eq!(descobertos, 0, "o fechamento cíclico não cobre tudo");

    // ─── o veredito, contra o banco ───
    let elementos: Vec<Vec<u32>> = familia
        .iter()
        .map(|&falta| (0..pool).filter(|i| falta & (1 << i) == 0).map(|i| i + 1).collect())
        .collect();
    let caminho = format!("/tmp/ciclico-{pool}-{jogo}.json");
    std::fs::write(&caminho, format!("{elementos:?}").replace(' ', "")).ok();
    println!("\n  {cartelas_finais} cartelas — escrito em {caminho}");
}

/// Todas as combinações de `k` elementos de `itens`, entregues uma a uma.
fn combinar(itens: &[u32], k: usize, acao: &mut impl FnMut(&[u32])) {
    let mut atual = Vec::with_capacity(k);
    fn passo(itens: &[u32], k: usize, inicio: usize, atual: &mut Vec<u32>, acao: &mut impl FnMut(&[u32])) {
        if atual.len() == k {
            acao(atual);
            return;
        }
        for i in inicio..itens.len() {
            atual.push(itens[i]);
            passo(itens, k, i + 1, atual, acao);
            atual.pop();
        }
    }
    passo(itens, k, 0, &mut atual, acao);
}

/// Completa a cobertura escolhendo órbitas, sempre a de melhor ganho por cartela.
///
/// `ja_escolhidas` entra como parte pronta — é o que permite reparar uma solução
/// da qual se tirou um punhado, em vez de recomeçar do zero. `ruido` desvia a
/// escolha de vez em quando: sem ele, reparar o mesmo buraco devolve sempre a
/// mesma peça e o laço não anda.
fn guloso(
    cobertura: &[Vec<u32>],
    inverso: &[Vec<u32>],
    peso_b: &[u32],
    orb_a: &[(u32, u32)],
    ja_escolhidas: &[usize],
    rng: &mut Pcg64Mcg,
    ruido: f64,
) -> Vec<usize> {
    let mut coberto = vec![false; peso_b.len()];
    let mut dentro = vec![false; orb_a.len()];
    let mut escolhidas: Vec<usize> = Vec::with_capacity(ja_escolhidas.len() + 64);

    let marcar = |i: usize,
                      coberto: &mut Vec<bool>,
                      dentro: &mut Vec<bool>,
                      escolhidas: &mut Vec<usize>| {
        if dentro[i] {
            return;
        }
        dentro[i] = true;
        escolhidas.push(i);
        for &t in &cobertura[i] {
            coberto[t as usize] = true;
        }
    };
    for &i in ja_escolhidas {
        marcar(i, &mut coberto, &mut dentro, &mut escolhidas);
    }

    // A lista dos que faltam, percorrida uma vez. Um alvo que já foi coberto por
    // outra escolha é pulado quando a vez dele chega.
    let mut descobertos: Vec<u32> =
        (0..peso_b.len() as u32).filter(|&t| !coberto[t as usize]).collect();
    // Embaralhar é o que dá caminhos diferentes à mesma reparação; sem isso o
    // laço de destruir-reparar devolve sempre a mesma peça no mesmo buraco.
    for i in (1..descobertos.len()).rev() {
        descobertos.swap(i, rng.gen_range(0..=i));
    }

    for &alvo in &descobertos {
        if coberto[alvo as usize] {
            continue;
        }
        // Só quem cobre este alvo pode fechá-lo: são no máximo `C(b, a)` órbitas.
        let mut melhor: Option<(usize, u64, u64)> = None;
        for &cand in &inverso[alvo as usize] {
            let i = cand as usize;
            if dentro[i] {
                continue;
            }
            let ganho: u64 = cobertura[i]
                .iter()
                .filter(|&&t| !coberto[t as usize])
                .map(|&t| peso_b[t as usize] as u64)
                .sum();
            if ganho == 0 {
                continue;
            }
            let custo = orb_a[i].1 as u64;
            let vence = match melhor {
                Some((_, g, c)) => ganho * c > g * custo,
                None => true,
            };
            if vence || (ruido > 0.0 && rng.gen_bool(ruido)) {
                melhor = Some((i, ganho, custo));
            }
        }
        if let Some((i, _, _)) = melhor {
            marcar(i, &mut coberto, &mut dentro, &mut escolhidas);
        }
    }
    escolhidas
}

/// Tira as órbitas cujos alvos já estão cobertos por outras.
///
/// Da mais cara para a mais barata: sair com a maior primeiro rende mais
/// cartelas, e uma órbita de 23 vale 23 vezes uma decisão errada aqui.
fn podar(cobertura: &[Vec<u32>], orb_a: &[(u32, u32)], escolhidas: &mut Vec<usize>) {
    let maior_alvo = cobertura.iter().flatten().copied().max().unwrap_or(0) as usize;
    let mut vezes = vec![0u32; maior_alvo + 1];
    for &i in escolhidas.iter() {
        for &t in &cobertura[i] {
            vezes[t as usize] += 1;
        }
    }
    let mut ordem = escolhidas.clone();
    ordem.sort_unstable_by_key(|&i| std::cmp::Reverse(orb_a[i].1));
    let mut sobrando = Vec::with_capacity(escolhidas.len());
    for i in ordem {
        if cobertura[i].iter().all(|&t| vezes[t as usize] > 1) {
            for &t in &cobertura[i] {
                vezes[t as usize] -= 1;
            }
        } else {
            sobrando.push(i);
        }
    }
    *escolhidas = sobrando;
}

/// O guloso que olha todas as candidatas a cada escolha.
///
/// Custa uma varredura completa por órbita escolhida — em `23/17` é um segundo
/// inteiro, contra menos de um milissegundo do guloso por alvo. Serve para a
/// primeira solução e só: medido, ele parte de 441 órbitas onde o rápido parte
/// de 459, e as dezoito de diferença são um bom adiantamento para o laço.
fn guloso_amplo(cobertura: &[Vec<u32>], peso_b: &[u32], orb_a: &[(u32, u32)]) -> Vec<usize> {
    let mut coberto = vec![false; peso_b.len()];
    let mut faltam = peso_b.len();
    let mut dentro = vec![false; orb_a.len()];
    let mut escolhidas: Vec<usize> = Vec::new();

    while faltam > 0 {
        let mut melhor: Option<(usize, u64, u64)> = None;
        for (i, alvos) in cobertura.iter().enumerate() {
            if dentro[i] {
                continue;
            }
            let ganho: u64 = alvos
                .iter()
                .filter(|&&t| !coberto[t as usize])
                .map(|&t| peso_b[t as usize] as u64)
                .sum();
            if ganho == 0 {
                continue;
            }
            let custo = orb_a[i].1 as u64;
            let vence = match melhor {
                Some((_, g, c)) => ganho * c > g * custo,
                None => true,
            };
            if vence {
                melhor = Some((i, ganho, custo));
            }
        }
        let Some((i, _, _)) = melhor else { break };
        dentro[i] = true;
        escolhidas.push(i);
        for &t in &cobertura[i] {
            if !coberto[t as usize] {
                coberto[t as usize] = true;
                faltam -= 1;
            }
        }
    }
    escolhidas
}
