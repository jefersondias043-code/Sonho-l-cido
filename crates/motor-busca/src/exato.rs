//! Cobertura mínima resolvida **ao certo** — e por que isso não roda no celular.
//!
//! O resto deste crate procura soluções boas sem nunca saber se são as melhores.
//! Aqui é o contrário: um ramifica-e-limita que devolve o ótimo com prova, ou
//! admite que não conseguiu. Ele é lento por natureza, e o teto de nós existe
//! para que essa lentidão seja sempre uma resposta e nunca um travamento.
//!
//! ## Os dois usos, e a fronteira entre eles
//!
//! 1. **Turán exato pequeno.** Resolvendo `T(n, b, a)` sem restrição nenhuma
//!    para `n` pequeno, o valor obtido é um **limite inferior provado**, e a
//!    recorrência `motor_core::limites::elevar_turan` o carrega para os `n` grandes que
//!    a modalidade usa. É o que levanta o piso mostrado na tela.
//!
//! 2. **O melhor fechamento cíclico.** Resolvendo a instância já reduzida a
//!    órbitas, o valor obtido é o menor fechamento **daquela família**. É um
//!    limite superior: melhora o banco, e não diz nada sobre o mínimo geral.
//!
//! Confundir os dois seria a maneira mais fácil de esta peça causar dano — um
//! piso alto demais faz o aplicativo declarar impossível uma solução que existe.
//! O `motor-core` já separa as duas ideias em `referencia::Referencia`, e a
//! separação vale igual aqui.

/// O problema, na forma em que `construtor::por_orbitas` já o monta.
#[derive(Debug, Clone)]
pub struct Instancia {
    /// Para cada candidato, os alvos que ele cobre. Ordenado e sem repetição.
    cobre: Vec<Vec<u32>>,
    /// O que custa escolher cada candidato. Em órbitas é o tamanho da órbita —
    /// escolher uma traz todas as rotações junto; em cartelas soltas é 1.
    peso: Vec<u64>,
    alvos: usize,
}

/// Como a busca exata terminou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Desfecho {
    /// O menor peso possível, com a escolha que o realiza. Índices na numeração
    /// original dos candidatos, mesmo quando a redução descartou alguns.
    Otimo { escolha: Vec<usize>, peso: u64 },
    /// Algum alvo não é coberto por candidato nenhum.
    Inviavel,
    /// Estourou o teto de nós. Não se sabe o ótimo — e dizer isso é o ponto.
    Excedido,
}

impl Instancia {
    /// Falha quando algum candidato aponta para alvo inexistente: é erro de
    /// quem montou, e passar batido daria uma "prova" sobre outro problema.
    pub fn nova(cobre: Vec<Vec<u32>>, peso: Vec<u64>, alvos: usize) -> Option<Self> {
        if cobre.len() != peso.len() {
            return None;
        }
        if cobre.iter().flatten().any(|&a| a as usize >= alvos) {
            return None;
        }
        Some(Instancia { cobre, peso, alvos })
    }

    pub fn candidatos(&self) -> usize {
        self.cobre.len()
    }

    pub fn alvos(&self) -> usize {
        self.alvos
    }
}

/* ─────────── conjuntos de bits ─────────── */

const BITS: usize = 64;

fn palavras(n: usize) -> usize {
    n.div_ceil(BITS)
}

fn marcar(bits: &mut [u64], i: u32) {
    bits[i as usize / BITS] |= 1 << (i as usize % BITS);
}

fn tem(bits: &[u64], i: u32) -> bool {
    bits[i as usize / BITS] & (1 << (i as usize % BITS)) != 0
}

/// Quantos bits de `a` também estão em `b`.
fn intersecao(a: &[u64], b: &[u64]) -> u32 {
    a.iter().zip(b).map(|(x, y)| (x & y).count_ones()).sum()
}

/// `a ⊆ b`?
fn contido(a: &[u64], b: &[u64]) -> bool {
    a.iter().zip(b).all(|(x, y)| x & !y == 0)
}

/* ─────────── reduções ─────────── */

