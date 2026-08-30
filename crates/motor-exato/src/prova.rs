//! A prova: **existe alguma coisa menor?**
//!
//! Construir e provar são perguntas diferentes, e esta é a segunda. O
//! construtor devolve uma coleção que funciona; aqui se decide se alguma
//! coleção menor poderia funcionar — e a única resposta que vale é a que veio
//! de varrer o espaço inteiro, não de não ter achado nada procurando um pouco.
//!
//! ## A busca
//!
//! É um ramifica-e-poda sobre a cobertura mínima, com quatro coisas que fazem a
//! diferença entre terminar e não terminar:
//!
//! 1. **Ramificar pelo alvo mais apertado.** Todo fechamento precisa atender
//!    todo alvo; então escolhe-se o alvo com menos candidatos possíveis e
//!    ramifica-se sobre eles. O fator de ramificação fica o menor disponível, e
//!    a busca continua completa.
//! 2. **Cota por empacotamento.** Alvos que nenhum candidato atende em dupla
//!    exigem candidatos distintos. Contar quantos desses cabem no que falta dá
//!    um piso para o resto do ramo — e onde ele encosta no recorde, o ramo
//!    inteiro morre sem ser visitado.
//! 3. **Dominância.** Um alvo cujos candidatos são um superconjunto dos de
//!    outro alvo sai: atender o apertado atende o folgado.
//! 4. **Simetria.** A variante cíclica troca "escolher cartelas" por "escolher
//!    órbitas": o espaço encolhe por um fator de cerca de `v`, e o que ela
//!    prova é mínimo **dentro da simetria**, o que o relatório diz com essas
//!    palavras.
//!
//! ## A pilha é explícita, e é de propósito
//!
//! Uma recursão só devolve o controle quando termina, e uma varredura pode
//! levar minutos. Com a pilha à mão, a busca anda por orçamento: `avancar`
//! visita os nós que lhe pedirem e devolve onde parou, com o recorde e a
//! contagem. É o que permite a tela mostrar progresso em vez de ficar muda, e o
//! que permite parar no meio sem perder o que já se varreu.
//!
//! ## O orçamento, e por que ele é dito em voz alta
//!
//! Estourou o teto de nós, a busca devolve `Excedido` — e isso não é "não
//! existe menor", é "não sei". A diferença entre as duas afirmações é o crate
//! inteiro.

use crate::construtor::{orbita, orbitas_de_blocos};
use crate::problema::{Bloco, Problema};

/// Acima disto a instância não é montada: a matriz de cobertura não caberia.
pub const TETO_DE_CANDIDATOS: usize = 200_000;

/// Teto do produto alvos × candidatos, que é o custo de montar a instância.
pub const TETO_DO_PRODUTO: usize = 40_000_000;

/// Quanto trabalho a dominância pode custar antes de não valer a pena.
///
/// As duas dominâncias são quadráticas — uma nos alvos, outra nos candidatos —
/// e cada comparação percorre um vetor de palavras. Num pool de 20 com jogos de
/// 17 e garantia de 13 são 15.504 alvos e 1.140 candidatos: a dominância de
/// alvos sozinha daria 4,3 **bilhões** de comparações de palavra, e a tela
/// ficava parada esperando uma redução que ali não rende quase nada.
///
/// O teto anterior olhava só a contagem de candidatos, e por isso não via esse
/// caso chegando. Este olha o trabalho de verdade.
pub const TRABALHO_DA_DOMINANCIA: u128 = 50_000_000;

/// Quantos nós a busca livre visita antes de desistir e dizer que desistiu.
pub const ORCAMENTO_PADRAO: u64 = 60_000_000;

/// Quanto pode custar **um nó** para a varredura ainda fazer sentido.
///
/// Abrir um nó significa medir o ganho de cada candidata que atende o alvo
/// escolhido, e medir uma candidata custa percorrer os alvos que ela atende.
/// Num pool de 20 com jogos de 17 e garantia de 13 são 685 candidatas de 9.316
/// alvos cada: **seis milhões de operações por nó**, ou quinze nós por segundo.
/// Uma varredura assim não termina nem em teoria, e ficar rastejando nela é
/// pior do que dizer que não cabe — a tela fica parada prometendo uma prova que
/// não vem.
pub const TETO_DO_CUSTO_POR_NO: u128 = 2_000_000;

/// O que a busca conseguiu afirmar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Desfecho {
    /// A varredura terminou inteira e encontrou algo abaixo do teto: **este é o
    /// mínimo**, e nada menor existe.
    Minimo { tamanho: usize, blocos: Vec<Bloco> },
    /// A varredura terminou inteira e nada abaixo do teto existe.
    NadaAbaixoDe { teto: usize },
    /// O orçamento acabou antes da resposta. Não é "não existe": é "não sei".
    Excedido,
    /// A instância nem foi montada — grande demais para caber.
    GrandeDemais { candidatos: usize, alvos: usize },
}

