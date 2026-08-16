//! Como o motor decide o que é "melhor".
//!
//! O documento conceitual insiste, com razão, que "melhor" precisa ser definido
//! explicitamente. Aqui isso vira uma **chave de custo** comparável: uma tripla
//! ordenada lexicograficamente, sempre minimizada.
//!
//! A ordem lexicográfica evita o problema clássico de somar objetivos com pesos
//! arbitrários — não existe peso que faça "cobrir tudo" e "usar poucas cartelas"
//! competirem de forma honesta, porque uma solução que não cobre tudo
//! simplesmente não serve.

use crate::problema::Objetivo;

/// Retrato numérico de uma solução em um instante.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Avaliacao {
    pub cartelas: usize,
    /// Alvos que nenhuma cartela atende.
    pub descobertos: usize,
    pub total_alvos: usize,
    /// Σ (contagem − 1) sobre os alvos cobertos: quanto de esforço está
    /// duplicado.
    pub redundancia: u64,
}

impl Avaliacao {
    /// Fração de alvos cobertos, em `0.0..=1.0`.
    pub fn cobertura(&self) -> f64 {
        if self.total_alvos == 0 {
            return 1.0;
        }
        (self.total_alvos - self.descobertos) as f64 / self.total_alvos as f64
    }

    pub fn cobertos(&self) -> usize {
        self.total_alvos - self.descobertos
    }

    /// Verdadeiro quando a regra de cobertura está inteiramente satisfeita.
    pub fn cobertura_total(&self) -> bool {
        self.descobertos == 0
    }

    /// Verdadeiro quando a solução respeita tudo que o objetivo exige.
    pub fn viavel(&self, objetivo: Objetivo) -> bool {
        match objetivo {
            Objetivo::MinimizarCartelas => self.cobertura_total(),
            Objetivo::MaximizarCobertura { orcamento } => self.cartelas <= orcamento,
        }
    }

    /// Traduz a avaliação na chave que o motor minimiza.
    pub fn chave(&self, objetivo: Objetivo) -> ChaveCusto {
        match objetivo {
            // Cobrir tudo vem primeiro; entre soluções completas, vence a que
            // usa menos cartelas; empatou, vence a menos redundante.
            Objetivo::MinimizarCartelas => ChaveCusto {
                primario: self.descobertos as u64,
                secundario: self.cartelas as u64,
                terciario: self.redundancia,
            },
            // Respeitar o orçamento vem primeiro; dentro dele, cobrir o máximo;
            // empatou, prefere menos cartelas.
            Objetivo::MaximizarCobertura { orcamento } => ChaveCusto {
                primario: self.cartelas.saturating_sub(orcamento) as u64,
                secundario: self.descobertos as u64,
                terciario: self.cartelas as u64,
            },
        }
    }
}

/// Custo de uma solução. **Menor é melhor**, comparado lexicograficamente.
///
/// A ordem derivada percorre os campos na ordem de declaração, que é
/// exatamente a hierarquia desejada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ChaveCusto {
    /// Violação de restrição. Zero significa solução válida.
    pub primario: u64,
    /// O objetivo em si.
    pub secundario: u64,
    /// Desempate.
    pub terciario: u64,
}

impl ChaveCusto {
    /// Pior custo possível — útil como valor inicial de comparação.
    pub const PIOR: ChaveCusto =
        ChaveCusto { primario: u64::MAX, secundario: u64::MAX, terciario: u64::MAX };

    /// Verdadeiro se `self` é estritamente melhor que `outra`.
    #[inline]
    pub fn melhor_que(&self, outra: &ChaveCusto) -> bool {
        self < outra
    }

    /// Verdadeiro se `self` é melhor ou igual a `outra`.
    #[inline]
    pub fn nao_pior_que(&self, outra: &ChaveCusto) -> bool {
        self <= outra
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn av(cartelas: usize, descobertos: usize, redundancia: u64) -> Avaliacao {
        Avaliacao { cartelas, descobertos, total_alvos: 100, redundancia }
    }

    #[test]
    fn cobertura_total_vence_qualquer_economia_de_cartelas() {
        let obj = Objetivo::MinimizarCartelas;
        let incompleta_e_enxuta = av(5, 1, 0).chave(obj);
        let completa_e_gorda = av(500, 0, 9999).chave(obj);

        assert!(
            completa_e_gorda.melhor_que(&incompleta_e_enxuta),
            "uma solução que não cobre tudo nunca pode ganhar de uma que cobre"
        );
    }

    #[test]
    fn entre_solucoes_completas_vence_a_que_usa_menos_cartelas() {
        let obj = Objetivo::MinimizarCartelas;
        assert!(av(29, 0, 50).chave(obj).melhor_que(&av(30, 0, 0).chave(obj)));
    }

    #[test]
    fn empate_em_cartelas_e_desempatado_pela_redundancia() {
        let obj = Objetivo::MinimizarCartelas;
        assert!(av(30, 0, 10).chave(obj).melhor_que(&av(30, 0, 11).chave(obj)));
    }

    #[test]
    fn com_orcamento_estourar_o_limite_e_o_pior_defeito() {
        let obj = Objetivo::MaximizarCobertura { orcamento: 10 };
        let dentro_do_orcamento_com_falhas = av(10, 40, 0).chave(obj);
        let fora_do_orcamento_perfeita = av(11, 0, 0).chave(obj);

        assert!(dentro_do_orcamento_com_falhas.melhor_que(&fora_do_orcamento_perfeita));
    }

    #[test]
    fn com_orcamento_cobrir_mais_e_o_objetivo() {
        let obj = Objetivo::MaximizarCobertura { orcamento: 10 };
        assert!(av(10, 5, 0).chave(obj).melhor_que(&av(9, 6, 0).chave(obj)));
    }

    #[test]
    fn viabilidade_depende_do_objetivo() {
        assert!(!av(5, 1, 0).viavel(Objetivo::MinimizarCartelas));
        assert!(av(5, 0, 0).viavel(Objetivo::MinimizarCartelas));

        let com_orcamento = Objetivo::MaximizarCobertura { orcamento: 5 };
        assert!(av(5, 40, 0).viavel(com_orcamento));
        assert!(!av(6, 0, 0).viavel(com_orcamento));
    }

    #[test]
    fn cobertura_e_fracionaria_e_bem_definida_no_caso_vazio() {
        assert_eq!(av(1, 0, 0).cobertura(), 1.0);
        assert_eq!(av(1, 25, 0).cobertura(), 0.75);
        let sem_alvos = Avaliacao { cartelas: 0, descobertos: 0, total_alvos: 0, redundancia: 0 };
        assert_eq!(sem_alvos.cobertura(), 1.0);
    }
}
