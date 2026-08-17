//! O painel de acompanhamento — §27 e §28 do documento conceitual.
//!
//! Faz duas coisas a cada evento do motor: mostra o andamento e **grava o
//! recorde no banco no mesmo instante em que ele aparece**.
//!
//! A gravação imediata é deliberada. Uma busca que roda por dias vai ser
//! interrompida de todo jeito — por Ctrl+C, por queda de energia, por reinício
//! da máquina. Se o resultado só fosse salvo ao final, cada uma dessas
//! interrupções custaria tudo. Salvando na hora, o pior caso é perder alguns
//! segundos de exploração.

use std::io::{IsTerminal, Write};

use motor_busca::{Evento, Observador};
use motor_core::{gap, LimiteInferior, Problema};
use motor_persistencia::Banco;

use crate::formato;

pub struct Painel<'a> {
    banco: &'a Banco,
    execucao_id: i64,
    problema: Problema,
    limite: LimiteInferior,
    /// Quando a saída é um terminal, a linha de progresso se sobrescreve; num
    /// arquivo de log ela vira uma linha nova a cada atualização.
    interativo: bool,
    /// Se há uma linha de progresso pendente que precisa ser encerrada antes
    /// de escrever qualquer outra coisa.
    linha_pendente: bool,
    pub falhas_de_gravacao: usize,
}

impl<'a> Painel<'a> {
    pub fn novo(
        banco: &'a Banco,
        execucao_id: i64,
        problema: Problema,
        limite: LimiteInferior,
    ) -> Self {
        Self {
            banco,
            execucao_id,
            problema,
            limite,
            interativo: std::io::stdout().is_terminal(),
            linha_pendente: false,
            falhas_de_gravacao: 0,
        }
    }

    fn encerrar_linha_de_progresso(&mut self) {
        if self.linha_pendente {
            println!();
            self.linha_pendente = false;
        }
    }

    fn escrever_progresso(&mut self, texto: &str) {
        if self.interativo {
            print!("\r\x1b[2K{texto}");
            let _ = std::io::stdout().flush();
            self.linha_pendente = true;
        } else {
            println!("{texto}");
        }
    }
}

