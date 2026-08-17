//! Leitura e escrita de fechamentos em texto.
//!
//! O formato é o mais simples que existe: uma cartela por linha, números
//! separados por espaço, vírgula, ponto e vírgula, tabulação ou hífen. É o que
//! se obtém colando de uma planilha, de um site ou de um bloco de notas — que é
//! exatamente de onde os fechamentos costumam vir. Linhas vazias e linhas
//! começadas por `#` são ignoradas, para que o arquivo possa ter comentários.
//!
//! ## Por que isto mora no núcleo
//!
//! Este código nasceu na linha de comando. Quando o aplicativo web ganhou a tela
//! de importar, havia duas saídas: reescrever o mesmo interpretador em
//! JavaScript, ou trazer este para o núcleo e usá-lo dos dois lados.
//!
//! Dois interpretadores do mesmo formato divergem — é questão de tempo. Um
//! aceita hífen e o outro não; um recusa número repetido e o outro produz
//! silenciosamente uma cartela menor do que o usuário pensa que tem. Aqui, o que
//! o celular aceita é exatamente o que o terminal aceita, porque é o mesmo
//! código compilado para WebAssembly.

use crate::cartela::Cartela;
use crate::problema::Problema;

/// O que pode dar errado ao ler um fechamento de fora.
///
/// Cada variante carrega onde o problema está, porque a mensagem vai aparecer
/// para alguém que colou trinta linhas e precisa saber qual delas corrigir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroFechamento {
    CampoNaoNumerico { linha: usize, campo: String },
    NumerosRepetidos { linha: usize },
    NenhumaCartela,
    TamanhoErrado { cartela: usize, encontrado: usize, esperado: usize },
    ForaDoPool { cartela: usize, rotulo: u32 },
}

impl std::fmt::Display for ErroFechamento {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroFechamento::CampoNaoNumerico { linha, campo } => {
                write!(f, "linha {linha}: \"{campo}\" não é um número")
            }
            ErroFechamento::NumerosRepetidos { linha } => {
                write!(f, "linha {linha}: a cartela tem números repetidos")
            }
            ErroFechamento::NenhumaCartela => write!(f, "nenhuma cartela encontrada"),
            ErroFechamento::TamanhoErrado { cartela, encontrado, esperado } => write!(
                f,
                "cartela {cartela}: tem {encontrado} números, mas a configuração pede {esperado}"
            ),
            ErroFechamento::ForaDoPool { cartela, rotulo } => {
                write!(f, "cartela {cartela}: o número {rotulo} não está no pool configurado")
            }
        }
    }
}

impl std::error::Error for ErroFechamento {}

