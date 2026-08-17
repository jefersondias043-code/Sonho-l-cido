//! Importação e exportação de fechamentos — §31 do documento conceitual.
//!
//! O formato é o mais simples que existe: uma cartela por linha, números
//! separados por espaço, vírgula ou ponto e vírgula. É o que se obtém colando
//! de uma planilha, de um site ou de um bloco de notas, que é exatamente de
//! onde os fechamentos costumam vir.
//!
//! Linhas vazias e linhas começadas por `#` são ignoradas, para que o arquivo
//! possa ter comentários.

use std::path::Path;

use anyhow::{bail, Context, Result};
use motor_core::{Cartela, Problema};

/// Lê um fechamento de um arquivo de texto.
///
/// Devolve as cartelas em rótulos do universo, sem interpretá-las ainda — a
/// validação contra um problema fica em [`converter_para_cartelas`].
pub fn ler_fechamento(caminho: &Path) -> Result<Vec<Vec<u32>>> {
    let texto = std::fs::read_to_string(caminho)
        .with_context(|| format!("não consegui ler {}", caminho.display()))?;
    interpretar_fechamento(&texto)
}

/// Interpreta o texto de um fechamento.
pub fn interpretar_fechamento(texto: &str) -> Result<Vec<Vec<u32>>> {
    let mut cartelas = Vec::new();

    for (numero, linha) in texto.lines().enumerate() {
        let limpa = linha.trim();
        if limpa.is_empty() || limpa.starts_with('#') {
            continue;
        }

        let mut rotulos = Vec::new();
        for campo in limpa.split([' ', '\t', ',', ';', '-']).filter(|c| !c.is_empty()) {
            let rotulo: u32 = campo.parse().with_context(|| {
                format!("linha {}: \"{campo}\" não é um número", numero + 1)
            })?;
            rotulos.push(rotulo);
        }

        if rotulos.is_empty() {
            continue;
        }

        rotulos.sort_unstable();
        let antes = rotulos.len();
        rotulos.dedup();
        if rotulos.len() != antes {
            bail!("linha {}: a cartela tem números repetidos", numero + 1);
        }

        cartelas.push(rotulos);
    }

    if cartelas.is_empty() {
        bail!("nenhuma cartela encontrada no arquivo");
    }
    Ok(cartelas)
}

/// Converte rótulos em cartelas internas, validando contra o problema.
pub fn converter_para_cartelas(
    rotulos: &[Vec<u32>],
    problema: &Problema,
) -> Result<Vec<Cartela>> {
    let mut cartelas = Vec::with_capacity(rotulos.len());

    for (posicao, linha) in rotulos.iter().enumerate() {
        if linha.len() != problema.tamanho_cartela() {
            bail!(
                "cartela {}: tem {} números, mas a configuração pede {}",
                posicao + 1,
                linha.len(),
                problema.tamanho_cartela()
            );
        }

        let mut cartela = Cartela::vazia();
        for &rotulo in linha {
            let indice = problema.indice_do_rotulo(rotulo).with_context(|| {
                format!(
                    "cartela {}: o número {rotulo} não está no pool configurado",
                    posicao + 1
                )
            })?;
            cartela.inserir(indice);
        }
        cartelas.push(cartela);
    }

    Ok(cartelas)
}

/// Deduz o pool a partir de um fechamento: todos os números que aparecem nele.
///
/// Serve para o usuário que tem as cartelas mas não lembra qual pool usou.
pub fn pool_do_fechamento(rotulos: &[Vec<u32>]) -> Vec<u32> {
    let mut pool: Vec<u32> = rotulos.iter().flatten().copied().collect();
    pool.sort_unstable();
    pool.dedup();
    pool
}

