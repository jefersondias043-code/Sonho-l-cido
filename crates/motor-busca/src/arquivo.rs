//! Arquivo de elites — qualidade **e** diversidade.
//!
//! Implementa os §17 a §20 do documento conceitual. Guardar só o campeão é
//! desperdício: uma solução um pouco pior, mas estruturalmente muito diferente,
//! costuma ser justamente o material de que a próxima reconstrução precisa.
//!
//! Por isso o arquivo é organizado em faixas por quantidade de cartelas, e
//! dentro de cada faixa exige-se distância estrutural mínima entre as soluções
//! guardadas. Sem essa exigência, o arquivo encheria de variações quase
//! idênticas da mesma solução — muitos registros, uma ideia só.
//!
//! Cada elite carrega também de onde veio (§20), o que permite reconstruir a
//! linhagem de qualquer solução.

use std::collections::{BTreeMap, HashSet};

use motor_core::{Avaliacao, Cartela};
use rand::Rng;

/// Uma solução guardada, com sua procedência.
#[derive(Debug, Clone)]
pub struct Elite {
    pub cartelas: Vec<Cartela>,
    pub avaliacao: Avaliacao,
    /// Identidade estrutural, independente da ordem das cartelas.
    pub assinatura: u64,
    /// Iteração em que foi encontrada.
    pub iteracao: u64,
    /// Assinatura da solução que lhe deu origem.
    pub ancestral: Option<u64>,
    /// Operador que a produziu.
    pub operador: &'static str,
}

#[derive(Debug, Clone)]
pub struct ArquivoElites {
    /// Faixas indexadas por quantidade de cartelas, da menor para a maior.
    faixas: BTreeMap<usize, Vec<Elite>>,
    assinaturas: HashSet<u64>,
    capacidade_por_faixa: usize,
    maximo_de_faixas: usize,
    distancia_minima: f64,
}

impl ArquivoElites {
    pub fn novo(
        capacidade_por_faixa: usize,
        maximo_de_faixas: usize,
        distancia_minima: f64,
    ) -> Self {
        Self {
            faixas: BTreeMap::new(),
            assinaturas: HashSet::new(),
            capacidade_por_faixa: capacidade_por_faixa.max(1),
            maximo_de_faixas: maximo_de_faixas.max(1),
            distancia_minima: distancia_minima.clamp(0.0, 1.0),
        }
    }

    /// Tenta guardar uma solução. Devolve `true` se ela entrou.
    ///
    /// Recusa em três situações: já foi vista antes (§38), é parecida demais
    /// com algo já guardado, ou a faixa está cheia de coisa melhor.
    pub fn registrar(&mut self, elite: Elite) -> bool {
        if self.assinaturas.contains(&elite.assinatura) {
            return false;
        }

        let faixa = self.faixas.entry(elite.avaliacao.cartelas).or_default();

        // Perto demais de alguém já guardado? Só entra se for melhor que esse
        // vizinho — aí substitui, em vez de somar mais do mesmo.
        let vizinho = faixa.iter().position(|guardada| {
            distancia_estrutural(&guardada.cartelas, &elite.cartelas) < self.distancia_minima
        });

        if let Some(posicao) = vizinho {
            if elite.avaliacao.descobertos < faixa[posicao].avaliacao.descobertos
                || (elite.avaliacao.descobertos == faixa[posicao].avaliacao.descobertos
                    && elite.avaliacao.redundancia < faixa[posicao].avaliacao.redundancia)
            {
                self.assinaturas.remove(&faixa[posicao].assinatura);
                self.assinaturas.insert(elite.assinatura);
                faixa[posicao] = elite;
                return true;
            }
            return false;
        }

        if faixa.len() < self.capacidade_por_faixa {
            self.assinaturas.insert(elite.assinatura);
            faixa.push(elite);
            self.aparar_faixas();
            return true;
        }

        // Faixa cheia: entra no lugar da pior, se for melhor que ela.
        let pior = faixa
            .iter()
            .enumerate()
            .max_by_key(|(_, e)| (e.avaliacao.descobertos, e.avaliacao.redundancia))
            .map(|(i, _)| i);

        if let Some(posicao) = pior {
            let atual = &faixa[posicao].avaliacao;
            let melhora = (elite.avaliacao.descobertos, elite.avaliacao.redundancia)
                < (atual.descobertos, atual.redundancia);
            if melhora {
                self.assinaturas.remove(&faixa[posicao].assinatura);
                self.assinaturas.insert(elite.assinatura);
                faixa[posicao] = elite;
                self.aparar_faixas();
                return true;
            }
        }

        false
    }