/// Interpreta o texto de um fechamento em rótulos do universo.
///
/// Ainda não valida contra nenhuma configuração — isso é
/// [`converter_para_cartelas`]. A separação existe porque o pool pode ser
/// *deduzido* do próprio fechamento ([`pool_do_fechamento`]), e nesse caso não há
/// configuração contra a qual validar antes de ler.
pub fn interpretar_fechamento(texto: &str) -> Result<Vec<Vec<u32>>, ErroFechamento> {
    let mut cartelas = Vec::new();

    for (numero, linha) in texto.lines().enumerate() {
        let limpa = linha.trim();
        if limpa.is_empty() || limpa.starts_with('#') {
            continue;
        }

        let mut rotulos = Vec::new();
        for campo in limpa.split([' ', '\t', ',', ';', '-']).filter(|c| !c.is_empty()) {
            let rotulo: u32 = campo.parse().map_err(|_| ErroFechamento::CampoNaoNumerico {
                linha: numero + 1,
                campo: campo.to_string(),
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
            // Quase sempre é erro de digitação, e passar batido produziria uma
            // cartela menor do que o usuário pensa que tem.
            return Err(ErroFechamento::NumerosRepetidos { linha: numero + 1 });
        }

        cartelas.push(rotulos);
    }

    if cartelas.is_empty() {
        return Err(ErroFechamento::NenhumaCartela);
    }
    Ok(cartelas)
}

/// Converte rótulos em cartelas internas, validando contra o problema.
pub fn converter_para_cartelas(
    rotulos: &[Vec<u32>],
    problema: &Problema,
) -> Result<Vec<Cartela>, ErroFechamento> {
    let mut cartelas = Vec::with_capacity(rotulos.len());

    for (posicao, linha) in rotulos.iter().enumerate() {
        if linha.len() != problema.tamanho_cartela() {
            return Err(ErroFechamento::TamanhoErrado {
                cartela: posicao + 1,
                encontrado: linha.len(),
                esperado: problema.tamanho_cartela(),
            });
        }

        let mut cartela = Cartela::vazia();
        for &rotulo in linha {
            let indice = problema.indice_do_rotulo(rotulo).ok_or(ErroFechamento::ForaDoPool {
                cartela: posicao + 1,
                rotulo,
            })?;
            cartela.inserir(indice);
        }
        cartelas.push(cartela);
    }

    Ok(cartelas)
}

/// Deduz o pool a partir de um fechamento: todos os números que aparecem nele.
///
/// Serve para quem tem as cartelas mas não lembra qual pool usou.
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
    use crate::problema::{Objetivo, RegraCobertura};

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
        assert_eq!(interpretar_fechamento(texto).unwrap().len(), 2);
    }

    #[test]
    fn ordena_os_numeros_de_cada_cartela() {
        assert_eq!(interpretar_fechamento("35 4 12 1").unwrap()[0], vec![1, 4, 12, 35]);
    }

    #[test]
    fn recusa_cartela_com_numero_repetido() {
        let erro = interpretar_fechamento("1 2 2 3").unwrap_err();
        assert_eq!(erro, ErroFechamento::NumerosRepetidos { linha: 1 });
        assert!(erro.to_string().contains("repetidos"), "mensagem foi: {erro}");
    }

    #[test]
    fn aponta_a_linha_certa_do_erro() {
        // Numa colagem de trinta linhas, "não é um número" sem o número da linha
        // é inútil.
        let erro = interpretar_fechamento("1 2 3\n4 5 6\n7 oito 9").unwrap_err();
        assert_eq!(
            erro,
            ErroFechamento::CampoNaoNumerico { linha: 3, campo: "oito".to_string() }
        );
    }

    #[test]
    fn recusa_texto_sem_nenhuma_cartela() {
        assert_eq!(
            interpretar_fechamento("# só comentário\n\n").unwrap_err(),
            ErroFechamento::NenhumaCartela
        );
    }

    #[test]
    fn pool_deduzido_reune_todos_os_numeros_sem_repetir() {
        let cartelas = vec![vec![1, 5, 9], vec![5, 9, 13], vec![2, 1, 13]];
        assert_eq!(pool_do_fechamento(&cartelas), vec![1, 2, 5, 9, 13]);
    }

    fn problema_pequeno() -> Problema {
        Problema::novo(
            60,
            vec![1, 4, 7, 12],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap()
    }

    #[test]
    fn converte_para_cartelas_validando_o_pool() {
        let problema = problema_pequeno();
        let cartelas = converter_para_cartelas(&[vec![1, 7], vec![4, 12]], &problema).unwrap();
        assert_eq!(cartelas.len(), 2);
        assert_eq!(cartelas[0].rotulos(problema.pool()), vec![1, 7]);
    }

    #[test]
    fn recusa_cartela_de_tamanho_errado() {
        let erro = converter_para_cartelas(&[vec![1, 4, 7]], &problema_pequeno()).unwrap_err();
        assert!(erro.to_string().contains("3 números"), "mensagem foi: {erro}");
    }

    #[test]
    fn recusa_numero_fora_do_pool() {
        let erro = converter_para_cartelas(&[vec![1, 99]], &problema_pequeno()).unwrap_err();
        assert!(erro.to_string().contains("99"), "mensagem foi: {erro}");
    }

    #[test]
    fn exportar_e_importar_fecham_o_ciclo() {
        let original = vec![vec![1u32, 4, 7, 12], vec![2, 5, 8, 14]];
        let texto = escrever_fechamento(&original);
        assert_eq!(interpretar_fechamento(&texto).unwrap(), original);
    }
}