impl Desfecho {
    /// Verdadeiro só quando a varredura foi completa.
    pub fn fechou(&self) -> bool {
        matches!(self, Desfecho::Minimo { .. } | Desfecho::NadaAbaixoDe { .. })
    }
}

/// O desfecho e o preço que ele custou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prova {
    pub desfecho: Desfecho,
    pub visitados: u64,
    pub candidatos: usize,
    pub alvos: usize,
}

/// A instância de cobertura, já reduzida.
///
/// Um *candidato* não é necessariamente uma cartela: na variante cíclica ele é
/// uma órbita inteira, que entra ou não entra em peso fechado. É essa indireção
/// que deixa a mesma busca servir às duas famílias.
#[derive(Debug, Clone)]
pub struct Instancia {
    /// Quantos alvos sobraram depois da redução.
    pub alvos: usize,
    /// Quantas vezes cada alvo precisa ser atendido.
    pub premiadas: usize,
    /// Por candidato, os índices dos alvos que ele atende.
    pub cobre: Vec<Vec<u32>>,
    /// Por candidato, quantas cartelas ele custa.
    pub peso: Vec<u32>,
    /// Por candidato, as cartelas que ele coloca na solução.
    pub blocos: Vec<Vec<Bloco>>,
    /// Por alvo, os candidatos que o atendem.
    pub por_alvo: Vec<Vec<u32>>,
    /// Os alvos em ordem crescente de quantos candidatos os atendem.
    pub ordem: Vec<u32>,
    /// Por alvo, o menor peso entre os candidatos que o atendem.
    pub menor_peso: Vec<u32>,
    /// A maior cobertura por unidade de peso, como fração `(alvos, peso)`.
    pub densidade: (u32, u32),
    /// Quantos alvos a dominância dispensou.
    pub alvos_dispensados: usize,
    /// Quantos candidatos a dominância dispensou.
    pub candidatos_dispensados: usize,
}

impl Instancia {
    /// A instância livre: um candidato por cartela, peso 1.
    pub fn livre(p: &Problema) -> Option<Instancia> {
        if !vale_varrer(p) {
            return None;
        }
        let blocos = p.blocos();
        let alvos = p.alvos();
        if blocos.len() > TETO_DE_CANDIDATOS
            || blocos.len().saturating_mul(alvos.len()) > TETO_DO_PRODUTO
        {
            return None;
        }
        let candidatos: Vec<Vec<Bloco>> = blocos.into_iter().map(|b| vec![b]).collect();
        Some(Instancia::montar(p, &alvos, candidatos))
    }

    /// A instância cíclica: um candidato por órbita, peso igual ao seu tamanho.
    pub fn ciclica(p: &Problema) -> Option<Instancia> {
        if !vale_varrer(p) {
            return None;
        }
        let alvos = p.alvos();
        if p.total_de_blocos() > TETO_DE_CANDIDATOS as u128 {
            return None;
        }
        let representantes = orbitas_de_blocos(p);
        if representantes.is_empty() {
            return None;
        }
        let candidatos: Vec<Vec<Bloco>> =
            representantes.into_iter().map(|r| orbita(r, p.v)).collect();
        let custo: usize = candidatos.iter().map(|c| c.len()).sum();
        if custo.saturating_mul(alvos.len()) > TETO_DO_PRODUTO {
            return None;
        }
        Some(Instancia::montar(p, &alvos, candidatos))
    }

