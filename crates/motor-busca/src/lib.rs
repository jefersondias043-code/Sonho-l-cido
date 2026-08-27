//! # motor-busca — a busca persistente e auto-reconstrutiva
//!
//! Este crate é o §46 do documento conceitual: a inovação não está em inventar
//! mais um algoritmo de fechamento, e sim na arquitetura de busca. Os métodos
//! clássicos — guloso, busca local, recozimento, algoritmos evolutivos — são
//! ferramentas internas, não o produto.
//!
//! ## O laço
//!
//! ```text
//! instantâneo  →  destruir  →  reconstruir  →  podar  →  avaliar
//!                     ↑                                     │
//!                     │                          aceita?  ──┤
//!                     │                                     │
//!                     └──────── desfazer ←──── não ─────────┘
//!                                                           │
//!                                            recorde? ──sim─→ guardar e
//!                                                             baixar a meta
//! ```
//!
//! ## As quatro peças
//!
//! | Peça | Papel | Documento |
//! |------|-------|-----------|
//! | [`operadores`] | como destruir | §9 |
//! | [`construcao`] | como reconstruir | §9.4, §10 |
//! | [`aceitacao`] | quando aceitar piorar | §11 |
//! | [`adaptativo`] | qual operador usar | §36 |
//! | [`arquivo`] | o que vale guardar | §17–§20 |
//!
//! ## O que torna a busca persistente
//!
//! Parar não custa nada e continuar não recomeça: [`MotorBusca::executar`] pode
//! ser chamada quantas vezes for preciso, e o estado interno — recorde, arquivo
//! de elites, pesos aprendidos — atravessa as pausas intacto.

pub mod aceitacao;
pub mod adaptativo;
pub mod arquivo;
pub mod construcao;
pub mod construtor;
pub mod controle;
pub mod motor;
pub mod oficina;
pub mod operadores;
pub mod troca;

pub use adaptativo::{Recompensas, SeletorAdaptativo};
pub use aceitacao::AceitacaoTardia;
pub use arquivo::{distancia_estrutural, ArquivoElites, Elite};
pub use controle::{
    CondicoesDeParada, Coletor, Controle, Estatisticas, Evento, MotivoEncerramento, Observador,
    Silencioso,
};
pub use motor::{
    Ajustes, Configuracao, MotorBusca, PassoDaMeta, ReinicioDaDiversificacao, RetratoDoMotor,
    UsoDoOperador,
    TETO_DE_ELITES,
};
pub use oficina::Oficina;
pub use troca::descida_por_troca;
pub use operadores::Operador;
