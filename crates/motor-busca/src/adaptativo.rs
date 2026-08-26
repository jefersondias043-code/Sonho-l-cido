//! Pesos adaptativos — o motor aprende com a própria execução.
//!
//! Implementa o §36 do documento conceitual. Cada operador começa com o mesmo
//! peso; a cada uso ele ganha pontos conforme o que produziu, e periodicamente
//! os pesos são reajustados na proporção do que cada um rendeu por uso.
//!
//! O efeito é que o motor descobre sozinho quais transformações funcionam
//! *naquele problema específico*. Uma reconstrução profunda pode ser inútil em
//! uma configuração e decisiva em outra, e não há como saber de antemão.
//!
//! O peso mínimo existe para que nenhum operador morra por completo: uma
//! estratégia que não serve hoje pode ser exatamente o que destrava a busca
//! depois de uma reconstrução.

use rand::Rng;

/// Peso mínimo de qualquer operador, como fração do peso médio.
const PISO_RELATIVO: f64 = 0.05;

/// Quanto cada resultado vale em pontos. São os `σ` da literatura de ALNS.
#[derive(Debug, Clone, Copy)]
pub struct Recompensas {
    /// A transformação produziu um recorde global.
    pub recorde: f64,
    /// Melhorou em relação à solução atual.
    pub melhorou: f64,
    /// Piorou, mas foi aceita — manteve a exploração viva.
    pub aceita: f64,
    /// Foi recusada.
    pub recusada: f64,
}

impl Default for Recompensas {
    fn default() -> Self {
        Self { recorde: 30.0, melhorou: 12.0, aceita: 4.0, recusada: 0.0 }
    }
}

#[derive(Debug, Clone)]
pub struct SeletorAdaptativo {
    pesos: Vec<f64>,
    pontos: Vec<f64>,
    usos: Vec<u32>,
    /// Quanto o histórico recente pesa frente ao acumulado, em `0.0..=1.0`.
    fator_reacao: f64,
    /// Iterações entre dois reajustes de peso.
    tamanho_segmento: u64,
    passo_no_segmento: u64,
    segmentos_concluidos: u64,
}

impl SeletorAdaptativo {
    pub fn novo(quantidade: usize, fator_reacao: f64, tamanho_segmento: u64) -> Self {
        assert!(quantidade > 0, "é preciso ao menos um operador");
        Self {
            pesos: vec![1.0; quantidade],
            pontos: vec![0.0; quantidade],
            usos: vec![0; quantidade],
            fator_reacao: fator_reacao.clamp(0.0, 1.0),
            tamanho_segmento: tamanho_segmento.max(1),
            passo_no_segmento: 0,
            segmentos_concluidos: 0,
        }
    }

    /// Sorteia um operador com probabilidade proporcional ao seu peso.
    pub fn escolher(&self, rng: &mut impl Rng) -> usize {
        let total: f64 = self.pesos.iter().sum();
        if total <= 0.0 {
            return rng.gen_range(0..self.pesos.len());
        }

        let mut sorteio = rng.gen::<f64>() * total;
        for (indice, &peso) in self.pesos.iter().enumerate() {
            sorteio -= peso;
            if sorteio <= 0.0 {
                return indice;
            }
        }
        self.pesos.len() - 1
    }

    /// Credita pontos ao operador e avança o segmento.
    ///
    /// Deve ser chamado exatamente uma vez por iteração, com o operador que foi
    /// efetivamente aplicado.
    pub fn registrar(&mut self, operador: usize, pontos: f64) {
        self.pontos[operador] += pontos;
        self.usos[operador] += 1;
        self.passo_no_segmento += 1;

        if self.passo_no_segmento >= self.tamanho_segmento {
            self.reajustar();
        }
    }

    /// Recalcula os pesos com base no rendimento por uso do último segmento.
    fn reajustar(&mut self) {
        let r = self.fator_reacao;
        for i in 0..self.pesos.len() {
            if self.usos[i] > 0 {
                let rendimento = self.pontos[i] / self.usos[i] as f64;
                self.pesos[i] = (1.0 - r) * self.pesos[i] + r * rendimento;
            }
            self.pontos[i] = 0.0;
            self.usos[i] = 0;
        }

        // Renormaliza para média 1 e aplica o piso, para que os pesos não
        // derivem em escala nem deixem nenhum operador chegar a zero.
        let media = self.pesos.iter().sum::<f64>() / self.pesos.len() as f64;
        if media > 0.0 {
            let piso = PISO_RELATIVO;
            for peso in &mut self.pesos {
                *peso = (*peso / media).max(piso);
            }
        } else {
            self.pesos.fill(1.0);
        }

        self.passo_no_segmento = 0;
        self.segmentos_concluidos += 1;
    }

    pub fn pesos(&self) -> &[f64] {
        &self.pesos
    }

