//! O melhor que o mundo já conseguiu — e o melhor que já se provou impossível
//! de superar.
//!
//! ## Por que isto existe
//!
//! O motor sabe duas coisas sobre a própria solução: quantas cartelas ela tem, e
//! qual o limite inferior que ele mesmo calcula ([`crate::limites`]). Falta a
//! terceira, e é a que o usuário mais quer saber: **como isso se compara com o
//! resto do mundo?**
//!
//! A La Jolla Covering Repository reúne, desde 1996, o melhor resultado
//! conhecido para cada covering design `C(v,k,t)`, junto com o melhor limite
//! inferior já provado. São trinta anos de contribuições de centenas de
//! pesquisadores, produzidas por dezenas de programas diferentes — busca local,
//! recozimento simulado, programação dinâmica, construções algébricas e um bom
//! número de ferramentas privadas que nunca foram distribuídas.
//!
//! Nenhum desses programas roda dentro de um navegador de celular, e não existe
//! um deles que seja melhor que os outros em toda a faixa. Mas o **resultado
//! acumulado** de todos eles cabe em 134 KiB e vem embutido no aplicativo.
//!
//! ## O que isso muda na prática
//!
//! Duas coisas, e a segunda é a mais séria.
//!
//! 1. **Referência de tela.** O usuário vê "27 cartelas · melhor do mundo: 21" e
//!    sabe exatamente onde está.
//!
//! 2. **Limite inferior muito mais forte.** Em 4.317 das 8.759 configurações
//!    (49%) o limite publicado é maior que a cota de Schönheim — e em nenhuma
//!    ele é menor. Isso não é detalhe acadêmico: em `C(13,5,2)` a cota de
//!    Schönheim diz 8, mas já está provado que 10 é o mínimo. Sem o limite
//!    publicado, o motor encontra as 10 cartelas ótimas em segundos, **não
//!    reconhece que terminou**, e segue procurando para sempre uma solução de 9
//!    que não existe — gastando a bateria do aparelho sem nenhuma chance.
//!
//! ## A fronteira que não pode ser cruzada
//!
//! [`Referencia::melhor_conhecido`] é um **limite superior**: alguém já
//! construiu uma solução desse tamanho. Ele serve de meta e de número de tela.
//!
//! [`Referencia::limite_publicado`] é um **limite inferior**: está provado que
//! não existe solução menor. Só ele pode sustentar uma declaração de
//! optimalidade.
//!
//! Trocar os dois faria o aplicativo cravar "ótimo provado" em cima de um
//! recorde que ainda pode cair. Por isso são campos distintos, com nomes que não
//! se confundem, e o [`crate::limites`] só aceita o segundo.
//!
//! ## Onde não se aplica
//!
//! A tabela cobre covering designs — os casos em que a cartela precisa **conter**
//! o alvo inteiro (`alvo == intersecao`). Com garantia parcial (`alvo >
//! intersecao`) o problema é outro, a tabela não fala dele, e
//! [`consultar`] não é sequer chamada.
//!
//! Fonte: La Jolla Covering Repository, D. M. Gordon
//! (<https://github.com/dmgordo/LJCR>), licença CC BY 4.0. Atualizada por
//! `ferramentas/atualizar-referencia.py`.

use std::sync::OnceLock;

/// O que o mundo já sabe sobre uma configuração.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Referencia {
    /// Menor solução que alguém já construiu. É um teto: existe, foi exibida.
    pub melhor_conhecido: u64,
    /// Maior limite inferior já provado. É um piso: nada menor pode existir.
    pub limite_publicado: u64,
}

impl Referencia {
    /// Verdadeiro quando o melhor conhecido já encostou no limite provado — ou
    /// seja, quando o mundo considera a questão encerrada.
    pub fn resolvido(&self) -> bool {
        self.melhor_conhecido == self.limite_publicado
    }
}

/// Como o número catalogado se relaciona com o problema que o usuário montou.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aplicacao {
    /// O problema **é** o covering design catalogado (`alvo == intersecao`).
    /// O número é o melhor resultado conhecido para ele, e o alvo a perseguir.
    Exata,
    /// Garantia parcial (`alvo > intersecao`). O número catalogado é um **teto
    /// válido**, quase sempre bem acima do necessário.
    Teto,
}