    /// Monta a matriz de cobertura e aplica as dominâncias que valem.
    fn montar(p: &Problema, alvos: &[Bloco], candidatos: Vec<Vec<Bloco>>) -> Instancia {
        let mut cobre: Vec<Vec<u32>> = Vec::with_capacity(candidatos.len());
        for grupo in &candidatos {
            let mut lista = Vec::new();
            for (i, &alvo) in alvos.iter().enumerate() {
                if grupo.iter().any(|&b| p.atende(alvo, b)) {
                    lista.push(i as u32);
                }
            }
            cobre.push(lista);
        }

        let mut vivos_alvo = vec![true; alvos.len()];
        let mut vivos_cand: Vec<bool> = cobre.iter().map(|c| !c.is_empty()).collect();
        let mut alvos_dispensados = 0;
        let mut candidatos_dispensados = vivos_cand.iter().filter(|v| !**v).count();

        // Dominância de alvos: se todo candidato que atende `a` também atende
        // `b`, então atender `a` já atendeu `b` — inclusive quantas vezes for
        // preciso, o que a mantém válida com `r > 1`.
        let palavras_por_alvo = candidatos.len().div_ceil(64) as u128;
        let custo_dos_alvos =
            (alvos.len() as u128) * (alvos.len() as u128) * palavras_por_alvo.max(1);
        if custo_dos_alvos <= TRABALHO_DA_DOMINANCIA {
            let palavras = candidatos.len().div_ceil(64);
            let mut quem: Vec<Vec<u64>> = vec![vec![0u64; palavras]; alvos.len()];
            for (c, lista) in cobre.iter().enumerate() {
                if !vivos_cand[c] {
                    continue;
                }
                for &a in lista {
                    quem[a as usize][c >> 6] |= 1u64 << (c & 63);
                }
            }
            for a in 0..alvos.len() {
                if !vivos_alvo[a] {
                    continue;
                }
                for b in 0..alvos.len() {
                    if a == b || !vivos_alvo[b] {
                        continue;
                    }
                    let dentro = quem[a].iter().zip(&quem[b]).all(|(x, y)| x & !y == 0);
                    let igual = quem[a] == quem[b];
                    if dentro && (!igual || a < b) {
                        vivos_alvo[b] = false;
                        alvos_dispensados += 1;
                    }
                }
            }

        }

        // Dominância de candidatos: atender menos custando o mesmo ou mais é
        // nunca ser necessário — **quando basta uma cartela por alvo**.
        //
        // Com `r > 1` ela deixa de valer, e a diferença é sutil o bastante para
        // merecer o parágrafo: o argumento é "troque o dominado pelo
        // dominante", e ele cai quando o dominante já está na solução. Aí são
        // precisos dois candidatos distintos, e o dominado pode ser justamente
        // o segundo. Por isso ela só roda com `r == 1`.
        {
            let vivos_agora = (0..alvos.len()).filter(|&a| vivos_alvo[a]).count() as u128;
            let palavras_por_candidato = vivos_agora.div_ceil(64).max(1);
            let custo = (candidatos.len() as u128).pow(2) * palavras_por_candidato;
            if p.r == 1 && custo <= TRABALHO_DA_DOMINANCIA {
                let sobrando: Vec<usize> = (0..alvos.len()).filter(|&a| vivos_alvo[a]).collect();
                let mut posicao = vec![usize::MAX; alvos.len()];
                for (nova, &antiga) in sobrando.iter().enumerate() {
                    posicao[antiga] = nova;
                }
                let palavras = sobrando.len().div_ceil(64);
                let mut mapa: Vec<Vec<u64>> = vec![vec![0u64; palavras]; candidatos.len()];
                for (c, lista) in cobre.iter().enumerate() {
                    for &a in lista {
                        let n = posicao[a as usize];
                        if n != usize::MAX {
                            mapa[c][n >> 6] |= 1u64 << (n & 63);
                        }
                    }
                }
                for x in 0..candidatos.len() {
                    if !vivos_cand[x] {
                        continue;
                    }
                    if mapa[x].iter().all(|w| *w == 0) {
                        vivos_cand[x] = false;
                        candidatos_dispensados += 1;
                        continue;
                    }
                    for y in 0..candidatos.len() {
                        if x == y || !vivos_cand[y] {
                            continue;
                        }
                        let dentro = mapa[x].iter().zip(&mapa[y]).all(|(a, b)| a & !b == 0);
                        if !dentro {
                            continue;
                        }
                        let px = candidatos[x].len() as u32;
                        let py = candidatos[y].len() as u32;
                        let igual = mapa[x] == mapa[y] && px == py;
                        if py <= px && (!igual || y < x) {
                            vivos_cand[x] = false;
                            candidatos_dispensados += 1;
                            break;
                        }
                    }
                }
            }
        }

        // Reindexa o que sobrou.
        let sobrando: Vec<usize> = (0..alvos.len()).filter(|&a| vivos_alvo[a]).collect();
        let mut posicao = vec![u32::MAX; alvos.len()];
        for (nova, &antiga) in sobrando.iter().enumerate() {
            posicao[antiga] = nova as u32;
        }

        let mut nova_cobre = Vec::new();
        let mut nova_peso = Vec::new();
        let mut novos_blocos = Vec::new();
        for (c, lista) in cobre.iter().enumerate() {
            if !vivos_cand[c] {
                continue;
            }
            let reduzida: Vec<u32> =
                lista.iter().map(|&a| posicao[a as usize]).filter(|&n| n != u32::MAX).collect();
            if reduzida.is_empty() {
                continue;
            }
            nova_cobre.push(reduzida);
            nova_peso.push(candidatos[c].len() as u32);
            novos_blocos.push(candidatos[c].clone());
        }

        let alvos_vivos = sobrando.len();
        let mut por_alvo: Vec<Vec<u32>> = vec![Vec::new(); alvos_vivos];
        for (c, lista) in nova_cobre.iter().enumerate() {
            for &a in lista {
                por_alvo[a as usize].push(c as u32);
            }
        }
        let menor_peso: Vec<u32> = por_alvo
            .iter()
            .map(|cs| cs.iter().map(|&c| nova_peso[c as usize]).min().unwrap_or(u32::MAX))
            .collect();
        let mut ordem: Vec<u32> = (0..alvos_vivos as u32).collect();
        ordem.sort_by_key(|&a| por_alvo[a as usize].len());

        // A melhor razão cobertura/peso entre todos os candidatos. Nenhum
        // candidato rende mais que isto, então o que falta dividido por ela é um
        // piso — a mesma cota de contagem, medida dentro da busca.
        let mut densidade = (1u32, 1u32);
        for (c, lista) in nova_cobre.iter().enumerate() {
            let num = lista.len() as u32;
            let den = nova_peso[c];
            if den > 0 && (num as u64) * (densidade.1 as u64) > (densidade.0 as u64) * (den as u64) {
                densidade = (num, den);
            }
        }

        Instancia {
            alvos: alvos_vivos,
            premiadas: p.r,
            cobre: nova_cobre,
            peso: nova_peso,
            blocos: novos_blocos,
            por_alvo,
            ordem,
            menor_peso,
            densidade,
            alvos_dispensados,
            candidatos_dispensados,
        }
    }

