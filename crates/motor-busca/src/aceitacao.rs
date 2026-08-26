//! Critério de aceitação — por que o motor aceita piorar.
//!
//! O §11 do documento conceitual é categórico: um algoritmo que só aceita
//! melhorias imediatas fica preso no primeiro ótimo local que encontrar. Para
//! chegar a 29 cartelas talvez seja preciso passar por 47.
//!
//! A técnica usada aqui é **aceitação tardia** (*late acceptance hill
//! climbing*): a solução candidata não é comparada com a atual, e sim com a que
//! era a atual `L` iterações atrás. Isso cria uma tolerância que se ajusta
//! sozinha — quando a busca está descendo rápido, o passado é pior e quase tudo
//! passa; quando ela estabiliza, o passado alcança o presente e o critério
//! aperta naturalmente.
//!
//! A escolha é deliberada frente ao recozimento simulado: o único parâmetro é o
//! tamanho da memória `L`. Não há temperatura inicial para calibrar nem
//! cronograma de resfriamento para errar.

use motor_core::ChaveCusto;

#[derive(Debug, Clone)]
pub struct AceitacaoTardia {
    historico: Vec<ChaveCusto>,
    passo: u64,
}

impl AceitacaoTardia {
    /// `tamanho` é o `L`: quantas iterações atrás está a régua de comparação.
    /// Valores maiores toleram desvios maiores e por mais tempo.
    pub fn nova(tamanho: usize, custo_inicial: ChaveCusto) -> Self {
        Self { historico: vec![custo_inicial; tamanho.max(1)], passo: 0 }
    }

    /// Decide se a candidata substitui a atual, e atualiza a memória.
    ///
    /// Aceita quando a candidata não é pior que a solução de `L` iterações
    /// atrás **ou** que a solução atual — a segunda condição garante que
    /// melhorias diretas nunca sejam recusadas.
    pub fn decidir(&mut self, candidata: ChaveCusto, atual: ChaveCusto) -> bool {
        let posicao = (self.passo % self.historico.len() as u64) as usize;
        let referencia = self.historico[posicao];

        let aceita = candidata.nao_pior_que(&referencia) || candidata.nao_pior_que(&atual);
        let resultante = if aceita { candidata } else { atual };

        if resultante.melhor_que(&referencia) {
            self.historico[posicao] = resultante;
        }

        self.passo = self.passo.wrapping_add(1);
        aceita
    }

    /// Zera a memória em torno de um novo custo de referência.
    ///
    /// Usado quando a busca muda de patamar — ao perseguir uma cardinalidade
    /// menor, o histórico anterior descreve um problema que não existe mais.
    pub fn reiniciar(&mut self, custo: ChaveCusto) {
        self.historico.fill(custo);
        self.passo = 0;
    }

    pub fn tamanho(&self) -> usize {
        self.historico.len()
    }

    /// A memória inteira, para gravar num arquivo de sessão.
    ///
    /// Sem ela, retomar devolve uma régua chapada no custo da solução salva, e
    /// a busca passa as próximas `L` iterações num regime que ela não estava —
    /// nem o apertado que tinha conquistado, nem o frouxo do começo. É o
    /// critério de aceitação inteiro, e ele é o que decide cada iteração.
    pub fn memoria(&self) -> (&[ChaveCusto], u64) {
        (&self.historico, self.passo)
    }

