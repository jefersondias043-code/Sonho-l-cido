//! O motor muda de escala quando os movimentos pequenos param de render?
//!
//! ## A hipótese
//!
//! Quanto melhor a solução, menos redundância sobra, e menos cartelas podem sair
//! sozinhas. A partir de certo ponto a melhoria só existe atrás de uma alteração
//! **combinada**: A não pode sair, B não pode sair, mas mexer nos dois ao mesmo
//! tempo abre caminho. Um motor que continuasse tentando só movimentos de uma
//! cartela ficaria batendo numa porta que não abre.
//!
//! ## O que o motor já tem
//!
//! Oito operadores, de escalas diferentes — de trocar um número dentro de uma
//! cartela até desmontar a maior parte da solução — e um seletor adaptativo que
//! reajusta os pesos a cada 500 iterações conforme o que cada um rendeu.
//!
//! Ou seja: o mecanismo existe. O que faltava era o instrumento para saber se
//! ele **age**. Este exemplo mede, janela a janela: quanto cada operador foi
//! usado, quanto foi aceito, quantos recordes deu, e quanto peso o seletor lhe
//! atribui — junto da redundância da melhor solução, que é o que define o
//! estágio.
//!
//!   cargo run --release -p motor-busca --example escalas -- [iteracoes] [janela] [semente]

use motor_busca::{
    CondicoesDeParada, Configuracao, Controle, Evento, MotorBusca, Observador, UsoDoOperador,
};
use motor_core::{Objetivo, Problema, RegraCobertura};

struct Calado;
impl Observador for Calado {
    fn ao_evento(&mut self, _: &Evento) {}
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let total: u64 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(300_000);
    let janela: u64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(25_000);
    let semente: u64 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(7);

    let problema = Problema::com_pool_inicial(
        20, 20, 17,
        RegraCobertura::garantia(15, 15),
        Objetivo::MinimizarCartelas,
    )
    .unwrap();
    let mut motor = MotorBusca::novo(
        problema,
        Configuracao { semente, intervalo_progresso: 0, ..Default::default() },
    )
    .unwrap();

    let nomes = MotorBusca::nomes_dos_operadores();
    let mut antes: Vec<UsoDoOperador> = vec![UsoDoOperador::default(); nomes.len()];

    println!("== 20 dezenas, jogos de 17 — semente {semente} ==\n");

    let mut ate = janela;
    while ate <= total {
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada {
                max_iteracoes: Some(ate),
                max_duracao: None,
                parar_em_optimalidade: false,
            },
            &mut Calado,
        );

        let melhor = motor.melhor_avaliacao();
        // Redundância por cartela: quantos sorteios cada cartela cobre a mais do
        // que o necessário. É o que define o estágio — muita redundância quer
        // dizer que ainda há gordura para tirar.
        let por_cartela = melhor.redundancia as f64 / melhor.cartelas.max(1) as f64;
        println!(
            "-- até {ate} · melhor {} cartelas · redundância {} ({:.1} por cartela) --",
            melhor.cartelas, melhor.redundancia, por_cartela
        );
        println!(
            "   {:<24} {:>12} {:>8} {:>10} {:>9} {:>7}",
            "operador", "usos", "aceitas", "intactas", "recordes", "peso"
        );

        let agora = motor.uso_dos_operadores().to_vec();
        let pesos: Vec<f64> = motor.pesos_dos_operadores().iter().map(|(_, p)| *p).collect();
        let usos_na_janela: u64 = agora
            .iter()
            .zip(&antes)
            .map(|(d, a)| d.usos - a.usos)
            .sum();

        for (i, nome) in nomes.iter().enumerate() {
            let usos = agora[i].usos - antes[i].usos;
            let aceitas = agora[i].aceitas - antes[i].aceitas;
            let recordes = agora[i].recordes - antes[i].recordes;
            let fatia = if usos_na_janela > 0 {
                usos as f64 * 100.0 / usos_na_janela as f64
            } else {
                0.0
            };
            let sem_efeito = agora[i].sem_efeito - antes[i].sem_efeito;
            let pct = |x: u64| if usos > 0 { x as f64 * 100.0 / usos as f64 } else { 0.0 };
            println!(
                "   {nome:<24} {usos:>6} {fatia:>4.0}% {:>7.0}% {:>9.0}% {recordes:>9} {:>7.2}",
                pct(aceitas), pct(sem_efeito), pesos[i],
            );
        }
        println!();

        antes = agora;
        ate += janela;
    }
}