    /// Verdadeiro quando algum alvo não tem candidatos suficientes.
    pub fn impossivel(&self) -> bool {
        self.por_alvo.iter().any(|c| c.len() < self.premiadas)
    }
}

/// Verdadeiro quando um nó da varredura custa pouco o bastante para valer.
fn vale_varrer(p: &Problema) -> bool {
    p.blocos_por_alvo().saturating_mul(p.alvos_por_bloco()) <= TETO_DO_CUSTO_POR_NO
}

/// Verdadeiro quando a instância livre caberia — **sem montá-la**.
///
/// Serve a quem precisa decidir se vale a pena entrar num caminho caro antes de
/// pagar a entrada. Só conta binomiais.
pub fn cabe_a_instancia(p: &Problema) -> bool {
    let blocos = p.total_de_blocos();
    let alvos = p.total_de_alvos() as u128;
    vale_varrer(p)
        && blocos <= TETO_DE_CANDIDATOS as u128
        && blocos.saturating_mul(alvos) <= TETO_DO_PRODUTO as u128
}

/// Um nível da busca: o alvo escolhido, os ramos, e o que está aplicado.
struct Quadro {
    ramos: Vec<u32>,
    proximo: usize,
    /// O candidato aplicado por este quadro, à espera de ser desfeito.
    aplicado: Option<u32>,
    /// Quantas cópias ele resolveu, para desfazer a contagem sem recontar.
    resolvidas: usize,
}

/// Onde a busca está.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Andamento {
    pub visitados: u64,
    /// O tamanho do melhor achado até agora, ou o teto se nada foi achado.
    pub recorde: usize,
    /// Profundidade atual da pilha — quantas cartelas o ramo já tem.
    pub profundidade: usize,
    /// Verdadeiro quando a varredura terminou inteira.
    pub terminou: bool,
}

/// A varredura, com pilha explícita e andando por orçamento.
pub struct BuscaExata {
    inst: Instancia,
    pilha: Vec<Quadro>,
    /// Quantas cartelas do ramo atual atendem cada alvo.
    ///
    /// A contagem **não** é limitada em `r`, e isso é o que torna o desfazer
    /// exato: aplicar soma um a cada alvo da cartela, desfazer tira um de cada
    /// um. Com a contagem limitada não há como saber, ao desfazer, quais alvos
    /// tinham de fato subido — e desfazer os errados fazia a busca dizer que
    /// tinha encontrado solução onde não havia.
    vezes: Vec<u16>,
    /// Cópias que ainda faltam no ramo atual.
    faltam: usize,
    /// Candidatos já usados no ramo atual — um candidato entra uma vez só.
    usado: Vec<bool>,
    escolhidos: Vec<u32>,
    custo: u32,
    melhor: u32,
    melhor_escolha: Option<Vec<u32>>,
    carimbo: Vec<u64>,
    marca: u64,
    nos: u64,
    terminou: bool,
    comecou: bool,
}