    /// Descarta as faixas de maior quantidade de cartelas quando há faixas
    /// demais — soluções muito grandes deixam de ser material útil.
    fn aparar_faixas(&mut self) {
        while self.faixas.len() > self.maximo_de_faixas {
            let Some((&maior, _)) = self.faixas.iter().next_back() else {
                break;
            };
            if let Some(removidas) = self.faixas.remove(&maior) {
                for elite in removidas {
                    self.assinaturas.remove(&elite.assinatura);
                }
            }
        }
    }

    /// Sorteia uma elite qualquer, para servir de ponto de partida a uma nova
    /// exploração.
    pub fn sortear(&self, rng: &mut impl Rng) -> Option<&Elite> {
        let total = self.quantidade();
        if total == 0 {
            return None;
        }
        let mut escolhido = rng.gen_range(0..total);
        for faixa in self.faixas.values() {
            if escolhido < faixa.len() {
                return faixa.get(escolhido);
            }
            escolhido -= faixa.len();
        }
        None
    }

    /// Sorteia entre as elites de menor quantidade de cartelas — o material
    /// mais promissor para recombinação.
    pub fn sortear_entre_as_melhores(&self, rng: &mut impl Rng) -> Option<&Elite> {
        let faixa = self.faixas.values().next()?;
        if faixa.is_empty() {
            return None;
        }
        faixa.get(rng.gen_range(0..faixa.len()))
    }

    /// Ranking do §18: todas as elites, da melhor para a pior.
    pub fn ranking(&self) -> Vec<&Elite> {
        let mut todas: Vec<&Elite> = self.faixas.values().flatten().collect();
        todas.sort_by_key(|e| {
            (e.avaliacao.descobertos, e.avaliacao.cartelas, e.avaliacao.redundancia)
        });
        todas
    }

    pub fn quantidade(&self) -> usize {
        self.faixas.values().map(|f| f.len()).sum()
    }

    pub fn faixas(&self) -> impl Iterator<Item = (&usize, &Vec<Elite>)> {
        self.faixas.iter()
    }

    pub fn ja_visitada(&self, assinatura: u64) -> bool {
        self.assinaturas.contains(&assinatura)
    }

    /// Repõe elites vindas de um arquivo de sessão, sem julgá-las de novo.
    ///
    /// Deliberadamente **não** passa por [`Self::registrar`]. O que chega aqui já
    /// foi um arquivo válido: cada elite entrou passando pela distância mínima
    /// contra as que estavam guardadas naquele momento. Reaplicar a regra agora,
    /// numa ordem que não é a de então, só pode recusar quem já tinha entrado —
    /// medido, uma em quarenta e uma se perdia a cada retomada, e um arquivo que
    /// encolhe a cada ida e volta acabaria vazio.
    ///
    /// A capacidade continua valendo: um arquivo adulterado não enche a memória.
    pub fn repor(&mut self, elites: Vec<Elite>) {
        for elite in elites {
            if self.assinaturas.contains(&elite.assinatura) {
                continue;
            }
            let faixa = self.faixas.entry(elite.avaliacao.cartelas).or_default();
            if faixa.len() >= self.capacidade_por_faixa {
                continue;
            }
            self.assinaturas.insert(elite.assinatura);
            faixa.push(elite);
        }
        self.aparar_faixas();
    }

    /// As elites guardadas, da faixa mais enxuta para a mais gorda.
    ///
    /// Existe para o arquivo de sessão. O que a busca acumulou aqui é material
    /// bruto — soluções boas e estruturalmente diferentes entre si — e é o que
    /// alimenta a recombinação e os reinícios da diversificação. Retomar sem
    /// elas devolve ao motor um arquivo vazio, e os dois mecanismos que
    /// dependem dele passam a não ter com o que trabalhar.
    pub fn elites(&self) -> impl Iterator<Item = &Elite> {
        self.faixas.values().flatten()
    }
}

