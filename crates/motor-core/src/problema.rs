//! Definição do problema — a fronteira entre o usuário e a matemática.
//!
//! O motor não conhece loterias. Ele conhece um universo de elementos, um pool
//! escolhido dentro dele, um tamanho de cartela, uma regra de cobertura e um
//! objetivo. Qualquer modalidade, presente ou futura, é apenas uma escolha
//! diferente desses números.

use serde::{Deserialize, Serialize};

use crate::combinatoria::Binomiais;

/// Regra de cobertura, na sua forma mais geral.
///
/// Leitura: *"para todo subconjunto do pool com `alvo` elementos, alguma cartela
/// precisa ter pelo menos `intersecao` elementos em comum com ele."*
///
/// Essa única formulação cobre toda a lista do documento conceitual:
///
/// | O que se quer                        | `alvo` | `intersecao` |
/// |--------------------------------------|--------|--------------|
/// | cobrir todos os pares                | 2      | 2            |
/// | cobrir todas as trincas              | 3      | 3            |
/// | cobrir todos os subconjuntos de `t`  | t      | t            |
/// | garantir `t` acertos se saírem `j`   | j      | t            |
///
/// Quando `alvo == intersecao`, o problema é exatamente um *covering design*
/// `C(p, k, t)` da literatura — que é o que permite validar o motor contra
/// ótimos já provados.
///
/// ## Atender mais de uma vez
///
/// `premiadas` eleva a exigência de "alguma cartela" para "pelo menos `r`
/// cartelas". Na leitura de quem joga: se as dezenas sorteadas caírem no pool,
/// não basta uma cartela premiada — `r` delas precisam estar.
///
/// Custa caro, e o preço é quase proporcional: a cota de contagem multiplica
/// por `r` exatamente. Mas nem sempre custa `r` vezes de fato — num pool de 18
/// com jogos de 17, garantir uma cartela premiada exige 16 jogos e garantir
/// duas exige 17, não 32. É essa diferença que faz valer a pena procurar em vez
/// de simplesmente repetir o fechamento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegraCobertura {
    /// `j` — tamanho dos subconjuntos do pool que precisam ser atendidos.
    pub alvo: usize,
    /// `t` — interseção mínima exigida entre o alvo e alguma cartela.
    pub intersecao: usize,
    /// `r` — quantas cartelas distintas precisam atender cada alvo.
    ///
    /// `#[serde(default)]` com 1: estados gravados antes desta opção existir
    /// continuam sendo lidos, e leem como o que eram — uma cartela basta.
    #[serde(default = "uma_cartela")]
    pub premiadas: usize,
}

/// O padrão histórico da regra: uma cartela atendendo cada alvo basta.
fn uma_cartela() -> usize {
    1
}

impl RegraCobertura {
    /// Todo subconjunto de tamanho `t` do pool deve estar *contido* em alguma
    /// cartela. É o covering design clássico `C(p, k, t)`.
    pub fn cobrir_subconjuntos(t: usize) -> Self {
        Self { alvo: t, intersecao: t, premiadas: 1 }
    }

    /// Se `alvo` elementos do pool forem sorteados, ao menos uma cartela terá
    /// no mínimo `intersecao` deles.
    pub fn garantia(alvo: usize, intersecao: usize) -> Self {
        Self { alvo, intersecao, premiadas: 1 }
    }

    /// Como [`Self::garantia`], exigindo `premiadas` cartelas por alvo em vez
    /// de uma.
    pub fn garantia_multipla(alvo: usize, intersecao: usize, premiadas: usize) -> Self {
        Self { alvo, intersecao, premiadas }
    }

    /// Verdadeiro quando a regra é um covering design puro (`j == t`, uma
    /// cartela por alvo), caso em que limites inferiores mais fortes ficam
    /// disponíveis.
    ///
    /// Exigir mais de uma cartela sai do catálogo: a cota de Schönheim e a
    /// tabela publicada falam de cobertura simples, e aplicá-las a uma
    /// cobertura múltipla daria um piso baixo demais.
    pub fn e_covering_design(&self) -> bool {
        self.alvo == self.intersecao && self.premiadas == 1
    }
}

/// O que "melhor" significa para esta execução.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Objetivo {
    /// Exige cobertura total e busca o menor número possível de cartelas.
    MinimizarCartelas,
    /// Aceita no máximo `orcamento` cartelas e busca cobrir o máximo possível.
    MaximizarCobertura { orcamento: usize },
}

impl Objetivo {
    /// Teto de cartelas imposto pelo objetivo, se houver.
    pub fn orcamento(&self) -> Option<usize> {
        match self {
            Objetivo::MinimizarCartelas => None,
            Objetivo::MaximizarCobertura { orcamento } => Some(*orcamento),
        }
    }
}

