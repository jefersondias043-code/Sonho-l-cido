//! Resolve, confere e publica o catálogo inteiro de fechamentos da Lotofácil.
//!
//! O espaço de respostas do aplicativo é finito e pequeno: pool de 15 a 25
//! dezenas, bilhete de 15 até o tamanho do pool, garantia de 11 a 15 acertos —
//! **330 combinações**. Não é espaço para explorar no aparelho de ninguém. É
//! catálogo para publicar.
//!
//! Este binário é o único lugar do projeto onde algo é procurado. Ele roda em
//! CI e na máquina de quem mantém o projeto, nunca no cliente. O que ele grava
//! em `catalogo/` são arquivos estáticos que o navegador só baixa.
//!
//! ## Como cada caso é resolvido
//!
//! Com `a = v − k` (o que falta ao bilhete) e `b = v − 15` (o que falta ao
//! sorteio), vale a identidade exata
//!
//! ```text
//! |B ∩ S| = 15 − a + |B' ∩ S'|    ⟹    |B ∩ S| ≥ t  ⟺  |B' ∩ S'| ≥ t + a − 15
//! ```
//!
//! e `t' = t + a − 15` organiza tudo:
//!
//! | situação | quem resolve |
//! |---|---|
//! | `t' ≤ 0` | aritmética: um bilhete qualquer já garante |
//! | `t' = a` e `k = 15` | fórmula: são todos os `C(v,15)` bilhetes, e é mínimo provado |
//! | `t' = a` | sistema de Turán ([`turan`]) + motor |
//! | `0 < t' < a` | motor, partindo do melhor que houver |
//!
//! ## O que nunca acontece aqui
//!
//! Nenhuma entrada é gravada sem passar por varredura exaustiva — todos os
//! `C(v,15)` sorteios possíveis dentro do pool, um a um. Um fechamento furado
//! gravado aqui viraria uma promessa falsa na tela de quem apostou.
//!
//! ```bash
//! cargo run --release --bin gerar-catalogo -- [segundos-por-caso] [v-k-t ...]
//! ```
//!
//! Sem casos nomeados, percorre as 330. Com eles, busca só os nomeados e mantém
//! o resto do catálogo publicado como está — o que permite dar horas aos casos
//! difíceis sem gastar as mesmas horas nos que já estão no melhor conhecido.
//!
//! `CATALOGO_SAIDA` desvia a escrita; `CATALOGO_SEMENTES` acrescenta outros
//! catálogos à leitura, e de cada combinação fica o menor fechamento.

mod turan;

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca, Silencioso};
use motor_core::limites::{limite_inferior, LimiteInferior};
use motor_core::{Cartela, MotorCobertura, Objetivo, Problema, RegraCobertura};

/// Quantas dezenas a Lotofácil sorteia.
const SORTEIO: usize = 15;
const POOL_MIN: usize = 15;
const POOL_MAX: usize = 25;
const GARANTIA_MIN: usize = 11;

/// Acima disto o fechamento não vai para o catálogo.
///
/// Não é economia de disco: é a fronteira do que alguém compra. Oito mil
/// bilhetes de 15 dezenas custam mais de vinte mil reais, e o catálogo existe
/// para responder "como gasto melhor este dinheiro", não para arquivar
/// curiosidades. Acima do teto a entrada guarda só o piso provado, e o
/// aplicativo diz que ali não há fechamento catalogado.
///
/// O teto vale para o resultado **final**, depois de o motor ter feito o que
/// podia — vários casos nascem com dezenas de milhares e terminam com poucas
/// centenas.
const TETO_DE_PUBLICACAO: usize = 8_000;

/// Acima disto nem vale materializar a construção de Turán como partida.
///
/// Podar meio milhão de bilhetes custa minutos e quase sempre perde para o que
/// o próprio motor constrói.
const TETO_DA_CONSTRUCAO: u64 = 400_000;