/// Distância estrutural entre duas soluções: Jaccard sobre o conjunto de
/// cartelas.
///
/// 0.0 significa soluções idênticas; 1.0, nenhuma cartela em comum. Duas
/// soluções vazias são consideradas idênticas.
pub fn distancia_estrutural(a: &[Cartela], b: &[Cartela]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }

    let mut esquerda: Vec<Cartela> = a.to_vec();
    let mut direita: Vec<Cartela> = b.to_vec();
    esquerda.sort_unstable();
    esquerda.dedup();
    direita.sort_unstable();
    direita.dedup();

    let (mut i, mut j, mut comuns) = (0usize, 0usize, 0usize);
    while i < esquerda.len() && j < direita.len() {
        match esquerda[i].cmp(&direita[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                comuns += 1;
                i += 1;
                j += 1;
            }
        }
    }

    let uniao = esquerda.len() + direita.len() - comuns;
    if uniao == 0 {
        return 0.0;
    }
    1.0 - (comuns as f64 / uniao as f64)
}

#[cfg(test)]
mod testes {
    use super::*;
    use rand::SeedableRng;
    use rand_pcg::Pcg64Mcg;

    fn cartelas(grupos: &[&[usize]]) -> Vec<Cartela> {
        grupos.iter().map(|g| Cartela::dos_indices(g)).collect()
    }

    fn elite(cs: Vec<Cartela>, descobertos: usize, assinatura: u64) -> Elite {
        Elite {
            avaliacao: Avaliacao {
                cartelas: cs.len(),
                descobertos,
                total_alvos: 100,
                redundancia: 0,
            },
            cartelas: cs,
            assinatura,
            iteracao: 0,
            ancestral: None,
            operador: "teste",
        }
    }

    #[test]
    fn distancia_vai_de_identico_a_disjunto() {
        let a = cartelas(&[&[0, 1], &[2, 3]]);
        let b = cartelas(&[&[0, 1], &[2, 3]]);
        let c = cartelas(&[&[4, 5], &[6, 7]]);
        let d = cartelas(&[&[0, 1], &[4, 5]]);

        assert_eq!(distancia_estrutural(&a, &b), 0.0);
        assert_eq!(distancia_estrutural(&a, &c), 1.0);
        // 1 em comum, união 3  →  1 - 1/3
        assert!((distancia_estrutural(&a, &d) - 2.0 / 3.0).abs() < 1e-12);
        assert_eq!(distancia_estrutural(&[], &[]), 0.0);
    }

    #[test]
    fn distancia_ignora_ordem_das_cartelas() {
        let a = cartelas(&[&[0, 1], &[2, 3], &[4, 5]]);
        let b = cartelas(&[&[4, 5], &[0, 1], &[2, 3]]);
        assert_eq!(distancia_estrutural(&a, &b), 0.0);
    }

    #[test]
    fn solucao_ja_vista_nao_entra_duas_vezes() {
        let mut arquivo = ArquivoElites::novo(5, 5, 0.2);
        assert!(arquivo.registrar(elite(cartelas(&[&[0, 1]]), 0, 111)));
        assert!(!arquivo.registrar(elite(cartelas(&[&[0, 1]]), 0, 111)));
        assert_eq!(arquivo.quantidade(), 1);
    }

    #[test]
    fn solucoes_parecidas_demais_nao_ocupam_duas_vagas() {
        let mut arquivo = ArquivoElites::novo(10, 5, 0.5);
        let base = cartelas(&[&[0, 1], &[2, 3], &[4, 5], &[6, 7]]);
        assert!(arquivo.registrar(elite(base.clone(), 5, 1)));

        // Só uma cartela diferente: distância bem abaixo de 0.5.
        let quase_igual = cartelas(&[&[0, 1], &[2, 3], &[4, 5], &[8, 9]]);
        assert!(!arquivo.registrar(elite(quase_igual, 5, 2)));
        assert_eq!(arquivo.quantidade(), 1);
    }

    #[test]
    fn parecida_mas_melhor_substitui_em_vez_de_somar() {
        let mut arquivo = ArquivoElites::novo(10, 5, 0.5);
        let base = cartelas(&[&[0, 1], &[2, 3], &[4, 5], &[6, 7]]);
        arquivo.registrar(elite(base, 5, 1));

        let quase_igual_e_melhor = cartelas(&[&[0, 1], &[2, 3], &[4, 5], &[8, 9]]);
        assert!(arquivo.registrar(elite(quase_igual_e_melhor, 2, 2)));
        assert_eq!(arquivo.quantidade(), 1, "deveria ter substituído, não somado");
        assert_eq!(arquivo.ranking()[0].avaliacao.descobertos, 2);
    }

