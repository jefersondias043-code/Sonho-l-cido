/*!
Protótipo: motores de construção em escala pequena, medidos contra a referência.

Não é o motor do aplicativo, e não é chamado por ele. É uma bancada separada
para experimentar abordagens antes de escolher uma — barata de rodar, barata de
jogar fora, e sem risco nenhum para o que já funciona.

## A simplificação que torna tudo isto pequeno

Com garantia cheia — a cartela precisa **conter** o sorteio inteiro — vale uma
troca de ponto de vista. Sejam `a = pool − jogo` as dezenas que faltam à cartela
e `b = pool − 15` as que faltam ao sorteio. Então

    a cartela contém o sorteio  ⟺  as `a` que faltam à cartela
                                    estão entre as `b` que faltam ao sorteio

O problema deixa de ser "cobrir sorteios com cartelas de 17" e vira "escolher
subconjuntos de tamanho `a` tais que todo subconjunto de tamanho `b` contenha
algum deles". É o **sistema de Turán T(v, b, a)**, e a diferença de tamanho é
brutal: em 20 dezenas com jogos de 17 são 1.140 trincas em vez de cartelas de
dezessete elementos, e a simetria cíclica passa a ser trivial de escrever.

## As abordagens em teste

- **guloso** — a cada passo, o conjunto de maior ganho entre todos. É o
  algoritmo clássico de cobertura, e o único com garantia demonstrada.
- **cíclico** — a cada passo, a **órbita** de maior ganho: um conjunto e todas as
  suas rotações, acrescentados juntos. É como a literatura chega aos valores
  publicados, e há um indício forte de que funciona aqui: o melhor fechamento
  conhecido para 20 dezenas com jogos de 17 tem 240 = 12 × 20, divisível pelo
  pool.
- **cíclico e depois guloso** — órbitas enquanto elas rendem, guloso para
  terminar. Órbitas inteiras acertam a estrutura mas exageram no fim.
- **poda** — depois de fechar, tira o que já não faz falta.

    cargo run --release --example prototipo
*/

use std::time::Instant;

/// `(pool, jogo, melhor conhecido)`, sorteio 15 e garantia cheia.
const REFERENCIA: &[(usize, usize, usize)] = &[
    (19, 17, 51),
    (20, 18, 40),
    (21, 19, 34),
    (22, 20, 30),
    (20, 17, 240),
    (21, 18, 182),
    (22, 19, 126),
    (23, 20, 100),
];

// ─────────── combinatória mínima ───────────

fn binomial(n: usize, k: usize) -> usize {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    let mut r: usize = 1;
    for i in 0..k {
        r = r * (n - i) / (i + 1);
    }
    r
}

/// Avança um vetor de índices crescentes para a combinação seguinte.
fn proxima(idx: &mut [usize], n: usize) -> bool {
    let k = idx.len();
    if k == 0 || n < k {
        return false;
    }
    let mut i = k;
    while i > 0 {
        i -= 1;
        if idx[i] != i + n - k {
            idx[i] += 1;
            for j in i + 1..k {
                idx[j] = idx[j - 1] + 1;
            }
            return true;
        }
    }
    false
}

/// Todas as máscaras de `tamanho` elementos escolhidos de `elementos`.
fn para_cada_subconjunto(elementos: &[u8], tamanho: usize, f: &mut impl FnMut(u32)) {
    if tamanho > elementos.len() {
        return;
    }
    let mut idx: Vec<usize> = (0..tamanho).collect();
    loop {
        let mut m = 0u32;
        for &i in &idx {
            m |= 1 << elementos[i];
        }
        f(m);
        if !proxima(&mut idx, elementos.len()) {
            return;
        }
    }
}

// ─────────── a instância ───────────

