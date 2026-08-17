//! # motor-core — o núcleo matemático
//!
//! Este crate não sabe o que é uma loteria. Ele conhece:
//!
//! - um **universo** de `N` elementos;
//! - um **pool** de `p` elementos escolhidos dentro dele;
//! - **cartelas**, que são subconjuntos de `k` elementos do pool;
//! - uma **regra de cobertura**, que diz quais subconjuntos precisam ser atendidos;
//! - um **objetivo**, que diz o que significa "melhor".
//!
//! Qualquer modalidade — existente hoje ou criada amanhã — é apenas uma escolha
//! diferente desses números. Não há, e não deve haver, nenhum `if` de
//! modalidade em lugar nenhum deste código.
//!
//! ## O que sustenta a performance
//!
//! Três decisões de representação carregam o motor inteiro:
//!
//! 1. **Cartelas são bitmasks de 128 bits.** Interseção e contagem viram
//!    instruções únicas de CPU. ([`cartela`])
//! 2. **Alvos têm índice denso.** O ranqueamento colex dá a cada subconjunto um
//!    inteiro em `0..C(p,j)`, então a cobertura vira um vetor plano em vez de um
//!    mapa. ([`combinatoria`])
//! 3. **A cobertura é incremental.** Adicionar ou remover uma cartela mexe só
//!    nos alvos daquela cartela, nunca recalcula tudo. ([`solucao`])
//!
//! ## O que sustenta a confiança
//!
//! Otimizador rápido que devolve resposta errada é pior que otimizador lento.
//! Duas defesas, ambas exercidas nos testes:
//!
//! - [`cobertura::MotorCobertura::contagens_por_forca_bruta`] recalcula a
//!   cobertura por enumeração exaustiva, sem compartilhar caminho de código com
//!   a versão incremental. [`solucao::Solucao::conferir_invariantes`] confronta
//!   as duas.
//! - [`limites`] reproduz números de covering design já provados na literatura,
//!   o que valida a matemática contra uma fonte externa ao projeto.
//!
//! ## O que sustenta a comparação
//!
//! [`referencia`] embute a tabela mundial de coberturas — para cada `C(v,k,t)`,
//! o melhor resultado que alguém já produziu e o melhor limite inferior já
//! provado. Serve para situar o resultado do usuário e, sobretudo, para o motor
//! saber quando parar: em metade das configurações o limite publicado é mais
//! forte que qualquer cota fechada.
//!
//! [`planos`] escreve por fórmula as soluções ótimas dos casos de estrutura
//! algébrica rígida, que nenhuma busca local alcança por acidente.

pub mod avaliacao;
pub mod cartela;
pub mod cobertura;
pub mod combinatoria;
pub mod conjunto;
pub mod limites;
pub mod planos;
pub mod problema;
pub mod referencia;
pub mod solucao;
pub mod texto;

/// Quantas cartelas atendem um determinado alvo.
///
/// `u32` em vez de `u16` para que soluções muito redundantes — comuns durante a
/// fase exploratória, quando o motor deliberadamente piora a solução — nunca
/// possam estourar o contador e corromper o invariante de cobertura.
pub type Contagem = u32;

/// Custo de memória por alvo, somando o vetor de contagens e o conjunto
/// esparso de descobertos. Usado para estimar a viabilidade de uma
/// configuração antes de alocar qualquer coisa.
pub const BYTES_POR_ALVO: u64 = 12;

pub use avaliacao::{Avaliacao, ChaveCusto};
pub use cartela::{Cartela, Mascara};
pub use cobertura::{MotorCobertura, Rascunho};
pub use conjunto::ConjuntoEsparso;
pub use limites::{gap, limite_inferior, optimalidade_provada, LimiteInferior, MetodoLimite};
pub use planos::semente_algebrica;
pub use problema::{
    ErroProblema, ErroViabilidade, Objetivo, Problema, RegraCobertura, Viabilidade,
};
pub use referencia::Referencia;
pub use solucao::{Restaurador, Solucao};
pub use texto::{interpretar_fechamento, ErroFechamento};
