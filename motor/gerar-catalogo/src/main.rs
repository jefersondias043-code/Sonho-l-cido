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

use motor_busca::{
    BuscaCiclica, CondicoesDeParada, Configuracao, Controle, InstanciaCiclica, MotorBusca,
    Silencioso,
};
use motor_core::limites::{limite_inferior, LimiteInferior};
use motor_core::{Cartela, MotorCobertura, Objetivo, Problema, RegraCobertura};

/// Quantas dezenas a Lotofácil sorteia.
const SORTEIO: usize = 15;
const POOL_MIN: usize = 15;
const POOL_MAX: usize = 25;
const GARANTIA_MIN: usize = 11;

/// Acima disto o fechamento não vai para o catálogo.
///
/// Nasceu como fronteira econômica — oito mil cartelas de 15 dezenas custam
/// mais de vinte mil reais, e o catálogo existe para responder "como gasto
/// melhor este dinheiro", não para arquivar curiosidades. Acima do teto a
/// entrada guarda só o piso provado, e o aplicativo diz que ali não há
/// fechamento catalogado.
///
/// **Mas ele conta cartelas, e não dinheiro, e por isso não é a fronteira que
/// o parágrafo acima descreve.** Oito mil cartelas de 15 dezenas são
/// R$ 28.000; oito mil de 17 são R$ 3,8 milhões; oito mil de 20 são
/// R$ 434 milhões. Medido no catálogo publicado, vinte fechamentos passam de
/// R$ 1 milhão e o mais caro custa R$ 59.907.456,00 — todos abaixo do teto.
/// Fica assim de propósito: o modo manual mostra o preço junto, e ver "R$ 59
/// milhões" ensina por que ninguém fecha com cartela de 20. Trocar o teto por
/// um em reais é decisão de produto, não conserto; o que não pode é o
/// comentário dizer o que a constante não faz.
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
                    entrada.jogos.map_or_else(
                        || entrada.alcancado.map_or("—".to_string(), |n| format!("({n})")),
                        |n| n.to_string(),
                    ),
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
    /// Quantos bilhetes o motor alcançou quando o resultado ficou **acima** do
    /// teto e por isso não vira catálogo.
    ///
    /// Sem isto a linha diz só "acima do teto", e quem mantém o projeto não
    /// sabe se faltou pouco ou muito — se dar mais máquina àquele caso tem
    /// chance de trazê-lo para dentro, ou se é tempo jogado fora. O número não
    /// vai para o índice: é para quem lê a saída decidir onde gastar horas.
    alcancado: Option<usize>,
}

/// Os pisos que a varredura exaustiva provou, e que nenhuma cota alcança.
///
/// Cada linha aqui é o resultado de `minimo-por-exaustao` em
/// `crates/motor-exato/examples/`: varreu o espaço inteiro de famílias com uma
/// cartela a menos, a menos de simetria, e não achou nenhuma que cubra. O
/// número é, portanto, **o mínimo**, e não uma estimativa por baixo.
///
/// Por que isto vive numa tabela em vez de rodar junto: a varredura é barata
/// nestes casos e cara em geral, e o gerador não pode ficar refém dela. Quem
/// acrescentar uma linha aqui roda o exemplo e cola o resultado — e o teste
/// abaixo cobra que nenhuma linha contradiga o que o catálogo publica.
mod exaustao {
    /// `(v, k, t, mínimo provado)`.
    pub const PROVADOS: &[(usize, usize, usize, u64)] = &[
        (21, 15, 11, 4),
        (22, 16, 11, 4),
        (22, 17, 12, 4),
        (23, 16, 11, 5),
        (23, 17, 11, 4),
        (23, 18, 12, 4),
        (24, 17, 11, 4),
        (24, 18, 11, 4),
        (24, 18, 12, 4),
        (24, 19, 12, 4),
        (25, 18, 11, 4),
        (25, 19, 11, 4),
        (25, 19, 12, 4),
        (25, 20, 12, 4),
        // A mais cara até agora: 1.225.584 nós em 421 s. A varredura alcança
        // `n = 6` quando o custo por nó é baixo — aqui `a = v − k = 4`, e é ele,
        // não o número de cartelas, que decide o tamanho de cada nó.
        (21, 17, 13, 7),
    ];

    pub fn piso(v: usize, k: usize, t: usize) -> Option<u64> {
        PROVADOS
            .iter()
            .find(|&&(pv, pk, pt, _)| (pv, pk, pt) == (v, k, t))
            .map(|&(_, _, _, n)| n)
    }
}