/// T(v, b, a): escolher conjuntos de `a` tais que todo conjunto de `b` contenha algum.
struct Turan {
    v: usize,
    a: usize,
    b: usize,
    /// Coberto ou não, indexado pela ordem colex do conjunto de `b` elementos.
    coberto: Vec<u8>,
    descobertos: usize,
    /// `C(n, k)` para o cálculo da posição colex.
    tabela: Vec<Vec<usize>>,
    escolhidos: Vec<u32>,
}

impl Turan {
    fn novo(v: usize, a: usize, b: usize) -> Turan {
        let mut tabela = vec![vec![0usize; b + 2]; v + 1];
        for (n, linha) in tabela.iter_mut().enumerate() {
            for (k, casa) in linha.iter_mut().enumerate() {
                *casa = binomial(n, k);
            }
        }
        let total = binomial(v, b);
        Turan {
            v,
            a,
            b,
            coberto: vec![0; total],
            descobertos: total,
            tabela,
            escolhidos: Vec::new(),
        }
    }

    /// A posição de uma máscara na ordem colex dos conjuntos de `b` elementos.
    fn posicao(&self, mascara: u32) -> usize {
        let mut m = mascara;
        let mut r = 0;
        let mut i = 1;
        while m != 0 {
            let p = m.trailing_zeros() as usize;
            m &= m - 1;
            r += self.tabela[p][i];
            i += 1;
        }
        r
    }

    /// Os elementos fora de uma máscara.
    fn fora(&self, mascara: u32) -> Vec<u8> {
        (0..self.v).filter(|&i| mascara >> i & 1 == 0).map(|i| i as u8).collect()
    }

    /// Quantos conjuntos de `b` ainda descobertos contêm este conjunto de `a`.
    fn ganho(&self, conjunto: u32) -> usize {
        let resto = self.fora(conjunto);
        let mut ganho = 0;
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            if self.coberto[self.posicao(conjunto | extra)] == 0 {
                ganho += 1;
            }
        });
        ganho
    }

    fn por(&mut self, conjunto: u32) {
        let resto = self.fora(conjunto);
        let mut posicoes = Vec::new();
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            posicoes.push(self.posicao(conjunto | extra));
        });
        for p in posicoes {
            if self.coberto[p] == 0 {
                self.descobertos -= 1;
            }
            self.coberto[p] += 1;
        }
        self.escolhidos.push(conjunto);
    }

    /// Recalcula a cobertura a partir dos escolhidos.
    fn refazer(&mut self, escolhidos: Vec<u32>) {
        self.coberto.iter_mut().for_each(|c| *c = 0);
        self.descobertos = self.coberto.len();
        self.escolhidos.clear();
        for c in escolhidos {
            self.por(c);
        }
    }

    /// Todos os conjuntos de `a` elementos.
    fn candidatos(&self) -> Vec<u32> {
        let todos: Vec<u8> = (0..self.v as u8).collect();
        let mut saida = Vec::new();
        para_cada_subconjunto(&todos, self.a, &mut |m| saida.push(m));
        saida
    }

    /// A órbita de um conjunto sob a rotação `i → i+1 (mod v)`.
    fn orbita(&self, conjunto: u32) -> Vec<u32> {
        let mut vista = Vec::new();
        let mut atual = conjunto;
        for _ in 0..self.v {
            if !vista.contains(&atual) {
                vista.push(atual);
            }
            atual = self.girar(atual);
        }
        vista
    }

    fn girar(&self, conjunto: u32) -> u32 {
        let cheio = (1u32 << self.v) - 1;
        ((conjunto << 1) | (conjunto >> (self.v - 1))) & cheio
    }

    /// Tira o que já não faz falta: um conjunto cuja saída não descobre nada.
    fn podar(&mut self) {
        loop {
            let mut saiu = false;
            let mut i = 0;
            while i < self.escolhidos.len() {
                let c = self.escolhidos[i];
                let resto = self.fora(c);
                let mut necessario = false;
                para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
                    if self.coberto[self.posicao(c | extra)] <= 1 {
                        necessario = true;
                    }
                });
                if necessario {
                    i += 1;
                    continue;
                }
                let sobra: Vec<u32> = self
                    .escolhidos
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, &c)| c)
                    .collect();
                self.refazer(sobra);
                saiu = true;
            }
            if !saiu {
                return;
            }
        }
    }
}