fn main() {
    let segundos: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(5);

    let so: Vec<(usize, usize, usize)> = std::env::args()
        .skip(2)
        .filter_map(|arg| {
            let mut partes = arg.split(['-', ',']);
            Some((
                partes.next()?.trim().parse().ok()?,
                partes.next()?.trim().parse().ok()?,
                partes.next()?.trim().parse().ok()?,
            ))
        })
        .collect();

    let saida = std::env::var("CATALOGO_SAIDA").unwrap_or_else(|_| "catalogo".to_string());
    let sementes = sementes::carregar(&saida);

    println!("Catálogo de fechamentos da Lotofácil ({segundos}s por caso em aberto)");
    println!("saída: {saida}/ · sementes carregadas: {}", sementes.len());
    if !so.is_empty() {
        println!("buscando só: {so:?}");
    }
    println!();
    println!(
        "{:>4} {:>4} {:>4} {:>9} {:>9} {:>12} {:>10}",
        "pool", "jogo", "gar", "piso", "bilhetes", "origem", "confere"
    );
    println!("{}", "─".repeat(60));

    let comeco = Instant::now();
    let mut entradas: Vec<Entrada> = Vec::with_capacity(330);
    let mut memo = HashMap::new();

    for v in POOL_MIN..=POOL_MAX {
        for k in SORTEIO..=v {
            for t in GARANTIA_MIN..=SORTEIO {
                let buscar = so.is_empty() || so.contains(&(v, k, t));
                let entrada = resolver(
                    v,
                    k,
                    t,
                    &sementes,
                    if buscar { Duration::from_secs(segundos) } else { Duration::ZERO },
                    &mut memo,
                );
                println!(
                    "{v:>4} {k:>4} {t:>4} {:>9} {:>9} {:>12} {:>10}",
                    entrada.piso,
                    entrada.jogos.map_or("—".to_string(), |n| n.to_string()),
                    entrada.origem,
                    if entrada.bilhetes.is_empty() { "não publica" } else { "sim" },
                );
                entradas.push(entrada);
            }
        }
    }

    assert_eq!(entradas.len(), 330, "o catálogo tem 330 combinações, sempre");
    escrever(&saida, &entradas);
    escrever_o_acaso(&saida);

    let publicadas = entradas.iter().filter(|e| !e.bilhetes.is_empty()).count();
    let provadas = entradas.iter().filter(|e| e.provado).count();
    println!();
    println!(
        "330 entradas · {publicadas} com bilhetes publicados · {provadas} no mínimo provado \
         · {:.0}s",
        comeco.elapsed().as_secs_f64()
    );
}

/// Uma linha do catálogo.
struct Entrada {
    v: usize,
    k: usize,
    t: usize,
    /// Nenhuma solução válida usa menos bilhetes que isto.
    piso: u64,
    /// Como o piso foi obtido, em português.
    metodo: String,
    /// Quantos bilhetes tem o melhor fechamento conhecido. `None` quando o caso
    /// fica acima do teto de publicação e nada foi procurado.
    jogos: Option<usize>,
    /// `jogos == piso`: o menor fechamento **é** o mínimo matemático.
    provado: bool,
    /// Vazio quando a entrada não publica bilhetes.
    bilhetes: Vec<Cartela>,
    origem: &'static str,
}