/// Tira do problema o que não pode mudar a resposta.
///
/// Duas regras, ambas clássicas em cobertura de conjuntos, e ambas com prova de
/// uma linha:
///
/// - **alvo dominado** — se todo candidato que cobre `B` também cobre `A`,
///   qualquer solução que cubra `B` já cobre `A`. `A` sai.
/// - **candidato dominado** — se `i` cobre um subconjunto do que `j` cobre e
///   não é mais barato, trocar `i` por `j` nunca piora. `i` sai.
///
/// Nas instâncias de Turán isto não é detalhe: em `T(10,5,3)` a primeira regra
/// sozinha derruba os alvos pela metade, e é a diferença entre a busca fechar em
/// segundos ou não fechar.
/// O problema depois de podado, e de onde cada candidato veio.
struct Reduzida {
    cobre: Vec<Vec<u32>>,
    peso: Vec<u64>,
    /// Índice original de cada candidato que sobrou, para devolver a resposta na
    /// numeração de quem perguntou.
    origem: Vec<usize>,
    alvos: usize,
}

fn reduzir(inst: &Instancia) -> Option<Reduzida> {
    let na = inst.alvos;
    let nc = inst.cobre.len();
    let pc = palavras(nc.max(1));

    // Quem cobre cada alvo, como bits sobre candidatos.
    let mut por_alvo = vec![vec![0u64; pc]; na];
    for (i, alvos) in inst.cobre.iter().enumerate() {
        for &a in alvos {
            marcar(&mut por_alvo[a as usize], i as u32);
        }
    }
    if por_alvo.iter().any(|c| c.iter().all(|&w| w == 0)) {
        return None; // alvo sem candidato: inviável
    }

    // Alvos dominados. Comparar todos contra todos é O(alvos²), e é barato
    // porque só chegam aqui as instâncias pequenas — as grandes vêm reduzidas
    // por órbitas antes.
    let grau: Vec<u32> = por_alvo.iter().map(|c| c.iter().map(|w| w.count_ones()).sum()).collect();
    let mut fica_alvo = vec![true; na];
    for a in 0..na {
        if !fica_alvo[a] {
            continue;
        }
        for b in 0..na {
            if a == b || !fica_alvo[b] {
                continue;
            }
            // `b` mais restrito que `a` (ou igual, e aí decide o índice).
            if grau[b] > grau[a] || (grau[b] == grau[a] && b > a) {
                continue;
            }
            if contido(&por_alvo[b], &por_alvo[a]) {
                fica_alvo[a] = false;
                break;
            }
        }
    }

    let mut novo_indice = vec![u32::MAX; na];
    let mut restantes = 0usize;
    for (a, fica) in fica_alvo.iter().enumerate() {
        if *fica {
            novo_indice[a] = restantes as u32;
            restantes += 1;
        }
    }

    let cobre: Vec<Vec<u32>> = inst
        .cobre
        .iter()
        .map(|alvos| alvos.iter().filter(|&&a| fica_alvo[a as usize]).map(|&a| novo_indice[a as usize]).collect())
        .collect();

    // Candidatos dominados, agora sobre os alvos que sobraram.
    let pa = palavras(restantes.max(1));
    let mascara: Vec<Vec<u64>> = cobre
        .iter()
        .map(|alvos| {
            let mut m = vec![0u64; pa];
            for &a in alvos {
                marcar(&mut m, a);
            }
            m
        })
        .collect();

    let mut fica_cand = vec![true; nc];
    for i in 0..nc {
        if !fica_cand[i] || cobre[i].is_empty() {
            fica_cand[i] = false;
            continue;
        }
        for j in 0..nc {
            if i == j || !fica_cand[j] {
                continue;
            }
            let melhor_preco = inst.peso[j] < inst.peso[i]
                || (inst.peso[j] == inst.peso[i] && cobre[j].len() > cobre[i].len())
                || (inst.peso[j] == inst.peso[i] && cobre[j].len() == cobre[i].len() && j < i);
            if melhor_preco && contido(&mascara[i], &mascara[j]) {
                fica_cand[i] = false;
                break;
            }
        }
    }

    let mut origem = Vec::new();
    let mut cobre_final = Vec::new();
    let mut peso_final = Vec::new();
    for i in 0..nc {
        if fica_cand[i] {
            origem.push(i);
            cobre_final.push(cobre[i].clone());
            peso_final.push(inst.peso[i]);
        }
    }

    Some(Reduzida { cobre: cobre_final, peso: peso_final, origem, alvos: restantes })
}

