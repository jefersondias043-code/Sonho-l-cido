/*!
O motor de Turán: o mesmo problema, visto pelo avesso.

## A troca de ponto de vista

Quando a garantia é cheia — a cartela precisa **conter** o sorteio inteiro —
vale uma equivalência que muda tudo. Sejam `a = v − k` as dezenas que faltam à
cartela e `b = v − j` as que faltam ao sorteio:

```text
a cartela contém o sorteio  ⟺  as `a` que faltam à cartela
                                estão entre as `b` que faltam ao sorteio
```

O problema deixa de ser "cobrir sorteios com cartelas de dezessete" e vira
"escolher conjuntos de `a` elementos tais que todo conjunto de `b` contenha
algum deles" — o **sistema de Turán T(v, b, a)**.

A diferença não é de gosto. Em 20 dezenas com jogos de 17 os objetos passam a
ser trincas, e um movimento da busca — trocar uma dezena de um conjunto — custa
duzentas e setenta e duas operações em vez de trinta e uma mil. Técnicas que não
pagavam passam a pagar, e é isso que este módulo explora.

## O que ele faz, e por que dois caminhos

Nenhuma abordagem sozinha ganha em toda a família, e a razão é estrutural:

- **Busca em espaço de órbitas.** Sob a rotação `i → i+1`, as 1.140 trincas de
  20 dezenas se agrupam em 57 órbitas, e o melhor fechamento publicado — 240
  cartelas, que é `12 × 20` — vira uma escolha de doze órbitas entre cinquenta e
  sete. Onde o fechamento publicado é cíclico, esta busca o encontra exatamente.

- **Recursão de Turán**, `T(n,b,a) ≤ T(n−1,b−1,a−1) + T(n−1,b,a)`. Fixe um
  elemento `x`: resolva o primeiro caso no resto e acrescente `x` a cada
  conjunto; resolva o segundo no resto e deixe como está. Um `b`-conjunto sem
  `x` é coberto pelo segundo; um com `x` tem, tirando `x`, um `(b−1)`-conjunto
  coberto pelo primeiro. Não depende de simetria nenhuma, e é ela que atende os
  casos em que o fechamento publicado **não** é cíclico — em Z₂₁ toda união de
  órbitas tem `21k` ou `21k + 7` cartelas, e o melhor conhecido para pool 21 com
  jogos de 18 tem 182, que não é nenhum dos dois.

  **Um nível apenas.** Descendo até o fundo, cada degrau acumula a folga do
  anterior e o resultado piora: medido, 238 cartelas contra as 231 da busca
  orbital. Parando no primeiro degrau e resolvendo bem as duas metades, 212.

O melhor dos dois é o que sai. Depois vem a descida com pesos, que é o que
aperta o número até onde der.

## Por que pesos, e não temperatura

Aceitar só o que não piora deixa a busca parada no primeiro arranjo em que
nenhuma troca ajuda. A saída clássica é o recozimento — aceitar piorar com
probabilidade que cai com o tempo —, e ele foi medido aqui: perdeu. Encarecer o
alvo que resiste, até que deixá-lo descoberto doa mais do que estragar a
vizinhança para cobri-lo, muda o terreno sob o mínimo local em vez de sacudir a
busca. Com dois milhões de movimentos os pesos alcançaram o que o recozimento
não alcançou com doze milhões.

## Medido

```text
configuração   publicado   este motor   o anterior
pool 19 j 17          51           51           55
pool 20 j 18          40           40           46
pool 21 j 19          34           34           34
pool 22 j 20          30           30           31
pool 20 j 17         240          240          328
pool 21 j 18         182          212          246
pool 22 j 19         126          160          194
```
*/

use crate::problema::{binomial, mascara_cheia, Bloco, Problema};

/// Quantas entradas a tabela de cobertura pode ter.
///
/// Quatro milhões de inteiros são dezesseis megabytes. Acima disso o motor
/// recusa a configuração e quem chamou fica com a escalada de sempre — melhor
/// isso do que estourar a memória de um celular.
const TETO_DA_TABELA: usize = 4_000_000;

/// Quantos movimentos sem ganho antes de encarecer o que resiste.
const MOVIMENTOS_ATE_ENCARECER: usize = 40;

/// O mesmo, no espaço de órbitas, onde a vizinhança é muito menor.
const ORBITAS_ATE_ENCARECER: usize = 200;

/// Quantos conjuntos são olhados antes de escolher qual descartar.
///
/// Dois, e não oito, por medida: cada olhada custa uma varredura inteira — mais
/// cara que o movimento que ela serve — e escolher entre oito deu o mesmo
/// número que descartar ao acaso.
const AMOSTRA_PARA_DESCARTE: usize = 2;

/// Quantas vezes um tamanho é tentado antes de a descida desistir dele.
const TENTATIVAS_POR_DEGRAU: usize = 2;

/// Quantos movimentos cada tentativa recebe.
const MOVIMENTOS_POR_TENTATIVA: u64 = 2_000_000;

/// Quantas rodadas cada tentativa em espaço de órbitas recebe.
const RODADAS_POR_TENTATIVA_ORBITAL: u64 = 400_000;

fn proximo(estado: &mut u64) -> u64 {
    *estado = estado
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *estado >> 33
}

