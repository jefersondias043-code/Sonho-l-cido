//! Ataque dedicado a **uma** combinação, com a incidência pré-calculada.
//!
//! ```bash
//! cargo run --release --example atacar -- <pool> <jogo> <alvo> <segundos> [semente]
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
}

impl Estado {
    fn vazio(t: &Terreno) -> Self {
        Self {
            selecionadas: Vec::new(),
            esta_dentro: vec![false; t.candidatos()],
            contagem: vec![0; t.total_alvos],
            descobertos: ConjuntoEsparso::completo(t.total_alvos),
        }
    }

    fn por(&mut self, t: &Terreno, cartela: usize) {
        for &alvo in t.alvos_de(cartela) {
            let c = &mut self.contagem[alvo as usize];
            *c += 1;
            if *c == 1 {
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
            if *c == 0 {
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
) -> Option<Vec<usize>> {
    const HISTORIA: usize = 4096;

    let mut e = Estado::vazio(t);
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

fn main() {
    let arg = |i: usize, padrao: usize| -> usize {
        std::env::args().nth(i).and_then(|v| v.parse().ok()).unwrap_or(padrao)
    };
    let pool = arg(1, 23);
    let jogo = arg(2, 20);
    let partir_de = arg(3, 102);
    let segundos = arg(4, 600) as u64;
    let semente = arg(5, 1) as u64;

    let t = Terreno::novo(pool, jogo);
    let mut rng = Pcg64Mcg::seed_from_u64(semente);

    // A partida sai do banco publicado, quando ele traz esta combinação: é o
    // melhor que se conhece, e partir de qualquer outra coisa seria jogar fora
    // o trabalho de todas as execuções anteriores. Sem banco, um guloso serve.
    let mut melhor = do_banco(&t).unwrap_or_else(|| {
        let mut e = Estado::vazio(&t);
        let mut candidatas = Vec::new();
        while !e.descobertos.is_empty() {
            let d = e.descobertos.em(rng.gen_range(0..e.descobertos.len())).unwrap();
            t.cartelas_do_alvo(d, &mut candidatas);
            let escolhida = *candidatas
                .iter()
                .filter(|&&c| !e.esta_dentro[c])
                .max_by_key(|&&c| {
                    t.alvos_de(c).iter().filter(|&&a| e.contagem[a as usize] == 0).count()
                })
                .expect("todo alvo descoberto tem cartela que o atende");
            e.por(&t, escolhida);
        }
        e.selecionadas.clone()
    });
    eprintln!("partida: {} cartelas", melhor.len());

    let comeco = Instant::now();
    let total = Duration::from_secs(segundos);
    let mut alvo = melhor.len().min(partir_de + 1).saturating_sub(1).max(1);

    while comeco.elapsed() < total && alvo > 1 {
        let sobra = total.saturating_sub(comeco.elapsed());
        match atacar(&t, &melhor, alvo, sobra, &mut rng) {
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
        format!("/tmp/atacar-{pool}-{jogo}-{semente}.json"),
        format!("{elementos:?}").replace(' ', ""),
    )
    .ok();

    // A prova: nenhum sorteio pode ficar de fora.
    let mut confere = vec![0u8; t.total_alvos];
    for &c in &melhor {
        for &a in t.alvos_de(c) {
            confere[a as usize] = 1;
        }
    }
    let descobertos = confere.iter().filter(|&&v| v == 0).count();
    println!("conferência independente: {descobertos} sorteios descobertos de {}", t.total_alvos);
    assert_eq!(descobertos, 0, "a solução não cobre tudo");
}
