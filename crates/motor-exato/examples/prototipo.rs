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

/// Quantos conjuntos são olhados antes de escolher qual descartar.
///
/// Dois, e não oito, por medida. Cada olhada custa uma varredura inteira de
/// bloco — mais cara que o movimento que ela serve —, e a comparação entre
/// descartar ao acaso e escolher entre oito deu **o mesmo número** nas duas
/// vezes em que foi feita. Oito custava quatro vezes mais para não comprar
/// nada.
///
/// Dois em vez de um porque a diferença é barata e evita o pior caso: descartar
/// justamente o conjunto que segurava sozinho uma parte da cobertura.
const AMOSTRA_PARA_DESCARTE: usize = 2;

/// Quantos movimentos sem ganho antes de encarecer o que resiste.
const MOVIMENTOS_ATE_ENCARECER: usize = 40;

/// O mesmo, no espaço de órbitas, onde a vizinhança é muito menor.
const ORBITAS_ATE_ENCARECER: usize = 200;

/// Quantas entradas a tabela de cobertura pode ter.
///
/// Oito milhões de inteiros de quatro bytes são trinta e dois megabytes — cabe
/// com folga aqui, e é o dobro do que os casos desta bancada pedem. Acima disso
/// a enumeração volta a ser feita na hora, mais devagar e sem gastar memória.
const TETO_DA_TABELA: usize = 8_000_000;

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
    /// As posições ainda descobertas, e onde cada uma está nesta lista.
    ///
    /// É o que permite sortear um alvo descoberto em tempo constante. Sem isto,
    /// sortear posições até cair numa descoberta fica caro exatamente no fim da
    /// busca, que é quando faltam poucas — e o fim é a parte difícil.
    lista: Vec<u32>,
    onde: Vec<u32>,
    /// O peso de cada alvo, e a soma dos pesos dos que estão descobertos.
    ///
    /// A ideia é velha e é a que faz buscas locais de cobertura convergirem: um
    /// alvo que resiste vai ficando **caro**, até que deixá-lo descoberto passe
    /// a doer mais do que estragar a vizinhança para cobri-lo. O mínimo local
    /// deixa de ser mínimo porque o terreno mudou embaixo dele — sem
    /// temperatura, sem sorteio, sem nada a calibrar.
    peso: Vec<u32>,
    custo: u64,
    /// `C(n, k)` para o cálculo da posição colex.
    tabela: Vec<Vec<usize>>,
    escolhidos: Vec<u32>,

    /// Para cada conjunto de `a` elementos, as posições que ele cobre.
    ///
    /// Vazio quando não coube na memória, e aí a enumeração é feita na hora.
    ///
    /// É a diferença entre um movimento custar sete mil operações e noventa mil:
    /// sem esta tabela, cada `por` e cada `tirar` reenumeram os subconjuntos e
    /// recalculam a posição colex de cada um, bit a bit, milhões de vezes. Com
    /// ela, um movimento é percorrer duas listas de inteiros.
    cobre_de: Vec<Vec<u32>>,
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
            lista: (0..total as u32).collect(),
            onde: (0..total as u32).collect(),
            peso: vec![1; total],
            custo: total as u64,
            tabela,
            escolhidos: Vec::new(),
            cobre_de: Vec::new(),
        }
    }

    /// Monta a tabela de cobertura, se ela couber.
    fn preparar(&mut self) {
        let conjuntos = binomial(self.v, self.a);
        let por_conjunto = binomial(self.v - self.a, self.b - self.a);
        if conjuntos.saturating_mul(por_conjunto) > TETO_DA_TABELA {
            return;
        }
        let mut cobre = vec![Vec::new(); conjuntos];
        let todos: Vec<u8> = (0..self.v as u8).collect();
        let mut lista = Vec::new();
        para_cada_subconjunto(&todos, self.a, &mut |c| lista.push(c));
        for c in lista {
            let resto = self.fora(c);
            let i = self.posicao(c);
            let mut posicoes = Vec::with_capacity(por_conjunto);
            para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
                posicoes.push(self.posicao(c | extra) as u32);
            });
            cobre[i] = posicoes;
        }
        self.cobre_de = cobre;
    }

    /// As posições cobertas por um conjunto, da tabela ou enumeradas na hora.
    fn posicoes_de(&self, conjunto: u32) -> Vec<u32> {
        if !self.cobre_de.is_empty() {
            return self.cobre_de[self.posicao(conjunto)].clone();
        }
        let resto = self.fora(conjunto);
        let mut posicoes = Vec::new();
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            posicoes.push(self.posicao(conjunto | extra) as u32);
        });
        posicoes
    }

    fn marcar_coberta(&mut self, p: usize) {
        let i = self.onde[p] as usize;
        let ultima = self.lista.pop().unwrap();
        if i < self.lista.len() {
            self.lista[i] = ultima;
            self.onde[ultima as usize] = i as u32;
        }
        self.onde[p] = u32::MAX;
        self.descobertos -= 1;
        self.custo -= self.peso[p] as u64;
    }

    fn marcar_descoberta(&mut self, p: usize) {
        self.onde[p] = self.lista.len() as u32;
        self.lista.push(p as u32);
        self.descobertos += 1;
        self.custo += self.peso[p] as u64;
    }

    /// O conjunto de `b` elementos que ocupa esta posição na ordem colex.
    fn desfazer(&self, posicao: usize) -> u32 {
        let mut r = posicao;
        let mut m = 0u32;
        for i in (1..=self.b).rev() {
            let mut p = i - 1;
            while p < self.v && self.tabela[p + 1][i] <= r {
                p += 1;
            }
            m |= 1 << p;
            r -= self.tabela[p][i];
        }
        m
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
        let posicoes = self.posicoes_de(conjunto);
        for p in posicoes.into_iter().map(|p| p as usize) {
            if self.coberto[p] == 0 {
                self.marcar_coberta(p);
            }
            self.coberto[p] += 1;
        }
        self.escolhidos.push(conjunto);
    }

    /// Recalcula a cobertura a partir dos escolhidos.
    fn refazer(&mut self, escolhidos: Vec<u32>) {
        self.coberto.iter_mut().for_each(|c| *c = 0);
        self.descobertos = self.coberto.len();
        self.lista = (0..self.coberto.len() as u32).collect();
        self.onde = (0..self.coberto.len() as u32).collect();
        self.custo = self.peso.iter().map(|&w| w as u64).sum();
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
                let necessario = self.perda_de(i) > 0;
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
    /// Peso de cada posição, e a soma dos pesos das descobertas.
    ///
    /// O mesmo mecanismo que destravou a busca em conjuntos, aplicado ao espaço
    /// de órbitas. Aqui ele custa ainda menos: são poucas dezenas de órbitas, e
    /// a estrutura que se procura — doze órbitas que cubram tudo — é exatamente
    /// o tipo de alvo que uma busca com memória encontra e uma sem memória não.
    peso: Vec<u32>,
    custo: u64,
    /// As posições descobertas, e onde cada uma está na lista.
    lista: Vec<u32>,
    onde: Vec<u32>,
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
            peso: vec![1; total],
            custo: total as u64,
            lista: (0..total as u32).collect(),
            onde: (0..total as u32).collect(),
            semente: 20_260_901,
        }
    }

    fn por(&mut self, o: usize) {
        for i in 0..self.cobre[o].len() {
            let p = self.cobre[o][i] as usize;
            if self.vezes[p] == 0 {
                self.descobertos -= 1;
                self.custo -= self.peso[p] as u64;
                let j = self.onde[p] as usize;
                let ultima = self.lista.pop().unwrap();
                if j < self.lista.len() {
                    self.lista[j] = ultima;
                    self.onde[ultima as usize] = j as u32;
                }
                self.onde[p] = u32::MAX;
            }
            self.vezes[p] += 1;
        }
        self.dentro[o] = true;
        self.escolhidas.push(o);
    }

    fn tirar_em(&mut self, i: usize) {
        let o = self.escolhidas.swap_remove(i);
        for j in 0..self.cobre[o].len() {
            let p = self.cobre[o][j] as usize;
            self.vezes[p] -= 1;
            if self.vezes[p] == 0 {
                self.descobertos += 1;
                self.custo += self.peso[p] as u64;
                self.onde[p] = self.lista.len() as u32;
                self.lista.push(p as u32);
            }
        }
        self.dentro[o] = false;
    }

    /// Encarece o que continua descoberto, e recalcula o custo.
    ///
    /// Varre a lista dos descobertos, e não o universo inteiro. A diferença
    /// cresce com o problema e aparece justamente no fim da busca, quando faltam
    /// poucos alvos e o encarecimento é chamado com mais frequência: em pool 21
    /// são cinquenta e quatro mil posições varridas para encarecer meia dúzia.
    fn encarecer(&mut self) {
        let mut acrescimo = 0u64;
        for i in 0..self.lista.len() {
            let p = self.lista[i] as usize;
            self.peso[p] += 1;
            acrescimo += 1;
        }
        self.custo += acrescimo;
    }

    fn zerar_pesos(&mut self) {
        self.peso.iter_mut().for_each(|w| *w = 1);
        self.custo = self.lista.len() as u64;
    }

    fn limpar(&mut self) {
        while !self.escolhidas.is_empty() {
            self.tirar_em(0);
        }
    }

    /// Um começo guloso com `m` órbitas: a de melhor ganho **por cartela**.
    ///
    /// Por cartela, e não bruto, porque nem toda órbita tem o mesmo tamanho. Em
    /// pool 21 as trincas `{i, i+7, i+14}` formam órbitas de sete, e não de
    /// vinte e uma; o melhor fechamento publicado ali tem 182 cartelas, que é
    /// `8 × 21 + 2 × 7`. Escolhendo por ganho bruto, uma órbita de sete nunca
    /// ganha de uma de vinte e uma, e essa estrutura fica fora do alcance —
    /// a busca só sabia montar múltiplos de vinte e um.
    fn partida_gulosa(&mut self, m: usize) {
        self.limpar();
        while self.escolhidas.len() < m {
            let mut melhor = usize::MAX;
            let mut maior = 0f64;
            for o in 0..self.cobre.len() {
                if self.dentro[o] {
                    continue;
                }
                let ganho = self.cobre[o]
                    .iter()
                    .filter(|&&p| self.vezes[p as usize] == 0)
                    .count() as f64
                    / self.tamanho[o] as f64;
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

    /// Tenta cobrir tudo com `m` órbitas, por trocas de uma, com pesos.
    ///
    /// Aceitar só o que não piora deixa a busca parada no primeiro arranjo em
    /// que nenhuma troca ajuda — e num espaço de poucas dezenas de órbitas esse
    /// ponto chega depressa. Encarecendo o que resiste, o mesmo arranjo deixa de
    /// ser mínimo e a busca continua.
    fn tenta(&mut self, m: usize, rodadas: usize) -> bool {
        self.partida_gulosa(m);
        if self.descobertos == 0 {
            return true;
        }
        self.zerar_pesos();

        let mut parado = 0usize;
        for _ in 0..rodadas {
            let i = sorteio(&mut self.semente) as usize % self.escolhidas.len();
            let entra = sorteio(&mut self.semente) as usize % self.cobre.len();
            if self.dentro[entra] {
                continue;
            }
            let antes = self.custo;
            let cartelas_antes = self.cartelas();
            let sai = self.escolhidas[i];
            self.tirar_em(i);
            self.por(entra);
            if self.descobertos == 0 {
                return true;
            }

            // Empate no custo decide pelo número de cartelas.
            //
            // É o que abre caminho para as órbitas curtas: trocar uma de vinte e
            // uma por uma de sete, cobrindo o mesmo, é progresso — e antes disto
            // a troca era recusada por empate, então o fechamento nunca deixava
            // de ser múltiplo do pool.
            let piorou = self.custo > antes
                || (self.custo == antes && self.cartelas() > cartelas_antes);
            if piorou {
                let ultima = self.escolhidas.len() - 1;
                self.tirar_em(ultima);
                self.por(sai);
                parado += 1;
            } else if self.custo == antes && self.cartelas() == cartelas_antes {
                parado += 1;
            } else {
                parado = 0;
            }

            if parado >= ORBITAS_ATE_ENCARECER {
                self.encarecer();
                parado = 0;
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
    while m > 1 {
        if b.tenta(m - 1, rodadas) {
            m -= 1;
            if b.cartelas() < melhor.len() {
                melhor = b.conjuntos();
            }
        } else {
            break;
        }
    }
    Some(melhor)
}

/// Tira um conjunto pelo índice, desfazendo a cobertura que ele dava.
impl Turan {
    fn tirar_em(&mut self, i: usize) {
        let c = self.escolhidos.swap_remove(i);
        let posicoes = self.posicoes_de(c);
        for p in posicoes.into_iter().map(|p| p as usize) {
            self.coberto[p] -= 1;
            if self.coberto[p] == 0 {
                self.marcar_descoberta(p);
            }
        }
    }

    /// Quantas posições ficariam descobertas se este conjunto saísse.
    fn perda_de(&self, i: usize) -> usize {
        let c = self.escolhidos[i];
        if !self.cobre_de.is_empty() {
            return self.cobre_de[self.posicao(c)]
                .iter()
                .filter(|&&p| self.coberto[p as usize] <= 1)
                .count();
        }
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

/// Recozimento em **tamanho fixo**: cobrir tudo com exatamente `n` conjuntos.
///
/// ## Por que a formulação muda tudo
///
/// "Cobrir e depois tirar o que sobra" responde a pergunta errada. Ela procura
/// uma cobertura qualquer e depois tenta espremê-la, e o que se espreme é
/// sempre a solução que a construção deixou — presa ao formato dela.
///
/// A formulação que a literatura usa é a inversa: **escolhe-se o tamanho** e
/// pergunta-se se existe cobertura ali. Falhou, sobe um; conseguiu, desce um. O
/// espaço deixa de ser "coberturas" e passa a ser "conjuntos de `n` elementos",
/// e o objetivo vira minimizar quantos alvos ficaram descobertos — uma função
/// que a busca local sabe descer.
///
/// ## Por que agora o recozimento paga
///
/// Ele já tinha sido tentado no motor do aplicativo e reprovado, com razão: lá
/// uma troca custa trinta e um mil varreduras, e o orçamento inteiro dava seis
/// mil movimentos. Recozimento com seis mil movimentos é um passeio aleatório
/// sem tempo de voltar.
///
/// Aqui, no espaço complementar, um movimento troca um elemento de uma trinca e
/// custa `2 · C(v−a, b−a)` — duzentas e setenta e duas operações em 20 dezenas
/// com jogos de 17. O mesmo orçamento compra **um milhão e meio** de movimentos.
/// A técnica não mudou; o que mudou foi o preço de usá-la.
fn recozer(t: &mut Turan, movimentos: usize, semente: &mut u64) -> bool {
    if t.descobertos == 0 {
        return true;
    }

    // Calibração: a piora típica é a escala natural do problema, e dividi-la
    // por `ln 2` faz uma piora média ser aceita com probabilidade de meio.
    let mut soma = 0.0f64;
    let mut vistas = 0usize;
    for _ in 0..200 {
        let antes = t.descobertos;
        t.trocar_um_elemento(semente);
        if t.descobertos > antes {
            soma += (t.descobertos - antes) as f64;
            vistas += 1;
        }
    }
    let inicial = if vistas > 0 {
        (soma / vistas as f64) / std::f64::consts::LN_2
    } else {
        1.0
    };
    let final_ = (inicial / 200.0).max(1e-6);
    let fator = (final_ / inicial).powf(1.0 / movimentos.max(1) as f64);

    let mut temperatura = inicial;
    for _ in 0..movimentos {
        if t.descobertos == 0 {
            return true;
        }
        // A mistura importa: o movimento dirigido resolve o que falta, e o
        // aleatório é o que impede a busca de girar em torno dos mesmos alvos.
        if sorteio(semente) % 10 < 8 {
            t.trocar_dirigido(semente, temperatura);
        } else {
            t.trocar_um_elemento_recozido(semente, temperatura);
        }
        temperatura *= fator;
    }
    t.descobertos == 0
}

impl Turan {
    /// Como [`Turan::trocar_um_elemento`], mas aceitando piorar sob a temperatura.
    fn trocar_um_elemento_recozido(&mut self, semente: &mut u64, temperatura: f64) {
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
        if self.descobertos <= antes {
            return;
        }

        let piora = (self.descobertos - antes) as f64;
        let chance = (-piora / temperatura.max(1e-9)).exp();
        let dado = sorteio(semente) as f64 / 2_147_483_648.0;
        if dado < chance {
            return;
        }
        let ultimo = self.escolhidos.len() - 1;
        self.tirar_em(ultimo);
        self.por(velho);
    }

    /// Um movimento que **mira um alvo descoberto**.
    ///
    /// A troca aleatória mexe onde calha, e no fim da busca quase todo lugar já
    /// está bom: os poucos alvos que faltam quase nunca são tocados. Este
    /// movimento faz o contrário — sorteia um alvo que falta, escolhe um
    /// subconjunto dele para entrar, e joga fora um dos que estão lá. A cobertura
    /// daquele alvo é garantida; o que a temperatura decide é se o estrago em
    /// volta vale a pena.
    ///
    /// É a mesma ideia que faz buscas locais de satisfatibilidade funcionarem:
    /// trabalhar sobre a restrição violada, e não sobre o espaço inteiro.
    fn trocar_dirigido(&mut self, semente: &mut u64, temperatura: f64) {
        if self.escolhidos.is_empty() || self.lista.is_empty() {
            return;
        }
        let alvo = self.desfazer(self.lista[sorteio(semente) as usize % self.lista.len()] as usize);

        // Um subconjunto de `a` elementos do alvo: entrando, ele cobre o alvo.
        let dentro: Vec<u8> = (0..self.v as u8).filter(|&e| alvo >> e & 1 == 1).collect();
        let mut novo = 0u32;
        let mut restantes = dentro.clone();
        for _ in 0..self.a {
            if restantes.is_empty() {
                return;
            }
            let i = sorteio(semente) as usize % restantes.len();
            novo |= 1 << restantes.swap_remove(i);
        }
        if self.escolhidos.contains(&novo) {
            return;
        }

        // Quem sai não é sorteado: entre uma amostra, sai o que menos falta faz.
        //
        // Medido, é aqui que o movimento dirigido ganha ou perde. Descartando ao
        // acaso, ele cobre o alvo que mirou e descobre outros tantos, e o saldo
        // fica no zero a zero. Olhando algumas opções antes de descartar, o
        // mesmo movimento passa a quase sempre melhorar — e a amostra é pequena
        // o bastante para não custar nada.
        let quantas = AMOSTRA_PARA_DESCARTE.min(self.escolhidos.len());
        let mut fora_i = 0usize;
        let mut menor = usize::MAX;
        for _ in 0..quantas {
            let c = sorteio(semente) as usize % self.escolhidos.len();
            let perda = self.perda_de(c);
            if perda < menor {
                menor = perda;
                fora_i = c;
                if perda == 0 {
                    break;
                }
            }
        }

        let velho = self.escolhidos[fora_i];
        let antes = self.descobertos;
        self.tirar_em(fora_i);
        self.por(novo);
        if self.descobertos <= antes {
            return;
        }

        let piora = (self.descobertos - antes) as f64;
        let chance = (-piora / temperatura.max(1e-9)).exp();
        let dado = sorteio(semente) as f64 / 2_147_483_648.0;
        if dado < chance {
            return;
        }
        let ultimo = self.escolhidos.len() - 1;
        self.tirar_em(ultimo);
        self.por(velho);
    }

    /// Tira o conjunto que menos falta faz.
    fn tirar_o_menos_util(&mut self) {
        let mut pior = 0;
        let mut menor = usize::MAX;
        for i in 0..self.escolhidos.len() {
            let perda = self.perda_de(i);
            if perda < menor {
                menor = perda;
                pior = i;
                if perda == 0 {
                    break;
                }
            }
        }
        self.tirar_em(pior);
    }
}

impl Turan {
    /// Encarece os alvos que continuam descobertos.
    fn encarecer(&mut self) {
        for i in 0..self.lista.len() {
            let p = self.lista[i] as usize;
            self.peso[p] += 1;
            self.custo += 1;
        }
    }

    fn zerar_pesos(&mut self) {
        self.peso.iter_mut().for_each(|w| *w = 1);
        self.custo = self.lista.len() as u64;
    }

    /// Um movimento guiado, aceito pelo custo **ponderado**.
    ///
    /// Mira um alvo descoberto, entra com um subconjunto dele, e descarta o que
    /// menos falta faz entre uma amostra. Aceita quando o custo não sobe — e é
    /// o encarecimento, não a tolerância a piorar, que tira a busca do lugar.
    fn passo_pesado(&mut self, semente: &mut u64) -> bool {
        if self.escolhidos.is_empty() || self.lista.is_empty() {
            return false;
        }
        let alvo = self.desfazer(self.lista[sorteio(semente) as usize % self.lista.len()] as usize);

        let dentro: Vec<u8> = (0..self.v as u8).filter(|&e| alvo >> e & 1 == 1).collect();
        let mut novo = 0u32;
        let mut restantes = dentro;
        for _ in 0..self.a {
            if restantes.is_empty() {
                return false;
            }
            let i = sorteio(semente) as usize % restantes.len();
            novo |= 1 << restantes.swap_remove(i);
        }
        if self.escolhidos.contains(&novo) {
            return false;
        }

        let quantas = AMOSTRA_PARA_DESCARTE.min(self.escolhidos.len());
        let mut fora_i = 0usize;
        let mut menor = u64::MAX;
        for _ in 0..quantas {
            let c = sorteio(semente) as usize % self.escolhidos.len();
            let perda = self.perda_pesada_de(c);
            if perda < menor {
                menor = perda;
                fora_i = c;
                if perda == 0 {
                    break;
                }
            }
        }

        let velho = self.escolhidos[fora_i];
        let antes = self.custo;
        self.tirar_em(fora_i);
        self.por(novo);
        if self.custo <= antes {
            return self.custo < antes;
        }
        let ultimo = self.escolhidos.len() - 1;
        self.tirar_em(ultimo);
        self.por(velho);
        false
    }

    /// Quanto peso ficaria descoberto se este conjunto saísse.
    fn perda_pesada_de(&self, i: usize) -> u64 {
        let c = self.escolhidos[i];
        if !self.cobre_de.is_empty() {
            return self.cobre_de[self.posicao(c)]
                .iter()
                .filter(|&&p| self.coberto[p as usize] <= 1)
                .map(|&p| self.peso[p as usize] as u64)
                .sum();
        }
        let resto = self.fora(c);
        let mut perda = 0u64;
        para_cada_subconjunto(&resto, self.b - self.a, &mut |extra| {
            let p = self.posicao(c | extra);
            if self.coberto[p] <= 1 {
                perda += self.peso[p] as u64;
            }
        });
        perda
    }
}

/// Busca com pesos: cobre tudo com o tamanho que estiver, ou desiste.
fn buscar_com_pesos(t: &mut Turan, movimentos: usize, semente: &mut u64) -> bool {
    if t.descobertos == 0 {
        return true;
    }
    t.zerar_pesos();
    let mut parado = 0usize;
    for _ in 0..movimentos {
        if t.descobertos == 0 {
            return true;
        }
        if t.passo_pesado(semente) {
            parado = 0;
        } else {
            parado += 1;
            // Sem ganho por um tempo: o terreno muda.
            if parado >= MOVIMENTOS_ATE_ENCARECER {
                t.encarecer();
                parado = 0;
            }
        }
    }
    t.descobertos == 0
}

/// Desce um degrau de cada vez, com pesos em cada tamanho.
fn descer_com_pesos(t: &mut Turan, movimentos: usize, tentativas: usize) {
    let mut semente = 20_260_903u64;
    loop {
        if t.escolhidos.len() <= 1 {
            return;
        }
        let guardado = t.escolhidos.clone();
        t.tirar_o_menos_util();
        let alvo = t.escolhidos.clone();

        let mut conseguiu = false;
        for _ in 0..tentativas {
            if buscar_com_pesos(t, movimentos, &mut semente) {
                conseguiu = true;
                break;
            }
            t.refazer(alvo.clone());
        }
        if !conseguiu {
            t.refazer(guardado);
            return;
        }
        t.podar();
    }
}

/// Desce um degrau de cada vez, recozendo em cada tamanho.
///
/// Cada degrau ganha o orçamento inteiro, e as sementes mudam a cada tentativa:
/// falhar num tamanho não é prova de que ele é impossível, só de que aquele
/// percurso não achou. Duas tentativas por degrau antes de desistir custam
/// pouco e recuperam bastante.
fn descer_recozendo(t: &mut Turan, movimentos: usize, tentativas: usize) {
    let mut semente = 20_260_902u64;
    loop {
        if t.escolhidos.len() <= 1 {
            return;
        }
        let guardado = t.escolhidos.clone();
        t.tirar_o_menos_util();
        let alvo = t.escolhidos.clone();

        let mut conseguiu = false;
        for _ in 0..tentativas {
            if recozer(t, movimentos, &mut semente) {
                conseguiu = true;
                break;
            }
            t.refazer(alvo.clone());
        }

        if !conseguiu {
            t.refazer(guardado);
            return;
        }
        t.podar();
    }
}

/// A recursão de Turán: um caso grande sai de dois menores.
///
///     T(n, b, a) ≤ T(n−1, b−1, a−1) + T(n−1, b, a)
///
/// Fixe um elemento `x`. Resolva `T(n−1, b−1, a−1)` no resto e acrescente `x` a
/// cada conjunto; resolva `T(n−1, b, a)` no resto e deixe como está. A união
/// cobre tudo, e a prova cabe em duas linhas:
///
/// - um `b`-conjunto **sem** `x` vive inteiro em `[n−1]`, e a segunda família o
///   cobre por construção;
/// - um `b`-conjunto **com** `x` tem, tirando `x`, um `(b−1)`-conjunto de
///   `[n−1]`; a primeira família cobre esse com algum `(a−1)`-conjunto, e junto
///   com `x` ele é um `a`-conjunto da família que está dentro do original.
///
/// É construção, e não busca: o custo é o dos dois casos menores, e o resultado
/// é garantido. Onde a busca direta esbarra na aritmética das órbitas — pool 21
/// com jogos de 18 quer 182, e nenhuma união de órbitas cíclicas de Z₂₁ dá 182 —,
/// a recursão não depende de simetria nenhuma.
fn recursivo(v: usize, a: usize, b: usize, esforco: usize, fundo: usize) -> Vec<u32> {
    // Fundo do poço: resolve direto.
    if a == 1 {
        // Todo `b`-conjunto precisa conter um dos escolhidos: bastam os
        // `v − b + 1` primeiros, porque um `b`-conjunto que os evitasse teria de
        // caber nos `b − 1` restantes.
        return (0..=(v - b)).map(|i| 1u32 << i).collect();
    }
    if a == b {
        // Cada `b`-conjunto contém apenas a si mesmo: não há escolha.
        let todos: Vec<u8> = (0..v as u8).collect();
        let mut saida = Vec::new();
        para_cada_subconjunto(&todos, a, &mut |m| saida.push(m));
        return saida;
    }
    if v <= fundo {
        return resolver_direto(v, a, b, esforco);
    }

    let x = (v - 1) as u32;
    let mut saida: Vec<u32> = recursivo(v - 1, a - 1, b - 1, esforco, fundo)
        .into_iter()
        .map(|c| c | (1 << x))
        .collect();
    saida.extend(recursivo(v - 1, a, b, esforco, fundo));
    saida
}

/// O motor completo num caso: órbitas, poda e descida com pesos.
fn resolver_direto(v: usize, a: usize, b: usize, esforco: usize) -> Vec<u32> {
    let mut t = Turan::novo(v, a, b);
    t.preparar();
    let partida = if binomial(v, b) <= 200_000 {
        let mut base = Turan::novo(v, a, b);
        base.preparar();
        orbital(&base, 400_000_000)
    } else {
        None
    };
    match partida {
        Some(conjuntos) => t.refazer(conjuntos),
        None => guloso(&mut t),
    }
    t.podar();
    descer_com_pesos(&mut t, esforco, 2);
    t.escolhidos.clone()
}

fn main() {
    // `CASO=20,17` isola uma configuração; `DUROS=1` corre só a folga de 3.
    let um_so = std::env::var("CASO").ok();
    let so_duros = std::env::var("DUROS").is_ok();
    // `SO=pesos` corre só o caminho vencedor, para iterar sem esperar os outros.
    let so_pesos = std::env::var("SO").map(|s| s == "pesos").unwrap_or(false);
    let tentativas: usize = std::env::var("TENTATIVAS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2);
    let orbital_trabalho: usize = std::env::var("ORBITAL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(400_000_000);
    // Abaixo deste pool a recursão para e o motor resolve direto.
    let fundo_da_recursao: usize = std::env::var("FUNDO")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(18);
    let movimentos: usize = std::env::var("MOVIMENTOS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2_000_000);

    println!("\nProtótipo — construção em T(v, b, a), contra os melhores conhecidos\n");
    println!(
        "  {:<14} {:>4} {:>8} {:>8} {:>8} {:>8} {:>10} {:>9} {:>7} {:>12} {:>8}",
        "configuração", "ref", "guloso", "cíclico", "misto", "orbital", "combinado", "recozido",
        "pesos", "recursivo", "tempo"
    );

    for &(pool, jogo, conhecido) in REFERENCIA {
        if let Some(pedido) = &um_so {
            if *pedido != format!("{pool},{jogo}") {
                continue;
            }
        } else if so_duros && pool - jogo < 3 {
            continue;
        }
        let (v, a, b) = (pool, pool - jogo, pool - 15);
        let comeco = Instant::now();

        let mostrar = |n: usize| if so_pesos { "—".to_string() } else { n.to_string() };

        let n_guloso = if so_pesos {
            "—".into()
        } else {
            let mut g = Turan::novo(v, a, b);
            guloso(&mut g);
            g.podar();
            mostrar(g.escolhidos.len())
        };

        let n_ciclico = if so_pesos {
            "—".into()
        } else {
            let mut c = Turan::novo(v, a, b);
            ciclico(&mut c, 1.0);
            c.podar();
            mostrar(c.escolhidos.len())
        };

        let n_misto = if so_pesos {
            "—".into()
        } else {
            let mut m = Turan::novo(v, a, b);
            ciclico(&mut m, 0.97);
            guloso(&mut m);
            m.podar();
            mostrar(m.escolhidos.len())
        };

        // A busca em espaço de órbitas só é montada onde a memória cabe: a
        // lista de posições por órbita cresce com `C(v, b)`.
        let (n_orbital, n_combinado) = if so_pesos {
            ("—".to_string(), "—".to_string())
        } else if binomial(v, b) <= 200_000 {
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

        // A recursão de Turán, e depois a mesma descida sobre o que ela deu.
        let n_recursivo = {
            let conjuntos = recursivo(v, a, b, movimentos / 4, fundo_da_recursao);
            let mut r = Turan::novo(v, a, b);
            r.preparar();
            r.refazer(conjuntos);
            r.podar();
            let bruto = r.escolhidos.len();
            descer_com_pesos(&mut r, movimentos, tentativas);
            format!("{bruto}→{}", r.escolhidos.len())
        };

        // O caminho completo: órbitas para a estrutura, poda, e recozimento em
        // tamanho fixo descendo degrau a degrau.
        let n_recozido = if so_pesos {
            "—".to_string()
        } else {
            let mut r = Turan::novo(v, a, b);
            r.preparar();
            let partida = if binomial(v, b) <= 200_000 {
                orbital(&Turan::novo(v, a, b), 400_000_000)
            } else {
                None
            };
            match partida {
                Some(conjuntos) => r.refazer(conjuntos),
                None => {
                    guloso(&mut r);
                }
            }
            r.podar();
            descer_recozendo(&mut r, movimentos, 2);
            r.escolhidos.len().to_string()
        };

        let n_pesos = {
            let mut r = Turan::novo(v, a, b);
            r.preparar();
            let partida = if binomial(v, b) <= 200_000 {
                let mut base = Turan::novo(v, a, b);
                base.preparar();
                orbital(&base, orbital_trabalho)
            } else {
                None
            };
            match partida {
                Some(conjuntos) => r.refazer(conjuntos),
                None => {
                    guloso(&mut r);
                }
            }
            r.podar();
            descer_com_pesos(&mut r, movimentos, tentativas);
            r.escolhidos.len()
        };

        println!(
            "  pool {pool} jogo {jogo}  {conhecido:>4} {n_guloso:>8} {n_ciclico:>8} {n_misto:>8} {n_orbital:>8} {n_combinado:>10} {n_recozido:>9} {n_pesos:>7} {n_recursivo:>12} {:>7.1}s",
            comeco.elapsed().as_secs_f64()
        );
    }
    println!();
}