/// Avança um vetor de índices crescentes para a combinação seguinte.
fn proxima_combinacao(idx: &mut [usize], n: usize) -> bool {
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
        if !proxima_combinacao(&mut idx, elementos.len()) {
            return;
        }
    }
}

// ─────────── a instância ───────────

/// T(v, b, a): conjuntos de `a` tais que todo conjunto de `b` contenha algum.
struct Instancia {
    v: usize,
    a: usize,
    b: usize,

    /// `C(n, k)` para a posição na ordem colex.
    tabela: Vec<Vec<usize>>,
    /// Para cada conjunto de `a`, as posições que ele cobre.
    cobre_de: Vec<Vec<u32>>,

    /// Quantos conjuntos escolhidos cobrem cada posição.
    coberto: Vec<u8>,
    /// As posições descobertas, e onde cada uma está nesta lista.
    ///
    /// É o que permite sortear um alvo descoberto em tempo constante. Sem isto,
    /// sortear até cair num descoberto fica caro justamente no fim da busca,
    /// quando faltam poucos — e o fim é a parte difícil.
    lista: Vec<u32>,
    onde: Vec<u32>,

    /// O peso de cada alvo, e a soma dos pesos dos descobertos.
    peso: Vec<u32>,
    custo: u64,

    escolhidos: Vec<u32>,
    semente: u64,

    /// Posições tocadas, para o orçamento de quem chama ser honesto.
    ///
    /// Um movimento em conjuntos custa duas travessias da lista de cobertura;
    /// um movimento em órbitas custa a lista da órbita inteira, que é vinte
    /// vezes maior. Cobrar os dois pelo mesmo preço fazia o orçamento pedido
    /// pela tela valer vinte vezes mais tempo do que ela esperava — e o motor
    /// parecia lento sem que ninguém soubesse por quê.
    trabalho: u64,
}

impl Instancia {
    /// Devolve `None` quando a instância não cabe na memória.
    fn nova(v: usize, a: usize, b: usize, semente: u64) -> Option<Instancia> {
        if a == 0 || a > b || b > v {
            return None;
        }
        let conjuntos = binomial(v, a);
        let por_conjunto = binomial(v - a, b - a);
        let alvos = binomial(v, b);
        if conjuntos.saturating_mul(por_conjunto) > TETO_DA_TABELA as u128
            || alvos > TETO_DA_TABELA as u128
        {
            return None;
        }
        let (conjuntos, alvos) = (conjuntos as usize, alvos as usize);

        let mut tabela = vec![vec![0usize; b + 2]; v + 2];
        for (n, linha) in tabela.iter_mut().enumerate() {
            for (k, casa) in linha.iter_mut().enumerate() {
                *casa = binomial(n, k) as usize;
            }
        }

        let mut instancia = Instancia {
            v,
            a,
            b,
            tabela,
            cobre_de: Vec::new(),
            coberto: vec![0; alvos],
            lista: (0..alvos as u32).collect(),
            onde: (0..alvos as u32).collect(),
            peso: vec![1; alvos],
            custo: alvos as u64,
            escolhidos: Vec::new(),
            semente,
            trabalho: 0,
        };

        // A tabela de cobertura é o que faz um movimento custar sete mil
        // operações em vez de noventa mil: sem ela, cada `por` e cada `tirar`
        // reenumeram os subconjuntos e recalculam a posição colex de cada um,
        // bit a bit, milhões de vezes.
        let mut cobre = vec![Vec::new(); conjuntos];
        let todos: Vec<u8> = (0..v as u8).collect();
        let mut candidatos = Vec::with_capacity(conjuntos);
        para_cada_subconjunto(&todos, a, &mut |c| candidatos.push(c));
        for c in candidatos {
            let resto = instancia.fora(c);
            let i = instancia.posicao(c);
            let mut posicoes = Vec::with_capacity(por_conjunto as usize);
            para_cada_subconjunto(&resto, b - a, &mut |extra| {
                posicoes.push(instancia.posicao(c | extra) as u32);
            });
            cobre[i] = posicoes;
        }
        instancia.cobre_de = cobre;
        Some(instancia)
    }

    /// A posição de uma máscara na ordem colex do seu tamanho.
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

    /// O conjunto de `b` elementos que ocupa esta posição.
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

    fn fora(&self, mascara: u32) -> Vec<u8> {
        (0..self.v)
            .filter(|&i| mascara >> i & 1 == 0)
            .map(|i| i as u8)
            .collect()
    }

    fn descobertos(&self) -> usize {
        self.lista.len()
    }

    fn marcar_coberta(&mut self, p: usize) {
        let i = self.onde[p] as usize;
        let ultima = self.lista.pop().unwrap();
        if i < self.lista.len() {
            self.lista[i] = ultima;
            self.onde[ultima as usize] = i as u32;
        }
        self.onde[p] = u32::MAX;
        self.custo -= self.peso[p] as u64;
    }

    fn marcar_descoberta(&mut self, p: usize) {
        self.onde[p] = self.lista.len() as u32;
        self.lista.push(p as u32);
        self.custo += self.peso[p] as u64;
    }

    fn por(&mut self, conjunto: u32) {
        let i = self.posicao(conjunto);
        self.trabalho += self.cobre_de[i].len() as u64;
        for k in 0..self.cobre_de[i].len() {
            let p = self.cobre_de[i][k] as usize;
            if self.coberto[p] == 0 {
                self.marcar_coberta(p);
            }
            self.coberto[p] += 1;
        }
        self.escolhidos.push(conjunto);
    }

