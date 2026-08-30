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
//! 1. **Ramificar pelo alvo mais apertado.** Todo fechamento precisa cobrir
//!    todo alvo; então escolhe-se o alvo com menos candidatos possíveis e
//!    ramifica-se sobre eles. O fator de ramificação fica o menor disponível, e
//!    a busca continua completa.
//! 2. **Cota por empacotamento.** Alvos que nenhum candidato cobre em dupla
//!    exigem candidatos distintos. Contar quantos desses cabem no que falta dá
//!    um piso para o resto do ramo — e onde ele encosta no recorde, o ramo
//!    inteiro morre sem ser visitado.
//! 3. **Dominância.** Um alvo cujos candidatos são um superconjunto dos de
//!    outro alvo sai: cobrir o apertado cobre o folgado. Um candidato que cobre
//!    menos que outro, custando o mesmo ou mais, também sai.
//! 4. **Simetria.** A variante cíclica troca "escolher blocos" por "escolher
//!    órbitas": o espaço encolhe por um fator de cerca de `v`, e o que ela
//!    prova é mínimo **dentro da simetria**, o que o relatório diz com essas
//!    palavras.
//!
//! ## O orçamento, e por que ele é dito em voz alta
//!
//! A busca recebe um teto de nós. Estourou o teto, ela devolve `Excedido` — e
//! isso não é "não existe menor", é "não sei". A diferença entre as duas
//! afirmações é o crate inteiro.

use crate::construtor::{orbita, orbitas_de_blocos};
use crate::problema::{Bloco, Problema};

/// Acima disto a instância não é montada: a matriz de cobertura não caberia.
pub const TETO_DE_CANDIDATOS: usize = 200_000;

/// Teto do produto alvos × candidatos, que é o custo de montar a instância.
pub const TETO_DO_PRODUTO: usize = 40_000_000;

/// Acima disto a dominância não é testada — ela é quadrática nos candidatos.
pub const TETO_DA_DOMINANCIA: usize = 4_000;

/// Quantos nós a busca livre visita antes de desistir e dizer que desistiu.
pub const ORCAMENTO_PADRAO: u64 = 60_000_000;

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
/// Um *candidato* não é necessariamente um bloco: na variante cíclica ele é uma
/// órbita inteira, que entra ou não entra em peso fechado. É essa indireção que
/// deixa a mesma busca servir às duas famílias.
#[derive(Debug, Clone)]
pub struct Instancia {
    /// Quantos alvos sobraram depois da redução.
    pub alvos: usize,
    /// Por candidato, os índices dos alvos que ele cobre.
    pub cobre: Vec<Vec<u32>>,
    /// Por candidato, quantos blocos ele custa.
    pub peso: Vec<u32>,
    /// Por candidato, os blocos que ele coloca na solução.
    pub blocos: Vec<Vec<Bloco>>,
    /// Por alvo, os candidatos que o cobrem.
    pub por_alvo: Vec<Vec<u32>>,
    /// Os alvos em ordem crescente de quantos candidatos os cobrem.
    pub ordem: Vec<u32>,
    /// Por alvo, o menor peso entre os candidatos que o cobrem.
    pub menor_peso: Vec<u32>,
    /// A maior cobertura por unidade de peso, como fração `(alvos, peso)`.
    /// É o que sustenta a cota de contagem dentro da busca.
    pub densidade: (u32, u32),
    /// Quantos alvos a dominância dispensou.
    pub alvos_dispensados: usize,
    /// Quantos candidatos a dominância dispensou.
    pub candidatos_dispensados: usize,
}

impl Instancia {
    /// A instância livre: um candidato por bloco, peso 1.
    pub fn livre(p: &Problema) -> Option<Instancia> {
        let blocos = p.blocos();
        let alvos = p.alvos();
        if blocos.len() > TETO_DE_CANDIDATOS || blocos.len().saturating_mul(alvos.len()) > TETO_DO_PRODUTO {
            return None;
        }
        let candidatos: Vec<Vec<Bloco>> = blocos.into_iter().map(|b| vec![b]).collect();
        Some(Instancia::montar(&alvos, candidatos))
    }

    /// A instância cíclica: um candidato por órbita, peso igual ao seu tamanho.
    pub fn ciclica(p: &Problema) -> Option<Instancia> {
        let alvos = p.alvos();
        let representantes = orbitas_de_blocos(p);
        if representantes.is_empty() || representantes.len() > TETO_DE_CANDIDATOS {
            return None;
        }
        let candidatos: Vec<Vec<Bloco>> =
            representantes.into_iter().map(|r| orbita(r, p.v)).collect();
        let custo: usize = candidatos.iter().map(|c| c.len()).sum();
        if custo.saturating_mul(alvos.len()) > TETO_DO_PRODUTO {
            return None;
        }
        Some(Instancia::montar(&alvos, candidatos))
    }

