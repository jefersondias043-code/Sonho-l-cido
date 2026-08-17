//! Leitura de fechamentos de arquivo — §31 do documento conceitual.
//!
//! O interpretador do formato mora em `motor_core::texto`, e não aqui. O motivo
//! é a tela de importar do aplicativo web: ela precisa aceitar exatamente o
//! mesmo texto que o terminal aceita, e a única forma de garantir isso é haver
//! um único código, compilado para os dois lados.
//!
//! O que sobra neste módulo é o que só existe no terminal: abrir arquivo.

use std::path::Path;

use anyhow::{Context, Result};

pub use motor_core::texto::{
    converter_para_cartelas, escrever_fechamento, interpretar_fechamento, pool_do_fechamento,
};

/// Lê um fechamento de um arquivo de texto.
///
/// Devolve as cartelas em rótulos do universo, sem interpretá-las ainda — a
/// validação contra um problema fica em [`converter_para_cartelas`].
pub fn ler_fechamento(caminho: &Path) -> Result<Vec<Vec<u32>>> {
    let texto = std::fs::read_to_string(caminho)
        .with_context(|| format!("não consegui ler {}", caminho.display()))?;
    interpretar_fechamento(&texto).with_context(|| format!("em {}", caminho.display()))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_um_arquivo_de_verdade() {
        // O resto do formato é exercido nos testes de `motor_core::texto`; aqui
        // só interessa que o arquivo chegue inteiro ao interpretador.
        let caminho = std::env::temp_dir().join("sonho-lucido-fechamento-de-teste.txt");
        std::fs::write(&caminho, "# exemplo\n01 04 07\n02 05 08\n").unwrap();

        let cartelas = ler_fechamento(&caminho).unwrap();
        assert_eq!(cartelas, vec![vec![1, 4, 7], vec![2, 5, 8]]);

        std::fs::remove_file(&caminho).ok();
    }

    #[test]
    fn arquivo_inexistente_diz_qual_arquivo() {
        let erro = ler_fechamento(Path::new("/caminho/que/nao/existe.txt")).unwrap_err();
        assert!(erro.to_string().contains("/nao/existe.txt"), "mensagem foi: {erro}");
    }
}