impl Observador for Painel<'_> {
    fn ao_evento(&mut self, evento: &Evento) {
        match evento {
            Evento::Iniciado { avaliacao, limite } => {
                self.encerrar_linha_de_progresso();
                println!(
                    "  solução inicial: {} cartelas | limite inferior ≥ {} ({})",
                    avaliacao.cartelas, limite.valor, limite.metodo
                );
            }

            Evento::NovoRecorde { avaliacao, cartelas, iteracao, decorrido, operador } => {
                self.encerrar_linha_de_progresso();

                let distancia = gap(avaliacao.cartelas as u64, self.limite.valor)
                    .map(|g| format!(" | gap {}", formato::percentual(g)))
                    .unwrap_or_default();

                println!(
                    "  ★ {} cartelas | cobertura {} | iteração {} | {}{} | via {operador}",
                    avaliacao.cartelas,
                    formato::percentual(avaliacao.cobertura()),
                    formato::milhares(*iteracao),
                    formato::duracao(*decorrido),
                    distancia,
                );

                // Grava antes de qualquer outra coisa: este é o resultado.
                let gravou = self.banco.gravar_solucao(
                    self.execucao_id,
                    &self.problema,
                    cartelas,
                    *avaliacao,
                    assinatura_das(cartelas),
                    *iteracao,
                    decorrido.as_secs_f64(),
                    Some(operador),
                    None,
                    true,
                );
                if gravou.is_err() {
                    self.falhas_de_gravacao += 1;
                    eprintln!("  aviso: não foi possível gravar este recorde no banco");
                }
                let _ = self.banco.atualizar_andamento(
                    self.execucao_id,
                    *iteracao,
                    decorrido.as_secs_f64(),
                );
            }

            Evento::Progresso {
                iteracao,
                decorrido,
                atual,
                melhor,
                alvo_cartelas,
                elites,
                operador,
            } => {
                let texto = format!(
                    "  {} iter | {} | atual {} cart, {} desc | melhor {} | meta {} | {} elites | {}",
                    formato::milhares(*iteracao),
                    formato::duracao(*decorrido),
                    atual.cartelas,
                    formato::milhares(atual.descobertos as u64),
                    melhor.cartelas,
                    alvo_cartelas,
                    elites,
                    operador,
                );
                self.escrever_progresso(&texto);

                let _ = self.banco.atualizar_andamento(
                    self.execucao_id,
                    *iteracao,
                    decorrido.as_secs_f64(),
                );
            }

            Evento::Diversificacao { iteracao, estrategia } => {
                self.encerrar_linha_de_progresso();
                println!(
                    "  ↻ estagnação na iteração {}: {estrategia}",
                    formato::milhares(*iteracao)
                );
            }

            Evento::Encerrado { motivo, estatisticas, melhor, decorrido } => {
                self.encerrar_linha_de_progresso();
                let _ = self.banco.atualizar_andamento(
                    self.execucao_id,
                    estatisticas.iteracoes,
                    decorrido.as_secs_f64(),
                );

                println!();
                println!("  encerrado: {motivo}");
                println!(
                    "  {} iterações em {} | {} aceitas | {} recordes | {} diversificações",
                    formato::milhares(estatisticas.iteracoes),
                    formato::duracao(*decorrido),
                    formato::milhares(estatisticas.aceitas),
                    estatisticas.recordes,
                    estatisticas.diversificacoes,
                );
                println!(
                    "  melhor solução conhecida: {} cartelas | cobertura {}",
                    melhor.cartelas,
                    formato::percentual(melhor.cobertura()),
                );
            }
        }
    }
}

/// Assinatura estrutural de um conjunto de cartelas.
///
/// Reproduz `Solucao::assinatura` para que o mesmo conjunto de cartelas receba
/// o mesmo identificador dentro e fora do motor — é isso que permite ao banco
/// reconhecer uma solução já gravada.
fn assinatura_das(cartelas: &[motor_core::Cartela]) -> u64 {
    let mut mascaras: Vec<u128> = cartelas.iter().map(|c| c.mascara()).collect();
    mascaras.sort_unstable();
    mascaras.dedup();

    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIMO: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET;
    for mascara in mascaras {
        for byte in mascara.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(PRIMO);
        }
    }
    hash
}

#[cfg(test)]
mod testes {
    use super::*;
    use motor_core::{Cartela, MotorCobertura, Objetivo, Rascunho, RegraCobertura, Solucao};

    #[test]
    fn a_assinatura_do_painel_bate_com_a_do_motor() {
        // Se divergirem, o banco gravaria a mesma solução várias vezes e a
        // detecção de duplicidade do §38 deixaria de funcionar.
        let problema = Problema::com_pool_inicial(
            13,
            13,
            4,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let cobertura = MotorCobertura::novo(&problema).unwrap();
        let mut rascunho = Rascunho::novo();

        let cartelas = vec![
            Cartela::dos_indices(&[0, 1, 2, 3]),
            Cartela::dos_indices(&[4, 5, 6, 7]),
            Cartela::dos_indices(&[8, 9, 10, 11]),
        ];
        let solucao = Solucao::de_cartelas(&cobertura, &cartelas, &mut rascunho);

        assert_eq!(assinatura_das(&cartelas), solucao.assinatura());
    }

    #[test]
    fn a_assinatura_ignora_a_ordem() {
        let a = Cartela::dos_indices(&[0, 1, 2]);
        let b = Cartela::dos_indices(&[3, 4, 5]);
        assert_eq!(assinatura_das(&[a, b]), assinatura_das(&[b, a]));
    }
}