    /// Monta a matriz de cobertura e aplica as duas dominâncias.
    fn montar(alvos: &[Bloco], candidatos: Vec<Vec<Bloco>>) -> Instancia {
        let mut cobre: Vec<Vec<u32>> = Vec::with_capacity(candidatos.len());
        for grupo in &candidatos {
            let mut lista = Vec::new();
            for (i, &alvo) in alvos.iter().enumerate() {
                if grupo.iter().any(|&b| alvo & b == alvo) {
                    lista.push(i as u32);
                }
            }
            cobre.push(lista);
        }

        let mut vivos_alvo = vec![true; alvos.len()];
        let mut vivos_cand: Vec<bool> = cobre.iter().map(|c| !c.is_empty()).collect();
        let mut alvos_dispensados = 0;
        let mut candidatos_dispensados = vivos_cand.iter().filter(|v| !**v).count();

        if candidatos.len() <= TETO_DA_DOMINANCIA {
            // Dominância de alvos: se todo candidato que cobre `a` também cobre
            // `b`, então cobrir `a` já cobriu `b`, e `b` sai da conta.
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
                    // `a` dentro de `b`: quem cobre `a` cobre `b`. Empate desfeito
                    // pelo índice, para não dispensar os dois.
                    let dentro = quem[a].iter().zip(&quem[b]).all(|(x, y)| x & !y == 0);
                    let igual = quem[a] == quem[b];
                    if dentro && (!igual || a < b) {
                        vivos_alvo[b] = false;
                        alvos_dispensados += 1;
                    }
                }
            }

            // Dominância de candidatos: cobrir menos custando o mesmo ou mais é
            // nunca ser necessário.
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

    /// Verdadeiro quando algum alvo não tem candidato nenhum: nada cobre tudo.
    pub fn impossivel(&self) -> bool {
        self.por_alvo.iter().any(|c| c.is_empty())
    }
}

/// O estado mutável da varredura, separado dos dados que não mudam.
///
/// A separação não é enfeite: a cota escreve no carimbo enquanto lê a instância,
/// e com tudo numa struct só o empréstimo não fecha.
struct Busca {
    vezes: Vec<u32>,
    carimbo: Vec<u64>,
    marca: u64,
    escolhidos: Vec<u32>,
    melhor: u32,
    melhor_escolha: Option<Vec<u32>>,
    nos: u64,
    orcamento: u64,
    estourou: bool,
}

impl Busca {
    fn nova(inst: &Instancia, teto: u32, orcamento: u64) -> Busca {
        Busca {
            vezes: vec![0; inst.alvos],
            carimbo: vec![0; inst.alvos],
            marca: 0,
            escolhidos: Vec::new(),
            melhor: teto,
            melhor_escolha: None,
            nos: 0,
            orcamento,
            estourou: false,
        }
    }

    /// Quantos alvos ainda descobertos este candidato acrescenta.
    fn ganho(&self, inst: &Instancia, c: u32) -> usize {
        inst.cobre[c as usize].iter().filter(|&&a| self.vezes[a as usize] == 0).count()
    }

    /// A cota por empacotamento, com saída antecipada.
    ///
    /// Alvos que nenhum candidato cobre juntos exigem candidatos distintos. A
    /// soma dos menores pesos desses alvos é um piso honesto para o que falta —
    /// e assim que o piso já derruba o ramo, ela para de somar, porque o número
    /// exato não interessa depois disso.
    fn cota(&mut self, inst: &Instancia, custo: u32, faltam: usize) -> u32 {
        // A contagem: nenhum candidato rende mais que a melhor densidade, então
        // o que falta dividido por ela é um piso. Custa três operações e já
        // derruba a maioria dos ramos.
        let (num, den) = inst.densidade;
        let contagem = if num == 0 {
            0
        } else {
            ((faltam as u64 * den as u64).div_ceil(num as u64)).min(u32::MAX as u64) as u32
        };
        if custo.saturating_add(contagem) >= self.melhor {
            return contagem;
        }

        self.marca += 1;
        let marca = self.marca;
        let mut soma = 0u32;
        for &t in &inst.ordem {
            let t = t as usize;
            if self.vezes[t] > 0 || self.carimbo[t] == marca {
                continue;
            }
            soma = soma.saturating_add(inst.menor_peso[t]);
            if custo.saturating_add(soma) >= self.melhor {
                return soma;
            }
            for &c in &inst.por_alvo[t] {
                for &u in &inst.cobre[c as usize] {
                    self.carimbo[u as usize] = marca;
                }
            }
        }
        soma.max(contagem)
    }