/// Erros de configuração — todos detectados antes de qualquer alocação pesada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroProblema {
    UniversoVazio,
    PoolVazio,
    PoolMaiorQueUniverso { pool: usize, universo: u32 },
    PoolAcimaDoLimite { pool: usize, limite: usize },
    ElementoForaDoUniverso { elemento: u32, universo: u32 },
    ElementoRepetido { elemento: u32 },
    CartelaVazia,
    CartelaMaiorQuePool { tamanho_cartela: usize, pool: usize },
    AlvoInvalido { alvo: usize, pool: usize },
    IntersecaoInvalida { intersecao: usize, alvo: usize, tamanho_cartela: usize },
    PremiadasZero,
    OrcamentoZero,
}

impl std::fmt::Display for ErroProblema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroProblema::UniversoVazio => write!(f, "o universo precisa ter ao menos 1 elemento"),
            ErroProblema::PoolVazio => write!(f, "o pool precisa ter ao menos 1 elemento"),
            ErroProblema::PoolMaiorQueUniverso { pool, universo } => {
                write!(f, "o pool tem {pool} elementos, mais que o universo de {universo}")
            }
            ErroProblema::PoolAcimaDoLimite { pool, limite } => write!(
                f,
                "o pool tem {pool} elementos; o limite desta implementação é {limite}"
            ),
            ErroProblema::ElementoForaDoUniverso { elemento, universo } => {
                write!(f, "o elemento {elemento} está fora do universo 1..={universo}")
            }
            ErroProblema::ElementoRepetido { elemento } => {
                write!(f, "o elemento {elemento} aparece mais de uma vez no pool")
            }
            ErroProblema::CartelaVazia => write!(f, "a cartela precisa ter ao menos 1 elemento"),
            ErroProblema::CartelaMaiorQuePool { tamanho_cartela, pool } => write!(
                f,
                "a cartela tem {tamanho_cartela} elementos, mais que o pool de {pool}"
            ),
            ErroProblema::AlvoInvalido { alvo, pool } => write!(
                f,
                "o alvo da cobertura ({alvo}) precisa estar entre 1 e o tamanho do pool ({pool})"
            ),
            ErroProblema::IntersecaoInvalida { intersecao, alvo, tamanho_cartela } => write!(
                f,
                "a interseção exigida ({intersecao}) precisa estar entre 1 e min(alvo={alvo}, cartela={tamanho_cartela})"
            ),
            ErroProblema::PremiadasZero => {
                write!(f, "é preciso exigir ao menos 1 cartela premiada por resultado")
            }
            ErroProblema::OrcamentoZero => write!(f, "o orçamento de cartelas precisa ser maior que zero"),
        }
    }
}

impl std::error::Error for ErroProblema {}

/// Maior pool suportado. As cartelas são bitmasks de 128 bits sobre os índices
/// do pool, então este é um limite estrutural, não arbitrário.
pub const POOL_MAXIMO: usize = 128;

/// A configuração completa de um problema, já validada.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Problema {
    universo: u32,
    /// Rótulos reais dos elementos do pool, em ordem crescente e sem repetição.
    /// O índice nesta lista é a identidade interna do elemento (0..p).
    pool: Vec<u32>,
    tamanho_cartela: usize,
    regra: RegraCobertura,
    objetivo: Objetivo,
}

impl Problema {
    /// Monta e valida um problema. Nenhuma estrutura pesada é alocada aqui.
    pub fn novo(
        universo: u32,
        mut pool: Vec<u32>,
        tamanho_cartela: usize,
        regra: RegraCobertura,
        objetivo: Objetivo,
    ) -> Result<Self, ErroProblema> {
        if universo == 0 {
            return Err(ErroProblema::UniversoVazio);
        }
        if pool.is_empty() {
            return Err(ErroProblema::PoolVazio);
        }

        pool.sort_unstable();
        for par in pool.windows(2) {
            if par[0] == par[1] {
                return Err(ErroProblema::ElementoRepetido { elemento: par[0] });
            }
        }
        for &elemento in &pool {
            if elemento == 0 || elemento > universo {
                return Err(ErroProblema::ElementoForaDoUniverso { elemento, universo });
            }
        }

        let p = pool.len();
        if p > universo as usize {
            return Err(ErroProblema::PoolMaiorQueUniverso { pool: p, universo });
        }
        if p > POOL_MAXIMO {
            return Err(ErroProblema::PoolAcimaDoLimite { pool: p, limite: POOL_MAXIMO });
        }
        if tamanho_cartela == 0 {
            return Err(ErroProblema::CartelaVazia);
        }
        if tamanho_cartela > p {
            return Err(ErroProblema::CartelaMaiorQuePool { tamanho_cartela, pool: p });
        }
        if regra.alvo == 0 || regra.alvo > p {
            return Err(ErroProblema::AlvoInvalido { alvo: regra.alvo, pool: p });
        }
        if regra.intersecao == 0 || regra.intersecao > regra.alvo.min(tamanho_cartela) {
            return Err(ErroProblema::IntersecaoInvalida {
                intersecao: regra.intersecao,
                alvo: regra.alvo,
                tamanho_cartela,
            });
        }
        if regra.premiadas == 0 {
            return Err(ErroProblema::PremiadasZero);
        }
        if matches!(objetivo, Objetivo::MaximizarCobertura { orcamento: 0 }) {
            return Err(ErroProblema::OrcamentoZero);
        }

        Ok(Self { universo, pool, tamanho_cartela, regra, objetivo })
    }