/// Escreve um fechamento em texto, uma cartela por linha.
pub fn escrever_fechamento(cartelas: &[Vec<u32>]) -> String {
    let mut saida = String::new();
    for cartela in cartelas {
        let linha: Vec<String> = cartela.iter().map(|r| format!("{r:02}")).collect();
        saida.push_str(&linha.join(" "));
        saida.push('\n');
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;
    use motor_core::{Objetivo, RegraCobertura};

    #[test]
    fn interpreta_o_formato_mais_comum() {
        let texto = "01 04 07 12 23 35 48\n02 05 08 14 27 31 52\n";
        let cartelas = interpretar_fechamento(texto).unwrap();
        assert_eq!(cartelas.len(), 2);
        assert_eq!(cartelas[0], vec![1, 4, 7, 12, 23, 35, 48]);
    }

    #[test]
    fn aceita_os_separadores_que_aparecem_na_pratica() {
        // Vírgula vem de planilha, ponto e vírgula de CSV brasileiro, hífen de
        // sites de resultados.
        for texto in ["1,2,3", "1;2;3", "1 - 2 - 3", "1\t2\t3", "  1   2   3  "] {
            let cartelas = interpretar_fechamento(texto).unwrap();
            assert_eq!(cartelas[0], vec![1, 2, 3], "falhou em {texto:?}");
        }
    }

    #[test]
    fn ignora_linhas_vazias_e_comentarios() {
        let texto = "# meu fechamento\n\n1 2 3\n\n# outro trecho\n4 5 6\n";
        let cartelas = interpretar_fechamento(texto).unwrap();
        assert_eq!(cartelas.len(), 2);
    }

    #[test]
    fn ordena_os_numeros_de_cada_cartela() {
        let cartelas = interpretar_fechamento("35 4 12 1").unwrap();
        assert_eq!(cartelas[0], vec![1, 4, 12, 35]);
    }

    #[test]
    fn recusa_cartela_com_numero_repetido() {
        // Quase sempre é erro de digitação, e passar batido produziria uma
        // cartela menor do que o usuário pensa que tem.
        let erro = interpretar_fechamento("1 2 2 3").unwrap_err();
        assert!(erro.to_string().contains("repetidos"), "mensagem foi: {erro}");
    }

    #[test]
    fn recusa_texto_sem_nenhuma_cartela() {
        assert!(interpretar_fechamento("# só comentário\n\n").is_err());
    }

    #[test]
    fn recusa_campo_que_nao_e_numero() {
        let erro = interpretar_fechamento("1 2 três").unwrap_err();
        assert!(erro.to_string().contains("não é um número"), "mensagem foi: {erro}");
    }

    #[test]
    fn pool_deduzido_reune_todos_os_numeros_sem_repetir() {
        let cartelas = vec![vec![1, 5, 9], vec![5, 9, 13], vec![2, 1, 13]];
        assert_eq!(pool_do_fechamento(&cartelas), vec![1, 2, 5, 9, 13]);
    }

    #[test]
    fn converte_para_cartelas_validando_o_pool() {
        let problema = Problema::novo(
            60,
            vec![1, 4, 7, 12],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();

        let cartelas = converter_para_cartelas(&[vec![1, 7], vec![4, 12]], &problema).unwrap();
        assert_eq!(cartelas.len(), 2);
        assert_eq!(cartelas[0].rotulos(problema.pool()), vec![1, 7]);
    }

    #[test]
    fn recusa_cartela_de_tamanho_errado() {
        let problema = Problema::novo(
            60,
            vec![1, 4, 7, 12],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();

        let erro = converter_para_cartelas(&[vec![1, 4, 7]], &problema).unwrap_err();
        assert!(erro.to_string().contains("3 números"), "mensagem foi: {erro}");
    }

    #[test]
    fn recusa_numero_fora_do_pool() {
        let problema = Problema::novo(
            60,
            vec![1, 4, 7, 12],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();

        let erro = converter_para_cartelas(&[vec![1, 99]], &problema).unwrap_err();
        assert!(erro.to_string().contains("99"), "mensagem foi: {erro}");
    }

    #[test]
    fn exportar_e_importar_fecham_o_ciclo() {
        let original = vec![vec![1u32, 4, 7, 12], vec![2, 5, 8, 14]];
        let texto = escrever_fechamento(&original);
        assert_eq!(interpretar_fechamento(&texto).unwrap(), original);
    }
}
