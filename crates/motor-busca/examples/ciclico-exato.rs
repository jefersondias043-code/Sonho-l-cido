//! Resolve ao certo o menor fechamento **cíclico** de cada configuração em
//! aberto da Lotinha, e diz onde isso melhora o banco.
//!
//! Não roda no celular. O que chega ao aplicativo é o `web/lotinha.json`
//! atualizado — o usuário recebe o fechamento pronto, sem gastar bateria
//! redescobrindo o que já foi provado aqui.
//!
//! ## O que este número é, e o que ele não é
//!
//! É o menor fechamento invariante por rotação `Z_pool`: um **limite superior**
//! para o mínimo geral, provado ótimo dentro daquela família. Não diz nada sobre
//! fechamentos sem essa simetria, e por isso não pode encostar em limite
//! inferior nenhum. Ver a mesma fronteira em `motor-core::referencia`.
//!
//! ```text
//! cargo run --release -p motor-busca --example ciclico-exato -- [teto_de_nos]
//! ```

use motor_busca::exato::{resolver, Desfecho};
use motor_busca::orbitas::InstanciaCiclica;
use std::io::Write;

const SORTEIO: usize = 15;

fn main() {
    let teto: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(20_000_000);

    // As vinte sem mínimo conhecido, da menor instância para a maior: assim o
    // que fecha aparece cedo, e o que não fecha não segura o resto.
    let abertas: Vec<(usize, usize)> = vec![
        (22, 19),
        (23, 20),
        (24, 21),
        (25, 22),
        (21, 18),
        (20, 17),
        (23, 19),
        (24, 20),
        (25, 21),
        (22, 18),
        (21, 17),
        (23, 18),
        (24, 19),
        (25, 20),
        (22, 17),
        (23, 17),
        (24, 18),
        (25, 19),
        (24, 17),
        (25, 18),
    ];

    // O que o banco entrega hoje, para saber se o exato melhora ou confirma.
    let banco: Vec<(usize, usize, u64)> = vec![
        (20, 17, 240),
        (21, 17, 1095),
        (21, 18, 182),
        (22, 17, 3454),
        (22, 18, 660),
        (22, 19, 126),
        (23, 17, 10051),
        (23, 18, 2162),
        (23, 19, 475),
        (23, 20, 100),
        (24, 17, 26837),
        (24, 18, 5884),
        (24, 19, 1506),
        (24, 20, 334),
        (24, 21, 80),
        (25, 18, 14875),
        (25, 19, 3856),
        (25, 20, 1104),
        (25, 21, 266),
        (25, 22, 72),
    ];

    println!("{:>9} {:>7} {:>7} {:>8} {:>9}  desfecho", "pool,jogo", "órbitas", "alvos", "banco", "cíclico");

    for (pool, jogo) in abertas {
        let temos = banco.iter().find(|&&(p, j, _)| p == pool && j == jogo).map(|&(_, _, n)| n);
        eprint!("{pool},{jogo}… ");
        let _ = std::io::stderr().flush();

        // Fora do celular o teto de memória pode subir: 25/22 pede 15,7 milhões
        // de ligações, e é a única em aberto que não cabe no teto do navegador.
        let Some(inst) =
            InstanciaCiclica::montar_ate(pool, pool - jogo, pool - SORTEIO, 64_000_000, None)
        else {
            println!("{:>9} {:>7} {:>7} {:>8} {:>9}  instância não cabe", format!("{pool},{jogo}"), "-", "-", "-", "-");
            continue;
        };
        let Some(exata) = inst.para_exato() else {
            println!("{:>9} {:>7} {:>7} {:>8} {:>9}  instância inválida", format!("{pool},{jogo}"), "-", "-", "-", "-");
            continue;
        };

        let (texto, valor) = match resolver(&exata, teto) {
            Desfecho::Otimo { peso, escolha } => {
                let confere = inst.expandir(&escolha).len() as u64 == peso;
                (
                    if confere { "ÓTIMO CÍCLICO".to_string() } else { "expansão divergiu".to_string() },
                    Some(peso),
                )
            }
            Desfecho::Excedido => ("estourou o teto".to_string(), None),
            Desfecho::Inviavel => ("inviável".to_string(), None),
        };

        let veredito = match (valor, temos) {
            (Some(v), Some(t)) if v < t => format!("{texto} — MELHORA o banco em {}", t - v),
            (Some(v), Some(t)) if v == t => format!("{texto} — confirma o banco"),
            (Some(v), Some(t)) => format!("{texto} — banco é melhor por {} (fechamento não cíclico)", v - t),
            (Some(_), None) => texto,
            (None, _) => texto,
        };

        println!(
            "{:>9} {:>7} {:>7} {:>8} {:>9}  {}",
            format!("{pool},{jogo}"),
            inst.candidatos(),
            inst.alvos(),
            temos.map(|t| t.to_string()).unwrap_or_else(|| "-".into()),
            valor.map(|v| v.to_string()).unwrap_or_else(|| "-".into()),
            veredito
        );
        let _ = std::io::stdout().flush();
    }
}