impl BuscaExata {
    pub fn nova(inst: Instancia, teto: usize) -> BuscaExata {
        let alvos = inst.alvos;
        let candidatos = inst.cobre.len();
        let impossivel = inst.impossivel() || teto == 0;
        BuscaExata {
            inst,
            pilha: Vec::new(),
            vezes: vec![0; alvos],
            // O verdadeiro valor só existe quando a busca começa, porque
            // depende de `premiadas`; até lá, zero.
            faltam: 0,
            usado: vec![false; candidatos],
            escolhidos: Vec::new(),
            custo: 0,
            melhor: teto as u32,
            melhor_escolha: None,
            carimbo: vec![0; alvos],
            marca: 0,
            nos: 0,
            terminou: impossivel,
            comecou: impossivel,
        }
    }

    pub fn andamento(&self) -> Andamento {
        Andamento {
            visitados: self.nos,
            recorde: self.melhor as usize,
            profundidade: self.escolhidos.len(),
            terminou: self.terminou,
        }
    }

    /// O desfecho, quando a varredura terminou — e o honesto quando não.
    pub fn desfecho(&self) -> Desfecho {
        if !self.terminou {
            return Desfecho::Excedido;
        }
        match &self.melhor_escolha {
            Some(escolha) => {
                let mut blocos: Vec<Bloco> = escolha
                    .iter()
                    .flat_map(|&c| self.inst.blocos[c as usize].iter().copied())
                    .collect();
                blocos.sort_unstable();
                blocos.dedup();
                Desfecho::Minimo { tamanho: self.melhor as usize, blocos }
            }
            None => Desfecho::NadaAbaixoDe { teto: self.melhor as usize },
        }
    }

    pub fn visitados(&self) -> u64 {
        self.nos
    }

    /// Visita até `nos` nós e devolve onde parou.
    pub fn avancar(&mut self, nos: u64) -> Andamento {
        if self.terminou {
            return self.andamento();
        }
        if !self.comecou {
            self.comecou = true;
            self.faltam = self.inst.alvos * self.inst.premiadas;
            self.nos += 1;
            if self.faltam == 0 {
                self.terminou = true;
                return self.andamento();
            }
            if self.cota() >= self.melhor {
                self.terminou = true;
                return self.andamento();
            }
            match self.abrir_quadro() {
                Some(q) => self.pilha.push(q),
                None => {
                    self.terminou = true;
                    return self.andamento();
                }
            }
        }

        let ate = self.nos.saturating_add(nos.max(1));
        while self.nos < ate {
            if self.pilha.is_empty() {
                self.terminou = true;
                break;
            }

            // Desfaz o candidato que este quadro tinha aplicado, se havia.
            if let Some(c) = self.pilha.last_mut().and_then(|q| q.aplicado.take()) {
                let resolvidas = self.pilha.last().map_or(0, |q| q.resolvidas);
                self.desaplicar(c, resolvidas);
            }

            let topo = self.pilha.last_mut().expect("pilha não vazia");
            if topo.proximo >= topo.ramos.len() {
                self.pilha.pop();
                continue;
            }
            let candidato = topo.ramos[topo.proximo];
            topo.proximo += 1;

            let peso = self.inst.peso[candidato as usize];
            if self.custo.saturating_add(peso) >= self.melhor {
                continue;
            }

            let resolvidas = self.aplicar(candidato);
            if let Some(topo) = self.pilha.last_mut() {
                topo.aplicado = Some(candidato);
                topo.resolvidas = resolvidas;
            }
            self.nos += 1;

            if self.faltam == 0 {
                // Uma solução completa, e melhor que o recorde por construção:
                // o corte de peso acima já garantiu isso.
                self.melhor = self.custo;
                self.melhor_escolha = Some(self.escolhidos.clone());
                continue;
            }
            if self.custo.saturating_add(self.cota()) >= self.melhor {
                continue;
            }
            match self.abrir_quadro() {
                Some(q) => self.pilha.push(q),
                None => continue,
            }
        }

        if self.pilha.is_empty() {
            self.terminou = true;
        }
        self.andamento()
    }

    /// O quadro do próximo alvo ainda em falta, com os candidatos que o atendem.
    fn abrir_quadro(&mut self) -> Option<Quadro> {
        let alvo_r = self.inst.premiadas.min(u16::MAX as usize) as u16;
        let alvo = self.inst.ordem.iter().copied().find(|&t| self.vezes[t as usize] < alvo_r)?;

        let mut ramos: Vec<(u32, usize)> = self.inst.por_alvo[alvo as usize]
            .iter()
            .copied()
            .filter(|&c| !self.usado[c as usize])
            .map(|c| (c, self.ganho(c)))
            .collect();
        if ramos.is_empty() {
            return None;
        }
        ramos.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        Some(Quadro {
            ramos: ramos.into_iter().map(|(c, _)| c).collect(),
            proximo: 0,
            aplicado: None,
            resolvidas: 0,
        })
    }

