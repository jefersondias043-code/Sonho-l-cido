//! Confere o catálogo inteiro, sorteio a sorteio, sem acreditar em nada.
//!
//! Este binário existe para **discordar** do gerador. Ele não usa `motor-core`,
//! não usa `motor-busca`, não usa nenhuma biblioteca externa: lê o JSON com um
//! varredor próprio, decodifica os bilhetes por conta própria, enumera os
//! sorteios com um algoritmo diferente e recalcula os limites com sua própria
//! aritmética. Se um erro de cobertura existisse nos dois lados, ele passaria
//! nos dois — e a conferência viraria o gerador afirmando que o gerador está
//! certo.
//!
//! O que ele cobra de cada entrada publicada:
//!
//! 1. **cobertura** — para **todo** sorteio de 15 dezenas dentro do pool existe
//!    um bilhete com ao menos `t` dezenas em comum;
//! 2. **forma** — cada bilhete tem exatamente `k` dezenas, todas dentro do pool,
//!    e não há bilhete repetido;
//! 3. **contagem** — o número de bilhetes é o que o índice promete;
//! 4. **soma de verificação** — o arquivo é o que o índice descreve;
//! 5. **piso** — nenhuma solução fica abaixo do limite inferior, e o limite
//!    inferior anunciado nunca é menor que a cota de contagem recalculada aqui;
//! 6. **prova** — a marca `provado` aparece se, e somente se, o tamanho
//!    encontrado encontra o piso;
//! 7. **os mínimos de argumento fechado** — nos 155 casos em que o mínimo não
//!    depende de cota nenhuma (um bilhete basta, ou `k = 15` com `t = 15` exige
//!    todos os `C(v,15)`), o índice tem de dizer exatamente o que a aritmética
//!    diz. Aqui a conferência não confia no gerador nem na literatura: refaz o
//!    argumento.
//!
//! E do catálogo como um todo: que ele tenha as 330 combinações, cada uma uma
//! única vez.
//!
//! ```bash
//! cargo run --release --bin conferir-tudo -- [catalogo] [v-k-t]
//! ```
//!
//! Sai com código 1 na primeira reprovação. Uma falha aqui bloqueia a
//! publicação, e é para isso que ele serve.
//!
//! Com `v-k-t`, a varredura profunda fica só naquela entrada — o conjunto das
//! 330 continua sendo conferido inteiro, que é barato. Serve a quem acabou de
//! regerar um fechamento e quer conferi-lo sem esperar os outros 311, e à suíte
//! que estraga o catálogo de propósito, oito vezes, para cobrar que ele reprove.
//! O que ele imprime diz, em letras, que foi uma conferência parcial: ninguém
//! pode confundir isso com a que autoriza publicar.

use std::process::ExitCode;

const SORTEIO: usize = 15;
const POOL_MIN: usize = 15;
const POOL_MAX: usize = 25;
const GARANTIA_MIN: usize = 11;