/// Resolve um caso `(v, k, t)`.
fn resolver(
    v: usize,
    k: usize,
    t: usize,
    sementes: &BTreeMap<(usize, usize, usize), Vec<Cartela>>,
    orcamento: Duration,
    memo: &mut HashMap<(usize, usize, usize), u64>,
) -> Entrada {
    let a = v - k;
    let b = v - SORTEIO;
    // `t' = t + a − 15`, em inteiro com sinal porque a parte interessante é
    // justamente quando ele fica negativo.
    let t_linha = t as isize + a as isize - SORTEIO as isize;

    // Um bilhete basta, e por aritmética: um bilhete de `k` dezenas e um
    // sorteio de 15, ambos dentro de um pool de `v`, se cruzam em pelo menos
    // `k + 15 − v` dezenas. Quando isso já alcança `t`, não há o que procurar.
    if a == 0 || t_linha <= 0 {
        return Entrada {
            v,
            k,
            t,
            piso: 1,
            metodo: "aritmética do pool".to_string(),
            jogos: Some(1),
            provado: true,
            bilhetes: vec![Cartela::dos_indices(&(0..k).collect::<Vec<_>>())],
            origem: "aritmética",
        };
    }

    let problema = Problema::com_pool_inicial(
        v as u32,
        v,
        k,
        RegraCobertura::garantia(SORTEIO, t),
        Objetivo::MinimizarCartelas,
    )
    .expect("(v, k, t) do catálogo é sempre uma configuração válida");
    let cobertura = MotorCobertura::novo(&problema).expect("C(25,15) cabe no limite de alvos");
    let LimiteInferior { valor: piso, metodo } = limite_inferior(&cobertura);

    // O bilhete precisa conter o sorteio inteiro **e** falta-lhe exatamente o
    // que falta ao sorteio: só serve o fechamento com todos os `C(v,15)`
    // bilhetes, e isso é mínimo provado sem busca nenhuma.
    if k == SORTEIO && t == SORTEIO {
        let total = turan::binomial(v, SORTEIO) as usize;
        let bilhetes = if total <= TETO_DE_PUBLICACAO {
            turan::todos_os_subconjuntos(v, SORTEIO)
                .iter()
                .map(|c| Cartela::dos_indices(c))
                .collect()
        } else {
            Vec::new()
        };
        return Entrada {
            v,
            k,
            t,
            piso,
            metodo: metodo.to_string(),
            jogos: Some(total),
            provado: total as u64 == piso,
            bilhetes,
            origem: "fórmula",
        };
    }

    // Acima do teto nem se procura: o que sairia daqui não caberia no catálogo,
    // e o tempo é melhor gasto nos casos que alguém vai comprar.
    if piso > TETO_DE_PUBLICACAO as u64 {
        return Entrada {
            v,
            k,
            t,
            piso,
            metodo: metodo.to_string(),
            jogos: None,
            provado: false,
            bilhetes: Vec::new(),
            origem: "acima do teto",
        };
    }

    let mut melhor: Vec<Cartela> = Vec::new();
    let mut origem = "motor";

    // O catálogo já publicado entra como candidato: regerar nunca pode ser um
    // retrocesso.
    if let Some(guardado) = sementes.get(&(v, k, t)) {
        melhor = guardado.clone();
        origem = "catálogo";
    }

    // Garantia total: a construção de Turán é um fechamento completo pronto, e
    // em `a ≤ 2` já é o valor exato.
    if t == SORTEIO && turan::tamanho(v, a, b, memo) <= TETO_DA_CONSTRUCAO {
        let faltas = turan::construir(&(0..v).collect::<Vec<_>>(), a, b, memo);
        let construida: Vec<Cartela> = faltas
            .iter()
            .map(|fora| {
                Cartela::dos_indices(&(0..v).filter(|i| !fora.contains(i)).collect::<Vec<_>>())
            })
            .collect();
        if melhor.is_empty() || construida.len() < melhor.len() {
            melhor = construida;
            origem = if a <= 2 { "fórmula" } else { "Turán" };
        }
    }

    if !orcamento.is_zero() {
        let achado = buscar(&problema, &melhor, orcamento);
        if !achado.is_empty() && (melhor.is_empty() || achado.len() < melhor.len()) {
            melhor = achado;
            origem = "motor";
        }
    }

    if melhor.is_empty() || melhor.len() > TETO_DE_PUBLICACAO {
        return Entrada {
            v,
            k,
            t,
            piso,
            metodo: metodo.to_string(),
            jogos: None,
            provado: false,
            bilhetes: Vec::new(),
            origem: if melhor.is_empty() { "sem partida" } else { "acima do teto" },
        };
    }

    // A conferência não é formalidade: é a única coisa que separa um fechamento
    // de uma lista de números com cara de fechamento.
    assert!(
        cobre_tudo(v, t, &melhor),
        "({v},{k},{t}): a solução de {} bilhetes não cobre todos os sorteios",
        melhor.len()
    );
    assert!(
        melhor.len() as u64 >= piso,
        "({v},{k},{t}): {} bilhetes fica abaixo do piso {piso} — isso é erro, não recorde",
        melhor.len()
    );

    melhor.sort_unstable_by_key(|c| c.indices());
    let jogos = melhor.len();
    Entrada {
        v,
        k,
        t,
        piso,
        metodo: metodo.to_string(),
        jogos: Some(jogos),
        provado: jogos as u64 == piso,
        bilhetes: melhor,
        origem,
    }
}

/// Põe o motor persistente para trabalhar a partir do que já houver.
fn buscar(problema: &Problema, inicial: &[Cartela], orcamento: Duration) -> Vec<Cartela> {
    let config = Configuracao { semente: 20260904, intervalo_progresso: 0, ..Default::default() };
    let Ok(mut motor) = MotorBusca::novo(problema.clone(), config) else {
        return Vec::new();
    };

    if !inicial.is_empty() {
        motor.semear(inicial);
    }
    motor.executar(
        &Controle::novo(),
        &CondicoesDeParada {
            max_duracao: Some(orcamento),
            parar_em_optimalidade: true,
            ..Default::default()
        },
        &mut Silencioso,
    );

    motor.melhor_cartelas().to_vec()
}

