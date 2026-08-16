//! Buffers de trabalho compartilhados por toda a busca.
//!
//! O motor executa milhões de iterações. Se cada uma alocasse um punhado de
//! vetores, o alocador viraria o gargalo — e a busca ficaria mais lenta que a
//! matemática que ela executa. A `Oficina` reúne todo o espaço temporário
//! necessário, alocado uma vez e reutilizado para sempre.

use motor_core::{Cartela, Rascunho, Restaurador};

#[derive(Debug, Default)]
pub struct Oficina {
    /// Buffers do cálculo de cobertura.
    pub rascunho: Rascunho,
    /// Buffers do desfazer.
    pub restaurador: Restaurador,
    /// Cópia das cartelas antes de uma transformação, para poder reverter.
    pub instantaneo: Vec<Cartela>,
    /// Elementos do pool ainda disponíveis ao montar uma cartela.
    pub candidatos: Vec<usize>,
    /// Elementos obrigatórios da cartela sendo construída.
    pub semente: Vec<usize>,
    /// Índices de cartelas, para percursos em ordem embaralhada.
    pub ordem: Vec<usize>,
    /// Pontuações auxiliares indexadas por cartela.
    pub notas: Vec<i64>,
    /// Cartelas escolhidas para sair na fase de destruição.
    ///
    /// A remoção é feita por valor, não por índice: `Solucao::remover` usa
    /// troca com o último elemento, então os índices se embaralham a cada
    /// remoção e uma lista de índices ficaria obsoleta na primeira delas.
    pub remocoes: Vec<Cartela>,
}

impl Oficina {
    pub fn nova() -> Self {
        Self::default()
    }
}
