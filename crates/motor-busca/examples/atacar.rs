//! Ataque dedicado a **uma** combinação, com a incidência pré-calculada.
//!
//! ```bash
//! cargo run --release --example atacar -- <pool> <jogo> <alvo> <segundos> [semente] [premiadas]
//! ```
//!
//! ## Por que existe, se já há um motor
//!
//! O motor é geral: resolve qualquer `C(v,k,t)` e por isso calcula os alvos de
//! uma cartela **na hora**, enumerando combinações e ranqueando em colex. É a
//! escolha certa para um aplicativo que aceita qualquer configuração, e é o que
//! o torna lento onde a configuração é pequena e conhecida.
//!
//! Aqui a configuração é uma só, e cabe pré-calcular tudo:
//!
//! - **a incidência** — para cada uma das `C(p,k)` cartelas possíveis, a lista
//!   dos alvos que ela atende, como inteiros. Em 23 dezenas com jogos de 20 são
//!   1.771 × 15.504 índices, 110 MiB, e uma troca vira uma varredura linear em
//!   vez de uma enumeração;
//! - **a contagem em `u8`** — um alvo é atendido por no máximo `C(p−15, k−15)`
//!   cartelas (56, aqui), então um byte basta. Os 490.314 alvos ocupam 479 KiB
//!   e **cabem na cache L2**, que é a diferença entre uma escrita de 1 ns e uma
//!   de 80 ns.
//!
//! Medido em 23/20: o motor geral faz ~360 trocas por segundo; isto faz dezenas
//! de milhares.
//!
//! ## O que ele procura
//!
//! Fixa `alvo` cartelas e minimiza os sorteios descobertos, com aceitação
//! tardia. Fechar em `alvo` significa que aquele tamanho basta — e aí tenta
//! `alvo − 1`. É o método de Nurmela e Östergård, com o laço quente escrito
//! para esta instância.
//!
//! `premiadas` exige que **`r` cartelas** contenham cada sorteio, e não apenas
//! uma. Muda uma linha do laço — descoberto passa a ser `contagem < r` — e nada
//! mais: a incidência é a mesma, e a contagem em `u8` continua bastando porque
//! o teto por alvo não depende de `r`.

use std::time::{Duration, Instant};

use motor_core::combinatoria::{indice_colex, iniciar_combinacao, proxima_combinacao, Binomiais};
use motor_core::conjunto::ConjuntoEsparso;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

const SORTEIO: usize = 15;

/// Tudo que não muda durante a busca.
struct Terreno {
    pool: usize,
    jogo: usize,
    total_alvos: usize,
    /// Índices dos alvos de cada cartela, concatenados **na ordem colex das
    /// cartelas**: os alvos da cartela `i` ocupam `i·por_cartela` em diante.
    ///
    /// Indexar por colex, e não pela ordem em que a enumeração as produz, é o
    /// que permite ir de um conjunto de dezenas ao seu bloco sem procurar. As
    /// duas ordens **não** coincidem — a enumeração é lexicográfica — e
    /// confundi-las dá uma tabela em que cada cartela aponta para os alvos de
    /// outra, com aparência perfeitamente normal.
    incidencia: Vec<u32>,
    /// Quantos alvos cada cartela atende: `C(k,15)`, igual para todas.
    por_cartela: usize,
    binom: Binomiais,
    candidatos: usize,
}