/// Varredura exaustiva: todos os `C(v,15)` sorteios possíveis dentro do pool.
///
/// Escrita aqui em bitmask e força bruta, sem tocar na contagem incremental do
/// motor. É uma segunda opinião dentro do próprio gerador — a terceira, que é a
/// que vale, é o binário `conferir-tudo`, que não compartilha uma linha com
/// este arquivo.
fn cobre_tudo(v: usize, t: usize, bilhetes: &[Cartela]) -> bool {
    let mascaras: Vec<u32> = bilhetes
        .iter()
        .map(|c| c.indices().iter().fold(0u32, |m, &i| m | (1 << i)))
        .collect();

    let mut sorteio: u32 = (1 << SORTEIO) - 1;
    let teto: u32 = 1 << v;
    while sorteio < teto {
        if !mascaras.iter().any(|&b| (b & sorteio).count_ones() as usize >= t) {
            return false;
        }
        // Gosper: o próximo subconjunto de mesmo tamanho, em ordem crescente.
        let menor = sorteio & sorteio.wrapping_neg();
        let soma = sorteio.wrapping_add(menor);
        sorteio = soma | (((sorteio ^ soma) >> 2) / menor);
    }
    true
}

/// Codifica um bilhete como a máscara das posições que ele ocupa no pool, em
/// base 36.
///
/// O catálogo não guarda dezenas: guarda **posições**. O mesmo fechamento de
/// pool 20 serve para quem escolheu as vinte primeiras dezenas e para quem
/// escolheu vinte outras — a posição 0 é sempre a menor dezena marcada. Isso é
/// o que faz 330 arquivos bastarem para todos os pedidos possíveis.
fn codificar(c: Cartela) -> String {
    let mascara = c.indices().iter().fold(0u32, |m, &i| m | (1 << i));
    let mut n = mascara as u64;
    if n == 0 {
        return "0".to_string();
    }
    let digitos = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut saida = Vec::new();
    while n > 0 {
        saida.push(digitos[(n % 36) as usize]);
        n /= 36;
    }
    saida.reverse();
    String::from_utf8(saida).expect("dígitos base 36 são ASCII")
}