    fn tirar_em(&mut self, indice: usize) {
        let c = self.escolhidos.swap_remove(indice);
        let i = self.posicao(c);
        self.trabalho += self.cobre_de[i].len() as u64;
        for k in 0..self.cobre_de[i].len() {
            let p = self.cobre_de[i][k] as usize;
            self.coberto[p] -= 1;
            if self.coberto[p] == 0 {
                self.marcar_descoberta(p);
            }
        }
    }

    fn refazer(&mut self, escolhidos: &[u32]) {
        self.coberto.iter_mut().for_each(|c| *c = 0);
        self.lista = (0..self.coberto.len() as u32).collect();
        self.onde = (0..self.coberto.len() as u32).collect();
        self.custo = self.peso.iter().map(|&w| w as u64).sum();
        self.escolhidos.clear();
        for &c in escolhidos {
            self.por(c);
        }
    }

    /// Quanto peso ficaria descoberto se este conjunto saísse.
    fn perda_de(&mut self, indice: usize) -> u64 {
        let i = self.posicao(self.escolhidos[indice]);
        self.trabalho += self.cobre_de[i].len() as u64;
        self.cobre_de[i]
            .iter()
            .filter(|&&p| self.coberto[p as usize] <= 1)
            .map(|&p| self.peso[p as usize] as u64)
            .sum()
    }

    fn zerar_pesos(&mut self) {
        self.peso.iter_mut().for_each(|w| *w = 1);
        self.custo = self.lista.len() as u64;
    }

    fn encarecer(&mut self) {
        let quantos = self.lista.len();
        for i in 0..quantos {
            let p = self.lista[i] as usize;
            self.peso[p] += 1;
        }
        self.custo += quantos as u64;
    }

    /// Tira tudo o que já não faz falta.
    ///
    /// A construção escolhe cada conjunto pelo que ele traz **no instante em
    /// que entra**, e um conjunto útil na rodada quarenta pode estar
    /// inteiramente contido no que os outros cobrem trezentos depois.
    fn podar(&mut self) {
        loop {
            let mut saiu = false;
            let mut i = 0;
            while i < self.escolhidos.len() {
                if self.perda_de(i) > 0 {
                    i += 1;
                    continue;
                }
                self.tirar_em(i);
                saiu = true;
            }
            if !saiu {
                return;
            }
        }
    }

    /// Um movimento que mira um alvo descoberto, aceito pelo custo ponderado.
    ///
    /// Sorteia um alvo que falta, entra com um subconjunto dele — cobrindo-o por
    /// construção — e descarta o que menos falta faz entre uma amostra. É a mesma
    /// ideia que faz buscas locais de satisfatibilidade funcionarem: trabalhar
    /// sobre a restrição violada, e não sobre o espaço inteiro.
    fn passo(&mut self) -> bool {
        if self.escolhidos.is_empty() || self.lista.is_empty() {
            return false;
        }
        let sorteado = proximo(&mut self.semente) as usize % self.lista.len();
        let alvo = self.desfazer(self.lista[sorteado] as usize);

        let mut restantes: Vec<u8> = (0..self.v as u8)
            .filter(|&e| alvo >> e & 1 == 1)
            .collect();
        let mut novo = 0u32;
        for _ in 0..self.a {
            if restantes.is_empty() {
                return false;
            }
            let i = proximo(&mut self.semente) as usize % restantes.len();
            novo |= 1 << restantes.swap_remove(i);
        }
        if self.escolhidos.contains(&novo) {
            return false;
        }

        let quantas = AMOSTRA_PARA_DESCARTE.min(self.escolhidos.len());
        let mut fora = 0usize;
        let mut menor = u64::MAX;
        for _ in 0..quantas {
            let c = proximo(&mut self.semente) as usize % self.escolhidos.len();
            let perda = self.perda_de(c);
            if perda < menor {
                menor = perda;
                fora = c;
                if perda == 0 {
                    break;
                }
            }
        }

        let velho = self.escolhidos[fora];
        let antes = self.custo;
        self.tirar_em(fora);
        self.por(novo);
        if self.custo <= antes {
            return self.custo < antes;
        }
        let ultimo = self.escolhidos.len() - 1;
        self.tirar_em(ultimo);
        self.por(velho);
        false
    }