/// Resolve um caso `(v, k, t)`.
fn resolver(
    v: usize,
    k: usize,
    t: usize,
    sementes: &BTreeMap<(usize, usize, usize), Vec<Cartela>>,
    orcamento: Duration,
    memo: &mut turan::Memo,
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
            alcancado: None,
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
    // A varredura exaustiva tem a última palavra. Onde ela rodou, o piso deixa
    // de ser cota e vira fato: não existe fechamento com uma cartela a menos,
    // varrido o espaço inteiro a menos de simetria.
    let (piso, metodo) = match exaustao::piso(v, k, t) {
        Some(provado) if provado > piso => (provado, "exaustão".to_string()),
        _ => (piso, metodo.to_string()),
    };

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
            metodo: metodo.clone(),
            jogos: Some(total),
            provado: total as u64 == piso,
            bilhetes,
            origem: "fórmula",
            alcancado: None,
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
            metodo: metodo.clone(),
            jogos: None,
            provado: false,
            bilhetes: Vec::new(),
            origem: "acima do teto",
            alcancado: None,
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

    // A construção fechada, que agora vale em toda linha e não só na de `t = 15`.
    // É um fechamento completo pronto: onde ela sai menor que o catálogo, entra
    // no lugar dele; onde sai maior, ainda serve de partida ao motor, que é
    // outro vale para explorar além do que já estava publicado.
    let t_linha = t_linha.max(0) as usize;
    if turan::tamanho(v, a, b, t_linha, memo) <= TETO_DA_CONSTRUCAO {
        let faltas = turan::construir(&(0..v).collect::<Vec<_>>(), a, b, t_linha, memo);
        let construida: Vec<Cartela> = faltas
            .iter()
            .map(|fora| {
                Cartela::dos_indices(&(0..v).filter(|i| !fora.contains(i)).collect::<Vec<_>>())
            })
            .collect();
        if melhor.is_empty() || construida.len() < melhor.len() {
            melhor = construida;
            origem = if a <= 2 { "fórmula" } else { "construção" };
        }
    }

    // A busca por simetria, que este gerador nunca tinha chamado.
    //
    // Ela nasceu para a Lotinha e ficou lá: `gerar-catalogo` só conhecia a
    // construção fechada. Mas `montar_com_intersecao` já aceita garantia
    // parcial, e a peça estava pronta — faltava ligá-la. Medida em doze casos
    // com 90 s cada, contra o catálogo publicado, ela **ganha em seis**:
    // `22/16/14` de 932 para 748, `22/15/14` de 4.184 para 3.916, `20/16/14` de
    // 90 para 80, `21/17/14` de 71 para 63, `22/18/14` de 61 para 55 e
    // `20/15/13` de 42 para 40.
    //
    // Por que ela alcança o que a busca livre não alcança: a unidade que ela
    // move é a **órbita**, então as `v` rotações andam juntas. A busca livre
    // move uma cartela por vez, e um fechamento simétrico é um vale de onde só
    // um salto coordenado de `v` cartelas sai. Não substitui a busca livre —
    // em seis dos doze ela perde —, por isso as duas correm e vale a menor.
    //
    // E o que ela achar vira **partida** da busca livre, que pode quebrar a
    // simetria e descer abaixo do ótimo cíclico.
    if !orcamento.is_zero() {
        if let Some(ciclica) = buscar_ciclica(v, k, t, orcamento / 3) {
            if melhor.is_empty() || ciclica.len() < melhor.len() {
                melhor = ciclica;
                origem = "simetria";
            }
        }
        let achado = buscar(&problema, &melhor, orcamento - orcamento / 3);
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
            metodo: metodo.clone(),
            jogos: None,
            provado: false,
            bilhetes: Vec::new(),
            origem: if melhor.is_empty() { "sem partida" } else { "acima do teto" },
            alcancado: (!melhor.is_empty()).then(|| melhor.len()),
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
        metodo: metodo.clone(),
        jogos: Some(jogos),
        provado: jogos as u64 == piso,
        bilhetes: melhor,
        origem,
        alcancado: None,
    }
}