/// FNV-1a de 32 bits sobre o texto canônico dos bilhetes.
///
/// Existe para o cliente conferir que o arquivo que ele baixou é o arquivo que
/// o índice descreve — CDN serve coisa velha, cache guarda coisa truncada, e um
/// fechamento truncado é um fechamento furado com cara de fechamento.
fn soma_de_verificacao(texto: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for byte in texto.bytes() {
        h ^= byte as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn escrever(saida: &str, entradas: &[Entrada]) {
    std::fs::create_dir_all(format!("{saida}/f")).expect("criar catalogo/f");

    // Índice compacto: uma linha por combinação, com os campos declarados no
    // cabeçalho. São 330 linhas — em objetos com chaves nomeadas o índice
    // triplicaria de tamanho, e ele é a única coisa que todo mundo baixa.
    let mut linhas = Vec::with_capacity(entradas.len());
    let mut metodos: Vec<String> = Vec::new();

    for e in entradas {
        let mut soma = 0u32;
        if !e.bilhetes.is_empty() {
            let corpo: Vec<String> = e.bilhetes.iter().map(|&c| codificar(c)).collect();
            let texto = corpo.join(",");
            soma = soma_de_verificacao(&texto);
            let arquivo = format!("{saida}/f/{}-{}-{}.json", e.v, e.k, e.t);
            std::fs::write(
                &arquivo,
                format!(
                    "{{\"v\":{},\"k\":{},\"t\":{},\"jogos\":{},\"soma\":{},\
                     \"codificacao\":\"posicoes-em-base36\",\"bilhetes\":[{}]}}",
                    e.v,
                    e.k,
                    e.t,
                    e.bilhetes.len(),
                    soma,
                    corpo.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(",")
                ),
            )
            .expect("gravar o fechamento");
        }

        let metodo = match metodos.iter().position(|m| m == &e.metodo) {
            Some(i) => i,
            None => {
                metodos.push(e.metodo.clone());
                metodos.len() - 1
            }
        };

        linhas.push(format!(
            "[{},{},{},{},{},{},{},{}]",
            e.v,
            e.k,
            e.t,
            e.piso,
            e.jogos.map_or("null".to_string(), |n| n.to_string()),
            u8::from(e.provado),
            metodo,
            soma
        ));
    }

    let json = format!(
        "{{\"versao\":1,\"sorteio\":{SORTEIO},\"universo\":{POOL_MAX},\
         \"campos\":[\"v\",\"k\",\"t\",\"piso\",\"jogos\",\"provado\",\"metodo\",\"soma\"],\
         \"metodos\":[{}],\"entradas\":[{}]}}",
        metodos.iter().map(|m| format!("\"{m}\"")).collect::<Vec<_>>().join(","),
        linhas.join(",\n")
    );
    std::fs::write(format!("{saida}/indice.json"), &json).expect("gravar o índice");
    println!("\nescrito {saida}/indice.json — {:.1} KiB", json.len() as f64 / 1024.0);
}

/// A distribuição do acaso, para a comparação lado a lado.
///
/// `chegam[v-k][t]` é a probabilidade de **um** bilhete de `k` dezenas, tirado
/// ao acaso dentro de um pool de `v`, fazer `t` acertos ou mais — dado que o
/// sorteio caiu inteiro dentro do pool, que é a condição sob a qual o
/// fechamento promete alguma coisa.
///
/// É hipergeométrica, e sai exata: `Σ_{i≥t} C(k,i)·C(v−k,15−i) / C(v,15)`. Com
/// ela o cliente escreve, sem estimar nada, o que `n` bilhetes ao acaso fariam
/// — `1 − (1−p)^n`, aritmética fechada sobre um número publicado.
///
/// Só os tamanhos de jogo que a lotérica aceita: comparar com um bilhete de 22
/// dezenas seria comparar com uma aposta que ninguém pode fazer.
fn escrever_o_acaso(saida: &str) {
    let mut dentro = Vec::new();
    let mut linhas = Vec::new();
    for v in POOL_MIN..=POOL_MAX {
        // A chance de o sorteio inteiro cair dentro de um pool de `v` dezenas:
        // `C(v,15) / C(25,15)`. É a condição sob a qual a garantia vale, e sem
        // ela o número da tela seria meia verdade — garantir 15 acertos num pool
        // de 15 dezenas é fácil e quase nunca acontece.
        // Notação científica, e não decimal fixa: `C(15,15)/C(25,15)` é
        // 3,06 × 10⁻⁷, e doze casas decimais já perdem dígitos significativos
        // suficientes para o inverso sair 3.268.764 em vez de 3.268.760.
        dentro.push(format!(
            "\"{v}\":{:e}",
            turan::binomial(v, SORTEIO) as f64 / turan::binomial(POOL_MAX, SORTEIO) as f64
        ));
        for k in SORTEIO..=v.min(20) {
            let total = turan::binomial(v, SORTEIO) as f64;
            let mut faixas = Vec::new();
            for t in GARANTIA_MIN..=SORTEIO {
                let favoraveis: f64 = (t..=SORTEIO.min(k))
                    .map(|i| {
                        (turan::binomial(k, i) as f64) * (turan::binomial(v - k, SORTEIO - i) as f64)
                    })
                    .sum();
                faixas.push(format!("\"{t}\":{:e}", favoraveis / total));
            }
            linhas.push(format!("\"{v}-{k}\":{{{}}}", faixas.join(",")));
        }
    }

    let json = format!(
        "{{\"versao\":1,\"observacao\":\"chegam[pool-jogo][garantia] é a chance de UM bilhete \
         tirado ao acaso dentro do pool fazer aquela quantidade de acertos ou mais, dado que o \
         sorteio caiu dentro do pool. Valor exato, hipergeométrico, não simulado.\",\
         \"chegam\":{{{}}},\"dentro\":{{{}}}}}",
        linhas.join(","),
        dentro.join(",")
    );
    std::fs::write(format!("{saida}/acaso.json"), &json).expect("gravar o acaso");
    println!("escrito {saida}/acaso.json — {:.1} KiB", json.len() as f64 / 1024.0);
}

/// Leitura dos catálogos que já existem, para que regerar só possa melhorar.
mod sementes {
    use std::collections::BTreeMap;

    use motor_core::Cartela;

    pub type Banco = BTreeMap<(usize, usize, usize), Vec<Cartela>>;

    pub fn carregar(saida: &str) -> Banco {
        let mut banco = Banco::new();
        let extras = std::env::var("CATALOGO_SEMENTES").unwrap_or_default();
        for raiz in std::iter::once(saida.to_string())
            .chain(extras.split(',').filter(|a| !a.is_empty()).map(str::to_string))
        {
            juntar(&mut banco, de_catalogo(&raiz));
        }
        juntar(&mut banco, da_lotinha("web/lotinha.json"));
        banco
    }

    /// De cada combinação fica o menor fechamento entre todas as fontes.
    fn juntar(destino: &mut Banco, novo: Banco) {
        for (chave, jogos) in novo {
            let melhor = destino.get(&chave).is_none_or(|atual| jogos.len() < atual.len());
            if melhor {
                destino.insert(chave, jogos);
            }
        }
    }

    /// Um catálogo gravado por uma execução anterior deste mesmo binário.
    fn de_catalogo(raiz: &str) -> Banco {
        let mut banco = Banco::new();
        let Ok(entradas) = std::fs::read_dir(format!("{raiz}/f")) else {
            return banco;
        };
        for arquivo in entradas.flatten() {
            let caminho = arquivo.path();
            let Some(nome) = caminho.file_stem().and_then(|n| n.to_str()) else { continue };
            let numeros: Vec<usize> = nome.split('-').filter_map(|n| n.parse().ok()).collect();
            let [v, k, t] = numeros[..] else { continue };
            let Ok(texto) = std::fs::read_to_string(&caminho) else { continue };
            let bilhetes = ler_bilhetes(&texto);
            if bilhetes.iter().all(|c| c.indices().len() == k) && !bilhetes.is_empty() {
                banco.insert((v, k, t), bilhetes);
            }
        }
        banco
    }

    /// Os bilhetes de um arquivo do catálogo, sem interpretador de JSON: o
    /// campo é o último do arquivo e os valores são palavras em base 36 entre
    /// aspas.
    fn ler_bilhetes(texto: &str) -> Vec<Cartela> {
        let Some(inicio) = texto.find("\"bilhetes\":[") else { return Vec::new() };
        texto[inicio..]
            .split('"')
            .filter(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric()))
            .skip(1)
            .filter_map(|palavra| {
                let mascara = u64::from_str_radix(palavra, 36).ok()?;
                Some(Cartela::dos_indices(
                    &(0..25).filter(|i| mascara >> i & 1 == 1).collect::<Vec<_>>(),
                ))
            })
            .collect()
    }

    /// O banco da Lotinha, do aplicativo anterior deste repositório.
    ///
    /// Ele guarda exatamente a linha `t = 15` deste catálogo — fechamentos em
    /// que o bilhete contém o sorteio inteiro — e cada um deles é resultado de
    /// horas de busca já gastas. Entram como semente e são reconferidos aqui
    /// como qualquer outra: nada é aproveitado sem passar pela varredura.
    ///
    /// Formato 2: por combinação `"pool,jogo"`, a lista do que **falta** a cada
    /// bilhete, em dezenas de 1 a pool.
    fn da_lotinha(arquivo: &str) -> Banco {
        let mut banco = Banco::new();
        let Ok(texto) = std::fs::read_to_string(arquivo) else { return banco };
        if !texto.contains("\"formato\":2") {
            return banco;
        }

        for pedaco in texto.split('"').skip(1).collect::<Vec<_>>().chunks(2) {
            let [chave, resto] = pedaco else { continue };
            let Some((pool, jogo)) = chave.split_once(',') else { continue };
            let (Ok(pool), Ok(jogo)) = (pool.parse::<usize>(), jogo.parse::<usize>()) else {
                continue;
            };
            let (Some(i), Some(f)) = (resto.find('['), resto.rfind(']')) else { continue };

            let bilhetes: Vec<Cartela> = resto[i + 1..f]
                .split('[')
                .skip(1)
                .filter_map(|linha| {
                    let fora: Vec<usize> = linha
                        .split(']')
                        .next()?
                        .split(',')
                        .filter_map(|n| n.trim().parse::<usize>().ok())
                        .map(|n| n - 1)
                        .collect();
                    let dentro: Vec<usize> = (0..pool).filter(|i| !fora.contains(i)).collect();
                    (dentro.len() == jogo).then(|| Cartela::dos_indices(&dentro))
                })
                .collect();

            if !bilhetes.is_empty() {
                banco.insert((pool, jogo, 15), bilhetes);
            }
        }
        banco
    }
}