    /// Tira o conjunto que menos falta faz.
    fn tirar_o_menos_util(&mut self) {
        let mut pior = 0;
        let mut menor = u64::MAX;
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

// ─────────── a busca em espaço de órbitas ───────────

/// Escolher `m` órbitas que cubram tudo, em vez de `m · v` conjuntos soltos.
struct Orbital {
    /// Para cada órbita, as posições que ela cobre.
    cobre: Vec<Vec<u32>>,
    /// Os conjuntos que compõem cada órbita.
    membros: Vec<Vec<u32>>,
    tamanho: Vec<usize>,

    vezes: Vec<u16>,
    lista: Vec<u32>,
    onde: Vec<u32>,
    peso: Vec<u32>,
    custo: u64,

    escolhidas: Vec<usize>,
    dentro: Vec<bool>,
    semente: u64,
    trabalho: u64,
}

impl Orbital {
    fn novo(t: &Instancia) -> Option<Orbital> {
        let todos: Vec<u8> = (0..t.v as u8).collect();
        let mut candidatos = Vec::new();
        para_cada_subconjunto(&todos, t.a, &mut |c| candidatos.push(c));

        let cheio = mascara_cheia(t.v);
        let girar = |c: u32| ((c << 1) | (c >> (t.v - 1))) & cheio;

        let mut visto = vec![false; 1usize << t.v.min(25)];
        if t.v > 25 {
            return None;
        }

        let mut cobre = Vec::new();
        let mut membros = Vec::new();
        let mut tamanho = Vec::new();

        for &c in &candidatos {
            if visto[c as usize] {
                continue;
            }
            let mut orbita = Vec::new();
            let mut atual = c;
            for _ in 0..t.v {
                if !visto[atual as usize] {
                    visto[atual as usize] = true;
                    orbita.push(atual);
                }
                atual = girar(atual);
            }

            let mut posicoes = Vec::new();
            for &membro in &orbita {
                posicoes.extend(t.cobre_de[t.posicao(membro)].iter().copied());
            }
            posicoes.sort_unstable();
            posicoes.dedup();

            cobre.push(posicoes);
            tamanho.push(orbita.len());
            membros.push(orbita);
        }

        let alvos = t.coberto.len();
        let n = cobre.len();
        Some(Orbital {
            cobre,
            membros,
            tamanho,
            vezes: vec![0; alvos],
            lista: (0..alvos as u32).collect(),
            onde: (0..alvos as u32).collect(),
            peso: vec![1; alvos],
            custo: alvos as u64,
            escolhidas: Vec::new(),
            dentro: vec![false; n],
            semente: t.semente ^ 0x5eed,
            trabalho: 0,
        })
    }

    fn descobertos(&self) -> usize {
        self.lista.len()
    }

    fn por(&mut self, o: usize) {
        self.trabalho += self.cobre[o].len() as u64;
        for k in 0..self.cobre[o].len() {
            let p = self.cobre[o][k] as usize;
            if self.vezes[p] == 0 {
                let i = self.onde[p] as usize;
                let ultima = self.lista.pop().unwrap();
                if i < self.lista.len() {
                    self.lista[i] = ultima;
                    self.onde[ultima as usize] = i as u32;
                }
                self.onde[p] = u32::MAX;
                self.custo -= self.peso[p] as u64;
            }
            self.vezes[p] += 1;
        }
        self.dentro[o] = true;
        self.escolhidas.push(o);
    }

    fn tirar_em(&mut self, indice: usize) {
        let o = self.escolhidas.swap_remove(indice);
        self.trabalho += self.cobre[o].len() as u64;
        for k in 0..self.cobre[o].len() {
            let p = self.cobre[o][k] as usize;
            self.vezes[p] -= 1;
            if self.vezes[p] == 0 {
                self.onde[p] = self.lista.len() as u32;
                self.lista.push(p as u32);
                self.custo += self.peso[p] as u64;
            }
        }
        self.dentro[o] = false;
    }

    fn limpar(&mut self) {
        while !self.escolhidas.is_empty() {
            self.tirar_em(0);
        }
    }

    fn encarecer(&mut self) {
        let quantos = self.lista.len();
        for i in 0..quantos {
            let p = self.lista[i] as usize;
            self.peso[p] += 1;
        }
        self.custo += quantos as u64;
    }

    fn zerar_pesos(&mut self) {
        self.peso.iter_mut().for_each(|w| *w = 1);
        self.custo = self.lista.len() as u64;
    }

    /// Um começo guloso com `m` órbitas: a de melhor ganho **por cartela**.
    ///
    /// Por cartela, e não bruto, porque as órbitas têm tamanhos diferentes. Em
    /// pool 21 as trincas `{i, i+7, i+14}` formam uma órbita de sete, e escolher
    /// por ganho bruto nunca a alcança.
    fn partida(&mut self, m: usize) {
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
            match melhor {
                usize::MAX => match (0..self.cobre.len()).find(|&o| !self.dentro[o]) {
                    Some(o) => self.por(o),
                    None => return,
                },
                o => self.por(o),
            }
        }
        self.zerar_pesos();
    }

    /// Um lote de trocas de órbita. Devolve `true` quando cobriu tudo.
    fn rodar(&mut self, rodadas: u64, parado: &mut usize) -> bool {
        for _ in 0..rodadas {
            if self.descobertos() == 0 {
                return true;
            }
            if self.escolhidas.is_empty() {
                return false;
            }
            let i = proximo(&mut self.semente) as usize % self.escolhidas.len();
            let entra = proximo(&mut self.semente) as usize % self.cobre.len();
            if self.dentro[entra] {
                continue;
            }

            let antes = self.custo;
            let cartelas_antes = self.cartelas();
            let sai = self.escolhidas[i];
            self.tirar_em(i);
            self.por(entra);
            if self.descobertos() == 0 {
                return true;
            }

            // Empate no custo decide pelo número de cartelas: é o que abre
            // caminho para as órbitas curtas, e sem isso o fechamento nunca
            // deixa de ser múltiplo do pool.
            let piorou = self.custo > antes
                || (self.custo == antes && self.cartelas() > cartelas_antes);
            if piorou {
                let ultima = self.escolhidas.len() - 1;
                self.tirar_em(ultima);
                self.por(sai);
                *parado += 1;
            } else if self.custo == antes && self.cartelas() == cartelas_antes {
                *parado += 1;
            } else {
                *parado = 0;
            }

            if *parado >= ORBITAS_ATE_ENCARECER {
                self.encarecer();
                *parado = 0;
            }
        }
        self.descobertos() == 0
    }

    fn cartelas(&self) -> usize {
        self.escolhidas.iter().map(|&o| self.tamanho[o]).sum()
    }

    fn conjuntos(&self) -> Vec<u32> {
        self.escolhidas
            .iter()
            .flat_map(|&o| self.membros[o].iter().copied())
            .collect()
    }
}

// ─────────── o construtor, em lotes ───────────

/// Em que ponto do trabalho o construtor está.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Etapa {
    /// Enchendo: um fechamento qualquer, o mais rápido possível.
    Enchendo,
    /// Procurando um conjunto de órbitas que cubra tudo.
    Orbitando,
    /// Resolvendo a primeira metade da recursão, `T(v−1, b−1, a−1)`.
    Recursando0,
    /// Resolvendo a segunda metade, `T(v−1, b, a)`.
    Recursando1,
    /// Apertando o melhor que apareceu, um degrau de cada vez.
    Descendo,
    /// Não há mais o que tentar.
    Parado,
}