// ─────────── as abordagens ───────────

/// Guloso clássico: a cada passo, o conjunto de maior ganho entre todos.
fn guloso(t: &mut Turan) {
    let candidatos = t.candidatos();
    while t.descobertos > 0 {
        let mut melhor = candidatos[0];
        let mut maior = 0;
        for &c in &candidatos {
            let g = t.ganho(c);
            if g > maior {
                maior = g;
                melhor = c;
            }
        }
        if maior == 0 {
            return;
        }
        t.por(melhor);
    }
}

/// Cíclico: a cada passo, a órbita de maior ganho, acrescentada inteira.
///
/// `ate` limita quanto da cobertura sai por órbitas; o resto fica para o guloso.
fn ciclico(t: &mut Turan, ate: f64) {
    let candidatos = t.candidatos();
    let mut orbitas: Vec<Vec<u32>> = Vec::new();
    let mut vistos: Vec<u32> = Vec::new();
    for &c in &candidatos {
        if vistos.contains(&c) {
            continue;
        }
        let o = t.orbita(c);
        vistos.extend(o.iter().copied());
        orbitas.push(o);
    }

    let total = t.coberto.len();
    while t.descobertos as f64 > total as f64 * (1.0 - ate) {
        let mut melhor: Option<&Vec<u32>> = None;
        let mut maior = 0usize;
        for o in &orbitas {
            // O ganho de uma órbita não é a soma dos ganhos: os membros se
            // sobrepõem. Conta-se a união, marcando e desmarcando.
            let antes = t.descobertos;
            let copia: Vec<u32> = o.clone();
            for &c in &copia {
                t.por(c);
            }
            let ganho = antes - t.descobertos;
            let sobra: Vec<u32> = t.escolhidos[..t.escolhidos.len() - copia.len()].to_vec();
            t.refazer(sobra);
            if ganho > maior {
                maior = ganho;
                melhor = Some(o);
            }
        }
        match melhor {
            Some(o) => {
                let copia = o.clone();
                for c in copia {
                    t.por(c);
                }
            }
            None => return,
        }
    }
}

/// Busca no **espaço de órbitas**: escolher `m` órbitas que cubram tudo.
///
/// É aqui que a simetria paga. Um fechamento de 240 cartelas em 20 dezenas é
/// uma escolha entre `C(1140, 240)` conjuntos de trincas — um número sem
/// sentido. Sob a rotação `i → i+1`, as 1.140 trincas se agrupam em 57 órbitas,
/// e o mesmo fechamento vira uma escolha de **12 órbitas entre 57**. O espaço
/// deixa de ser astronômico e vira algo que uma busca local percorre.
///
/// O indício de que vale a pena está no próprio número: 240 = 12 × 20, múltiplo
/// exato do pool. Fechamentos publicados que são múltiplos do pool costumam ser
/// cíclicos, e é o caso.
///
/// A busca desce um degrau de cada vez: acha `m` órbitas que cobrem tudo, tenta
/// `m − 1`, e assim até não conseguir. Cada tentativa é uma busca local por
/// trocas de uma órbita, aceitando o que não piora.
struct Orbital {
    /// Para cada órbita, as posições que ela cobre.
    cobre: Vec<Vec<u32>>,
    /// Quantas órbitas escolhidas cobrem cada posição.
    vezes: Vec<u16>,
    descobertos: usize,
    escolhidas: Vec<usize>,
    dentro: Vec<bool>,
    tamanho: Vec<usize>,
    /// Os conjuntos que compõem cada órbita.
    membros: Vec<Vec<u32>>,
    semente: u64,
}