    fn aplicar(&mut self, candidato: u32) -> usize {
        let alvo_r = self.inst.premiadas.min(u16::MAX as usize) as u16;
        let mut resolvidas = 0;
        for &a in &self.inst.cobre[candidato as usize] {
            let a = a as usize;
            if self.vezes[a] < alvo_r {
                resolvidas += 1;
            }
            self.vezes[a] += 1;
        }
        self.faltam -= resolvidas;
        self.custo += self.inst.peso[candidato as usize];
        self.usado[candidato as usize] = true;
        self.escolhidos.push(candidato);
        resolvidas
    }

    fn desaplicar(&mut self, candidato: u32, resolvidas: usize) {
        for &a in &self.inst.cobre[candidato as usize] {
            self.vezes[a as usize] -= 1;
        }
        self.faltam += resolvidas;
        self.custo -= self.inst.peso[candidato as usize];
        self.usado[candidato as usize] = false;
        self.escolhidos.pop();
    }

    /// Quantas cópias em falta este candidato acrescentaria.
    fn ganho(&self, c: u32) -> usize {
        let alvo_r = self.inst.premiadas.min(u16::MAX as usize) as u16;
        self.inst.cobre[c as usize].iter().filter(|&&a| self.vezes[a as usize] < alvo_r).count()
    }

    /// O piso do que ainda falta neste ramo.
    ///
    /// Duas afirmações independentes, e vale a mais forte:
    ///
    /// - **contagem** — nenhum candidato rende mais que a melhor densidade, e o
    ///   que falta dividido por ela é um piso. Custa três operações.
    /// - **empacotamento** — alvos que nenhum candidato atende em dupla exigem
    ///   candidatos distintos, `r` para cada um. Somar os menores pesos desses
    ///   alvos é um piso honesto, e assim que ele já derruba o ramo a soma para.
    fn cota(&mut self) -> u32 {
        let (num, den) = self.inst.densidade;
        let contagem = if num == 0 {
            0
        } else {
            ((self.faltam as u64 * den as u64).div_ceil(num as u64)).min(u32::MAX as u64) as u32
        };
        if self.custo.saturating_add(contagem) >= self.melhor {
            return contagem;
        }

        self.marca += 1;
        let marca = self.marca;
        let alvo_r = self.inst.premiadas.min(u16::MAX as usize) as u16;
        let premiadas = self.inst.premiadas as u32;
        let mut soma = 0u32;
        for &t in &self.inst.ordem {
            let t = t as usize;
            if self.vezes[t] >= alvo_r || self.carimbo[t] == marca {
                continue;
            }
            let faltando = premiadas.saturating_sub(self.vezes[t] as u32);
            soma = soma.saturating_add(self.inst.menor_peso[t].saturating_mul(faltando));
            if self.custo.saturating_add(soma) >= self.melhor {
                return soma;
            }
            for &c in &self.inst.por_alvo[t] {
                for &u in &self.inst.cobre[c as usize] {
                    self.carimbo[u as usize] = marca;
                }
            }
        }
        soma.max(contagem)
    }
}

/// Varre a instância inteira atrás de algo abaixo de `teto`.
///
/// `teto` é o tamanho da melhor construção conhecida, em cartelas. A busca só
/// aceita soluções estritamente menores — o que já se tem não precisa ser
/// reencontrado.
pub fn resolver(inst: &Instancia, teto: usize, orcamento: u64) -> Prova {
    let candidatos = inst.cobre.len();
    let alvos = inst.alvos;
    let mut busca = BuscaExata::nova(inst.clone(), teto);
    busca.avancar(orcamento);
    Prova { desfecho: busca.desfecho(), visitados: busca.visitados(), candidatos, alvos }
}

fn grande_demais(p: &Problema) -> Prova {
    Prova {
        desfecho: Desfecho::GrandeDemais {
            candidatos: p.total_de_blocos().min(usize::MAX as u128) as usize,
            alvos: p.total_de_alvos(),
        },
        visitados: 0,
        candidatos: 0,
        alvos: p.total_de_alvos(),
    }
}

/// A prova sem restrição: vale para todas as coleções, com ou sem simetria.
pub fn provar_livre(p: &Problema, teto: usize, orcamento: u64) -> Prova {
    match Instancia::livre(p) {
        Some(inst) => resolver(&inst, teto, orcamento),
        None => grande_demais(p),
    }
}

/// A prova dentro da simetria cíclica: espaço muito menor, afirmação mais fraca.
pub fn provar_ciclica(p: &Problema, teto: usize, orcamento: u64) -> Prova {
    match Instancia::ciclica(p) {
        Some(inst) => resolver(&inst, teto, orcamento),
        None => grande_demais(p),
    }
}
#[cfg(test)]
mod testes {
    use super::*;
    use crate::limites;