fn main() -> ExitCode {
    let raiz = std::env::args().nth(1).unwrap_or_else(|| "catalogo".to_string());
    let so_esta: Option<(usize, usize, usize)> = std::env::args().nth(2).and_then(|a| {
        let n: Vec<usize> = a.split('-').filter_map(|p| p.parse().ok()).collect();
        (n.len() == 3).then(|| (n[0], n[1], n[2]))
    });

    let texto = match std::fs::read_to_string(format!("{raiz}/indice.json")) {
        Ok(t) => t,
        Err(erro) => {
            eprintln!("não deu para ler {raiz}/indice.json: {erro}");
            return ExitCode::FAILURE;
        }
    };

    let entradas = ler_indice(&texto);
    match so_esta {
        None => println!("Conferindo {} entradas de {raiz}/", entradas.len()),
        Some((v, k, t)) => println!(
            "CONFERÊNCIA PARCIAL de {raiz}/: o conjunto das {} entradas, e a varredura só de \
             ({v},{k},{t}). Isto não autoriza publicação.",
            entradas.len()
        ),
    }

    let mut reprovadas = Vec::new();
    let mut publicadas = 0usize;
    let mut sorteios_varridos: u64 = 0;

    for e in &entradas {
        if so_esta.is_some_and(|alvo| alvo != (e.v, e.k, e.t)) {
            continue;
        }
        match conferir(&raiz, e) {
            Ok(varridos) => {
                sorteios_varridos += varridos;
                if varridos > 0 {
                    publicadas += 1;
                }
            }
            Err(motivo) => {
                println!("REPROVA ({},{},{}): {motivo}", e.v, e.k, e.t);
                reprovadas.push((e.v, e.k, e.t));
            }
        }
    }

    if let Err(motivo) = conferir_o_conjunto(&entradas) {
        println!("REPROVA o catálogo: {motivo}");
        reprovadas.push((0, 0, 0));
    }

    println!(
        "\n{} entradas · {publicadas} com bilhetes · {sorteios_varridos} sorteios varridos",
        entradas.len()
    );

    if reprovadas.is_empty() {
        println!("tudo confere");
        ExitCode::SUCCESS
    } else {
        println!("{} reprovações", reprovadas.len());
        ExitCode::FAILURE
    }
}

struct Linha {
    v: usize,
    k: usize,
    t: usize,
    piso: u64,
    jogos: Option<u64>,
    provado: bool,
    soma: u32,
}

/// O catálogo tem as 330 combinações, cada uma uma vez só.
fn conferir_o_conjunto(entradas: &[Linha]) -> Result<(), String> {
    let mut vistas = Vec::new();
    for v in POOL_MIN..=POOL_MAX {
        for k in SORTEIO..=v {
            for t in GARANTIA_MIN..=SORTEIO {
                let quantas = entradas.iter().filter(|e| (e.v, e.k, e.t) == (v, k, t)).count();
                if quantas != 1 {
                    return Err(format!("({v},{k},{t}) aparece {quantas} vezes"));
                }
                vistas.push((v, k, t));
            }
        }
    }
    if entradas.len() != vistas.len() {
        return Err(format!("{} entradas, esperadas {}", entradas.len(), vistas.len()));
    }
    Ok(())
}

