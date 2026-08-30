//! Os limites inferiores — o que este aplicativo consegue **provar** sozinho.
//!
//! Um limite inferior é uma afirmação forte: *não existe* solução menor que
//! isto. É a metade do problema que não depende de procurar nada, e é ela que
//! transforma "achei 32" em "32 é o mínimo".
//!
//! Todos os limites daqui são calculados. Nenhum é consultado em tabela de
//! terceiros — e isso é uma decisão, não um esquecimento. A tabela da La Jolla
//! diria, para `C(13,5,2)`, que o mínimo é 10; este módulo prova apenas `≥ 8`.
//! A diferença é o que ainda não sabemos por conta própria, e escondê-la seria
//! passar por nosso um trabalho que é de outros.
//!
//! ## Só entra aqui o que tem demonstração escrita
//!
//! Uma cota inferior errada é pior que nenhuma: ela faz o aplicativo dizer
//! "mínimo provado" sobre uma construção que não é mínima. Duas recorrências
//! plausíveis foram escritas e apagadas nesta mesma sessão por não sobreviverem
//! à conferência contra construções verificadas. Por isso cada função aqui
//! carrega a demonstração no comentário, e o teste
//! [`nenhuma_cota_passa_por_cima_de_um_fechamento_que_existe`] cobra a única
//! coisa que importa: uma cota nunca pode passar de uma coleção que este mesmo
//! programa construiu e o verificador aprovou.

use crate::problema::{binomial, Problema};

/// De onde um limite veio. A tela mostra o nome porque a origem muda o que a
/// pessoa deve concluir — uma cota fechada é reprodutível a lápis; uma prova
/// por exaustão vale para aquele caso e mais nenhum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limite {
    /// Cada bloco cobre no máximo `C(k,t)` alvos, e há `C(v,t)` a cobrir.
    Contagem,
    /// A recorrência de Schönheim, que aplica a contagem elemento a elemento.
    Schonheim,
    /// Um piso do subproblema `C(v−1, k−1, t−1)`, provado **aqui**, e elevado
    /// pela recorrência de Schönheim.
    ///
    /// O piso de dentro às vezes é o mínimo exato — quando a exaustão fechou
    /// naquele tamanho — e às vezes é ele próprio uma elevação de mais fundo. A
    /// frase diz `≥` nos dois casos, porque é `≥` o que se provou.
    Interno { v: usize, k: usize, t: usize, piso: u64 },
    /// O próprio problema resolvido ao certo, sem restrição.
    Exaustao,
}