/// O que a tabela tem a dizer sobre um problema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Consulta {
    pub referencia: Referencia,
    pub aplicacao: Aplicacao,
}

/// Consulta a tabela para a configuração completa do usuário.
///
/// ## O caso que faltava: garantia parcial
///
/// A tabela cataloga coberturas completas. Um fechamento de loteria quase nunca
/// é uma: o usual é *"garantir 4 acertos se saírem 6"*, com `alvo = 6` e
/// `intersecao = 4`. Para esses, a primeira versão desta função devolvia nada —
/// tecnicamente correto e praticamente inútil, porque é justamente a
/// configuração mais usada.
///
/// Mas a tabela **tem** o que dizer, e o argumento é curto:
///
/// > Se toda `t`-upla do pool está contida em alguma cartela, então para
/// > qualquer sorteio de `j ≥ t` números basta tomar uma `t`-upla dentro dele —
/// > alguma cartela a contém inteira, e portanto acerta pelo menos `t`.
///
/// Logo, uma cobertura completa de `t`-uplas resolve a garantia parcial com
/// folga, e o melhor conhecido para `C(pool, cartela, t)` é um **teto** para o
/// problema do usuário. Um teto folgado — em `pool 20, cartela 6, garantir 4` o
/// teto é 382 cartelas e o motor acha 114 — mas um número real, publicado, e
/// muito melhor que "sem referência".
///
/// A validação de [`crate::problema::Problema`] garante `intersecao ≤ alvo`, que
/// é a única condição de que o argumento precisa.
///
/// ## O que este teto **não** é
///
/// Não é limite inferior. O limite publicado de `C(pool, cartela, t)` vale para
/// a cobertura completa, não para a garantia parcial — que pode (e costuma) ser
/// resolvida com muito menos. Por isso [`crate::limites`] continua usando a
/// tabela **apenas** quando `alvo == intersecao`. Confundir os dois faria o motor
/// declarar impossível o que ele mesmo acabou de encontrar.
pub fn consultar_problema(
    pool: usize,
    cartela: usize,
    alvo: usize,
    intersecao: usize,
) -> Option<Consulta> {
    let referencia = consultar(pool, cartela, intersecao)?;
    let aplicacao = if alvo == intersecao { Aplicacao::Exata } else { Aplicacao::Teto };
    Some(Consulta { referencia, aplicacao })
}

/// Uma linha da tabela, compactada. `v`, `k` e `t` cabem em um byte; os
/// tamanhos chegam a seis dígitos nas configurações maiores.
#[derive(Debug, Clone, Copy)]
struct Linha {
    chave: u32,
    melhor: u32,
    limite: u32,
}

/// Empacota `(v, k, t)` num inteiro único, preservando a ordem lexicográfica.
///
/// É o que permite guardar a tabela como um vetor ordenado e consultá-la por
/// busca binária, sem tabela de espalhamento e sem alocar nada por consulta.
fn chave(v: usize, k: usize, t: usize) -> Option<u32> {
    let (v, k, t) = (u32::try_from(v).ok()?, u32::try_from(k).ok()?, u32::try_from(t).ok()?);
    if v > 0xFF || k > 0xFF || t > 0xFF {
        return None;
    }
    Some((v << 16) | (k << 8) | t)
}

const TABELA_BRUTA: &str = include_str!("../dados/ljcr.csv");