/// O motor de Turán, dirigido em lotes de movimentos.
///
/// A tela pede `avancar(n)` e recebe o controle de volta: nada aqui roda até o
/// fim de uma vez, porque um celular precisa continuar respondendo enquanto o
/// motor trabalha.
pub struct Construtor {
    t: Instancia,
    orbital: Option<Orbital>,
    etapa: Etapa,

    /// A melhor cobertura completa já encontrada, em conjuntos de `a`.
    melhor: Vec<u32>,

    // ── busca em órbitas ──
    m: usize,
    /// Se este construtor é uma metade da recursão de outro.
    ///
    /// Metades entregam rápido e não procuram fino: o pai é quem tem tempo.
    sub_de_recursao: bool,
    /// O maior tamanho de órbita, para saber quando `m` já não pode ganhar.
    maior_orbita: usize,
    tentativa_orbital: usize,
    parado_orbital: usize,
    rodadas_no_m: u64,

    // ── recursão ──
    sub: Option<Box<Construtor>>,
    acumulado: Vec<u32>,
    /// O trabalho das peças que já foram descartadas.
    encerrado: u64,

    // ── descida ──
    /// A descida é o terceiro estágio da tela, e é ligada à mão.
    ///
    /// Sem esta trava o construtor iria da construção ao aperto sem parar, e o
    /// botão "Ativar otimização" não teria o que ativar — o número já teria sido
    /// apertado. Construir e apertar são duas decisões, e são de quem olha.
    descer_liberado: bool,
    guardado: Vec<u32>,
    alvo: Vec<u32>,
    tentativa: usize,
    movimentos_na_tentativa: u64,
    parado: usize,
}

impl Construtor {
    /// Devolve `None` quando o problema não é representável ou não cabe.
    ///
    /// A troca de ponto de vista exige garantia cheia — a cartela precisa conter
    /// o sorteio inteiro — e uma cartela premiada por sorteio. Fora disso, quem
    /// chamou fica com a escalada de sempre.
    pub fn novo(p: &Problema, semente: u64) -> Option<Construtor> {
        if p.t != p.j || p.r != 1 || p.k >= p.v || p.j > p.v {
            return None;
        }
        let (v, a, b) = (p.v, p.v - p.k, p.v - p.j);
        Construtor::da_instancia(v, a, b, semente, true)
    }

    /// Um construtor que só aperta, partindo de um fechamento já pronto.
    ///
    /// É o que faz o botão de otimizar continuar valendo depois de o aplicativo
    /// ser fechado e reaberto: o motor não é gravado, mas as cartelas que ele
    /// achou estão no trabalho guardado, e daqui ele retoma o aperto de onde
    /// elas estão.
    pub fn a_partir_de(p: &Problema, semente: u64, cartelas: &[Bloco]) -> Option<Construtor> {
        if cartelas.len() <= 1 {
            return None;
        }
        let mut c = Construtor::novo(p, semente)?;
        let cheio = mascara_cheia(p.v);
        c.melhor = cartelas.iter().map(|&b| cheio & !b).collect();
        c.orbital = None;
        c.sub = None;
        c.etapa = Etapa::Descendo;
        c.descer_liberado = true;
        Some(c)
    }