    fn passo(&mut self, inst: &Instancia, faltam: usize, custo: u32) {
        if self.estourou {
            return;
        }
        self.nos += 1;
        if self.nos > self.orcamento {
            self.estourou = true;
            return;
        }
        if faltam == 0 {
            if custo < self.melhor {
                self.melhor = custo;
                self.melhor_escolha = Some(self.escolhidos.clone());
            }
            return;
        }
        if custo.saturating_add(self.cota(inst, custo, faltam)) >= self.melhor {
            return;
        }

        // O alvo mais apertado que ainda falta. A ordem é estática porque a
        // lista de candidatos de um alvo não muda durante a busca.
        let alvo = match inst.ordem.iter().copied().find(|&t| self.vezes[t as usize] == 0) {
            Some(t) => t as usize,
            None => return,
        };

        let mut ramos: Vec<(u32, usize)> =
            inst.por_alvo[alvo].iter().map(|&c| (c, self.ganho(inst, c))).collect();
        ramos.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

        for (c, _) in ramos {
            let peso = inst.peso[c as usize];
            if custo.saturating_add(peso) >= self.melhor {
                continue;
            }
            let mut novos = 0usize;
            for &a in &inst.cobre[c as usize] {
                if self.vezes[a as usize] == 0 {
                    novos += 1;
                }
                self.vezes[a as usize] += 1;
            }
            self.escolhidos.push(c);
            self.passo(inst, faltam - novos, custo + peso);
            self.escolhidos.pop();
            for &a in &inst.cobre[c as usize] {
                self.vezes[a as usize] -= 1;
            }
            if self.estourou {
                return;
            }
        }
    }
}

/// Varre a instância inteira atrás de algo abaixo de `teto`.
///
/// `teto` é o tamanho da melhor construção conhecida, em blocos. A busca só
/// aceita soluções estritamente menores — o que já se tem não precisa ser
/// reencontrado.
pub fn resolver(inst: &Instancia, teto: usize, orcamento: u64) -> Prova {
    let candidatos = inst.cobre.len();
    if inst.impossivel() || teto == 0 {
        return Prova {
            desfecho: Desfecho::NadaAbaixoDe { teto },
            visitados: 0,
            candidatos,
            alvos: inst.alvos,
        };
    }
    let mut busca = Busca::nova(inst, teto as u32, orcamento);
    let faltam = inst.alvos;
    busca.passo(inst, faltam, 0);

    let desfecho = if busca.estourou {
        Desfecho::Excedido
    } else {
        match busca.melhor_escolha.take() {
            Some(escolha) => {
                let mut blocos: Vec<Bloco> =
                    escolha.iter().flat_map(|&c| inst.blocos[c as usize].iter().copied()).collect();
                blocos.sort_unstable();
                blocos.dedup();
                Desfecho::Minimo { tamanho: busca.melhor as usize, blocos }
            }
            None => Desfecho::NadaAbaixoDe { teto },
        }
    };

    Prova { desfecho, visitados: busca.nos, candidatos, alvos: inst.alvos }
}

/// A prova sem restrição: vale para todas as coleções, com ou sem simetria.
pub fn provar_livre(p: &Problema, teto: usize, orcamento: u64) -> Prova {
    match Instancia::livre(p) {
        Some(inst) => resolver(&inst, teto, orcamento),
        None => Prova {
            desfecho: Desfecho::GrandeDemais {
                candidatos: p.total_de_blocos().min(usize::MAX as u128) as usize,
                alvos: p.total_de_alvos(),
            },
            visitados: 0,
            candidatos: 0,
            alvos: p.total_de_alvos(),
        },
    }
}

/// A prova dentro da simetria cíclica: espaço muito menor, afirmação mais fraca.
pub fn provar_ciclica(p: &Problema, teto: usize, orcamento: u64) -> Prova {
    match Instancia::ciclica(p) {
        Some(inst) => resolver(&inst, teto, orcamento),
        None => Prova {
            desfecho: Desfecho::GrandeDemais {
                candidatos: p.total_de_blocos().min(usize::MAX as u128) as usize,
                alvos: p.total_de_alvos(),
            },
            visitados: 0,
            candidatos: 0,
            alvos: p.total_de_alvos(),
        },
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
                    let Ok(p) = Problema::novo(v, k, t) else { continue };
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
            let p = Problema::novo(v, k, t).unwrap();
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
            let p = Problema::novo(v, k, t).unwrap();
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
        let p = Problema::novo(9, 3, 2).unwrap();
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
        let p = Problema::novo(13, 5, 2).unwrap();
        let prova = provar_livre(&p, 10, 5_000);
        assert_eq!(prova.desfecho, Desfecho::Excedido);
        assert!(!prova.desfecho.fechou(), "orçamento estourado não pode contar como prova");
    }

    #[test]
    fn um_teto_apertado_demais_devolve_nada_abaixo() {
        // C(7,3,2) vale 7; procurar abaixo de 5 tem de varrer tudo e voltar de
        // mãos vazias, sem inventar solução.
        let p = Problema::novo(7, 3, 2).unwrap();
        let prova = provar_livre(&p, 5, 40_000_000);
        assert_eq!(prova.desfecho, Desfecho::NadaAbaixoDe { teto: 5 });
        assert!(prova.desfecho.fechou());
    }

    #[test]
    fn a_dominancia_so_descarta_o_que_sobra() {
        // Na instância livre todos os candidatos cobrem exatamente C(k,t) alvos,
        // então nenhum domina outro e nada pode ser descartado. Na cíclica, onde
        // as órbitas têm tamanhos diferentes, ela morde.
        let p = Problema::novo(9, 3, 2).unwrap();
        let livre = Instancia::livre(&p).unwrap();
        assert_eq!(livre.candidatos_dispensados, 0, "a instância livre não tem dominado");
        assert_eq!(livre.alvos, p.total_de_alvos());
    }
}