impl Terreno {
    fn novo(pool: usize, jogo: usize) -> Self {
        let binom = Binomiais::novo(pool, pool);
        let total_alvos = binom.c(pool, SORTEIO) as usize;
        let candidatos = binom.c(pool, jogo) as usize;
        let por_cartela = binom.c(jogo, SORTEIO) as usize;

        eprintln!(
            "terreno: {candidatos} cartelas possíveis, {total_alvos} sorteios, \
             {por_cartela} sorteios por cartela ({:.0} MiB de incidência)",
            (candidatos * por_cartela * 4) as f64 / 1_048_576.0
        );

        let mut incidencia = vec![0u32; candidatos * por_cartela];

        let mut cartela = Vec::new();
        iniciar_combinacao(jogo, &mut cartela);
        let mut dentro = Vec::new();
        loop {
            let onde = indice_colex(&binom, &cartela) as usize * por_cartela;
            let mut escrita = onde;

            // Os alvos de uma cartela são os `SORTEIO`-subconjuntos dela.
            iniciar_combinacao(SORTEIO, &mut dentro);
            loop {
                let alvo: Vec<usize> = dentro.iter().map(|&i| cartela[i]).collect();
                incidencia[escrita] = indice_colex(&binom, &alvo) as u32;
                escrita += 1;
                if !proxima_combinacao(jogo, SORTEIO, &mut dentro) {
                    break;
                }
            }
            debug_assert_eq!(escrita - onde, por_cartela);

            if !proxima_combinacao(pool, jogo, &mut cartela) {
                break;
            }
        }

        Self { pool, jogo, total_alvos, incidencia, por_cartela, binom, candidatos }
    }

    fn candidatos(&self) -> usize {
        self.candidatos
    }

    fn alvos_de(&self, cartela: usize) -> &[u32] {
        let onde = cartela * self.por_cartela;
        &self.incidencia[onde..onde + self.por_cartela]
    }

    /// O índice da cartela formada por estes elementos do pool.
    fn indice_da_cartela(&self, elementos: &[usize]) -> usize {
        indice_colex(&self.binom, elementos) as usize
    }

    /// As cartelas que atendem este alvo: acrescentam `jogo − 15` elementos de
    /// fora dele. São `C(p−15, k−15)` — 56 em 23/20.
    fn cartelas_do_alvo(&self, alvo: u32, saida: &mut Vec<usize>) {
        saida.clear();
        let mut elementos = Vec::with_capacity(SORTEIO);
        motor_core::combinatoria::subconjunto_do_indice(
            &self.binom,
            alvo as u64,
            SORTEIO,
            &mut elementos,
        );
        let fora: Vec<usize> =
            (0..self.pool).filter(|e| !elementos.contains(e)).collect();

        let extras = self.jogo - SORTEIO;
        let mut escolha = Vec::new();
        iniciar_combinacao(extras, &mut escolha);
        loop {
            let mut cartela = elementos.clone();
            cartela.extend(escolha.iter().map(|&i| fora[i]));
            cartela.sort_unstable();
            saida.push(self.indice_da_cartela(&cartela));
            if !proxima_combinacao(fora.len(), extras, &mut escolha) {
                break;
            }
        }
    }
}

/// A solução em construção, com a contabilidade que torna a troca barata.
struct Estado {
    selecionadas: Vec<usize>,
    esta_dentro: Vec<bool>,
    contagem: Vec<u8>,
    descobertos: ConjuntoEsparso,
    /// Quantas cartelas cada sorteio precisa ter para contar como atendido.
    exigido: u8,
}

impl Estado {
    fn vazio(t: &Terreno, exigido: u8) -> Self {
        Self {
            selecionadas: Vec::new(),
            esta_dentro: vec![false; t.candidatos()],
            contagem: vec![0; t.total_alvos],
            descobertos: ConjuntoEsparso::completo(t.total_alvos),
            exigido,
        }
    }

    fn por(&mut self, t: &Terreno, cartela: usize) {
        for &alvo in t.alvos_de(cartela) {
            let c = &mut self.contagem[alvo as usize];
            *c += 1;
            if *c == self.exigido {
                self.descobertos.remover(alvo);
            }
        }
        self.esta_dentro[cartela] = true;
        self.selecionadas.push(cartela);
    }

    fn tira(&mut self, t: &Terreno, posicao: usize) -> usize {
        let cartela = self.selecionadas.swap_remove(posicao);
        for &alvo in t.alvos_de(cartela) {
            let c = &mut self.contagem[alvo as usize];
            *c -= 1;
            if *c + 1 == self.exigido {
                self.descobertos.inserir(alvo);
            }
        }
        self.esta_dentro[cartela] = false;
        cartela
    }

    fn custo(&self) -> usize {
        self.descobertos.len()
    }
}