/* ─────────── ramifica e limita ─────────── */

struct Busca {
    cobre: Vec<Vec<u64>>,
    peso: Vec<u64>,
    por_alvo: Vec<Vec<u32>>,
    alvos: usize,
    melhor_peso: u64,
    melhor: Vec<usize>,
    nos: u64,
    teto: u64,
}

impl Busca {
    /// Cota inferior para o que ainda falta pagar.
    ///
    /// Cada candidato cobre no máximo `c` dos alvos que restam custando `w`, e
    /// portanto entrega no máximo `c/w` alvos por unidade de peso. Tomando o
    /// melhor `c/w` do momento, cobrir `restam` alvos custa ao menos
    /// `restam · w/c`. É a cota de contagem, com peso.
    fn cota(&self, descobertos: &[u64], restam: u32) -> u64 {
        let mut melhor = (0u64, 1u64); // (cobertura, peso)
        for (i, m) in self.cobre.iter().enumerate() {
            let c = intersecao(m, descobertos) as u64;
            if c == 0 {
                continue;
            }
            let w = self.peso[i];
            if c as u128 * melhor.1 as u128 > melhor.0 as u128 * w as u128 {
                melhor = (c, w);
            }
        }
        if melhor.0 == 0 {
            return u64::MAX;
        }
        let bruto = (restam as u128 * melhor.1 as u128).div_ceil(melhor.0 as u128);
        bruto.min(u64::MAX as u128) as u64
    }

    fn ramificar(&mut self, descobertos: &mut Vec<u64>, restam: u32, peso: u64, escolha: &mut Vec<usize>) -> bool {
        if restam == 0 {
            if peso < self.melhor_peso {
                self.melhor_peso = peso;
                self.melhor = escolha.clone();
            }
            return true;
        }
        self.nos += 1;
        if self.nos > self.teto {
            return false;
        }
        let cota = self.cota(descobertos, restam);
        if cota == u64::MAX || peso.saturating_add(cota) >= self.melhor_peso {
            return true;
        }

        // Ramifica no alvo descoberto com menos saídas: se ele vai estrangular a
        // busca, que estrangule agora e não vinte níveis abaixo.
        let mut alvo = u32::MAX;
        let mut menos = usize::MAX;
        for a in 0..self.alvos as u32 {
            if tem(descobertos, a) {
                let n = self.por_alvo[a as usize].len();
                if n < menos {
                    menos = n;
                    alvo = a;
                    if n <= 1 {
                        break;
                    }
                }
            }
        }

        // Toda solução precisa cobrir esse alvo, e só estes candidatos o cobrem:
        // o ramo é exaustivo. Os mais eficientes primeiro, para o corte pegar.
        let mut opcoes: Vec<usize> = self.por_alvo[alvo as usize].iter().map(|&i| i as usize).collect();
        opcoes.sort_by(|&i, &j| {
            let ci = intersecao(&self.cobre[i], descobertos) as u128 * self.peso[j] as u128;
            let cj = intersecao(&self.cobre[j], descobertos) as u128 * self.peso[i] as u128;
            cj.cmp(&ci)
        });

        for i in opcoes {
            let mut cobertos = Vec::new();
            for a in 0..self.alvos as u32 {
                if tem(descobertos, a) && tem(&self.cobre[i], a) {
                    cobertos.push(a);
                }
            }
            for &a in &cobertos {
                descobertos[a as usize / BITS] &= !(1 << (a as usize % BITS));
            }
            escolha.push(i);
            let seguiu = self.ramificar(
                descobertos,
                restam - cobertos.len() as u32,
                peso + self.peso[i],
                escolha,
            );
            escolha.pop();
            for &a in &cobertos {
                marcar(descobertos, a);
            }
            if !seguiu {
                return false;
            }
        }
        true
    }
}

