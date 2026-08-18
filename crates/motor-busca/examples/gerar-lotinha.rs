//! Gera o banco de fechamentos da Lotinha.
//!
//! A modalidade: escolhem-se de 17 a 25 dezenas entre 25, o resultado da
//! Lotofácil é a referência, e ganha-se quando as 15 sorteadas caem **todas**
//! dentro do conjunto escolhido. São 45 combinações de `(pool, tamanho do jogo)`
//! com `17 ≤ jogo ≤ pool ≤ 25`.
//!
//! Uma delas não entra no banco, e é decisão consciente: `(25,17)` termina com
//! 81.556 jogos, que ficariam em quase 2 MiB e descreveriam uma compra de
//! oitenta e um mil reais. Não é fechamento que alguém vá levar. Ali o
//! aplicativo mostra o piso conhecido e deixa o motor construir sob demanda,
//! em vez de carregar megabytes que ninguém usaria.
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
//! cargo run --release --example gerar-lotinha -- [segundos-por-caso] [pool,jogo ...]
//! ```
//!
//! Sem casos nomeados, percorre a modalidade inteira. Com eles, busca só os
//! nomeados e copia o resto do banco publicado sem tocar — o que permite dar
//! horas aos cinco casos difíceis sem gastar as mesmas horas nos quarenta que
//! já estão no melhor que se sabe alcançar:
//!
//! ```bash
//! cargo run --release --example gerar-lotinha -- 3600 24,17 24,18 25,17 25,18 25,19
//! ```

use std::collections::{BTreeMap, HashMap};
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

    // Casos nomeados na linha de comando. Vazio quer dizer "a modalidade toda".
    let so: Vec<(usize, usize)> = std::env::args()
        .skip(2)
        .filter_map(|arg| {
            let (p, j) = arg.split_once(',')?;
            Some((p.trim().parse().ok()?, j.trim().parse().ok()?))
        })
        .collect();

    println!("Banco de fechamentos da Lotinha ({segundos}s por caso em aberto)\n");
    if !so.is_empty() {
        let lista: Vec<String> = so.iter().map(|(p, j)| format!("{p},{j}")).collect();
        println!("buscando só: {}\n", lista.join(" · "));
    }
    println!(
        "{:>5} {:>5} {:>7} {:>9} {:>10} {:>12} {:>9}",
        "pool", "jogo", "piso", "partida", "final", "origem", "confere"
    );
    println!("{}", "─".repeat(64));

    // O banco que já está publicado entra como candidato a partida.
    //
    // Sem isto, regerar é uma moeda ao ar: esta execução chegou a 11.567 jogos
    // em `(23,17)` onde a anterior tinha chegado a 11.546, e gravar seria
    // publicar um retrocesso. Oferecendo o anterior ao motor, `escolher_partida`
    // compara e fica com o melhor — e regerar passa a só poder melhorar.
    let anterior = carregar_banco_anterior();
    if !anterior.is_empty() {
        println!("banco anterior: {} fechamentos entram como candidatos\n", anterior.len());
    }

    let mut banco: BTreeMap<String, Vec<Vec<usize>>> = BTreeMap::new();

    for pool in 17..=25usize {
        for jogo in 17..=pool {
            let a = pool - jogo;
            let b = pool - SORTEIO;
            let piso = melhor_piso(pool, jogo);

            // A construção por grupos é ótima como partida, mas cresce
            // rápido: em `(25,17)` ela tem 1,08 milhão de jogos. Acima do teto
            // o motor parte do próprio guloso — que nesses casos é melhor de
            // qualquer forma — em vez de gastar minutos podando o que já
            // nasceu grande demais.
            let cabe_construir = tamanho_da_construcao(pool, a, b) <= TETO_DA_CONSTRUCAO;

            let (inicial, mut origem) = if cabe_construir {
                construir(pool, jogo)
            } else {
                (Vec::new(), "guloso")
            };

            // O melhor entre a construção e o que já está publicado.
            let de_partida = match anterior.get(&format!("{pool},{jogo}")) {
                Some(guardado) if inicial.is_empty() || guardado.len() < inicial.len() => {
                    guardado.clone()
                }
                _ => inicial,
            };
            // A coluna "partida" reporta de onde o motor de fato saiu.
            let partida = de_partida.len();

            // Fora da lista, o caso não é buscado: fica exatamente o que já
            // estava publicado (ou a construção, se nada estava). Continua
            // sendo conferido e continua passando pela travessa do piso — não
            // se copia para o banco um fechamento que ninguém olhou.
            let buscar = so.is_empty() || so.contains(&(pool, jogo));
            if !buscar {
                origem = "mantido";
            }

            let final_ = if buscar && (a >= 3 || !cabe_construir) {
                melhorar(pool, jogo, &de_partida, Duration::from_secs(segundos))
            } else {
                de_partida
            };

            // O que decide a entrada no banco é o tamanho **final**, não o da
            // partida. `(23,17)` nasce com 100.947 jogos e termina com 11.546:
            // cortar pela partida jogaria fora justamente o caso em que o motor
            // mais fez diferença.
            if final_.len() > TETO_DO_BANCO {
                println!(
                    "{pool:>5} {jogo:>5} {piso:>7} {partida:>9} {:>10} {origem:>12} {:>9}",
                    final_.len(),
                    "—",
                );
                continue;
            }

            // A conferência não é formalidade: é a única coisa que separa um
            // fechamento de uma lista de números com cara de fechamento.
            let ok = cobre_tudo(pool, jogo, &final_);

            // Quando a partida foi uma construção — que já é um fechamento
            // completo — o motor nunca pode terminar pior que ela, e não cobrir
            // seria defeito. Quando ele partiu do zero, não cobrir apenas quer
            // dizer que o orçamento de tempo acabou antes: nesses casos o
            // fechamento fica de fora do banco, sem virar promessa falsa.
            if !ok && !cabe_construir {
                println!(
                    "{pool:>5} {jogo:>5} {piso:>7} {partida:>9} {:>10} {origem:>12} {:>9}",
                    final_.len(),
                    "incompleto",
                );
                continue;
            }
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

            // Guarda o **complemento**: as posições que faltam ao jogo, e não as
            // que ele tem.
            //
            // É a mesma troca de ponto de vista que dá os valores exatos da
            // modalidade, agora aplicada ao armazenamento. Um jogo de 17 dezenas
            // num pool de 23 é o complemento de 6 — guardar 6 números em vez de
            // 17 corta o arquivo em 65%, e no banco inteiro em 69%.
            //
            // Com isso cabe muito mais coisa pré-calculada no mesmo espaço, que
            // é o ponto: quanto mais estiver pronto, menos o celular precisa
            // fazer.
            banco.insert(
                format!("{pool},{jogo}"),
                final_
                    .iter()
                    .map(|c| {
                        let dentro: Vec<usize> = c.indices();
                        (0..pool).filter(|i| !dentro.contains(i)).map(|i| i + 1).collect()
                    })
                    .collect(),
            );
        }
    }

    // JSON escrito à mão: é um objeto de listas de listas, e acrescentar uma
    // dependência de serialização a um exemplo custaria mais que as dez linhas.
    //
    // O campo `formato` existe para o aplicativo saber o que está lendo. A
    // versão 1 guardava os jogos; a 2 guarda o que falta a eles.
    let mut json = String::from("{\"formato\":2,\"fechamentos\":{");
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
    json.push_str("}}");

    std::fs::write(DESTINO, &json).expect("gravar o banco");
    println!("\nescrito {DESTINO} — {:.1} KiB", json.len() as f64 / 1024.0);
}