/// Procura no espaço das soluções invariantes por rotação.
///
/// Devolve `None` quando a instância cíclica não cabe na memória — a tabela de
/// ligações cresce com `C(v,a)/v` vezes quantos alvos cada conjunto alcança, e
/// nas garantias parciais de pool grande isso passa de bilhões. Dos 112 casos
/// acima do piso, 85 cabem no teto padrão.
///
/// O teto é do ambiente (`CATALOGO_TETO_CICLICO`) porque ele é uma decisão de
/// máquina, e não de matemática: quem tiver memória sobrando alcança mais casos.
fn buscar_ciclica(v: usize, k: usize, t: usize, orcamento: Duration) -> Option<Vec<Cartela>> {
    let (a, b) = (v - k, v - SORTEIO);
    let t_linha = (t + v).checked_sub(k + SORTEIO)?;
    if t_linha == 0 || t_linha > a.min(b) {
        return None;
    }
    let teto: usize = std::env::var("CATALOGO_TETO_CICLICO")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(120_000_000);
    // A tabela inteira quando ela cabe; uma amostra das órbitas candidatas
    // quando não cabe. Os 23 piores casos do catálogo — pool de 24 e 25 com
    // garantia parcial, folga de 5× a 6× até o piso — pediam bilhões de
    // ligações e ficavam sem simetria nenhuma. A amostra os traz para dentro:
    // ali uma órbita de cartelas sozinha já cobre quase 80% das órbitas de
    // alvo, e a solução tem cinco, então escolher cinco entre oitocentas
    // continua sendo um problema com muitas soluções.
    let inteira = InstanciaCiclica::montar_com_intersecao(v, a, b, t_linha, teto, None);

    // Duas sementes, cada uma com metade do orçamento: a busca cíclica reinicia
    // sozinha quando estanca, e trocar de semente troca o vale inteiro.
    //
    // Quando a instância é **amostrada**, a semente troca mais do que o vale:
    // troca o conjunto de candidatas, que é o que limita ali. Duas amostras
    // diferentes são dois problemas diferentes, e cada um pode ter a solução
    // que o outro não tem — enquanto duas trajetórias na mesma amostra dividem
    // o mesmo teto. Por isso a amostra se remonta a cada semente, e o custo de
    // remontar é bem gasto.
    let mut melhor: Option<Vec<Cartela>> = None;
    for semente in [7u64, 4243] {
        let inst = match &inteira {
            Some(i) => i.clone(),
            None => match InstanciaCiclica::montar_amostrado(
                v,
                a,
                b,
                t_linha,
                teto,
                20260908_u64.wrapping_add(semente),
                None,
            ) {
                Some(i) => i,
                None => return melhor,
            },
        };
        let mut busca = BuscaCiclica::nova(inst, 1, semente);
        let ate = Instant::now() + orcamento / 2;
        while Instant::now() < ate {
            busca.avancar(50);
        }
        let achado = busca.melhor_solucao();
        if achado.is_empty() {
            continue;
        }
        // Cobrança independente antes de aceitar: a solução cíclica vem de outro
        // caminho, e `cobre_tudo` é a varredura por força bruta deste arquivo.
        if !cobre_tudo(v, t, &achado) {
            continue;
        }
        if melhor.as_ref().is_none_or(|m| achado.len() < m.len()) {
            melhor = Some(achado);
        }
    }
    melhor
}

/// Põe o motor persistente para trabalhar a partir do que já houver.
///
/// Uma corrida só, com semente fixa. Chegou a ser dividida em recomeços de
/// cinco minutos com sementes diferentes, pela hipótese de que uma trajetória
/// azarada não melhora por durar mais — o próprio `motor-busca` registra uma
/// medição em que trocar a semente mudou o resultado em 28 cartelas. Medido,
/// não se sustentou: com o mesmo tempo total, do zero,
///
///     caso        1 corrida   2 recomeços   4 recomeços
///     21-15-13          117           117           117
///     22-15-13          296           294           299
///     23-15-12           83             —            88
///
/// Um empate, um ganho de 0,7% e duas perdas, de 1% e de 6%. Cada recomeço
/// devolve ao motor uma fase de aquecimento que ele já tinha pago, e num
/// orçamento de uma hora isso se repetiria doze vezes. A hipótese era razoável e
/// está errada; fica o número, e a corrida única.
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

#[cfg(test)]
mod testes_da_exaustao {
    use super::exaustao;

    /// Nenhum piso provado pode passar do que o catálogo publica.
    ///
    /// A tabela é colada à mão a partir da saída de `minimo-por-exaustao`, e um
    /// erro de digitação ali viraria uma afirmação falsa na tela: "mínimo
    /// provado 5" onde o catálogo entrega 4 seria dizer que o próprio
    /// fechamento publicado é impossível. Aqui isso reprova.
    #[test]
    fn nenhum_piso_provado_contradiz_o_catalogo() {
        let Ok(texto) = std::fs::read_to_string("catalogo/indice.json")
            .or_else(|_| std::fs::read_to_string("../../catalogo/indice.json"))
        else {
            return; // sem catálogo à mão não há o que conferir
        };
        for &(v, k, t, piso) in exaustao::PROVADOS {
            let alvo = format!("[{v},{k},{t},");
            let Some(i) = texto.find(&alvo) else { continue };
            let linha: Vec<u64> = texto[i + 1..]
                .split(']')
                .next()
                .unwrap_or("")
                .split(',')
                .filter_map(|x| x.trim().parse().ok())
                .collect();
            // `[v, k, t, piso, jogos, …]`
            if let Some(&jogos) = linha.get(4) {
                assert!(
                    piso <= jogos,
                    "({v},{k},{t}): a exaustão diz mínimo {piso}, e o catálogo publica {jogos}"
                );
            }
        }
    }

    /// A tabela não repete combinação, que seria duas verdades para o mesmo caso.
    #[test]
    fn a_tabela_nao_repete_combinacao() {
        let mut vistos = std::collections::HashSet::new();
        for &(v, k, t, _) in exaustao::PROVADOS {
            assert!(vistos.insert((v, k, t)), "({v},{k},{t}) aparece duas vezes");
        }
    }
}