    /// **A invariante que amarra os dois módulos.** Uma cota inferior diz que
    /// nada menor existe; a busca exaustiva sai procurando exatamente isso. Se
    /// ela achasse, uma das duas estaria errada — e o teste não precisa saber
    /// qual é o mínimo para cobrar isso.
    #[test]
    fn a_busca_nunca_encontra_solucao_abaixo_de_uma_cota_provada() {
        for v in 5..=11usize {
            for k in 2..v.min(6) {
                for t in 1..=k.min(3) {
                    let Ok(p) = Problema::cobertura(v, k, t) else { continue };
                    let piso = limites::sem_busca(&p);
                    let prova = provar_livre(&p, piso.valor as usize, 300_000);
                    assert!(
                        !matches!(prova.desfecho, Desfecho::Minimo { .. }),
                        "C({v},{k},{t}): a busca achou algo abaixo da cota {} ({})",
                        piso.valor,
                        piso.origem
                    );
                }
            }
        }
    }

    /// Dois desenhos que não dependem de tabela nenhuma: o plano de Fano tem 7
    /// blocos e o sistema de Steiner de ordem 9 tem 12. A exaustão precisa
    /// chegar neles, e a coleção devolvida precisa cobrir de verdade.
    #[test]
    fn a_exaustao_reencontra_os_dois_desenhos_classicos() {
        for &(v, k, t, minimo) in &[(7usize, 3usize, 2usize, 7usize), (9, 3, 2, 12)] {
            let p = Problema::cobertura(v, k, t).unwrap();
            let prova = provar_livre(&p, minimo + 3, 20_000_000);
            match &prova.desfecho {
                Desfecho::Minimo { tamanho, blocos } => {
                    assert_eq!(*tamanho, minimo, "C({v},{k},{t})");
                    assert!(p.cobre(blocos), "C({v},{k},{t}): a solução ótima não cobre");
                    assert_eq!(blocos.len(), *tamanho);
                }
                outro => panic!("C({v},{k},{t}) não fechou: {outro:?}"),
            }
        }
    }

    #[test]
    fn tudo_que_a_busca_devolve_cobre_de_verdade() {
        // O verificador é conferido contra **todos** os alvos originais, e não
        // contra os que sobraram da redução — é aí que um descarte indevido na
        // dominância apareceria.
        for &(v, k, t) in &[(6usize, 3usize, 2usize), (7, 3, 2), (8, 4, 3), (9, 3, 2)] {
            let p = Problema::cobertura(v, k, t).unwrap();
            let teto = crate::construtor::construir(&p).tamanho() + 2;
            let prova = provar_livre(&p, teto, 5_000_000);
            if let Desfecho::Minimo { tamanho, blocos } = &prova.desfecho {
                assert!(p.cobre(blocos), "C({v},{k},{t})");
                assert_eq!(blocos.len(), *tamanho);
            }
        }
    }

    #[test]
    fn a_busca_ciclica_encolhe_o_espaco_e_continua_cobrindo() {
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let livre = Instancia::livre(&p).unwrap();
        let ciclica = Instancia::ciclica(&p).unwrap();
        assert!(
            ciclica.cobre.len() < livre.cobre.len(),
            "órbitas: {} candidatos, blocos: {}",
            ciclica.cobre.len(),
            livre.cobre.len()
        );
        let prova = resolver(&ciclica, 30, 10_000_000);
        match prova.desfecho {
            Desfecho::Minimo { blocos, .. } => {
                assert!(p.cobre(&blocos));
                // Uma solução cíclica é união de órbitas inteiras: girá-la
                // devolve ela mesma. É o que "dentro da simetria" quer dizer.
                let girada: Vec<Bloco> = {
                    let mut g: Vec<Bloco> =
                        blocos.iter().map(|&b| crate::construtor::girar(b, 9)).collect();
                    g.sort_unstable();
                    g
                };
                assert_eq!(girada, blocos, "a solução cíclica não é fechada por rotação");
            }
            outro => panic!("a cíclica não fechou: {outro:?}"),
        }
    }

    #[test]
    fn o_orcamento_curto_devolve_nao_sei_e_nao_uma_mentira() {
        let p = Problema::cobertura(13, 5, 2).unwrap();
        let prova = provar_livre(&p, 10, 5_000);
        assert_eq!(prova.desfecho, Desfecho::Excedido);
        assert!(!prova.desfecho.fechou(), "orçamento estourado não pode contar como prova");
    }

    #[test]
    fn um_teto_apertado_demais_devolve_nada_abaixo() {
        // C(7,3,2) vale 7; procurar abaixo de 5 tem de varrer tudo e voltar de
        // mãos vazias, sem inventar solução.
        let p = Problema::cobertura(7, 3, 2).unwrap();
        let prova = provar_livre(&p, 5, 40_000_000);
        assert_eq!(prova.desfecho, Desfecho::NadaAbaixoDe { teto: 5 });
        assert!(prova.desfecho.fechou());
    }

