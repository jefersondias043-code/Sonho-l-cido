//! # motor-exato — o construtor matemático de fechamentos mínimos
//!
//! ## A inversão
//!
//! O caminho comum gera muitas cartelas e tenta comprimi-las. Este resolve o
//! problema **antes** de construir:
//!
//! ```text
//!   parâmetros
//!       ↓
//!   modelo combinatório formal          problema.rs
//!       ↓
//!   limites matemáticos                 limites.rs
//!       ↓
//!   construção direta no alvo           construtor.rs
//!       ↓
//!   verificação                         problema.rs
//!       ↓
//!   prova de que nada menor existe      prova.rs
//!       ↓
//!   veredito                            veredito.rs
//! ```
//!
//! Encontrar e provar são funções diferentes, e o crate as mantém separadas:
//! [`construtor`] responde *quais cartelas*, [`prova`] responde *se existe algo
//! menor*, e só o encontro das duas autoriza dizer "mínimo".
//!
//! ## O que ele não faz
//!
//! Não consulta tabela de mínimos de terceiros. Todo número que ele afirma foi
//! calculado aqui — e onde não conseguiu calcular, ele diz que não conseguiu,
//! em vez de emprestar a resposta de alguém.
//!
//! Essa recusa tem preço, e o preço é visível: em `C(13,5,2)` o mínimo é 10, e
//! sabe-se disso por trabalho computacional pesado registrado na literatura.
//! Calculando sozinho, este crate encontra 10 e prova apenas `≥ 8`. A
//! diferença entre os dois números é honestidade, não fraqueza — e a tela
//! mostra os dois.
//!
//! ## Sem dependência dos outros motores
//!
//! Nem `motor-core` nem `motor-busca`. Ele define o próprio bloco, a própria
//! enumeração de combinações e os próprios limites. São poucas centenas de
//! linhas, e em troca a matemática do aplicativo se lê num lugar só.

pub mod construtor;
pub mod limites;
pub mod prova;
pub mod problema;
pub mod veredito;

pub use limites::{Limite, LimiteInferior};
pub use problema::{Bloco, Problema};
pub use veredito::{Relatorio, Veredito};