/// Recozimento com aceitação tardia, no tamanho fixo `alvo`.
fn atacar(
    t: &Terreno,
    inicial: &[usize],
    alvo: usize,
    orcamento: Duration,
    rng: &mut impl Rng,
    exigido: u8,
) -> Option<Vec<usize>> {
    const HISTORIA: usize = 4096;

    let mut e = Estado::vazio(t, exigido);
    for &c in inicial.iter().take(alvo) {
        e.por(t, c);
    }
    while e.selecionadas.len() < alvo {
        let c = rng.gen_range(0..t.candidatos());
        if !e.esta_dentro[c] {
            e.por(t, c);
        }
    }

    let mut custo = e.custo();
    let mut historia = vec![custo; HISTORIA];
    let mut passo = 0usize;
    let mut candidatas = Vec::new();
    let comeco = Instant::now();
    let mut trocas = 0u64;

    while custo > 0 {
        if passo % 512 == 0 && comeco.elapsed() >= orcamento {
            eprintln!(
                "   n={alvo}: parou com {custo} descobertos ({trocas} trocas, {:.0}/s)",
                trocas as f64 / comeco.elapsed().as_secs_f64().max(1e-9)
            );
            return None;
        }
        passo = passo.wrapping_add(1);
        trocas += 1;

        // Um sorteio descoberto guia o movimento: a cartela que entra tem de
        // atendê-lo, senão a troca é ruído.
        let d = e.descobertos.em(rng.gen_range(0..e.descobertos.len()))?;
        t.cartelas_do_alvo(d, &mut candidatas);
        let entra = *candidatas
            .iter()
            .filter(|&&c| !e.esta_dentro[c])
            .nth(rng.gen_range(0..candidatas.iter().filter(|&&c| !e.esta_dentro[c]).count().max(1)))
            .unwrap_or(&candidatas[0]);
        if e.esta_dentro[entra] {
            continue;
        }

        let posicao = rng.gen_range(0..e.selecionadas.len());
        let sai = e.tira(t, posicao);
        e.por(t, entra);

        let depois = e.custo();
        if depois <= custo || depois <= historia[passo % HISTORIA] {
            custo = depois;
        } else {
            let ultima = e.selecionadas.len() - 1;
            e.tira(t, ultima);
            e.por(t, sai);
        }
        historia[passo % HISTORIA] = custo;
    }

    eprintln!(
        "   n={alvo}: FECHOU em {:.1}s ({trocas} trocas)",
        comeco.elapsed().as_secs_f64()
    );
    Some(e.selecionadas.clone())
}

/// O fechamento publicado para esta combinação, se houver, em índices de
/// cartela.
///
/// O banco guarda o **complemento** — as posições que faltam ao jogo — e em
/// base 1. Aqui tudo é base 0 e o jogo inteiro, então a leitura converte os
/// dois de uma vez.
fn do_banco(t: &Terreno) -> Option<Vec<usize>> {
    let texto = std::fs::read_to_string("web/lotinha.json").ok()?;
    let complementos = texto.contains("\"formato\":2");
    let chave = format!("\"{},{}\"", t.pool, t.jogo);
    let inicio = texto.find(&chave)? + chave.len();
    let resto = &texto[inicio..];
    let abre = resto.find('[')?;
    let fecha = resto[abre..].find("]]")? + abre + 2;

    let mut saida = Vec::new();
    for linha in resto[abre + 1..fecha].split('[').skip(1) {
        let numeros: Vec<usize> = linha
            .split(']')
            .next()?
            .split(',')
            .filter_map(|n| n.trim().parse::<usize>().ok())
            .map(|n| n - 1)
            .collect();
        let jogo: Vec<usize> = if complementos {
            (0..t.pool).filter(|i| !numeros.contains(i)).collect()
        } else {
            numeros
        };
        if jogo.len() == t.jogo {
            saida.push(t.indice_da_cartela(&jogo));
        }
    }
    (!saida.is_empty()).then_some(saida)
}