/// Resolve ao certo, ou admite que não conseguiu.
///
/// `teto_de_nos` é o que separa "demora" de "trava". Estourado o teto, o
/// desfecho é [`Desfecho::Excedido`] — nunca um palpite disfarçado de prova.
pub fn resolver(inst: &Instancia, teto_de_nos: u64) -> Desfecho {
    let Some(Reduzida { cobre, peso, origem, alvos }) = reduzir(inst) else {
        return Desfecho::Inviavel;
    };
    if alvos == 0 {
        return Desfecho::Otimo { escolha: Vec::new(), peso: 0 };
    }

    let pa = palavras(alvos);
    let mascara: Vec<Vec<u64>> = cobre
        .iter()
        .map(|alvos_do| {
            let mut m = vec![0u64; pa];
            for &a in alvos_do {
                marcar(&mut m, a);
            }
            m
        })
        .collect();
    let mut por_alvo = vec![Vec::new(); alvos];
    for (i, alvos_do) in cobre.iter().enumerate() {
        for &a in alvos_do {
            por_alvo[a as usize].push(i as u32);
        }
    }

    // Um guloso barato entra já como resposta corrente. Sem um teto de partida
    // a poda não tem contra o que comparar e a primeira descida varre o espaço
    // inteiro; e entrando como resposta, não como teto solto, o caso em que o
    // guloso já era ótimo não precisa de tratamento à parte.
    let (peso_guloso, escolha_gulosa) = guloso(&mascara, &peso, alvos, pa);

    let mut busca = Busca {
        cobre: mascara,
        peso,
        por_alvo,
        alvos,
        melhor_peso: peso_guloso,
        melhor: escolha_gulosa,
        nos: 0,
        teto: teto_de_nos,
    };

    let mut descobertos = vec![0u64; pa];
    for a in 0..alvos as u32 {
        marcar(&mut descobertos, a);
    }
    let mut escolha = Vec::new();
    let completou = busca.ramificar(&mut descobertos, alvos as u32, 0, &mut escolha);

    if !completou {
        return Desfecho::Excedido;
    }
    Desfecho::Otimo {
        escolha: busca.melhor.into_iter().map(|i| origem[i]).collect(),
        peso: busca.melhor_peso,
    }
}