    #[test]
    fn solucoes_diferentes_de_mesma_qualidade_convivem() {
        // É o ponto do §19: diversidade tem valor próprio.
        let mut arquivo = ArquivoElites::novo(10, 5, 0.5);
        assert!(arquivo.registrar(elite(cartelas(&[&[0, 1], &[2, 3]]), 5, 1)));
        assert!(arquivo.registrar(elite(cartelas(&[&[4, 5], &[6, 7]]), 5, 2)));
        assert_eq!(arquivo.quantidade(), 2);
    }

    #[test]
    fn faixas_em_excesso_descartam_as_solucoes_maiores() {
        let mut arquivo = ArquivoElites::novo(2, 2, 0.1);
        arquivo.registrar(elite(cartelas(&[&[0, 1]]), 0, 1)); // 1 cartela
        arquivo.registrar(elite(cartelas(&[&[0, 1], &[2, 3]]), 0, 2)); // 2 cartelas
        arquivo.registrar(elite(cartelas(&[&[0, 1], &[2, 3], &[4, 5]]), 0, 3)); // 3

        assert_eq!(arquivo.faixas().count(), 2);
        let tamanhos: Vec<usize> = arquivo.faixas().map(|(&k, _)| k).collect();
        assert_eq!(tamanhos, vec![1, 2], "a faixa de 3 cartelas deveria ter saído");
        assert!(!arquivo.ja_visitada(3), "a assinatura descartada precisa ser esquecida");
    }

    #[test]
    fn ranking_ordena_por_qualidade() {
        let mut arquivo = ArquivoElites::novo(5, 5, 0.1);
        arquivo.registrar(elite(cartelas(&[&[0, 1], &[2, 3], &[4, 5]]), 0, 1));
        arquivo.registrar(elite(cartelas(&[&[6, 7]]), 4, 2));
        arquivo.registrar(elite(cartelas(&[&[8, 9], &[0, 2]]), 0, 3));

        let ranking = arquivo.ranking();
        assert_eq!(ranking[0].assinatura, 3, "2 cartelas cobrindo tudo vem primeiro");
        assert_eq!(ranking[1].assinatura, 1);
        assert_eq!(ranking[2].assinatura, 2, "a incompleta vai para o fim");
    }

    #[test]
    fn sorteio_alcanca_todas_as_faixas() {
        let mut arquivo = ArquivoElites::novo(3, 5, 0.1);
        arquivo.registrar(elite(cartelas(&[&[0, 1]]), 0, 1));
        arquivo.registrar(elite(cartelas(&[&[2, 3], &[4, 5]]), 0, 2));
        arquivo.registrar(elite(cartelas(&[&[6, 7], &[8, 9], &[0, 3]]), 0, 3));

        let mut rng = Pcg64Mcg::seed_from_u64(3);
        let mut vistas = HashSet::new();
        for _ in 0..300 {
            vistas.insert(arquivo.sortear(&mut rng).unwrap().assinatura);
        }
        assert_eq!(vistas.len(), 3, "o sorteio não alcançou todas as elites");
    }

    #[test]
    fn arquivo_vazio_nao_sorteia_nada() {
        let arquivo = ArquivoElites::novo(3, 3, 0.2);
        let mut rng = Pcg64Mcg::seed_from_u64(1);
        assert!(arquivo.sortear(&mut rng).is_none());
        assert!(arquivo.sortear_entre_as_melhores(&mut rng).is_none());
    }

    #[test]
    fn melhores_vem_da_faixa_de_menor_cardinalidade() {
        let mut arquivo = ArquivoElites::novo(3, 5, 0.1);
        arquivo.registrar(elite(cartelas(&[&[0, 1], &[2, 3], &[4, 5]]), 0, 3));
        arquivo.registrar(elite(cartelas(&[&[6, 7]]), 0, 1));

        let mut rng = Pcg64Mcg::seed_from_u64(5);
        for _ in 0..20 {
            let elite = arquivo.sortear_entre_as_melhores(&mut rng).unwrap();
            assert_eq!(elite.avaliacao.cartelas, 1);
        }
    }
}