    /// Devolve os pesos aprendidos ao lugar de onde vieram.
    ///
    /// Existe para a sessão exportada carregar o que o motor aprendeu sobre
    /// quais operadores funcionam nesta configuração. Sem isto, retomar um
    /// trabalho de dez horas começa de novo com todos os operadores empatados —
    /// o resultado não se perde, mas o aprendizado sim, e ele custa milhares de
    /// iterações para voltar.
    ///
    /// Uma lista de tamanho errado é ignorada: vem de um arquivo de outra
    /// versão, com outro conjunto de operadores, e aplicá-la parcialmente daria
    /// pesos trocados — pior que pesos zerados.
    pub fn restaurar_pesos(&mut self, pesos: &[f64]) -> bool {
        if pesos.len() != self.pesos.len() || pesos.iter().any(|p| !p.is_finite() || *p <= 0.0) {
            return false;
        }
        self.pesos.copy_from_slice(pesos);
        true
    }

    pub fn segmentos_concluidos(&self) -> u64 {
        self.segmentos_concluidos
    }

    /// O segmento em curso: pontos e usos ainda não convertidos em peso.
    ///
    /// Os pesos sozinhos descrevem o que o motor já converteu em decisão. O que
    /// está no meio do segmento é aprendizado em formação, e jogá-lo fora ao
    /// retomar atrasa o próximo reajuste em até um segmento inteiro.
    pub fn segmento_em_curso(&self) -> (&[f64], &[u32], u64) {
        (&self.pontos, &self.usos, self.passo_no_segmento)
    }

    /// Repõe um segmento em formação. Tamanhos errados são ignorados.
    pub fn restaurar_segmento(&mut self, pontos: &[f64], usos: &[u32], passo: u64) -> bool {
        if pontos.len() != self.pontos.len() || usos.len() != self.usos.len() {
            return false;
        }
        if pontos.iter().any(|p| !p.is_finite() || *p < 0.0) {
            return false;
        }
        self.pontos.copy_from_slice(pontos);
        self.usos.copy_from_slice(usos);
        self.passo_no_segmento = passo.min(self.tamanho_segmento.saturating_sub(1));
        true
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use rand::SeedableRng;
    use rand_pcg::Pcg64Mcg;

    #[test]
    fn comeca_com_todos_os_operadores_em_pe_de_igualdade() {
        let seletor = SeletorAdaptativo::novo(4, 0.3, 100);
        assert_eq!(seletor.pesos(), &[1.0, 1.0, 1.0, 1.0]);
    }

    #[test]
    fn operador_produtivo_ganha_peso_e_improdutivo_perde() {
        let mut seletor = SeletorAdaptativo::novo(3, 0.5, 30);

        // O operador 0 sempre produz recordes; os outros nunca produzem nada.
        for _ in 0..10 {
            seletor.registrar(0, 30.0);
            seletor.registrar(1, 0.0);
            seletor.registrar(2, 0.0);
        }

        assert_eq!(seletor.segmentos_concluidos(), 1);
        let pesos = seletor.pesos();
        assert!(pesos[0] > pesos[1], "o produtivo deveria ter subido: {pesos:?}");
        assert!(pesos[0] > pesos[2]);
    }

    #[test]
    fn nenhum_operador_e_extinto() {
        let mut seletor = SeletorAdaptativo::novo(3, 1.0, 10);
        for _ in 0..200 {
            seletor.registrar(0, 100.0);
            seletor.registrar(1, 0.0);
            seletor.registrar(2, 0.0);
        }

        for (i, &peso) in seletor.pesos().iter().enumerate() {
            assert!(peso > 0.0, "operador {i} chegou a peso zero e nunca mais seria sorteado");
        }
    }

    #[test]
    fn escolha_segue_os_pesos() {
        let mut seletor = SeletorAdaptativo::novo(2, 0.9, 20);
        for _ in 0..40 {
            seletor.registrar(0, 50.0);
            seletor.registrar(1, 0.0);
        }

        let mut rng = Pcg64Mcg::seed_from_u64(7);
        let mut contagem = [0u32; 2];
        for _ in 0..2000 {
            contagem[seletor.escolher(&mut rng)] += 1;
        }

        assert!(
            contagem[0] > contagem[1],
            "o operador de maior peso deveria ser sorteado mais: {contagem:?}"
        );
    }

    #[test]
    fn escolha_e_valida_mesmo_com_pesos_no_piso() {
        let seletor = SeletorAdaptativo::novo(5, 0.5, 10);
        let mut rng = Pcg64Mcg::seed_from_u64(1);
        for _ in 0..500 {
            assert!(seletor.escolher(&mut rng) < 5);
        }
    }

    #[test]
    fn reajuste_acontece_no_fim_de_cada_segmento() {
        let mut seletor = SeletorAdaptativo::novo(2, 0.5, 5);
        for _ in 0..4 {
            seletor.registrar(0, 10.0);
        }
        assert_eq!(seletor.segmentos_concluidos(), 0);

        seletor.registrar(1, 10.0);
        assert_eq!(seletor.segmentos_concluidos(), 1);
    }
}
