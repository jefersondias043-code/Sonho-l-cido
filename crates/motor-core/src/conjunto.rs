//! Conjunto esparso de inteiros com inserção, remoção e sorteio em O(1).
//!
//! O motor precisa saber, a todo instante, *quais* alvos ainda estão
//! descobertos — e precisa conseguir sortear um deles para guiar a reconstrução
//! gulosa. Varrer o vetor de contagens custaria O(total_alvos) por passo, o que
//! dominaria o tempo de execução.
//!
//! A estrutura clássica para isso mantém duas listas que se apontam: uma lista
//! densa com os elementos presentes e um mapa de cada elemento para sua posição
//! nela. Remover é trocar com o último e encurtar.

/// Marca de "este elemento não está no conjunto".
const AUSENTE: u32 = u32::MAX;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConjuntoEsparso {
    densos: Vec<u32>,
    posicao: Vec<u32>,
}

impl ConjuntoEsparso {
    /// Conjunto vazio, capaz de conter os elementos `0..capacidade`.
    pub fn vazio(capacidade: usize) -> Self {
        Self { densos: Vec::with_capacity(capacidade), posicao: vec![AUSENTE; capacidade] }
    }

    /// Conjunto contendo todos os elementos `0..capacidade`.
    pub fn completo(capacidade: usize) -> Self {
        Self {
            densos: (0..capacidade as u32).collect(),
            posicao: (0..capacidade as u32).collect(),
        }
    }

    #[inline]
    pub fn capacidade(&self) -> usize {
        self.posicao.len()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.densos.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.densos.is_empty()
    }

    #[inline]
    pub fn contem(&self, elemento: u32) -> bool {
        self.posicao
            .get(elemento as usize)
            .is_some_and(|&pos| pos != AUSENTE)
    }

    /// Insere. Inserir algo já presente não faz nada.
    #[inline]
    pub fn inserir(&mut self, elemento: u32) {
        debug_assert!((elemento as usize) < self.posicao.len());
        if self.posicao[elemento as usize] == AUSENTE {
            self.posicao[elemento as usize] = self.densos.len() as u32;
            self.densos.push(elemento);
        }
    }

    /// Remove. Remover algo ausente não faz nada.
    #[inline]
    pub fn remover(&mut self, elemento: u32) {
        debug_assert!((elemento as usize) < self.posicao.len());
        let pos = self.posicao[elemento as usize];
        if pos == AUSENTE {
            return;
        }

        // Traz o último para o buraco aberto, mantendo a lista densa compacta.
        let ultimo = *self.densos.last().expect("lista densa não pode estar vazia aqui");
        self.densos[pos as usize] = ultimo;
        self.posicao[ultimo as usize] = pos;
        self.densos.pop();
        self.posicao[elemento as usize] = AUSENTE;
    }

    pub fn limpar(&mut self) {
        for &elemento in &self.densos {
            self.posicao[elemento as usize] = AUSENTE;
        }
        self.densos.clear();
    }

    pub fn preencher(&mut self) {
        self.densos.clear();
        self.densos.extend(0..self.posicao.len() as u32);
        for (i, pos) in self.posicao.iter_mut().enumerate() {
            *pos = i as u32;
        }
    }

    /// Elementos presentes, em ordem arbitrária.
    #[inline]
    pub fn elementos(&self) -> &[u32] {
        &self.densos
    }

    /// Elemento na posição `i` da lista densa. Serve para sortear em O(1):
    /// basta gerar um índice aleatório em `0..len()`.
    #[inline]
    pub fn em(&self, i: usize) -> Option<u32> {
        self.densos.get(i).copied()
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn inserir_e_remover_mantem_pertinencia_correta() {
        let mut c = ConjuntoEsparso::vazio(10);
        assert!(c.is_empty());

        c.inserir(3);
        c.inserir(7);
        c.inserir(3); // repetido: sem efeito
        assert_eq!(c.len(), 2);
        assert!(c.contem(3) && c.contem(7));
        assert!(!c.contem(4));

        c.remover(3);
        assert_eq!(c.len(), 1);
        assert!(!c.contem(3) && c.contem(7));

        c.remover(3); // ausente: sem efeito
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn completo_contem_toda_a_faixa() {
        let c = ConjuntoEsparso::completo(5);
        assert_eq!(c.len(), 5);
        for i in 0..5u32 {
            assert!(c.contem(i));
        }
    }

    #[test]
    fn remocao_em_qualquer_ordem_preserva_o_conjunto() {
        // O truque do "troca com o último" é onde esse tipo de estrutura
        // costuma quebrar: o elemento movido precisa ter sua posição corrigida.
        for remover_primeiro in 0..5u32 {
            let mut c = ConjuntoEsparso::completo(5);
            c.remover(remover_primeiro);

            let mut restantes: Vec<u32> = c.elementos().to_vec();
            restantes.sort_unstable();
            let esperado: Vec<u32> = (0..5).filter(|&x| x != remover_primeiro).collect();
            assert_eq!(restantes, esperado);

            for &x in &esperado {
                assert!(c.contem(x), "{x} sumiu após remover {remover_primeiro}");
            }
        }
    }

    #[test]
    fn esvaziar_e_repreencher_voltam_ao_estado_consistente() {
        let mut c = ConjuntoEsparso::completo(6);
        c.remover(2);
        c.limpar();
        assert!(c.is_empty());
        assert!(!c.contem(0));

        c.preencher();
        assert_eq!(c.len(), 6);
        for i in 0..6u32 {
            assert!(c.contem(i));
        }
        c.remover(0);
        assert_eq!(c.len(), 5);
        assert!(!c.contem(0));
    }
}