fn sorteio(semente: &mut u64) -> u64 {
    *semente = semente
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *semente >> 33
}

impl Orbital {
    fn novo(t: &Turan) -> Orbital {
        let candidatos = t.candidatos();
        let mut vistos: Vec<u32> = Vec::new();
        let mut cobre = Vec::new();
        let mut tamanho = Vec::new();
        let mut membros = Vec::new();

        for &c in &candidatos {
            if vistos.contains(&c) {
                continue;
            }
            let orbita = t.orbita(c);
            vistos.extend(orbita.iter().copied());

            let mut posicoes = Vec::new();
            for &membro in &orbita {
                let resto = t.fora(membro);
                para_cada_subconjunto(&resto, t.b - t.a, &mut |extra| {
                    posicoes.push(t.posicao(membro | extra) as u32);
                });
            }
            posicoes.sort_unstable();
            posicoes.dedup();
            cobre.push(posicoes);
            tamanho.push(orbita.len());
            membros.push(orbita);
        }

        let total = t.coberto.len();
        let n = cobre.len();
        Orbital {
            cobre,
            vezes: vec![0; total],
            descobertos: total,
            escolhidas: Vec::new(),
            dentro: vec![false; n],
            tamanho,
            membros,
            semente: 20_260_901,
        }
    }

    fn por(&mut self, o: usize) {
        for &p in &self.cobre[o] {
            if self.vezes[p as usize] == 0 {
                self.descobertos -= 1;
            }
            self.vezes[p as usize] += 1;
        }
        self.dentro[o] = true;
        self.escolhidas.push(o);
    }

    fn tirar_em(&mut self, i: usize) {
        let o = self.escolhidas.swap_remove(i);
        for &p in &self.cobre[o] {
            self.vezes[p as usize] -= 1;
            if self.vezes[p as usize] == 0 {
                self.descobertos += 1;
            }
        }
        self.dentro[o] = false;
    }

    fn limpar(&mut self) {
        while !self.escolhidas.is_empty() {
            self.tirar_em(0);
        }
    }

    /// Um começo guloso com `m` órbitas: a de maior ganho, e a seguinte.
    fn partida_gulosa(&mut self, m: usize) {
        self.limpar();
        while self.escolhidas.len() < m {
            let mut melhor = usize::MAX;
            let mut maior = 0usize;
            for o in 0..self.cobre.len() {
                if self.dentro[o] {
                    continue;
                }
                let ganho = self.cobre[o]
                    .iter()
                    .filter(|&&p| self.vezes[p as usize] == 0)
                    .count();
                if ganho > maior {
                    maior = ganho;
                    melhor = o;
                }
            }
            if melhor == usize::MAX {
                // Nada acrescenta: completa com qualquer uma que falte.
                let livre = (0..self.cobre.len()).find(|&o| !self.dentro[o]);
                match livre {
                    Some(o) => self.por(o),
                    None => return,
                }
            } else {
                self.por(melhor);
            }
        }
    }

    /// Tenta cobrir tudo com `m` órbitas, por trocas de uma.
    fn tenta(&mut self, m: usize, rodadas: usize) -> bool {
        self.partida_gulosa(m);
        if self.descobertos == 0 {
            return true;
        }
        for _ in 0..rodadas {
            let i = sorteio(&mut self.semente) as usize % self.escolhidas.len();
            let entra = sorteio(&mut self.semente) as usize % self.cobre.len();
            if self.dentro[entra] {
                continue;
            }
            let antes = self.descobertos;
            let sai = self.escolhidas[i];
            self.tirar_em(i);
            self.por(entra);
            if self.descobertos == 0 {
                return true;
            }
            if self.descobertos > antes {
                // Piorou: desfaz. A que entrou está no fim.
                let ultima = self.escolhidas.len() - 1;
                self.tirar_em(ultima);
                self.por(sai);
            }
        }
        self.descobertos == 0
    }