    /// Restaura uma memória gravada. Devolve `false` se não servir.
    ///
    /// Um histórico de outro tamanho vem de uma configuração diferente e não
    /// descreve esta busca; recusar é melhor que remendar, porque quem recusa
    /// cai no `reiniciar`, que ao menos é coerente.
    pub fn restaurar(&mut self, historico: &[ChaveCusto], passo: u64) -> bool {
        if historico.len() != self.historico.len() {
            return false;
        }
        self.historico.copy_from_slice(historico);
        self.passo = passo;
        true
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn custo(valor: u64) -> ChaveCusto {
        ChaveCusto { primario: valor, secundario: 0, terciario: 0 }
    }

    #[test]
    fn melhoria_direta_e_sempre_aceita() {
        let mut criterio = AceitacaoTardia::nova(10, custo(100));
        for _ in 0..50 {
            assert!(criterio.decidir(custo(10), custo(20)));
        }
    }

    #[test]
    fn piora_e_aceita_enquanto_o_passado_for_pior() {
        let mut criterio = AceitacaoTardia::nova(5, custo(100));
        // A memória começa em 100: uma candidata de 60 é pior que a atual (50)
        // mas melhor que o passado, então passa.
        assert!(criterio.decidir(custo(60), custo(50)));
    }

    #[test]
    fn piora_e_recusada_depois_que_a_memoria_alcanca_o_presente() {
        let mut criterio = AceitacaoTardia::nova(3, custo(10));
        // Com a memória já em 10, uma candidata de 50 não passa por nenhum
        // dos dois caminhos.
        assert!(!criterio.decidir(custo(50), custo(10)));
    }

    #[test]
    fn memoria_so_desce_nunca_sobe() {
        // É o que garante a convergência: a régua aperta com o tempo e nunca
        // afrouxa sozinha.
        let mut criterio = AceitacaoTardia::nova(1, custo(100));

        criterio.decidir(custo(30), custo(40)); // a memória desce a 30
        assert!(!criterio.decidir(custo(80), custo(50)), "80 é pior que a memória (30) e que a atual (50)");
        // A recusa não pode ter afrouxado a régua: 80 continua sendo recusado.
        assert!(!criterio.decidir(custo(80), custo(50)));
    }

    #[test]
    fn candidata_melhor_que_a_atual_passa_mesmo_contra_a_memoria() {
        // A segunda condição do critério existe para isto: uma melhoria direta
        // nunca é recusada, por mais apertada que a memória esteja. Sem isso a
        // busca perderia progresso legítimo.
        let mut criterio = AceitacaoTardia::nova(1, custo(100));
        criterio.decidir(custo(30), custo(40)); // memória em 30

        assert!(
            criterio.decidir(custo(80), custo(90)),
            "80 é pior que a memória, mas melhora a atual (90): tem de passar"
        );
    }

    #[test]
    fn reiniciar_devolve_a_tolerancia() {
        let mut criterio = AceitacaoTardia::nova(4, custo(10));
        assert!(!criterio.decidir(custo(50), custo(10)));

        criterio.reiniciar(custo(100));
        assert!(criterio.decidir(custo(50), custo(10)), "após reiniciar, 50 volta a caber");
    }

    #[test]
    fn a_memoria_atravessa_uma_gravacao_inteira() {
        let mut criterio = AceitacaoTardia::nova(4, custo(100));
        criterio.decidir(custo(30), custo(40));
        criterio.decidir(custo(20), custo(30));
        let (historico, passo) = criterio.memoria();
        let (historico, passo) = (historico.to_vec(), passo);

        // Um critério novo, como o do outro aparelho.
        let mut outro = AceitacaoTardia::nova(4, custo(999));
        assert!(outro.restaurar(&historico, passo));
        assert_eq!(outro.memoria().0, historico.as_slice());
        assert_eq!(outro.memoria().1, passo);

        // E os dois passam a decidir igual, que é o que importa.
        assert_eq!(criterio.decidir(custo(50), custo(40)), outro.decidir(custo(50), custo(40)));
    }

    #[test]
    fn uma_memoria_de_outro_tamanho_e_recusada() {
        let mut criterio = AceitacaoTardia::nova(4, custo(10));
        assert!(!criterio.restaurar(&[custo(1), custo(2)], 0), "tamanho diferente não descreve esta busca");
        assert_eq!(criterio.tamanho(), 4, "e a memória em uso fica intacta");
    }

    #[test]
    fn tamanho_zero_e_tratado_como_um() {
        let mut criterio = AceitacaoTardia::nova(0, custo(10));
        assert_eq!(criterio.tamanho(), 1);
        assert!(criterio.decidir(custo(5), custo(10)));
    }
}