/// Lê o banco já publicado, para que regerar nunca produza um retrocesso.
///
/// Formato: `{"pool,jogo": [[posições 1..P], ...]}`. A leitura é deliberadamente
/// simples — se o arquivo não existir ou não for legível, devolve vazio e a
/// geração segue como se fosse a primeira.
fn carregar_banco_anterior() -> BTreeMap<String, Vec<Cartela>> {
    let Ok(texto) = std::fs::read_to_string(DESTINO) else {
        return BTreeMap::new();
    };

    // O formato 2 guarda complementos; o 1 guardava os jogos. Ler os dois
    // permite regerar em cima de um banco antigo sem perder o que ele tem.
    let complementos = texto.contains("\"formato\":2");

    let mut saida = BTreeMap::new();
    // Cada entrada é `"P,k":[[..],[..]]`. Fatiar pelo padrão da chave evita
    // trazer um interpretador de JSON para dentro de um exemplo.
    for pedaco in texto.split("\"").skip(1).collect::<Vec<_>>().chunks(2) {
        let [chave, resto] = pedaco else { continue };
        if !chave.contains(',') {
            continue;
        }
        let Some((pool_txt, _)) = chave.split_once(',') else { continue };
        let Ok(pool): Result<usize, _> = pool_txt.parse() else { continue };
        let Some(inicio) = resto.find('[') else { continue };
        let Some(fim) = resto.rfind(']') else { continue };
        let corpo = &resto[inicio + 1..fim];

        let jogos: Vec<Cartela> = corpo
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
                    let dentro: Vec<usize> =
                        (0..pool).filter(|i| !numeros.contains(i)).collect();
                    Some(Cartela::dos_indices(&dentro))
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

/// Acima disto o fechamento não entra no banco embutido.
///
/// Guardando complementos, o banco inteiro dá 1,6 MiB de JSON que viajam em
/// 316 KiB comprimidos — menos que o WebAssembly do motor, e o navegador só
/// baixa uma vez. Com este teto, 44 das 45 combinações da modalidade ficam
/// prontas de fábrica.
///
/// A que sobra é `(25,17)`, com 81.556 jogos. Ela ficaria em quase 2 MiB, e
/// descreve uma compra de oitenta e um mil reais — não é fechamento que alguém
/// vá levar. Ali a fórmula e o motor continuam disponíveis sob demanda.
///
/// O teto é aplicado ao resultado **final**, depois de o motor ter feito o que
/// podia: `(24,18)` nasce com 134.596 jogos da construção e termina com 7.400.
const TETO_DO_BANCO: usize = 40_000;

/// Acima disto nem vale construir a partida por grupos.
///
/// Podar um milhão de cartelas custa minutos e quase sempre perde para o
/// guloso do próprio motor, que já nasce enxuto. O teto é generoso de
/// propósito: uma cartela é uma máscara de bits, então mesmo centenas de
/// milhares delas cabem de sobra na memória.
const TETO_DA_CONSTRUCAO: usize = 400_000;

/// Quantos jogos a construção de partida produziria, sem construí-la.
///
/// Precisa ser calculado antes: materializar 1,08 milhão de cartelas só para
/// medir e jogar fora consumiria memória à toa.
fn tamanho_da_construcao(pool: usize, a: usize, b: usize) -> usize {
    match a {
        0 => 1,
        1 => 16,
        _ => turan_tamanho(pool, a, b, &mut HashMap::new()).min(usize::MAX as u64) as usize,
    }
}

/// O melhor piso conhecido para `(pool, jogo)` nesta modalidade.
///
/// Serve para duas coisas: como travessa de segurança — nada gerado aqui pode
/// ficar abaixo dele, e um fechamento que fique é erro, não recorde — e como
/// referência do quanto ainda há a ganhar.
///
/// São dois argumentos independentes, e vale o mais forte:
///
/// - **contagem** — cada jogo cobre `C(k,15)` dos `C(P,15)` sorteios;
/// - **Schönheim** — `L(v,k,t) = ⌈(v/k)·L(v−1,k−1,t−1)⌉`, a mesma que o motor
///   usa.
///
/// Usar só a contagem, como antes, deixava a travessa baixa demais para servir
/// de travessa: nas 15 combinações desta modalidade em que o mínimo verdadeiro
/// é conhecido, Schönheim acerta as 15 e a contagem fica de 76% a 433% abaixo.
/// Em `(23,17)` são 3.996 contra 3.606 — quase quatrocentos jogos de folga em
/// que um defeito de cobertura passaria sem ser notado.
fn melhor_piso(pool: usize, jogo: usize) -> usize {
    let por_contagem = binomial(pool, SORTEIO).div_ceil(binomial(jogo, SORTEIO)) as usize;
    let por_schonheim = motor_core::limites::schonheim(pool, jogo, SORTEIO) as usize;
    por_contagem.max(por_schonheim)
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
        _ => {
            // O que falta a cada jogo, pela melhor das construções fechadas.
            let pontos: Vec<usize> = (0..pool).collect();
            let faltas = turan_construir(&pontos, a, b, &mut HashMap::new());
            let jogos = faltas
                .iter()
                .map(|fora| {
                    Cartela::dos_indices(
                        &(0..pool).filter(|i| !fora.contains(i)).collect::<Vec<_>>(),
                    )
                })
                .collect();
            (jogos, if a == 2 { "exato" } else { "fórmula" })
        }
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

/// Impossível: não existe família que sirva. Longe do topo de `u64` para que
/// somas com este valor não estourem.
const INVIAVEL: u64 = u64::MAX / 4;

/// Quantos `a`-subconjuntos de `[v]` bastam para que todo `b`-subconjunto
/// contenha um deles — pela melhor construção fechada que este programa conhece.
///
/// É o problema de Turán, na forma complementar em que a modalidade vive: um
/// jogo de `k` dezenas é o complemento de `a = P − k`, um sorteio de 15 é o
/// complemento de `b = P − 15`, e *o jogo contém o sorteio* ⟺ *as `a` que
/// faltam ao jogo estão entre as `b` que faltam ao sorteio*.
///
/// Três argumentos disputam, e vale o menor:
///
/// 1. **tudo** — todos os `C(v,a)` subconjuntos. Sempre serve, quase sempre é
///    desperdício.
/// 2. **por um ponto** — escolha `x`. Os `b`-conjuntos que não contêm `x` são
///    `b`-conjuntos de `[v]∖{x}`; os que contêm `x` viram `(b−1)`-conjuntos de
///    `[v]∖{x}` que precisam conter um `(a−1)`-conjunto, ao qual se junta `x`.
///    Daí `N(v,a,b) ≤ N(v−1,a,b) + N(v−1,a−1,b−1)`.
/// 3. **por grupos** — parta `[v]` em `g` partes. Um `b`-conjunto deixa
///    `⌈b/g⌉` elementos em alguma parte pela casa dos pombos, então basta que
///    cada parte carregue uma família boa para `⌈b/g⌉` no lugar de `b`. Com
///    `⌈b/g⌉ = a` isto vira "todos os `a`-subconjuntos de cada grupo", que é a
///    construção que o programa usava sozinha.
///
/// O ganho de somar as três não é pequeno. Em 25 dezenas com jogos de 19 a
/// construção por grupos pede 177.100 jogos; esta pede 6.072 — vinte e nove
/// vezes menos, e sem busca nenhuma.
fn turan_tamanho(v: usize, a: usize, b: usize, memo: &mut HashMap<(usize, usize, usize), u64>) -> u64 {
    if a > b || b > v {
        return INVIAVEL;
    }
    if a == 0 || v == b {
        return 1;
    }
    if a == b {
        return binomial(v, b);
    }
    if a == 1 {
        return (v - b + 1) as u64;
    }
    if let Some(&pronto) = memo.get(&(v, a, b)) {
        return pronto;
    }

    let mut melhor = binomial(v, a);

    let por_ponto = turan_tamanho(v - 1, a, b, memo)
        .saturating_add(turan_tamanho(v - 1, a - 1, b - 1, memo));
    melhor = melhor.min(por_ponto);

    for g in 2..=b {
        let alvo = b.div_ceil(g);
        if alvo < a {
            break; // partir mais só afrouxa a casa dos pombos
        }
        let mut total = 0u64;
        for i in 0..g {
            let tam = v / g + usize::from(i < v % g);
            total = total.saturating_add(turan_tamanho(tam, a, alvo, memo));
            if total >= melhor {
                break;
            }
        }
        melhor = melhor.min(total);
    }

    memo.insert((v, a, b), melhor);
    melhor
}

/// A família que [`turan_tamanho`] contou, agora materializada.
///
/// Repete exatamente as mesmas escolhas: mede as três alternativas e constrói a
/// vencedora. Construir sem medir antes seria arriscar materializar a opção
/// grande de um ramo que a medida descartaria.
fn turan_construir(
    pontos: &[usize],
    a: usize,
    b: usize,
    memo: &mut HashMap<(usize, usize, usize), u64>,
) -> Vec<Vec<usize>> {
    let v = pontos.len();
    debug_assert!(a <= b && b <= v);

    if a == 0 {
        return vec![Vec::new()];
    }
    if v == b {
        return vec![pontos[..a].to_vec()];
    }
    if a == b {
        return combinacoes(pontos, a);
    }
    if a == 1 {
        return pontos[..v - b + 1].iter().map(|&p| vec![p]).collect();
    }

    let alvo = turan_tamanho(v, a, b, memo);

    if alvo == binomial(v, a) {
        return combinacoes(pontos, a);
    }

    let por_ponto = turan_tamanho(v - 1, a, b, memo)
        .saturating_add(turan_tamanho(v - 1, a - 1, b - 1, memo));
    if alvo == por_ponto {
        let x = pontos[0];
        let resto = &pontos[1..];
        let mut saida = turan_construir(resto, a, b, memo);
        for mut menor in turan_construir(resto, a - 1, b - 1, memo) {
            menor.push(x);
            menor.sort_unstable();
            saida.push(menor);
        }
        return saida;
    }

    for g in 2..=b {
        let alvo_do_grupo = b.div_ceil(g);
        if alvo_do_grupo < a {
            break;
        }
        let mut partes: Vec<Vec<usize>> = vec![Vec::new(); g];
        for (i, &p) in pontos.iter().enumerate() {
            partes[i % g].push(p);
        }
        let total: u64 = partes
            .iter()
            .map(|parte| turan_tamanho(parte.len(), a, alvo_do_grupo, memo))
            .fold(0u64, |acc, n| acc.saturating_add(n));
        if total == alvo {
            let mut saida = Vec::new();
            for parte in &partes {
                saida.extend(turan_construir(parte, a, alvo_do_grupo, memo));
            }
            return saida;
        }
    }

    // Nenhum ramo empatou com a medida — só pode ser erro de programação, e
    // devolver a família trivial esconderia o defeito atrás de um resultado
    // grande porém correto.
    unreachable!("a medida de Turán não bateu com nenhuma construção em ({v}, {a}, {b})");
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

    // Sem semente, qualquer coisa que o motor tenha achado é melhor que nada —
    // comparar com o tamanho de `inicial` daria zero, e devolver zero é
    // devolver um fechamento vazio que reprovaria na conferência seguinte por
    // um motivo enganoso.
    if inicial.is_empty() {
        return achado;
    }

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
