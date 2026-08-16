//! Controle da execução — os botões PARAR e CONTINUAR do §15 e §16.
//!
//! A busca é um laço que pode rodar por dias. Quem a inicia precisa poder
//! interrompê-la de fora, sem perder nada, e precisa acompanhar o que está
//! acontecendo lá dentro sem que o motor saiba o que é uma tela.
//!
//! Daí duas peças separadas: um sinal de parada compartilhável entre threads, e
//! uma interface de observação por onde os eventos saem. O motor não imprime
//! nada — ele avisa. Quem escuta decide se aquilo vira uma linha de terminal,
//! um registro em banco ou um quadro numa interface gráfica.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use motor_core::{Avaliacao, Cartela, LimiteInferior};

/// Sinal de parada, compartilhável entre threads.
///
/// Clonar dá outra alça para o *mesmo* sinal — é assim que o tratador de
/// Ctrl+C, ou um botão de interface, alcança a busca em andamento.
#[derive(Debug, Clone, Default)]
pub struct Controle {
    parar: Arc<AtomicBool>,
}

impl Controle {
    pub fn novo() -> Self {
        Self::default()
    }

    /// Pede que a busca encerre no fim da iteração atual.
    pub fn parar(&self) {
        self.parar.store(true, Ordering::Relaxed);
    }

    pub fn foi_solicitada_parada(&self) -> bool {
        self.parar.load(Ordering::Relaxed)
    }

    /// Reabilita o controle para uma nova execução (o CONTINUAR do §16).
    pub fn retomar(&self) {
        self.parar.store(false, Ordering::Relaxed);
    }
}

/// Até onde esta execução deve ir.
///
/// Todos os limites são opcionais. Sem nenhum deles, a busca só termina quando
/// alguém pedir — que é o comportamento padrão descrito no §14.
#[derive(Debug, Clone, Default)]
pub struct CondicoesDeParada {
    pub max_iteracoes: Option<u64>,
    pub max_duracao: Option<Duration>,
    /// Encerra quando a melhor solução encontrada alcançar o limite inferior,
    /// ou seja, quando não houver mais nada a procurar.
    pub parar_em_optimalidade: bool,
}

impl CondicoesDeParada {
    /// Sem limite: roda até alguém pedir para parar.
    pub fn indefinida() -> Self {
        Self { parar_em_optimalidade: true, ..Default::default() }
    }

    pub fn por_iteracoes(quantidade: u64) -> Self {
        Self {
            max_iteracoes: Some(quantidade),
            parar_em_optimalidade: true,
            ..Default::default()
        }
    }

    pub fn por_tempo(duracao: Duration) -> Self {
        Self { max_duracao: Some(duracao), parar_em_optimalidade: true, ..Default::default() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotivoEncerramento {
    /// Alguém acionou o controle de parada.
    Solicitado,
    LimiteDeIteracoes,
    LimiteDeTempo,
    /// A melhor solução encontrada alcançou o limite inferior: não existe
    /// solução melhor, e isso está provado.
    OptimalidadeProvada,
}

impl std::fmt::Display for MotivoEncerramento {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MotivoEncerramento::Solicitado => write!(f, "parada solicitada"),
            MotivoEncerramento::LimiteDeIteracoes => write!(f, "limite de iterações atingido"),
            MotivoEncerramento::LimiteDeTempo => write!(f, "limite de tempo atingido"),
            MotivoEncerramento::OptimalidadeProvada => write!(f, "optimalidade provada"),
        }
    }
}

/// Números acumulados da busca.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Estatisticas {
    pub iteracoes: u64,
    pub aceitas: u64,
    pub recordes: u64,
    pub diversificacoes: u64,
    /// Soluções recusadas por já terem sido visitadas (§38).
    pub duplicadas_evitadas: u64,
}

/// O que o motor conta para fora enquanto trabalha.
#[derive(Debug, Clone)]
pub enum Evento {
    Iniciado {
        avaliacao: Avaliacao,
        limite: LimiteInferior,
    },
    /// Uma solução melhor que todas as anteriores. O único evento que altera
    /// a "melhor solução conhecida".
    NovoRecorde {
        avaliacao: Avaliacao,
        cartelas: Vec<Cartela>,
        iteracao: u64,
        decorrido: Duration,
        operador: &'static str,
    },
    /// Retrato periódico do andamento — alimenta o painel do §27.
    Progresso {
        iteracao: u64,
        decorrido: Duration,
        atual: Avaliacao,
        melhor: Avaliacao,
        /// Cardinalidade que a busca está perseguindo neste momento.
        alvo_cartelas: usize,
        elites: usize,
        operador: &'static str,
    },
    /// A busca detectou estagnação e mudou de região (§35).
    Diversificacao {
        iteracao: u64,
        estrategia: &'static str,
    },
    Encerrado {
        motivo: MotivoEncerramento,
        estatisticas: Estatisticas,
        melhor: Avaliacao,
        decorrido: Duration,
    },
}

/// Quem quiser acompanhar a busca implementa isto.
pub trait Observador {
    fn ao_evento(&mut self, evento: &Evento);
}

/// Observador que ignora tudo — para execuções silenciosas e testes.
pub struct Silencioso;

impl Observador for Silencioso {
    fn ao_evento(&mut self, _evento: &Evento) {}
}

/// Observador que guarda os eventos em memória, útil em testes.
#[derive(Debug, Default)]
pub struct Coletor {
    pub eventos: Vec<Evento>,
}

impl Observador for Coletor {
    fn ao_evento(&mut self, evento: &Evento) {
        self.eventos.push(evento.clone());
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn controle_comeca_liberado() {
        let controle = Controle::novo();
        assert!(!controle.foi_solicitada_parada());
    }

    #[test]
    fn parada_alcanca_todas_as_alcas_do_mesmo_controle() {
        // É isso que permite um botão, ou um Ctrl+C, alcançar a busca que já
        // está rodando em outra thread.
        let controle = Controle::novo();
        let outra_alca = controle.clone();

        outra_alca.parar();
        assert!(controle.foi_solicitada_parada());

        controle.retomar();
        assert!(!outra_alca.foi_solicitada_parada());
    }

    #[test]
    fn condicoes_padrao_nao_impoem_limite() {
        let condicoes = CondicoesDeParada::indefinida();
        assert!(condicoes.max_iteracoes.is_none());
        assert!(condicoes.max_duracao.is_none());
        assert!(condicoes.parar_em_optimalidade);
    }

    #[test]
    fn coletor_guarda_os_eventos_na_ordem() {
        let mut coletor = Coletor::default();
        coletor.ao_evento(&Evento::Diversificacao { iteracao: 1, estrategia: "a" });
        coletor.ao_evento(&Evento::Diversificacao { iteracao: 2, estrategia: "b" });
        assert_eq!(coletor.eventos.len(), 2);
    }
}