/// Guloso por melhor razão cobertura/peso. Só serve de teto inicial.
fn guloso(cobre: &[Vec<u64>], peso: &[u64], alvos: usize, pa: usize) -> (u64, Vec<usize>) {
    let mut descobertos = vec![0u64; pa];
    for a in 0..alvos as u32 {
        marcar(&mut descobertos, a);
    }
    let mut restam = alvos as u32;
    let mut total = 0u64;
    let mut escolha = Vec::new();
    while restam > 0 {
        let mut melhor = None;
        for (i, m) in cobre.iter().enumerate() {
            let c = intersecao(m, &descobertos) as u128;
            if c == 0 {
                continue;
            }
            let w = peso[i] as u128;
            match melhor {
                None => melhor = Some((i, c, w)),
                Some((_, bc, bw)) if c * bw > bc * w => melhor = Some((i, c, w)),
                _ => {}
            }
        }
        let Some((i, c, _)) = melhor else { break };
        for p in 0..pa {
            descobertos[p] &= !cobre[i][p];
        }
        restam -= c as u32;
        total += peso[i];
        escolha.push(i);
    }
    (total, escolha)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn turan(n: usize, k: usize, r: usize, teto: u64) -> Desfecho {
        let blocos: Vec<Vec<u32>> = combinacoes(n, r);
        let alvos: Vec<Vec<u32>> = combinacoes(n, k);
        let cobre: Vec<Vec<u32>> = blocos
            .iter()
            .map(|b| {
                alvos
                    .iter()
                    .enumerate()
                    .filter(|(_, a)| b.iter().all(|x| a.contains(x)))
                    .map(|(i, _)| i as u32)
                    .collect()
            })
            .collect();
        let peso = vec![1u64; cobre.len()];
        let inst = Instancia::nova(cobre, peso, alvos.len()).unwrap();
        resolver(&inst, teto)
    }

    fn combinacoes(n: usize, k: usize) -> Vec<Vec<u32>> {
        let mut saida = Vec::new();
        let mut atual = Vec::new();
        fn passo(inicio: usize, n: usize, k: usize, atual: &mut Vec<u32>, saida: &mut Vec<Vec<u32>>) {
            if atual.len() == k {
                saida.push(atual.clone());
                return;
            }
            for i in inicio..n {
                atual.push(i as u32);
                passo(i + 1, n, k, atual, saida);
                atual.pop();
            }
        }
        passo(0, n, k, &mut atual, &mut saida);
        saida
    }

    fn peso_de(d: &Desfecho) -> u64 {
        match d {
            Desfecho::Otimo { peso, .. } => *peso,
            outro => panic!("esperava ótimo, veio {outro:?}"),
        }
    }

    #[test]
    fn dois_triangulos_disjuntos_resolvem_seis_pontos() {
        // Todo 5-conjunto de 6 pontos deixa um de fora, e então contém inteiro
        // um dos dois triângulos. Um bloco só nunca basta: ele cabe em apenas
        // três dos seis 5-conjuntos.
        assert_eq!(peso_de(&turan(6, 5, 3, 1_000_000)), 2);
    }

    #[test]
    fn com_blocos_de_um_ponto_a_resposta_e_a_formula() {
        // T(n,k,1) = n − k + 1: os pontos não escolhidos formam o maior
        // `k`-conjunto que escaparia, então sobram no máximo k−1 deles.
        for n in 4..=9 {
            for k in 2..=n {
                assert_eq!(peso_de(&turan(n, k, 1, 1_000_000)), (n - k + 1) as u64, "n={n} k={k}");
            }
        }
    }

    #[test]
    fn os_exatos_pequenos_da_familia_que_a_modalidade_usa() {
        // `(k=5, r=3)` é pool 20 com jogos de 17, na forma complementar. Estes
        // são os valores que levantam o piso, e Schönheim erra dois deles:
        // dá 4 para n=7 e 7 para n=8.
        assert_eq!(peso_de(&turan(5, 5, 3, 1_000_000)), 1);
        assert_eq!(peso_de(&turan(6, 5, 3, 1_000_000)), 2);
        assert_eq!(peso_de(&turan(7, 5, 3, 1_000_000)), 5);
        assert_eq!(peso_de(&turan(8, 5, 3, 5_000_000)), 8);
    }

    #[test]
    fn a_escolha_devolvida_cobre_mesmo_tudo() {
        let n = 7;
        let (k, r) = (5, 3);
        let blocos = combinacoes(n, r);
        let alvos = combinacoes(n, k);
        let cobre: Vec<Vec<u32>> = blocos
            .iter()
            .map(|b| {
                alvos
                    .iter()
                    .enumerate()
                    .filter(|(_, a)| b.iter().all(|x| a.contains(x)))
                    .map(|(i, _)| i as u32)
                    .collect()
            })
            .collect();
        let inst = Instancia::nova(cobre.clone(), vec![1; cobre.len()], alvos.len()).unwrap();
        let Desfecho::Otimo { escolha, peso } = resolver(&inst, 1_000_000) else {
            panic!("esperava ótimo");
        };
        assert_eq!(escolha.len() as u64, peso);
        let mut vistos = vec![false; alvos.len()];
        for &i in &escolha {
            for &a in &cobre[i] {
                vistos[a as usize] = true;
            }
        }
        assert!(vistos.iter().all(|&v| v), "a solução devolvida deixou alvo descoberto");
    }

    #[test]
    fn o_peso_manda_e_nao_a_quantidade() {
        // Dois candidatos baratos cobrindo metade cada devem vencer um caro que
        // cobre tudo — senão a busca por órbitas escolheria pelo número de
        // órbitas em vez do número de cartelas.
        let cobre = vec![vec![0, 1, 2, 3], vec![0, 1], vec![2, 3]];
        let inst = Instancia::nova(cobre, vec![10, 1, 1], 4).unwrap();
        assert!(matches!(resolver(&inst, 1_000_000), Desfecho::Otimo { peso: 2, .. }));
    }

    #[test]
    fn alvo_sem_candidato_e_inviavel_e_nao_panico() {
        let inst = Instancia::nova(vec![vec![0]], vec![1], 2).unwrap();
        assert_eq!(resolver(&inst, 1_000), Desfecho::Inviavel);
    }

    #[test]
    fn um_teto_apertado_admite_que_nao_sabe() {
        assert_eq!(turan(9, 5, 3, 1), Desfecho::Excedido);
    }

    #[test]
    fn candidato_que_aponta_alvo_inexistente_nao_vira_instancia() {
        assert!(Instancia::nova(vec![vec![0, 7]], vec![1], 2).is_none());
        assert!(Instancia::nova(vec![vec![0]], vec![1, 1], 2).is_none());
    }
}