    /// Quantas cartelas as órbitas escolhidas representam.
    fn cartelas(&self) -> usize {
        self.escolhidas.iter().map(|&o| self.tamanho[o]).sum()
    }

    /// Os conjuntos, membro a membro, das órbitas escolhidas.
    fn conjuntos(&self) -> Vec<u32> {
        self.escolhidas
            .iter()
            .flat_map(|&o| self.membros[o].iter().copied())
            .collect()
    }
}

/// Desce de degrau em degrau: `m` órbitas, `m − 1`, até não conseguir.
///
/// O orçamento por degrau é dado em **trabalho**, e não em rodadas: uma troca
/// custa a soma das posições das duas órbitas envolvidas, e isso varia mil vezes
/// entre pool 20 e pool 22. Contando rodadas, o mesmo número que resolve um caso
/// em milissegundos deixa o outro rodando por horas — e foi o que aconteceu na
/// primeira tentativa.
///
/// A partida também não é do zero. O menor número possível de conjuntos sai da
/// contagem — cada conjunto de `a` cabe em `C(v−a, b−a)` conjuntos de `b`, e são
/// `C(v, b)` a cobrir —, e dividindo pelo tamanho da órbita sai o menor `m` que
/// tem chance. Começar abaixo disso é gastar tentativa em degrau impossível.
fn orbital(t: &Turan, trabalho: usize) -> Option<Vec<u32>> {
    let mut b = Orbital::novo(t);
    let total = b.cobre.len();
    if total == 0 {
        return None;
    }

    let por_orbita = b.cobre.iter().map(|c| c.len()).sum::<usize>() / total;
    let rodadas = (trabalho / por_orbita.max(1).saturating_mul(2)).clamp(500, 300_000);

    let piso_de_conjuntos = t.coberto.len().div_ceil(binomial(t.v - t.a, t.b - t.a).max(1));
    let maior_orbita = b.tamanho.iter().copied().max().unwrap_or(1);
    let mut m = piso_de_conjuntos.div_ceil(maior_orbita).max(1);

    while m <= total && !b.tenta(m, rodadas) {
        m += 1;
    }
    if m > total {
        return None;
    }

    let mut melhor: Vec<u32> = b.conjuntos();
    while m > 1 && b.tenta(m - 1, rodadas) {
        m -= 1;
        if b.cartelas() < melhor.len() {
            melhor = b.conjuntos();
        }
    }
    Some(melhor)
}

/// Tira um conjunto pelo índice, desfazendo a cobertura que ele dava.
impl Turan {
    fn tirar_em(&mut self, i: usize) {
        let c = self.escolhidos.swap_remove(i);
        let resto = self.fora(c);
        let mut posicoes = Vec::new();
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            posicoes.push(self.posicao(c | extra));
        });
        for p in posicoes {
            self.coberto[p] -= 1;
            if self.coberto[p] == 0 {
                self.descobertos += 1;
            }
        }
    }

    /// Quantas posições ficariam descobertas se este conjunto saísse.
    fn perda_de(&self, i: usize) -> usize {
        let c = self.escolhidos[i];
        let resto = self.fora(c);
        let mut perda = 0;
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            if self.coberto[self.posicao(c | extra)] <= 1 {
                perda += 1;
            }
        });
        perda
    }

    /// Troca um elemento de um conjunto escolhido por outro que ele não tem.
    ///
    /// É o movimento fino, e é o que quebra a simetria: a solução que veio das
    /// órbitas é rígida, e daqui para baixo ela deixa de precisar ser.
    fn trocar_um_elemento(&mut self, semente: &mut u64) {
        if self.escolhidos.is_empty() {
            return;
        }
        let i = sorteio(semente) as usize % self.escolhidos.len();
        let velho = self.escolhidos[i];
        let dentro: Vec<u8> = (0..self.v as u8).filter(|&e| velho >> e & 1 == 1).collect();
        let fora = self.fora(velho);
        if dentro.is_empty() || fora.is_empty() {
            return;
        }
        let sai = dentro[sorteio(semente) as usize % dentro.len()];
        let entra = fora[sorteio(semente) as usize % fora.len()];
        let novo = (velho & !(1 << sai)) | (1 << entra);
        if self.escolhidos.contains(&novo) {
            return;
        }

        let antes = self.descobertos;
        self.tirar_em(i);
        self.por(novo);
        if self.descobertos > antes {
            let ultimo = self.escolhidos.len() - 1;
            self.tirar_em(ultimo);
            self.por(velho);
        }
    }
}

