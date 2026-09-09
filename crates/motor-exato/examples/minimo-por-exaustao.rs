//! **O mínimo, provado por exaustão** — e não estimado por cota.
//!
//! ```bash
//! cargo run --release --example minimo-por-exaustao -p motor-exato -- v-k-t:n ...
//! ```
//!
//! O `piso` do índice é uma **cota inferior**: diz que nada menor existe, não
//! que aquele tamanho exista. Em covering designs essas cotas são notoriamente
//! frouxas — em `25/18/13` a de contagem dá 17 porque 3.268.760 ÷ 202.164 =
//! 16,17, e alcançá-la exigiria dezessete cartelas se sobrepondo em 95% do que
//! cobrem. A folga que o índice mostra ali não é fechamento esperando ser
//! achado: é a cota sendo fraca.
//!
//! Este programa responde a outra pergunta, e a resposta dele é definitiva:
//! **existe algum fechamento com `n` cartelas?** Varre o espaço inteiro. Se
//! achar, devolve o fechamento — e é um fechamento menor que o publicado. Se
//! não achar, provou que `n` é impossível, e o mínimo passa a ser `n+1`.
//!
//! ## As duas reduções que tornam a varredura possível
//!
//! **Enumerar famílias a menos de simetria.** O problema é invariante por
//! qualquer permutação das `v` dezenas. Fixada uma família parcial, as dezenas
//! se repartem em **blocos** pela assinatura de pertinência — quem está em
//! quais cartelas. Duas cartelas novas que tomem a mesma quantidade de cada
//! bloco são equivalentes por uma permutação que fixa tudo o que já foi
//! escolhido. Então a próxima cartela não se escolhe entre `C(v,k)` conjuntos:
//! escolhe-se entre as maneiras de repartir `k` pelos blocos, que são poucas.
//! A primeira cartela, com um bloco só, é única.
//!
//! É completo, por indução: se uma permutação leva as `i` primeiras cartelas de
//! uma família qualquer às representantes daqui, alguma permutação do
//! estabilizador dessas `i` — que não mexe nelas — leva a `(i+1)`-ésima à
//! representante dela.
//!
//! **Conferir a cobertura sem olhar sorteio nenhum.** Um sorteio `S` cruza uma
//! cartela `B` em `|B ∩ S|`, e cada bloco está inteiro dentro de `B` ou inteiro
//! fora. Logo `|B ∩ S|` só depende de **quantas** dezenas `S` toma de cada
//! bloco. Em vez dos `C(25,15) = 3.268.760` sorteios, enumeram-se os vetores de
//! contagem sobre os blocos — alguns milhares —, e cada um carrega quantos
//! sorteios reais representa, que é o produto dos binomiais.
//!
//! ## A poda
//!
//! Com os sorteios descobertos contados de graça, a cota de contagem entra a
//! cada nó: se o que falta descobrir não cabe nas cartelas que ainda restam, o
//! ramo morre sem ser visitado.
use std::collections::HashMap;
use std::time::Instant;

const SORTEIO: u32 = 15;

fn binomial(n: u64, k: u64) -> u64 {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    let mut total: u128 = 1;
    for i in 0..k {
        total = total * u128::from(n - i) / u128::from(i + 1);
    }
    total as u64
}

/// Um bloco: as dezenas com a mesma assinatura de pertinência, e a assinatura.
struct Bloco {
    dezenas: Vec<u32>,
    /// Bit `i` ligado quando a cartela `i` da família contém estas dezenas.
    em: u32,
}

fn blocos(familia: &[u32], v: u32) -> Vec<Bloco> {
    let mut mapa: HashMap<u32, Vec<u32>> = HashMap::new();
    for x in 0..v {
        let mut em = 0u32;
        for (i, &b) in familia.iter().enumerate() {
            if b & (1 << x) != 0 {
                em |= 1 << i;
            }
        }
        mapa.entry(em).or_default().push(x);
    }
    let mut saida: Vec<Bloco> = mapa.into_iter().map(|(em, dezenas)| Bloco { dezenas, em }).collect();
    saida.sort_unstable_by_key(|b| b.em);
    saida
}

/// Percorre as repartições de `quantas` dezenas pelos blocos.
fn repartir(bl: &[Bloco], quantas: u32, acao: &mut impl FnMut(&[u32])) {
    fn passo(
        bl: &[Bloco],
        i: usize,
        faltam: u32,
        atual: &mut Vec<u32>,
        acao: &mut impl FnMut(&[u32]),
    ) {
        if i == bl.len() {
            if faltam == 0 {
                acao(atual);
            }
            return;
        }
        let resto: u32 = bl[i..].iter().map(|b| b.dezenas.len() as u32).sum();
        if resto < faltam {
            return;
        }
        for c in 0..=(bl[i].dezenas.len() as u32).min(faltam) {
            atual[i] = c;
            passo(bl, i + 1, faltam - c, atual, acao);
        }
        atual[i] = 0;
    }
    let mut atual = vec![0u32; bl.len()];
    passo(bl, 0, quantas, &mut atual, acao);
}