/// Confere uma entrada. Devolve quantos sorteios foram varridos.
fn conferir(raiz: &str, e: &Linha) -> Result<u64, String> {
    if !(POOL_MIN..=POOL_MAX).contains(&e.v)
        || !(SORTEIO..=e.v).contains(&e.k)
        || !(GARANTIA_MIN..=SORTEIO).contains(&e.t)
    {
        return Err("combinação fora do catálogo".to_string());
    }

    let total_sorteios = binomial(e.v, SORTEIO);
    let por_bilhete = alvos_por_bilhete(e.v, e.k, e.t);
    let por_contagem = total_sorteios.div_ceil(por_bilhete.max(1));
    if e.piso < por_contagem {
        return Err(format!(
            "piso {} abaixo da cota de contagem {por_contagem}, recalculada aqui",
            e.piso
        ));
    }

    // Dois casos em que o mínimo sai de argumento fechado, e que por isso podem
    // ser cobrados aqui sem acreditar em cota nenhuma. Cobrem 155 das 330.
    //
    // Um bilhete de `k` dezenas e um sorteio de 15, ambos dentro de um pool de
    // `v`, se cruzam em pelo menos `k + 15 − v` dezenas — não há como não se
    // cruzarem. Quando isso já alcança `t`, um bilhete qualquer basta; e zero
    // bilhetes não cobrem sorteio nenhum, então um é o mínimo, ponto.
    let cruzam = (e.k + SORTEIO).saturating_sub(e.v);
    if cruzam >= e.t {
        if e.jogos != Some(1) || e.piso != 1 || !e.provado {
            return Err(format!(
                "qualquer bilhete de {} dezenas cruza {cruzam} com qualquer sorteio do pool de \
                 {}, então o mínimo é 1 — o índice diz piso {} e {:?} bilhetes",
                e.k, e.v, e.piso, e.jogos
            ));
        }
    } else if e.jogos == Some(1) {
        return Err(format!(
            "um bilhete só, e um bilhete de {} dezenas cruza no máximo {cruzam} \
             garantidas com um sorteio do pool de {}",
            e.k, e.v
        ));
    }

    // E `k = 15` com `t = 15`: para conter as 15 sorteadas, um bilhete de 15
    // dezenas tem de **ser** o sorteio. Nenhum serve a dois, e são precisos
    // todos os `C(v,15)`.
    if e.k == SORTEIO && e.t == SORTEIO
        && (e.piso != total_sorteios || e.jogos != Some(total_sorteios) || !e.provado)
    {
        return Err(format!(
            "k=15 com t=15 exige exatamente os C({},15) = {total_sorteios} bilhetes, e é mínimo \
             provado — o índice diz piso {}, {:?} bilhetes, provado={}",
            e.v, e.piso, e.jogos, e.provado
        ));
    }

    if let Some(jogos) = e.jogos {
        if jogos < e.piso {
            return Err(format!("{jogos} bilhetes fica abaixo do piso {}", e.piso));
        }
        if e.provado != (jogos == e.piso) {
            return Err(format!(
                "marca provado={} com {jogos} bilhetes e piso {}",
                e.provado, e.piso
            ));
        }
    } else if e.provado {
        return Err("marca provado sem tamanho encontrado".to_string());
    }

    // Entrada sem bilhetes publicados: o que ela afirma é só o piso e o tamanho,
    // e os dois já foram cobrados acima.
    if e.soma == 0 {
        return Ok(0);
    }

    let arquivo = format!("{raiz}/f/{}-{}-{}.json", e.v, e.k, e.t);
    let texto = std::fs::read_to_string(&arquivo).map_err(|erro| format!("{arquivo}: {erro}"))?;

    let palavras = ler_bilhetes(&texto)?;
    if soma_de_verificacao(&palavras.join(",")) != e.soma {
        return Err("a soma de verificação do arquivo não bate com o índice".to_string());
    }

    let mut bilhetes: Vec<u32> = Vec::with_capacity(palavras.len());
    for palavra in &palavras {
        let mascara = u32::from_str_radix(palavra, 36)
            .map_err(|_| format!("bilhete ilegível: {palavra:?}"))?;
        if mascara >> e.v != 0 {
            return Err(format!("bilhete {palavra} usa posição fora do pool de {}", e.v));
        }
        if mascara.count_ones() as usize != e.k {
            return Err(format!(
                "bilhete {palavra} tem {} dezenas, não {}",
                mascara.count_ones(),
                e.k
            ));
        }
        bilhetes.push(mascara);
    }

    if e.jogos != Some(bilhetes.len() as u64) {
        return Err(format!("o arquivo tem {} bilhetes, o índice diz {:?}", bilhetes.len(), e.jogos));
    }

    let mut ordenados = bilhetes.clone();
    ordenados.sort_unstable();
    ordenados.dedup();
    if ordenados.len() != bilhetes.len() {
        return Err("há bilhete repetido".to_string());
    }

    // Toda dezena do pool entra em algum bilhete — a menos que o fechamento
    // seja um bilhete só, e aí ele leva `k` das `v` e as outras ficam de fora.
    //
    // A tela conta com isso ao pé da letra: só na resposta de um bilhete ela
    // avisa que parte do que a pessoa marcou não vai ser jogada. Se um
    // fechamento de vários jogos passasse a deixar dezenas de fora, o
    // aplicativo pediria para marcar 25 e jogaria 24 sem dizer nada — o tipo de
    // silêncio que só aparece quando alguém confere o bilhete impresso.
    let uniao = bilhetes.iter().fold(0u32, |a, b| a | b);
    let usadas = uniao.count_ones() as usize;
    let esperadas = if bilhetes.len() == 1 { e.k } else { e.v };
    if usadas != esperadas {
        return Err(format!(
            "os {} bilhetes usam {usadas} dezenas do pool de {}, esperadas {esperadas}",
            bilhetes.len(),
            e.v
        ));
    }

    // A varredura. Todo sorteio de 15 dezenas dentro do pool, um a um.
    let teto: u32 = 1 << e.v;
    let mut sorteio: u32 = (1 << SORTEIO) - 1;
    let mut varridos: u64 = 0;
    while sorteio < teto {
        let mut coberto = false;
        for &b in &bilhetes {
            if (b & sorteio).count_ones() as usize >= e.t {
                coberto = true;
                break;
            }
        }
        if !coberto {
            return Err(format!(
                "o sorteio {} não é coberto por bilhete nenhum",
                dezenas(sorteio)
            ));
        }
        varridos += 1;
        // Próximo subconjunto de mesmo tamanho, em ordem crescente.
        let menor = sorteio & sorteio.wrapping_neg();
        let soma = sorteio.wrapping_add(menor);
        sorteio = soma | (((sorteio ^ soma) >> 2) / menor);
    }

    if varridos != total_sorteios {
        return Err(format!("varreu {varridos} sorteios, esperados {total_sorteios}"));
    }
    Ok(varridos)
}