/// Aperta uma solução pronta: tira o menos útil e tenta recobrir sem ele.
///
/// É o segundo motor, e ele começa de onde o primeiro parou. A solução que sai
/// das órbitas cobre tudo mas é rígida — todo membro de uma órbita entrou junto,
/// precise ou não. Aqui a simetria é abandonada e cada conjunto passa a andar
/// por conta própria.
fn refinar(t: &mut Turan, rodadas_por_degrau: usize) {
    let mut semente = 987_654_321u64;
    loop {
        if t.escolhidos.len() <= 1 {
            return;
        }
        let guardado = t.escolhidos.clone();

        // Sai o de menor perda.
        let mut pior = 0;
        let mut menor = usize::MAX;
        for i in 0..t.escolhidos.len() {
            let perda = t.perda_de(i);
            if perda < menor {
                menor = perda;
                pior = i;
                if perda == 0 {
                    break;
                }
            }
        }
        t.tirar_em(pior);

        let mut conseguiu = t.descobertos == 0;
        for _ in 0..rodadas_por_degrau {
            if conseguiu {
                break;
            }
            t.trocar_um_elemento(&mut semente);
            conseguiu = t.descobertos == 0;
        }

        if !conseguiu {
            t.refazer(guardado);
            return;
        }
    }
}

fn main() {
    println!("\nProtótipo — construção em T(v, b, a), contra os melhores conhecidos\n");
    println!(
        "  {:<14} {:>4} {:>8} {:>8} {:>8} {:>8} {:>10} {:>8}",
        "configuração", "ref", "guloso", "cíclico", "misto", "orbital", "combinado", "tempo"
    );

    for &(pool, jogo, conhecido) in REFERENCIA {
        let (v, a, b) = (pool, pool - jogo, pool - 15);
        let comeco = Instant::now();

        let mut g = Turan::novo(v, a, b);
        guloso(&mut g);
        g.podar();
        let n_guloso = g.escolhidos.len();

        let mut c = Turan::novo(v, a, b);
        ciclico(&mut c, 1.0);
        c.podar();
        let n_ciclico = c.escolhidos.len();

        let mut m = Turan::novo(v, a, b);
        ciclico(&mut m, 0.97);
        guloso(&mut m);
        m.podar();
        let n_misto = m.escolhidos.len();

        // A busca em espaço de órbitas só é montada onde a memória cabe: a
        // lista de posições por órbita cresce com `C(v, b)`.
        let (n_orbital, n_combinado) = if binomial(v, b) <= 200_000 {
            let base = Turan::novo(v, a, b);
            match orbital(&base, 400_000_000) {
                Some(conjuntos) => {
                    let bruto = conjuntos.len();
                    let mut o = Turan::novo(v, a, b);
                    o.refazer(conjuntos);
                    o.podar();
                    refinar(&mut o, 400_000);
                    (bruto.to_string(), o.escolhidos.len().to_string())
                }
                None => ("—".into(), "—".into()),
            }
        } else {
            ("—".into(), "—".into())
        };

        println!(
            "  pool {pool} jogo {jogo}  {conhecido:>4} {n_guloso:>8} {n_ciclico:>8} {n_misto:>8} {n_orbital:>8} {n_combinado:>10} {:>7.1}s",
            comeco.elapsed().as_secs_f64()
        );
    }
    println!();
}