/// Quantos sorteios a família deixa descobertos.
///
/// Um vetor de contagem `(c₀, …, c_r)` com `Σcᵢ = 15` representa
/// `∏ C(|blocoᵢ|, cᵢ)` sorteios de verdade, e todos cruzam cada cartela na
/// mesma quantidade. Descoberto é o vetor em que nenhuma cartela alcança `t`.
fn descobertos(bl: &[Bloco], quantas_cartelas: usize, t: u32) -> u64 {
    let mut total = 0u64;
    repartir(bl, SORTEIO, &mut |c: &[u32]| {
        let mut cruz = vec![0u32; quantas_cartelas];
        let mut peso = 1u64;
        for (i, b) in bl.iter().enumerate() {
            if c[i] == 0 {
                continue;
            }
            peso = peso.saturating_mul(binomial(b.dezenas.len() as u64, u64::from(c[i])));
            for (j, cr) in cruz.iter_mut().enumerate() {
                if b.em & (1 << j) != 0 {
                    *cr += c[i];
                }
            }
        }
        if !cruz.iter().any(|&x| x >= t) {
            total += peso;
        }
    });
    total
}

/// Quantos sorteios uma cartela sozinha atende — o teto de uma cartela, para a
/// poda por contagem.
fn alcance_de_uma(v: u32, k: u32, t: u32) -> u64 {
    (t..=SORTEIO.min(k))
        .map(|i| {
            binomial(u64::from(k), u64::from(i))
                .saturating_mul(binomial(u64::from(v - k), u64::from(SORTEIO - i)))
        })
        .sum()
}

struct Varredura {
    v: u32,
    k: u32,
    t: u32,
    n: usize,
    alcance: u64,
    nos: u64,
    teto_de_nos: u64,
}

enum Desfecho {
    Achou(Vec<u32>),
    NaoExiste,
    Excedido,
}

impl Varredura {
    fn varrer(&mut self, familia: &mut Vec<u32>) -> Desfecho {
        self.nos += 1;
        if self.nos > self.teto_de_nos {
            return Desfecho::Excedido;
        }
        let bl = blocos(familia, self.v);
        let falta = descobertos(&bl, familia.len(), self.t);
        if falta == 0 {
            return Desfecho::Achou(familia.clone());
        }
        let restam = self.n - familia.len();
        if restam == 0 {
            return Desfecho::NaoExiste;
        }
        // A cota de contagem no que sobrou: o que falta cobrir não cabe nas
        // cartelas que ainda restam.
        if falta > self.alcance.saturating_mul(restam as u64) {
            return Desfecho::NaoExiste;
        }

        let mut proximas: Vec<u32> = Vec::new();
        repartir(&bl, self.k, &mut |c: &[u32]| {
            let mut m = 0u32;
            for (i, b) in bl.iter().enumerate() {
                for &d in b.dezenas.iter().take(c[i] as usize) {
                    m |= 1 << d;
                }
            }
            proximas.push(m);
        });
        let mut excedeu = false;
        for m in proximas {
            if familia.contains(&m) {
                continue;
            }
            familia.push(m);
            let r = self.varrer(familia);
            familia.pop();
            match r {
                Desfecho::Achou(f) => return Desfecho::Achou(f),
                Desfecho::Excedido => excedeu = true,
                Desfecho::NaoExiste => {}
            }
        }
        if excedeu {
            Desfecho::Excedido
        } else {
            Desfecho::NaoExiste
        }
    }
}

/// Confere na força bruta, sem reusar nada acima: todo sorteio possível
/// encontra alguma cartela com ao menos `t` dezenas em comum.
fn confere(cartelas: &[u32], v: u32, t: u32) -> bool {
    let mut sorteio: u32 = (1 << SORTEIO) - 1;
    let teto: u32 = 1 << v;
    while sorteio < teto {
        if !cartelas.iter().any(|&c| (c & sorteio).count_ones() >= t) {
            return false;
        }
        let menor = sorteio & sorteio.wrapping_neg();
        let ondulacao = sorteio.wrapping_add(menor);
        if ondulacao == 0 {
            break;
        }
        sorteio = ondulacao | (((sorteio ^ ondulacao) >> 2) / menor);
    }
    true
}

fn main() {
    let teto_de_nos: u64 = std::env::var("TETO_DE_NOS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(200_000_000);
    for arg in std::env::args().skip(1) {
        let (caso, n) = arg.split_once(':').unwrap_or((arg.as_str(), "0"));
        let p: Vec<u32> = caso.split('-').filter_map(|x| x.parse().ok()).collect();
        if p.len() != 3 {
            continue;
        }
        let (v, k, t) = (p[0], p[1], p[2]);
        let n: usize = n.parse().unwrap_or(0);
        let comeco = Instant::now();
        let mut vr = Varredura {
            v,
            k,
            t,
            n,
            alcance: alcance_de_uma(v, k, t),
            nos: 0,
            teto_de_nos,
        };
        let mut familia = Vec::new();
        let desfecho = vr.varrer(&mut familia);
        let s = comeco.elapsed().as_secs_f64();
        match desfecho {
            Desfecho::Achou(f) => {
                let ok = confere(&f, v, t);
                println!(
                    "{v}/{k}/{t}: EXISTE com {n} cartelas · confere {} · {} nós · {s:.1}s",
                    if ok { "sim" } else { "NÃO" },
                    vr.nos
                );
                for m in &f {
                    let d: Vec<u32> = (0..v).filter(|i| m & (1 << i) != 0).map(|i| i + 1).collect();
                    println!("    {d:?}");
                }
            }
            Desfecho::NaoExiste => println!(
                "{v}/{k}/{t}: PROVADO que {n} cartelas não bastam · {} nós · {s:.1}s",
                vr.nos
            ),
            Desfecho::Excedido => println!(
                "{v}/{k}/{t}: não sei — o teto de {teto_de_nos} nós estourou · {s:.1}s"
            ),
        }
    }
}