    /// **A garantia contra a tela muda.** Andar em fatias tem de dar exatamente
    /// o mesmo desfecho que andar de uma vez — mesmo mínimo, mesmas cartelas,
    /// mesmo número de nós. Se divergirem, o progresso que a tela mostra está
    /// contando uma história diferente da que o motor está vivendo.
    #[test]
    fn varrer_em_fatias_da_no_mesmo_que_varrer_de_uma_vez() {
        for &(v, k, t) in &[(7usize, 3usize, 2usize), (9, 3, 2), (6, 3, 2), (8, 4, 3)] {
            let p = Problema::cobertura(v, k, t).unwrap();
            let inst = Instancia::livre(&p).unwrap();
            let teto = crate::construtor::construir(&p).tamanho() + 2;

            let inteiro = resolver(&inst, teto, 50_000_000);
            assert!(inteiro.desfecho.fechou(), "C({v},{k},{t}) não fechou de uma vez");

            let mut fatiado = BuscaExata::nova(inst.clone(), teto);
            let mut voltas = 0;
            while !fatiado.andamento().terminou {
                fatiado.avancar(37);
                voltas += 1;
                assert!(voltas < 5_000_000, "C({v},{k},{t}) fatiado não termina");
            }
            // Só faz sentido exigir várias fatias quando há mais nós que uma
            // fatia: nos casos minúsculos a poda fecha tudo de primeira.
            assert!(
                voltas > 1 || inteiro.visitados <= 37,
                "C({v},{k},{t}) varreu {} nós numa fatia só de 37",
                inteiro.visitados
            );
            assert_eq!(fatiado.desfecho(), inteiro.desfecho, "C({v},{k},{t}) divergiu");
            assert_eq!(fatiado.visitados(), inteiro.visitados, "C({v},{k},{t}): nós diferentes");
        }
    }

    /// O andamento precisa andar, e o recorde precisa só melhorar.
    #[test]
    fn o_andamento_da_busca_avanca_e_o_recorde_nunca_piora() {
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let inst = Instancia::livre(&p).unwrap();
        let mut busca = BuscaExata::nova(inst, 16);
        let mut anterior = busca.andamento();
        for _ in 0..200_000 {
            let agora = busca.avancar(50);
            assert!(agora.visitados >= anterior.visitados);
            assert!(agora.recorde <= anterior.recorde, "o recorde piorou");
            if agora.terminou {
                assert_eq!(agora.recorde, 12, "o mínimo de C(9,3,2)");
                return;
            }
            anterior = agora;
        }
        panic!("a busca não terminou");
    }

    /// Com duas cartelas premiadas o mínimo muda, e a busca precisa achar o
    /// novo — não o antigo dobrado.
    #[test]
    fn a_busca_resolve_com_mais_de_uma_cartela_premiada() {
        let simples = Problema::novo(7, 3, 2, 2, 1).unwrap();
        let dobrado = Problema::novo(7, 3, 2, 2, 2).unwrap();

        let um = provar_livre(&simples, 12, 50_000_000);
        let dois = provar_livre(&dobrado, 24, 50_000_000);
        assert!(um.desfecho.fechou() && dois.desfecho.fechou());

        let tamanho = |d: &Desfecho| match d {
            Desfecho::Minimo { tamanho, .. } => *tamanho,
            Desfecho::NadaAbaixoDe { teto } => *teto,
            outro => panic!("não fechou: {outro:?}"),
        };
        let a = tamanho(&um.desfecho);
        let b = tamanho(&dois.desfecho);
        assert_eq!(a, 7, "C(7,3,2) = 7");
        assert!(b > a, "pedir duas premiadas não pode custar o mesmo: {b} contra {a}");
        assert!(b <= 2 * a, "e não deveria custar o dobro: {b} contra {a}");

        // E o que ela devolve precisa passar pelo verificador, com as cópias.
        if let Desfecho::Minimo { blocos, .. } = &dois.desfecho {
            assert!(dobrado.cobre(blocos), "a solução de r=2 não atende duas vezes");
        }
    }

    #[test]
    fn a_dominancia_so_descarta_o_que_sobra() {
        // Na instância livre todos os candidatos cobrem exatamente C(k,t) alvos,
        // então nenhum domina outro e nada pode ser descartado. Na cíclica, onde
        // as órbitas têm tamanhos diferentes, ela morde.
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let livre = Instancia::livre(&p).unwrap();
        assert_eq!(livre.candidatos_dispensados, 0, "a instância livre não tem dominado");
        assert_eq!(livre.alvos, p.total_de_alvos());
    }
}