    /// Atalho para o caso mais comum: pool contíguo `1..=p` dentro do universo.
    pub fn com_pool_inicial(
        universo: u32,
        tamanho_pool: usize,
        tamanho_cartela: usize,
        regra: RegraCobertura,
        objetivo: Objetivo,
    ) -> Result<Self, ErroProblema> {
        let pool = (1..=tamanho_pool as u32).collect();
        Self::novo(universo, pool, tamanho_cartela, regra, objetivo)
    }

    pub fn universo(&self) -> u32 {
        self.universo
    }

    pub fn pool(&self) -> &[u32] {
        &self.pool
    }

    /// `p` — quantidade de elementos no pool.
    pub fn tamanho_pool(&self) -> usize {
        self.pool.len()
    }

    /// `k` — quantidade de elementos em cada cartela.
    pub fn tamanho_cartela(&self) -> usize {
        self.tamanho_cartela
    }

    pub fn regra(&self) -> RegraCobertura {
        self.regra
    }

    /// `r` — quantas cartelas precisam atender cada alvo.
    pub fn premiadas(&self) -> usize {
        self.regra.premiadas
    }

    pub fn objetivo(&self) -> Objetivo {
        self.objetivo
    }

    /// Converte um rótulo real do universo no índice interno do pool.
    pub fn indice_do_rotulo(&self, rotulo: u32) -> Option<usize> {
        self.pool.binary_search(&rotulo).ok()
    }

    /// Converte um índice interno de volta no rótulo que o usuário enxerga.
    pub fn rotulo_do_indice(&self, indice: usize) -> Option<u32> {
        self.pool.get(indice).copied()
    }
}

/// Estimativa de custo de uma configuração, calculada antes de alocar memória.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Viabilidade {
    /// `C(p, j)` — quantos subconjuntos-alvo precisam ser atendidos.
    pub total_alvos: u64,
    /// Quantos alvos uma única cartela atende. Define o custo de cada
    /// inserção/remoção no laço quente.
    pub alvos_por_cartela: u64,
    /// Memória das estruturas indexadas por alvo, em bytes.
    pub bytes_contagem: u64,
}

/// Limite padrão de alvos.
///
/// Cada alvo custa [`crate::BYTES_POR_ALVO`] entre o vetor de contagens e o
/// conjunto esparso de descobertos, então 20 milhões de alvos ficam em torno de
/// 240 MB. Problemas reais raramente passam de alguns milhões.
pub const LIMITE_ALVOS_PADRAO: u64 = 20_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroViabilidade {
    AlvosDemais { total_alvos: u64, limite: u64, bytes_contagem: u64 },
}

impl std::fmt::Display for ErroViabilidade {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroViabilidade::AlvosDemais { total_alvos, limite, bytes_contagem } => write!(
                f,
                "esta configuração gera {total_alvos} subconjuntos-alvo (limite: {limite}), \
                 exigindo {:.1} GB só para o mapa de cobertura. \
                 Reduza o tamanho do pool ou o alvo da regra de cobertura.",
                *bytes_contagem as f64 / 1e9
            ),
        }
    }
}

impl std::error::Error for ErroViabilidade {}

/// Calcula o custo estrutural do problema sem alocar nada.
pub fn avaliar_viabilidade(problema: &Problema, binom: &Binomiais) -> Viabilidade {
    let p = problema.tamanho_pool();
    let k = problema.tamanho_cartela();
    let regra = problema.regra();

    let total_alvos = binom.c(p, regra.alvo);

    // Uma cartela `C` atende todo alvo `J` com |C ∩ J| >= t. Contando por
    // quantos elementos do alvo vêm de dentro da cartela:
    //   Σ_{i=t}^{min(k,j)} C(k, i) · C(p - k, j - i)
    let mut alvos_por_cartela = 0u64;
    for i in regra.intersecao..=regra.alvo.min(k) {
        let restantes = regra.alvo - i;
        alvos_por_cartela = alvos_por_cartela
            .saturating_add(binom.c(k, i).saturating_mul(binom.c(p - k, restantes)));
    }

    Viabilidade {
        total_alvos,
        alvos_por_cartela,
        bytes_contagem: total_alvos.saturating_mul(crate::BYTES_POR_ALVO),
    }
}