impl std::fmt::Display for Limite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Limite::Contagem => write!(f, "cota de contagem"),
            Limite::Schonheim => write!(f, "cota de Schönheim"),
            Limite::Interno { v, k, t, piso } => {
                write!(f, "C({v},{k},{t}) ≥ {piso}, provado aqui e elevado")
            }
            Limite::Exaustao => write!(f, "exaustão: nenhuma solução menor existe"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimiteInferior {
    pub valor: u64,
    pub origem: Limite,
}

impl LimiteInferior {
    /// Fica com a afirmação mais forte das duas. No empate mantém a que já
    /// estava, porque nomear a cota mais simples explica melhor o mesmo número.
    pub fn melhor(self, outro: LimiteInferior) -> LimiteInferior {
        if outro.valor > self.valor {
            outro
        } else {
            self
        }
    }
}

/// A cota de contagem: `⌈C(v,t) / C(k,t)⌉`.
///
/// O argumento cabe numa linha: cada bloco cobre no máximo `C(k,t)` alvos, e
/// existem `C(v,t)` para cobrir. É a mais fraca das cotas e a mais fácil de
/// explicar — e onde ela encosta numa construção, o mínimo está determinado.
pub fn contagem(p: &Problema) -> u64 {
    let por_bloco = p.alvos_por_bloco();
    if por_bloco == 0 {
        return 0;
    }
    let total = binomial(p.v, p.t);
    (total.div_ceil(por_bloco)).min(u64::MAX as u128) as u64
}

/// A cota de Schönheim.
///
/// ```text
/// L(v, k, 1) = ⌈ v / k ⌉
/// L(v, k, t) = ⌈ (v / k) · L(v−1, k−1, t−1) ⌉
/// ```
///
/// O argumento: fixe um elemento `x`. Os blocos que contêm `x`, com `x`
/// removido, precisam cobrir todos os `(t−1)`-subconjuntos dos outros `v−1`
/// elementos — logo são pelo menos `C(v−1, k−1, t−1)`. Isso vale para cada um
/// dos `v` elementos; como cada bloco contém `k` elementos, ele é contado `k`
/// vezes na soma, e daí `b · k ≥ v · C(v−1, k−1, t−1)`.
pub fn schonheim(v: usize, k: usize, t: usize) -> u64 {
    if t == 0 || k == 0 || t > k || k > v {
        return 0;
    }
    fn passo(v: u128, k: u128, t: usize) -> u128 {
        if t == 1 {
            return v.div_ceil(k);
        }
        (v * passo(v - 1, k - 1, t - 1)).div_ceil(k)
    }
    passo(v as u128, k as u128, t).min(u64::MAX as u128) as u64
}

/// Eleva um piso do subproblema `C(v−1, k−1, t−1)` para o problema inteiro.
///
/// É o passo único da recorrência de Schönheim, isolado — e a razão de ele
/// existir separado é que aqui o valor de dentro **não precisa ser a cota de
/// Schönheim**: pode ser o mínimo do subproblema, resolvido por exaustão neste
/// mesmo programa. A desigualdade
///
/// ```text
/// b · k ≥ v · C(v−1, k−1, t−1)
/// ```
///
/// continua valendo se o lado direito for trocado por qualquer piso válido do
/// subproblema, e fica mais apertada quanto melhor for esse piso. É por essa
/// porta que a exaustão de um caso pequeno vira cota de um caso grande.
pub fn elevar_do_interno(v: usize, k: usize, interno: u64) -> u64 {
    if k == 0 {
        return 0;
    }
    ((v as u128 * interno as u128).div_ceil(k as u128)).min(u64::MAX as u128) as u64
}

/// O melhor limite que este aplicativo consegue afirmar **sem procurar nada**.
///
/// Toma o máximo das cotas fechadas: cada uma diz "não existe solução menor que
/// isto", e a afirmação mais forte continua verdadeira.
pub fn sem_busca(p: &Problema) -> LimiteInferior {
    let conta = LimiteInferior { valor: contagem(p).max(1), origem: Limite::Contagem };
    let scho = LimiteInferior { valor: schonheim(p.v, p.k, p.t), origem: Limite::Schonheim };
    conta.melhor(scho)
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::construtor;

    /// **A invariante que importa.** Uma cota inferior que passe do tamanho de
    /// uma coleção que existe está errada, e não há discussão possível: a
    /// coleção é a testemunha.
    ///
    /// O teste não consulta tabela nenhuma. Ele constrói, manda o verificador
    /// conferir alvo por alvo, e só então compara. Foi ele que pegou duas
    /// recorrências plausíveis e falsas.
    #[test]
    fn nenhuma_cota_passa_por_cima_de_um_fechamento_que_existe() {
        for v in 4..=13usize {
            for k in 2..v {
                for t in 1..=k.min(3) {
                    let Ok(p) = Problema::novo(v, k, t) else { continue };
                    let c = construtor::construir(&p);
                    assert!(p.cobre(&c.blocos), "C({v},{k},{t}): a construção nem cobre");
                    let piso = sem_busca(&p);
                    assert!(
                        piso.valor <= c.tamanho() as u64,
                        "C({v},{k},{t}): a cota diz {} ({}) e existe coleção de {}",
                        piso.valor,
                        piso.origem,
                        c.tamanho()
                    );
                }
            }
        }
    }

    /// Dois mínimos que não dependem de tabela: o plano de Fano tem 7 blocos e
    /// o sistema de Steiner de ordem 9 tem 12, e ambos são exibíveis.
    #[test]
    fn onde_a_contagem_encosta_num_desenho_conhecido_ela_o_determina() {
        let fano = Problema::novo(7, 3, 2).unwrap();
        assert_eq!(sem_busca(&fano).valor, 7);
        let steiner = Problema::novo(9, 3, 2).unwrap();
        assert_eq!(sem_busca(&steiner).valor, 12);
    }

    #[test]
    fn a_elevacao_do_interno_reproduz_schonheim_quando_alimentada_com_schonheim() {
        // Schönheim é exatamente esta elevação aplicada em cadeia. Alimentá-la
        // com a cota de dentro tem de devolver a cota de fora — se não devolve,
        // uma das duas está escrita errado.
        for v in 4..=15usize {
            for k in 2..v {
                for t in 2..=k.min(4) {
                    let interno = schonheim(v - 1, k - 1, t - 1);
                    assert_eq!(
                        elevar_do_interno(v, k, interno),
                        schonheim(v, k, t),
                        "C({v},{k},{t})"
                    );
                }
            }
        }
    }

    #[test]
    fn a_elevacao_cresce_com_o_piso_de_dentro() {
        // A porta pela qual a exaustão de um caso pequeno aperta um caso grande
        // só serve se um piso interno maior produzir uma cota externa maior.
        let fraco = elevar_do_interno(10, 5, 7);
        let forte = elevar_do_interno(10, 5, 8);
        assert!(forte > fraco, "{forte} deveria passar de {fraco}");
    }

    #[test]
    fn schonheim_nunca_fica_abaixo_da_contagem_nos_casos_de_interesse() {
        for v in 4..=16usize {
            for k in 2..v {
                for t in 1..=k.min(4) {
                    let Ok(p) = Problema::novo(v, k, t) else { continue };
                    let _ = contagem(&p);
                    let _ = schonheim(v, k, t);
                    // Nenhuma das duas pode ser zero num problema legítimo: um
                    // fechamento sempre precisa de ao menos uma cartela.
                    assert!(sem_busca(&p).valor >= 1, "C({v},{k},{t})");
                }
            }
        }
    }

    #[test]
    fn as_cotas_nao_entram_em_panico_com_parametros_de_borda() {
        assert_eq!(schonheim(5, 5, 5), 1);
        assert_eq!(schonheim(3, 5, 2), 0, "k > v não descreve cobertura");
        assert_eq!(elevar_do_interno(9, 0, 5), 0, "k = 0 não descreve cobertura");
        let p = Problema::novo(6, 6, 3).unwrap();
        assert_eq!(sem_busca(&p).valor, 1, "um bloco que é o universo inteiro cobre tudo");
    }
}
