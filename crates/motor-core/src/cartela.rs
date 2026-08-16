//! Representação de uma cartela.
//!
//! Uma cartela é um subconjunto do pool. Como o pool tem no máximo 128
//! elementos, ela cabe inteira em um `u128` — e as operações que o motor mais
//! executa (interseção, contagem, união) viram uma ou duas instruções de CPU.
//! É essa escolha que torna possível avaliar milhões de soluções por segundo.

use crate::problema::POOL_MAXIMO;

/// Bitmask sobre os *índices* do pool (0..p), não sobre os rótulos do universo.
pub type Mascara = u128;

/// Máscara com os `p` bits mais baixos ligados.
#[inline]
pub fn mascara_pool(p: usize) -> Mascara {
    debug_assert!(p <= POOL_MAXIMO);
    if p >= POOL_MAXIMO {
        Mascara::MAX
    } else {
        (1 << p) - 1
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Cartela(Mascara);

impl Cartela {
    pub const fn vazia() -> Self {
        Self(0)
    }

    pub const fn da_mascara(mascara: Mascara) -> Self {
        Self(mascara)
    }

    /// Constrói a partir de índices do pool. Índices repetidos são absorvidos.
    pub fn dos_indices(indices: &[usize]) -> Self {
        let mut mascara = 0;
        for &i in indices {
            debug_assert!(i < POOL_MAXIMO);
            mascara |= 1u128 << i;
        }
        Self(mascara)
    }

    #[inline]
    pub const fn mascara(self) -> Mascara {
        self.0
    }

    #[inline]
    pub const fn contem(self, indice: usize) -> bool {
        self.0 & (1u128 << indice) != 0
    }

    #[inline]
    pub fn inserir(&mut self, indice: usize) {
        debug_assert!(indice < POOL_MAXIMO);
        self.0 |= 1u128 << indice;
    }

    #[inline]
    pub fn remover(&mut self, indice: usize) {
        self.0 &= !(1u128 << indice);
    }

    /// Quantidade de elementos — um único `popcnt`.
    #[inline]
    pub const fn tamanho(self) -> usize {
        self.0.count_ones() as usize
    }

    #[inline]
    pub const fn vazio(self) -> bool {
        self.0 == 0
    }

    /// Quantos elementos as duas cartelas têm em comum.
    #[inline]
    pub const fn tamanho_intersecao(self, outra: Cartela) -> usize {
        (self.0 & outra.0).count_ones() as usize
    }

    /// Quantos elementos aparecem em ao menos uma das duas.
    #[inline]
    pub const fn tamanho_uniao(self, outra: Cartela) -> usize {
        (self.0 | outra.0).count_ones() as usize
    }

    /// Distância de Jaccard em `0.0..=1.0`. Duas cartelas vazias distam 0.
    ///
    /// É a métrica de "quão diferentes são estruturalmente" usada tanto pelo
    /// arquivo de diversidade quanto pelos operadores de remoção relacionada.
    pub fn distancia_jaccard(self, outra: Cartela) -> f64 {
        let uniao = self.tamanho_uniao(outra);
        if uniao == 0 {
            return 0.0;
        }
        1.0 - (self.tamanho_intersecao(outra) as f64 / uniao as f64)
    }

    /// Escreve os índices presentes, em ordem crescente, em `saida`.
    pub fn indices_em(self, saida: &mut Vec<usize>) {
        saida.clear();
        let mut restante = self.0;
        while restante != 0 {
            saida.push(restante.trailing_zeros() as usize);
            restante &= restante - 1;
        }
    }

    /// Escreve em `saida` os índices do pool que a cartela *não* contém.
    pub fn indices_ausentes_em(self, p: usize, saida: &mut Vec<usize>) {
        saida.clear();
        let mut restante = !self.0 & mascara_pool(p);
        while restante != 0 {
            saida.push(restante.trailing_zeros() as usize);
            restante &= restante - 1;
        }
    }

    /// Aloca e devolve os índices presentes. Conveniente fora do laço quente.
    pub fn indices(self) -> Vec<usize> {
        let mut saida = Vec::with_capacity(self.tamanho());
        self.indices_em(&mut saida);
        saida
    }

    /// Traduz para os rótulos que o usuário reconhece, em ordem crescente.
    pub fn rotulos(self, pool: &[u32]) -> Vec<u32> {
        self.indices().into_iter().filter_map(|i| pool.get(i).copied()).collect()
    }
}

impl std::fmt::Display for Cartela {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let indices = self.indices();
        let texto: Vec<String> = indices.iter().map(|i| i.to_string()).collect();
        write!(f, "{{{}}}", texto.join(", "))
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn operacoes_basicas() {
        let mut c = Cartela::dos_indices(&[0, 3, 7]);
        assert_eq!(c.tamanho(), 3);
        assert!(c.contem(3));
        assert!(!c.contem(4));

        c.inserir(4);
        assert_eq!(c.tamanho(), 4);
        c.remover(0);
        assert_eq!(c.indices(), vec![3, 4, 7]);

        // Remover algo ausente não muda nada.
        c.remover(60);
        assert_eq!(c.indices(), vec![3, 4, 7]);
    }

    #[test]
    fn indices_saem_sempre_em_ordem_crescente() {
        let c = Cartela::dos_indices(&[9, 1, 40, 0, 127]);
        assert_eq!(c.indices(), vec![0, 1, 9, 40, 127]);
    }

    #[test]
    fn indices_repetidos_sao_absorvidos() {
        let c = Cartela::dos_indices(&[5, 5, 5, 2]);
        assert_eq!(c.tamanho(), 2);
        assert_eq!(c.indices(), vec![2, 5]);
    }

    #[test]
    fn complemento_respeita_o_tamanho_do_pool() {
        let c = Cartela::dos_indices(&[0, 2]);
        let mut ausentes = Vec::new();
        c.indices_ausentes_em(5, &mut ausentes);
        assert_eq!(ausentes, vec![1, 3, 4]);
    }

    #[test]
    fn mascara_do_pool_cobre_todos_os_indices_validos() {
        assert_eq!(mascara_pool(0), 0);
        assert_eq!(mascara_pool(1), 1);
        assert_eq!(mascara_pool(64).count_ones(), 64);
        assert_eq!(mascara_pool(128), Mascara::MAX);
        assert_eq!(mascara_pool(128).count_ones(), 128);
    }

    #[test]
    fn jaccard_vai_de_identico_a_disjunto() {
        let a = Cartela::dos_indices(&[1, 2, 3]);
        let b = Cartela::dos_indices(&[1, 2, 3]);
        let c = Cartela::dos_indices(&[4, 5, 6]);
        let d = Cartela::dos_indices(&[2, 3, 4]);

        assert_eq!(a.distancia_jaccard(b), 0.0);
        assert_eq!(a.distancia_jaccard(c), 1.0);
        // |∩| = 2, |∪| = 4  →  1 - 0.5
        assert!((a.distancia_jaccard(d) - 0.5).abs() < 1e-12);
        assert_eq!(Cartela::vazia().distancia_jaccard(Cartela::vazia()), 0.0);
    }

    #[test]
    fn rotulos_traduzem_indices_para_o_universo_do_usuario() {
        let pool = [7u32, 13, 42, 55];
        let c = Cartela::dos_indices(&[0, 2]);
        assert_eq!(c.rotulos(&pool), vec![7, 42]);
    }
}