/// Verifica se o problema cabe na memória disponível sob o limite dado.
pub fn checar_viabilidade(
    problema: &Problema,
    binom: &Binomiais,
    limite_alvos: u64,
) -> Result<Viabilidade, ErroViabilidade> {
    let viabilidade = avaliar_viabilidade(problema, binom);
    if viabilidade.total_alvos > limite_alvos {
        return Err(ErroViabilidade::AlvosDemais {
            total_alvos: viabilidade.total_alvos,
            limite: limite_alvos,
            bytes_contagem: viabilidade.bytes_contagem,
        });
    }
    Ok(viabilidade)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn binom() -> Binomiais {
        Binomiais::novo(128, 128)
    }

    #[test]
    fn problema_valido_e_aceito() {
        let p = Problema::com_pool_inicial(
            60,
            20,
            7,
            RegraCobertura::cobrir_subconjuntos(3),
            Objetivo::MinimizarCartelas,
        )
        .expect("configuração deveria ser válida");

        assert_eq!(p.tamanho_pool(), 20);
        assert_eq!(p.tamanho_cartela(), 7);
        assert_eq!(p.pool()[0], 1);
        assert_eq!(p.pool()[19], 20);
    }

    #[test]
    fn pool_e_normalizado_e_indexavel() {
        let p = Problema::novo(
            60,
            vec![42, 7, 13],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();

        assert_eq!(p.pool(), &[7, 13, 42]);
        assert_eq!(p.indice_do_rotulo(13), Some(1));
        assert_eq!(p.indice_do_rotulo(99), None);
        assert_eq!(p.rotulo_do_indice(2), Some(42));
    }

    #[test]
    fn configuracoes_invalidas_sao_recusadas() {
        let regra = RegraCobertura::cobrir_subconjuntos(2);
        let obj = Objetivo::MinimizarCartelas;

        assert_eq!(
            Problema::novo(10, vec![1, 1], 2, regra, obj),
            Err(ErroProblema::ElementoRepetido { elemento: 1 })
        );
        assert_eq!(
            Problema::novo(10, vec![1, 11], 2, regra, obj),
            Err(ErroProblema::ElementoForaDoUniverso { elemento: 11, universo: 10 })
        );
        assert_eq!(
            Problema::novo(10, vec![1, 2], 5, regra, obj),
            Err(ErroProblema::CartelaMaiorQuePool { tamanho_cartela: 5, pool: 2 })
        );
        assert!(matches!(
            Problema::novo(10, vec![1, 2, 3], 2, RegraCobertura::garantia(2, 3), obj),
            Err(ErroProblema::IntersecaoInvalida { .. })
        ));
    }

    #[test]
    fn covering_design_atende_um_alvo_por_subconjunto_da_cartela() {
        // Com j == t, cada cartela cobre exatamente C(k, t) alvos.
        let p = Problema::com_pool_inicial(
            60,
            20,
            7,
            RegraCobertura::cobrir_subconjuntos(3),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let v = avaliar_viabilidade(&p, &binom());

        assert_eq!(v.total_alvos, 1140); // C(20, 3)
        assert_eq!(v.alvos_por_cartela, 35); // C(7, 3)
    }

    #[test]
    fn garantia_parcial_atende_mais_alvos_por_cartela() {
        // p=20, k=6, j=6, t=4  →  C(6,4)·C(14,2) + C(6,5)·C(14,1) + C(6,6)·C(14,0)
        let p = Problema::com_pool_inicial(
            60,
            20,
            6,
            RegraCobertura::garantia(6, 4),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let v = avaliar_viabilidade(&p, &binom());

        assert_eq!(v.total_alvos, 38760); // C(20, 6)
        assert_eq!(v.alvos_por_cartela, 15 * 91 + 6 * 14 + 1);
    }

    #[test]
    fn configuracao_grande_demais_e_recusada_antes_de_alocar() {
        let p = Problema::com_pool_inicial(
            100,
            100,
            6,
            RegraCobertura::cobrir_subconjuntos(6),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();

        assert!(matches!(
            checar_viabilidade(&p, &binom(), LIMITE_ALVOS_PADRAO),
            Err(ErroViabilidade::AlvosDemais { .. })
        ));
    }
}