    fn da_instancia(
        v: usize,
        a: usize,
        b: usize,
        semente: u64,
        pode_recursar: bool,
    ) -> Option<Construtor> {
        let t = Instancia::nova(v, a, b, semente)?;
        let orbital = Orbital::novo(&t);

        // O menor número de conjuntos que a contagem permite, dividido pela
        // maior órbita: começar abaixo disso é gastar tentativa em degrau
        // impossível.
        let piso = t.coberto.len().div_ceil(t.cobre_de[0].len().max(1));
        let maior_orbita = orbital
            .as_ref()
            .and_then(|o| o.tamanho.iter().copied().max())
            .unwrap_or(1);

        // A recursão vem primeiro, e não por ser melhor — ela costuma ser pior.
        //
        // É que ela **sempre entrega**, e entrega cedo: monta a solução a partir
        // de dois casos menores, sem procurar nada. A busca em órbitas é mais
        // fina mas começa no menor número que a contagem permite e sobe até
        // algum cobrir, e até lá não há fechamento nenhum para mostrar. Com a
        // recursão na frente, quem toca no botão vê um fechamento completo em
        // poucos segundos e vê o número cair depois; com ela atrás, veria a tela
        // parada no que a escalada tinha deixado.
        // Encher vem antes de tudo, e é o que garante que exista um fechamento
        // para mostrar no primeiro segundo. As etapas seguintes são todas
        // tentativas de **melhorar** um número que já existe, e não a única
        // esperança de haver algum — foi assim que a tela ficava parada no que a
        // escalada tinha deixado enquanto o motor procurava.
        let etapa = Etapa::Enchendo;

        let construtor = Construtor {
            t,
            orbital,
            etapa,
            melhor: Vec::new(),
            m: piso.div_ceil(maior_orbita).max(1),
            sub_de_recursao: !pode_recursar,
            maior_orbita,
            tentativa_orbital: 0,
            parado_orbital: 0,
            rodadas_no_m: 0,
            sub: None,
            acumulado: Vec::new(),
            encerrado: 0,
            // As metades da recursão precisam ir até o fim sozinhas: quem
            // espera pelo botão é o construtor de cima.
            descer_liberado: !pode_recursar,
            guardado: Vec::new(),
            alvo: Vec::new(),
            tentativa: 0,
            movimentos_na_tentativa: 0,
            parado: 0,
        };
        Some(construtor)
    }

    /// Quantas cartelas a melhor cobertura completa tem. Zero se não houver.
    pub fn quantas(&self) -> usize {
        self.melhor.len()
    }

    /// Quanto trabalho real já foi feito, contando as duas buscas e as metades.
    ///
    /// `encerrado` guarda o que peças já descartadas gastaram. Sem ele o total
    /// **caía** quando a busca em órbitas terminava e era jogada fora — e quem
    /// cobra pela diferença passava a cobrar zero, ficando com orçamento
    /// infinito sem perceber.
    pub fn trabalho(&self) -> u64 {
        self.encerrado
            + self.t.trabalho
            + self.orbital.as_ref().map(|o| o.trabalho).unwrap_or(0)
            + self.sub.as_ref().map(|s| s.trabalho()).unwrap_or(0)
    }

    pub fn terminou(&self) -> bool {
        self.etapa == Etapa::Parado
    }

    /// Se já existe uma cobertura completa para mostrar.
    pub fn construiu(&self) -> bool {
        !self.melhor.is_empty()
    }

    /// Se a construção acabou e ele está esperando a ordem de apertar.
    pub fn esperando_o_aperto(&self) -> bool {
        self.etapa == Etapa::Descendo && !self.descer_liberado
    }

    /// Libera o terceiro estágio.
    pub fn liberar_a_descida(&mut self) {
        self.descer_liberado = true;
    }

    /// A melhor cobertura, já traduzida de volta para cartelas.
    ///
    /// Cada conjunto guardado são as dezenas que **faltam** à cartela: a volta é
    /// o complemento.
    pub fn cartelas(&self) -> Vec<Bloco> {
        let cheio = mascara_cheia(self.t.v);
        self.melhor.iter().map(|&c| cheio & !c).collect()
    }

    /// Um lote de trabalho. Devolve `true` se a melhor cobertura mudou.
    pub fn avancar(&mut self, movimentos: u64) -> bool {
        let antes = self.melhor.len();
        match self.etapa {
            Etapa::Enchendo => self.encher(movimentos),
            Etapa::Orbitando => self.orbitar(movimentos),
            Etapa::Recursando0 | Etapa::Recursando1 => self.recursar(movimentos),
            Etapa::Descendo => self.descer(movimentos),
            Etapa::Parado => {}
        }
        !self.melhor.is_empty() && (antes == 0 || self.melhor.len() < antes)
    }

    fn guardar_se_melhor(&mut self, conjuntos: Vec<u32>) {
        if !conjuntos.is_empty() && (self.melhor.is_empty() || conjuntos.len() < self.melhor.len()) {
            self.melhor = conjuntos;
        }
    }