/// Quantos sorteios um único bilhete de `k` dezenas atende: escolhe `i ≥ t`
/// dezenas dentro dele e as `15 − i` restantes fora.
fn alvos_por_bilhete(v: usize, k: usize, t: usize) -> u64 {
    (t..=SORTEIO.min(k))
        .map(|i| binomial(k, i).saturating_mul(binomial(v - k, SORTEIO - i)))
        .fold(0u64, u64::saturating_add)
}

fn binomial(n: usize, k: usize) -> u64 {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    let mut total: u128 = 1;
    for i in 0..k {
        total = total * (n - i) as u128 / (i as u128 + 1);
    }
    total.min(u64::MAX as u128) as u64
}

fn dezenas(mascara: u32) -> String {
    (0..32)
        .filter(|i| mascara >> i & 1 == 1)
        .map(|i| (i + 1).to_string())
        .collect::<Vec<_>>()
        .join("-")
}

fn soma_de_verificacao(texto: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for byte in texto.bytes() {
        h ^= byte as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// As palavras do campo `bilhetes`, na ordem em que aparecem.
fn ler_bilhetes(texto: &str) -> Result<Vec<String>, String> {
    let inicio = texto.find("\"bilhetes\":[").ok_or("arquivo sem campo bilhetes")?;
    let corpo = &texto[inicio + "\"bilhetes\":[".len()..];
    let fim = corpo.find(']').ok_or("campo bilhetes sem fechamento")?;
    Ok(corpo[..fim]
        .split(',')
        .map(|p| p.trim().trim_matches('"').to_string())
        .filter(|p| !p.is_empty())
        .collect())
}

/// As linhas do índice, cada uma um vetor de oito números (o sétimo, o método,
/// não interessa aqui: é texto para a tela).
fn ler_indice(texto: &str) -> Vec<Linha> {
    let Some(inicio) = texto.find("\"entradas\":[") else { return Vec::new() };
    let corpo = &texto[inicio + "\"entradas\":[".len()..];

    let mut saida = Vec::new();
    let mut resto = corpo;
    while let Some(i) = resto.find('[') {
        let Some(f) = resto[i..].find(']') else { break };
        let campos: Vec<&str> = resto[i + 1..i + f].split(',').map(str::trim).collect();
        resto = &resto[i + f + 1..];

        if campos.len() != 8 {
            continue;
        }
        let numero = |s: &str| s.parse::<u64>().ok();
        let (Some(v), Some(k), Some(t), Some(piso), Some(soma)) = (
            numero(campos[0]),
            numero(campos[1]),
            numero(campos[2]),
            numero(campos[3]),
            numero(campos[7]),
        ) else {
            continue;
        };
        saida.push(Linha {
            v: v as usize,
            k: k as usize,
            t: t as usize,
            piso,
            jogos: numero(campos[4]),
            provado: campos[5] == "1",
            soma: soma as u32,
        });
    }
    saida
}