/// Completa o fechamento pelo guloso global, com fila preguiçosa.
///
/// A cada passo entra a cartela que atende mais alvos ainda em falta. As notas
/// só caem — nenhuma cartela fica melhor porque outra entrou —, então uma nota
/// vencida sempre **superestima**: recalcular ao desempilhar e devolver à fila
/// quando a nota cai acha o verdadeiro melhor sem revarrer as cem mil
/// candidatas a cada passo.
///
/// Diferente do guloso que sorteia um alvo em falta e escolhe entre as poucas
/// cartelas que o atendem, este olha o tabuleiro inteiro. Em 23/17 com duas
/// cartelas premiadas isso é a diferença entre juntar cartelas que se repetem e
/// juntar cartelas que se completam.
fn preencher_guloso(t: &Terreno, e: &mut Estado) {
    let exigido = e.exigido;
    let nota = |e: &Estado, c: usize| {
        t.alvos_de(c).iter().filter(|&&a| e.contagem[a as usize] < exigido).count()
    };
    let mut fila: std::collections::BinaryHeap<(usize, usize)> = (0..t.candidatos())
        .filter(|&c| !e.esta_dentro[c])
        .map(|c| (nota(e, c), c))
        .collect();

    while !e.descobertos.is_empty() {
        let (chave, c) = fila.pop().expect("alvo em falta sem cartela que o atenda");
        if e.esta_dentro[c] {
            continue;
        }
        let agora = nota(e, c);
        // Nota zerada é definitiva, porque as notas nunca sobem: a candidata
        // morreu e sai da fila. Devolvê-la em vez de descartar já fez esta
        // busca girar sem sair do lugar.
        if agora == 0 {
            continue;
        }
        if agora < chave {
            fila.push((agora, c));
            continue;
        }
        e.por(t, c);
    }
}

/// Tira as cartelas que não fazem falta, e devolve quantas saíram.
///
/// O guloso acrescenta uma cartela para tapar um buraco e, passos adiante,
/// outra cobre o mesmo alvo por tabela. A primeira vira peso morto. Uma cartela
/// sai quando **todos** os seus alvos sobram — contagem estritamente acima do
/// exigido —, e aí a garantia fica exatamente onde estava.
fn podar(t: &Terreno, e: &mut Estado) -> usize {
    let mut tirou = 0;
    loop {
        let antes = tirou;
        let mut i = 0;
        while i < e.selecionadas.len() {
            let c = e.selecionadas[i];
            if t.alvos_de(c).iter().all(|&a| e.contagem[a as usize] > e.exigido) {
                // `tira` troca a última para esta posição: não avançar `i`.
                e.tira(t, i);
                tirou += 1;
            } else {
                i += 1;
            }
        }
        if tirou == antes {
            return tirou;
        }
    }
}

/// Um fechamento guardado sozinho num arquivo, como `[[1,2,...],[...]]`, em
/// base 1 e com o jogo inteiro (não o complemento). Cartelas de outro tamanho
/// são ignoradas, o que faz um arquivo de outra combinação passar sem quebrar.
fn de_arquivo(t: &Terreno, caminho: &str) -> Option<Vec<usize>> {
    let texto = std::fs::read_to_string(caminho).ok()?;
    let mut saida = Vec::new();
    for linha in texto.split('[').skip(2) {
        let numeros: Vec<usize> = linha
            .split(']')
            .next()?
            .split(',')
            .filter_map(|n| n.trim().parse::<usize>().ok())
            .map(|n| n - 1)
            .collect();
        if numeros.len() == t.jogo {
            saida.push(t.indice_da_cartela(&numeros));
        }
    }
    eprintln!("semente de {caminho}: {} cartelas", saida.len());
    (!saida.is_empty()).then_some(saida)
}