/// A tabela lida uma única vez, na primeira consulta.
///
/// Ler 8.759 linhas leva menos de um milissegundo, e a maioria das sessões faz
/// pelo menos uma consulta — mas quem usa garantia parcial não faz nenhuma, e
/// para essa pessoa o trabalho nunca acontece.
fn tabela() -> &'static [Linha] {
    static TABELA: OnceLock<Vec<Linha>> = OnceLock::new();
    TABELA.get_or_init(|| {
        let mut linhas = Vec::with_capacity(9_000);
        for texto in TABELA_BRUTA.lines() {
            if texto.starts_with('#') || texto.is_empty() {
                continue;
            }
            let mut campos = texto.split(',');
            let mut proximo = || campos.next().and_then(|c| c.trim().parse::<u32>().ok());

            let (Some(v), Some(k), Some(t), Some(melhor), Some(limite)) =
                (proximo(), proximo(), proximo(), proximo(), proximo())
            else {
                // Uma linha corrompida não pode derrubar o aplicativo inteiro;
                // o pior que acontece é essa configuração ficar sem referência.
                // O teste `a_tabela_inteira_e_bem_formada` impede que isso
                // chegue a acontecer sem alguém ficar sabendo.
                continue;
            };

            let Some(chave) = chave(v as usize, k as usize, t as usize) else { continue };
            linhas.push(Linha { chave, melhor, limite });
        }
        linhas.sort_unstable_by_key(|linha| linha.chave);
        linhas
    })
}

/// O que se sabe sobre `C(v, k, t)`, ou `None` se a configuração está fora da
/// faixa catalogada.
///
/// `v` é o tamanho do pool, `k` o tamanho da cartela e `t` o tamanho dos
/// subconjuntos que precisam ser cobertos.
pub fn consultar(v: usize, k: usize, t: usize) -> Option<Referencia> {
    let chave = chave(v, k, t)?;
    let tabela = tabela();
    let posicao = tabela.binary_search_by_key(&chave, |linha| linha.chave).ok()?;
    let linha = tabela[posicao];
    Some(Referencia {
        melhor_conhecido: linha.melhor as u64,
        limite_publicado: linha.limite as u64,
    })
}