    /// Um fechamento qualquer, pelo caminho mais curto.
    ///
    /// Toma um alvo descoberto e acrescenta o subconjunto dele que mais cobre.
    /// É o algoritmo guloso clássico, e a garantia dele — não passar de `H(d)`
    /// vezes o ótimo — é a única que uma construção deste tipo tem. Aqui ele
    /// não precisa ser bom: precisa ser **imediato**, para que tudo o que vier
    /// depois seja melhoria de um número que já está na tela.
    fn encher(&mut self, movimentos: u64) {
        for _ in 0..movimentos {
            if self.t.descobertos() == 0 {
                break;
            }
            let sorteado = proximo(&mut self.t.semente) as usize % self.t.lista.len();
            let alvo = self.t.desfazer(self.t.lista[sorteado] as usize);
            let dentro: Vec<u8> = (0..self.t.v as u8)
                .filter(|&e| alvo >> e & 1 == 1)
                .collect();

            let mut melhor = 0u32;
            let mut maior = 0usize;
            para_cada_subconjunto(&dentro, self.t.a, &mut |c| {
                let i = self.t.posicao(c);
                let ganho = self.t.cobre_de[i]
                    .iter()
                    .filter(|&&p| self.t.coberto[p as usize] == 0)
                    .count();
                if ganho > maior {
                    maior = ganho;
                    melhor = c;
                }
            });
            if maior == 0 {
                break;
            }
            self.t.por(melhor);
        }

        if self.t.descobertos() > 0 {
            return;
        }

        self.t.podar();
        let cheio = self.t.escolhidos.clone();
        self.guardar_se_melhor(cheio);

        // Com um fechamento na mão, o resto é melhoria — e a ordem entre as duas
        // melhorias importa.
        //
        // A busca em órbitas vem primeiro porque é ela que acerta em cheio
        // quando o fechamento publicado é cíclico: 240 = 12 × 20 em pool 20 com
        // jogos de 17. Ela é cara, e gastar orçamento antes dela custou
        // exatamente isso — medido, com o enchimento e a recursão na frente o
        // mesmo caso saía com 252 em vez de 240.
        //
        // A recursão vem depois, como segunda opinião: ela não depende de
        // simetria nenhuma e é o que atende os casos em que nenhuma união de
        // órbitas alcança o número publicado.
        //
        // As metades da recursão pulam as duas: elas existem para entregar
        // depressa, e a busca em órbitas delas custaria mais do que o pai
        // inteiro.
        self.etapa = if self.sub_de_recursao {
            Etapa::Descendo
        } else if self.orbital.is_some() {
            let m = self.m;
            if let Some(o) = self.orbital.as_mut() {
                o.partida(m);
            }
            Etapa::Orbitando
        } else {
            Etapa::Recursando0
        };
    }

    fn orbitar(&mut self, movimentos: u64) {
        let mut parado = self.parado_orbital;
        let (coberto, conjuntos, quantas_orbitas) = match self.orbital.as_mut() {
            None => {
                self.etapa = Etapa::Descendo;
                return;
            }
            Some(o) => {
                let coberto = o.rodar(movimentos.max(1), &mut parado);
                let conjuntos = if coberto { o.conjuntos() } else { Vec::new() };
                (coberto, conjuntos, o.cobre.len())
            }
        };
        self.parado_orbital = parado;
        self.rodadas_no_m += movimentos;

        if coberto {
            self.guardar_se_melhor(conjuntos);
            if self.m > 1 {
                self.m -= 1;
                self.tentativa_orbital = 0;
                self.rodadas_no_m = 0;
                self.parado_orbital = 0;
                let m = self.m;
                if let Some(o) = self.orbital.as_mut() {
                    o.partida(m);
                }
            } else {
                self.passar_da_orbita();
            }
            return;
        }

        if self.rodadas_no_m < RODADAS_POR_TENTATIVA_ORBITAL {
            return;
        }

        self.tentativa_orbital += 1;
        self.rodadas_no_m = 0;
        self.parado_orbital = 0;
        if self.tentativa_orbital >= TENTATIVAS_POR_DEGRAU {
            // Sobe um degrau enquanto houver esperança de a busca em órbitas
            // bater o que já está na mão. Passando disso, ela não tem mais o que
            // oferecer e a descida assume.
            self.m += 1;
            self.tentativa_orbital = 0;
            let sem_esperanca = self.m > quantas_orbitas
                || (!self.melhor.is_empty() && self.m * self.maior_orbita >= self.melhor.len());
            if sem_esperanca {
                self.passar_da_orbita();
                return;
            }
        }
        let m = self.m;
        if let Some(o) = self.orbital.as_mut() {
            o.partida(m);
        }
    }

    fn passar_da_orbita(&mut self) {
        if let Some(o) = self.orbital.as_ref() {
            self.encerrado += o.trabalho;
        }
        self.orbital = None;
        self.etapa = if self.sub_de_recursao {
            Etapa::Descendo
        } else {
            Etapa::Recursando0
        };
    }

    /// A recursão de Turán, um nível.
    ///
    /// `T(n, b, a) ≤ T(n−1, b−1, a−1) + T(n−1, b, a)`: fixa o último elemento,
    /// resolve os dois casos menores no resto, e acrescenta o elemento fixo aos
    /// conjuntos da primeira metade.
    fn recursar(&mut self, movimentos: u64) {
        let (v, a, b) = (self.t.v, self.t.a, self.t.b);
        let primeira = self.etapa == Etapa::Recursando0;

        if self.sub.is_none() {
            let (sa, sb) = if primeira { (a - 1, b - 1) } else { (a, b) };
            if sa == 0 || sa > sb {
                // Fundo do poço da primeira metade: um conjunto de zero
                // elementos cobre tudo, e o elemento fixo sozinho basta.
                self.acumulado.push(1 << (v - 1));
                self.etapa = Etapa::Recursando1;
                return;
            }
            match Construtor::da_instancia(v - 1, sa, sb, self.t.semente ^ 0xabcd, false) {
                Some(c) => self.sub = Some(Box::new(c)),
                None => {
                    self.etapa = Etapa::Descendo;
                    return;
                }
            }
        }

        let sub = self.sub.as_mut().unwrap();
        sub.avancar(movimentos);
        if !sub.terminou() {
            return;
        }

        let parte = sub.melhor.clone();
        self.encerrado += sub.trabalho();
        self.sub = None;
        if primeira {
            let fixo = 1u32 << (v - 1);
            self.acumulado.extend(parte.into_iter().map(|c| c | fixo));
            self.etapa = Etapa::Recursando1;
        } else {
            self.acumulado.extend(parte);
            let juntos = std::mem::take(&mut self.acumulado);
            self.guardar_se_melhor(juntos);

            self.etapa = Etapa::Descendo;
        }
    }