fn main() {
    let arg = |i: usize, padrao: usize| -> usize {
        std::env::args().nth(i).and_then(|v| v.parse().ok()).unwrap_or(padrao)
    };
    let pool = arg(1, 23);
    let jogo = arg(2, 20);
    let partir_de = arg(3, 102);
    let segundos = arg(4, 600) as u64;
    let semente = arg(5, 1) as u64;
    // Quantas cartelas premiadas o fechamento garante. `1` é a cobertura de
    // sempre; `2` pede que **duas** cartelas contenham cada sorteio.
    let premiadas = arg(6, 1).max(1) as u8;

    let t = Terreno::novo(pool, jogo);
    eprintln!("garantia: {premiadas} cartela(s) premiada(s) por sorteio");
    let mut rng = Pcg64Mcg::seed_from_u64(semente);

    // A partida sai do banco publicado, quando ele traz esta combinação: é o
    // melhor que se conhece, e partir de qualquer outra coisa seria jogar fora
    // o trabalho de todas as execuções anteriores.
    //
    // Com `premiadas > 1` o banco **não** é solução — ele cobre cada sorteio
    // uma vez só. Serve mesmo assim como semente: o guloso entra depois e
    // completa até a garantia pedida. Quando `premiadas == 1` e o banco já
    // fecha, o guloso não acrescenta nada e a partida é o próprio banco.
    let mut e = Estado::vazio(&t, premiadas);
    // `ATACAR_SEMENTE` aponta para um arquivo de fechamento e tem precedência
    // sobre o banco: é por onde entra uma construção feita à mão — um
    // agrupamento, por exemplo — que já começa melhor do que o guloso chegaria.
    let semeadura = std::env::var("ATACAR_SEMENTE")
        .ok()
        .and_then(|caminho| de_arquivo(&t, &caminho))
        .or_else(|| do_banco(&t));
    if let Some(banco) = semeadura {
        for c in banco {
            if !e.esta_dentro[c] {
                e.por(&t, c);
            }
        }
        eprintln!("semente: {} cartelas aproveitadas", e.selecionadas.len());
    }
    preencher_guloso(&t, &mut e);
    let podadas = podar(&t, &mut e);
    let mut melhor = e.selecionadas.clone();
    drop(e);
    eprintln!("partida: {} cartelas ({podadas} podadas)", melhor.len());

    let comeco = Instant::now();
    let total = Duration::from_secs(segundos);
    // `partir_de = 0` significa "comece de onde a partida chegou".
    let teto = if partir_de == 0 { melhor.len() } else { melhor.len().min(partir_de + 1) };
    let mut alvo = teto.saturating_sub(1).max(1);

    while comeco.elapsed() < total && alvo > 1 {
        let sobra = total.saturating_sub(comeco.elapsed());
        match atacar(&t, &melhor, alvo, sobra, &mut rng, premiadas) {
            Some(nova) => {
                melhor = nova;
                println!("RECORDE {pool}/{jogo}: {alvo} cartelas");
                alvo -= 1;
            }
            None => break,
        }
    }

    println!("melhor de {pool}/{jogo} nesta execução: {} cartelas", melhor.len());
    let elementos: Vec<Vec<usize>> = melhor
        .iter()
        .map(|&c| {
            let mut v = Vec::new();
            motor_core::combinatoria::subconjunto_do_indice(&t.binom, c as u64, t.jogo, &mut v);
            v.iter().map(|x| x + 1).collect()
        })
        .collect();
    std::fs::write(
        format!("/tmp/atacar-{pool}-{jogo}-r{premiadas}-{semente}.json"),
        format!("{elementos:?}").replace(' ', ""),
    )
    .ok();

    // A prova: todo sorteio precisa de `premiadas` cartelas, e a contagem é
    // refeita do zero, sem reaproveitar nada do que a busca manteve.
    let mut confere = vec![0u8; t.total_alvos];
    for &c in &melhor {
        for &a in t.alvos_de(c) {
            confere[a as usize] = confere[a as usize].saturating_add(1);
        }
    }
    let faltando = confere.iter().filter(|&&v| v < premiadas).count();
    let minimo = confere.iter().copied().min().unwrap_or(0);
    println!(
        "conferência independente: {faltando} sorteios com menos de {premiadas} cartelas \
         (o pior tem {minimo}) de {}",
        t.total_alvos
    );
    assert_eq!(faltando, 0, "a solução não entrega a garantia pedida");
}