/// Quantas configurações a tabela cataloga. Só para diagnóstico e testes.
pub fn quantidade_catalogada() -> usize {
    tabela().len()
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::limites::schonheim;

    #[test]
    fn a_tabela_carrega_inteira() {
        // Se o CSV encolher de repente, alguma coisa deu errado na geração.
        assert!(
            quantidade_catalogada() > 8_000,
            "só {} configurações carregadas",
            quantidade_catalogada()
        );
    }

    #[test]
    fn a_tabela_inteira_e_bem_formada() {
        // Nenhuma linha pode ser descartada silenciosamente pelo leitor.
        let uteis = TABELA_BRUTA
            .lines()
            .filter(|l| !l.starts_with('#') && !l.is_empty())
            .count();
        assert_eq!(uteis, quantidade_catalogada(), "alguma linha não foi lida");
    }

    #[test]
    fn o_limite_publicado_nunca_contradiz_schonheim() {
        // A defesa central desta tabela. Se um limite publicado ficasse abaixo
        // da cota de Schönheim, ou acima do melhor conhecido, o motor poderia
        // declarar optimalidade errada — o pior defeito possível aqui.
        for texto in TABELA_BRUTA.lines().filter(|l| !l.starts_with('#') && !l.is_empty()) {
            let n: Vec<u64> = texto.split(',').map(|c| c.trim().parse().unwrap()).collect();
            let (v, k, t, melhor, limite) = (n[0], n[1], n[2], n[3], n[4]);

            assert!(limite <= melhor, "C({v},{k},{t}): limite {limite} > melhor {melhor}");
            assert!(
                limite >= schonheim(v as usize, k as usize, t as usize),
                "C({v},{k},{t}): limite publicado {limite} abaixo da cota de Schönheim"
            );
            assert!(melhor > 0 && limite > 0, "C({v},{k},{t}): número não positivo");
        }
    }

    #[test]
    fn reproduz_valores_classicos() {
        // Os mesmos números que `limites.rs` já usa como aferição externa.
        for (v, k, t, esperado) in [
            (7, 3, 2, 7),    // plano de Fano
            (9, 3, 2, 12),   // sistema de Steiner S(2,3,9)
            (13, 4, 2, 13),  // plano projetivo de ordem 3
            (16, 4, 2, 20),  // sistema de Steiner S(2,4,16)
            (8, 4, 3, 14),   // valor clássico
            (21, 5, 2, 21),  // plano projetivo de ordem 4
            (25, 5, 2, 30),  // plano afim de ordem 5
        ] {
            let r = consultar(v, k, t).expect("configuração clássica tem de estar na tabela");
            assert_eq!(r.melhor_conhecido, esperado, "C({v},{k},{t})");
            assert!(r.resolvido(), "C({v},{k},{t}) é ótimo provado na literatura");
        }
    }

    #[test]
    fn o_limite_publicado_supera_schonheim_onde_deve() {
        // C(13,5,2): Schönheim diz 8, mas está provado que o mínimo é 10. É o
        // caso que faria o motor procurar para sempre uma solução impossível.
        assert_eq!(schonheim(13, 5, 2), 8);
        let r = consultar(13, 5, 2).unwrap();
        assert_eq!(r.limite_publicado, 10);
        assert_eq!(r.melhor_conhecido, 10);
    }

    #[test]
    fn garantia_parcial_recebe_um_teto_em_vez_de_nada() {
        // O caso do fechamento de loteria: pool 20, cartelas de 6, garantir 4
        // acertos se saírem 6. Não é covering design, mas cobrir todas as
        // 4-uplas resolve com folga — e isso é um número publicado.
        let c = consultar_problema(20, 6, 6, 4).expect("há teto para esta configuração");
        assert_eq!(c.aplicacao, Aplicacao::Teto);
        assert_eq!(c.referencia.melhor_conhecido, consultar(20, 6, 4).unwrap().melhor_conhecido);
    }

    #[test]
    fn cobertura_completa_recebe_o_numero_exato() {
        let c = consultar_problema(21, 5, 2, 2).expect("C(21,5,2) está na tabela");
        assert_eq!(c.aplicacao, Aplicacao::Exata);
        assert_eq!(c.referencia.melhor_conhecido, 21);
    }

    /// O teto tem de ser **de verdade** um teto: uma cobertura completa das
    /// `t`-uplas precisa satisfazer a garantia parcial.
    ///
    /// Confere o argumento por enumeração, não por raciocínio: para cada
    /// `j`-subconjunto do pool, alguma cartela do plano tem ao menos `t`
    /// elementos em comum com ele.
    #[test]
    fn uma_cobertura_de_t_uplas_realmente_garante_t_acertos() {
        use crate::cartela::Cartela;
        use crate::planos::plano_projetivo;

        // PG(2,3): cobre todos os pares de um pool de 13, com cartelas de 4.
        let retas = plano_projetivo(3).unwrap();
        let cartelas: Vec<Cartela> = retas.iter().map(|r| Cartela::dos_indices(r)).collect();

        // Então, para todo sorteio de j = 2..=5 números, alguma cartela acerta 2.
        for j in 2..=5usize {
            for combinacao in combinacoes(13, j) {
                let sorteio = Cartela::dos_indices(&combinacao);
                assert!(
                    cartelas.iter().any(|c| c.tamanho_intersecao(sorteio) >= 2),
                    "sorteio {combinacao:?} não recebeu 2 acertos de nenhuma cartela"
                );
            }
        }
    }

    /// Todos os `k`-subconjuntos de `0..n`, para o teste acima.
    #[cfg(test)]
    fn combinacoes(n: usize, k: usize) -> Vec<Vec<usize>> {
        let mut saida = Vec::new();
        let mut atual = Vec::with_capacity(k);
        fn passo(n: usize, k: usize, inicio: usize, atual: &mut Vec<usize>, saida: &mut Vec<Vec<usize>>) {
            if atual.len() == k {
                saida.push(atual.clone());
                return;
            }
            for i in inicio..n {
                atual.push(i);
                passo(n, k, i + 1, atual, saida);
                atual.pop();
            }
        }
        passo(n, k, 0, &mut atual, &mut saida);
        saida
    }

    #[test]
    fn configuracoes_fora_da_faixa_nao_inventam_resposta() {
        assert!(consultar(500, 5, 2).is_none(), "v acima do catalogado");
        assert!(consultar(20, 5, 19).is_none(), "t acima do catalogado");
        assert!(consultar(3, 9, 2).is_none(), "k > v não é design válido");
    }
}