    fn descer(&mut self, movimentos: u64) {
        if self.melhor.is_empty() {
            self.etapa = Etapa::Parado;
            return;
        }
        if !self.descer_liberado {
            return;
        }

        // Primeira entrada na descida: carrega o melhor e poda.
        if self.alvo.is_empty() && self.guardado.is_empty() {
            let melhor = self.melhor.clone();
            self.t.refazer(&melhor);
            self.t.podar();
            self.melhor = self.t.escolhidos.clone();
            self.preparar_degrau();
        }

        for _ in 0..movimentos {
            if self.t.descobertos() == 0 {
                break;
            }
            if self.t.passo() {
                self.parado = 0;
            } else {
                self.parado += 1;
                if self.parado >= MOVIMENTOS_ATE_ENCARECER {
                    self.t.encarecer();
                    self.parado = 0;
                }
            }
        }
        self.movimentos_na_tentativa += movimentos;

        if self.t.descobertos() == 0 {
            self.t.podar();
            self.melhor = self.t.escolhidos.clone();
            self.preparar_degrau();
            return;
        }

        if self.movimentos_na_tentativa >= MOVIMENTOS_POR_TENTATIVA {
            self.tentativa += 1;
            self.movimentos_na_tentativa = 0;
            if self.tentativa >= TENTATIVAS_POR_DEGRAU {
                // Este tamanho não sai. Devolve o que valia e encerra.
                let guardado = std::mem::take(&mut self.guardado);
                self.t.refazer(&guardado);
                self.melhor = guardado;
                self.etapa = Etapa::Parado;
                return;
            }
            let alvo = self.alvo.clone();
            self.t.refazer(&alvo);
            self.t.zerar_pesos();
        }
    }

    /// Guarda o que já vale, tira o menos útil, e recomeça a contagem.
    fn preparar_degrau(&mut self) {
        self.guardado = self.t.escolhidos.clone();
        if self.t.escolhidos.len() <= 1 {
            self.etapa = Etapa::Parado;
            return;
        }
        self.t.tirar_o_menos_util();
        self.alvo = self.t.escolhidos.clone();
        self.t.zerar_pesos();
        self.tentativa = 0;
        self.movimentos_na_tentativa = 0;
        self.parado = 0;
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    /// Roda o construtor até ele parar, e devolve quantas cartelas saíram.
    fn resolver(v: usize, k: usize, teto: u64) -> usize {
        let p = Problema::novo(v, k, 15, 15, 1).unwrap();
        let mut c = Construtor::novo(&p, 20_260_901).expect("deveria ser representável");
        let mut lotes = 0;
        while !c.terminou() && lotes < teto {
            c.avancar(200_000);
            lotes += 1;
        }
        c.quantas()
    }

    /// **A cobertura precisa ser real.** Um motor que devolve um número bonito
    /// e não cumpre a garantia é pior do que motor nenhum.
    #[test]
    fn o_que_sai_cobre_de_verdade() {
        let p = Problema::novo(18, 17, 15, 15, 1).unwrap();
        let mut c = Construtor::novo(&p, 7).unwrap();
        for _ in 0..200 {
            if c.terminou() {
                break;
            }
            c.avancar(100_000);
        }
        let cartelas = c.cartelas();
        assert!(!cartelas.is_empty());

        // Toda cartela tem exatamente `k` dezenas.
        for &b in &cartelas {
            assert_eq!(b.count_ones() as usize, p.k, "cartela com tamanho errado");
        }

        // E todo sorteio possível está dentro de alguma delas.
        let alvos = crate::problema::combinacoes(p.v, p.j);
        for alvo in alvos {
            assert!(
                cartelas.iter().any(|&b| b & alvo == alvo),
                "sorteio descoberto"
            );
        }
    }

    /// **O caso que o motor anterior resolvia com 328 cartelas.**
    ///
    /// O melhor fechamento publicado tem 240, e é `12 × 20` — cíclico. A busca
    /// em espaço de órbitas existe para encontrar exatamente este.
    #[test]
    #[ignore]
    fn vinte_dezenas_com_jogos_de_dezessete() {
        let quantas = resolver(20, 17, 20_000);
        assert!(
            quantas <= 260,
            "saiu com {quantas} cartelas, e o melhor publicado tem 240"
        );
    }

    /// Garantia parcial e cartela premiada dupla não têm esta representação.
    #[test]
    fn recusa_o_que_nao_representa() {
        let parcial = Problema::novo(20, 17, 15, 14, 1).unwrap();
        assert!(Construtor::novo(&parcial, 1).is_none());

        let dupla = Problema::novo(20, 17, 15, 15, 2).unwrap();
        assert!(Construtor::novo(&dupla, 1).is_none());
    }
}
