//! Formatação para leitura humana.
//!
//! Números de iteração chegam à casa dos bilhões e tempos à casa dos dias. Sem
//! separador de milhar e sem formato de duração, o painel do §27 vira uma
//! parede de dígitos que ninguém consegue ler de relance.

use std::time::Duration;

/// Separa milhares com ponto, na convenção brasileira: `18492731` → `18.492.731`.
pub fn milhares(valor: u64) -> String {
    let digitos = valor.to_string();
    let bytes = digitos.as_bytes();
    let mut saida = String::with_capacity(digitos.len() + digitos.len() / 3);

    for (posicao, &digito) in bytes.iter().enumerate() {
        if posicao > 0 && (bytes.len() - posicao) % 3 == 0 {
            saida.push('.');
        }
        saida.push(digito as char);
    }
    saida
}

/// Duração em `HH:MM:SS`, sem limite de horas: `03:42:18`, `128:05:00`.
pub fn duracao(tempo: Duration) -> String {
    let total = tempo.as_secs();
    format!("{:02}:{:02}:{:02}", total / 3600, (total % 3600) / 60, total % 60)
}

/// Percentual com uma casa: `0.9834` → `98,3%`.
pub fn percentual(fracao: f64) -> String {
    format!("{:.1}%", fracao * 100.0).replace('.', ",")
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn milhares_agrupa_de_tres_em_tres() {
        assert_eq!(milhares(0), "0");
        assert_eq!(milhares(7), "7");
        assert_eq!(milhares(999), "999");
        assert_eq!(milhares(1000), "1.000");
        assert_eq!(milhares(18_492_731), "18.492.731");
        assert_eq!(milhares(1_000_000_000), "1.000.000.000");
    }

    #[test]
    fn duracao_nao_estoura_em_execucoes_longas() {
        assert_eq!(duracao(Duration::from_secs(0)), "00:00:00");
        assert_eq!(duracao(Duration::from_secs(59)), "00:00:59");
        assert_eq!(duracao(Duration::from_secs(3600)), "01:00:00");
        assert_eq!(duracao(Duration::from_secs(13338)), "03:42:18");
        // Uma busca de vários dias precisa continuar legível.
        assert_eq!(duracao(Duration::from_secs(460_800)), "128:00:00");
    }

    #[test]
    fn percentual_usa_virgula_decimal() {
        assert_eq!(percentual(1.0), "100,0%");
        assert_eq!(percentual(0.9834), "98,3%");
        assert_eq!(percentual(0.0), "0,0%");
    }
}
