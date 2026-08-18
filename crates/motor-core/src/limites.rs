//! Limites inferiores — a diferença entre "melhor que encontrei" e "melhor que existe".
//!
//! O §24 do documento conceitual faz uma distinção que quase todo software de
//! otimização ignora: encontrar uma solução de 29 cartelas **não** prova que 28
//! seja impossível. Sem um limite inferior, o motor não tem como saber se ainda
//! vale a pena procurar.
//!
//! Aqui ficam os dois limites que dá para calcular de forma exata e barata.
//! Quando o limite inferior encontra a melhor solução conhecida, a busca acabou
//! — e aí sim é legítimo dizer "ótimo provado".

use crate::cobertura::MotorCobertura;
use crate::referencia;

/// Como o limite foi obtido.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetodoLimite {
    /// Cota de Schönheim, válida para covering designs (`j == t`).
    Schonheim,
    /// Contagem simples: total de alvos dividido pelo que cabe em uma cartela.
    Contagem,
    /// Limite inferior já provado na literatura, catalogado em
    /// [`crate::referencia`]. Costuma ser bem mais forte que os dois anteriores
    /// — supera Schönheim em metade das configurações conhecidas — porque vem de
    /// argumentos específicos daquele caso, e não de uma fórmula geral.
    Publicado,
}

impl std::fmt::Display for MetodoLimite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MetodoLimite::Schonheim => write!(f, "cota de Schönheim"),
            MetodoLimite::Contagem => write!(f, "cota de contagem"),
            MetodoLimite::Publicado => write!(f, "limite provado na literatura"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimiteInferior {
    /// Nenhuma solução válida pode usar menos cartelas que isto.
    pub valor: u64,
    pub metodo: MetodoLimite,
}

/// Cota de contagem: cada cartela atende no máximo `alvos_por_cartela` alvos,
/// e existem `total_alvos` a atender, cada um `premiadas` vezes.
///
/// Vale para qualquer regra de cobertura — garantias parciais e cobertura
/// múltipla inclusive. Exigir `r` cartelas por alvo multiplica a demanda total
/// por `r` sem mudar o que cada cartela oferece, então o piso multiplica por
/// `r` exatamente.
pub fn limite_por_contagem(total_alvos: u64, alvos_por_cartela: u64, premiadas: u64) -> u64 {
    if alvos_por_cartela == 0 {
        return 0;
    }
    total_alvos.saturating_mul(premiadas.max(1)).div_ceil(alvos_por_cartela)
}

/// Cota de Schönheim para o covering design `C(v, k, t)`.
///
/// Definida pela recorrência
///
/// ```text
/// L(v, k, 1) = ⌈ v / k ⌉
/// L(v, k, t) = ⌈ (v / k) · L(v−1, k−1, t−1) ⌉
/// ```
///
/// O argumento: fixe um elemento `x`. Os blocos que contêm `x` precisam cobrir
/// todos os `(t−1)`-subconjuntos dos outros `v−1` elementos, e cada bloco
/// contribui com `k−1` deles. Isso dá o número mínimo de blocos por elemento;
/// somando sobre os `v` elementos e dividindo pelos `k` elementos de cada bloco
/// chega-se à recorrência.
///
/// Devolve 0 quando os parâmetros não descrevem um covering design válido
/// (`1 <= t <= k <= v`), sinalizando "sem limite útil".
pub fn schonheim(v: usize, k: usize, t: usize) -> u64 {
    if t == 0 || k == 0 || t > k || k > v {
        return 0;
    }

    // Acumula em u128 porque o produto intermediário cresce rápido; a saturação
    // só seria atingida em configurações muito além do que é enumerável.
    fn recorrencia(v: u128, k: u128, t: u32) -> u128 {
        if t == 1 {
            return v.div_ceil(k);
        }
        let interno = recorrencia(v - 1, k - 1, t - 1);
        (v.saturating_mul(interno)).div_ceil(k)
    }

    recorrencia(v as u128, k as u128, t as u32).min(u64::MAX as u128) as u64
}

/// Melhor limite inferior disponível para a configuração do motor.
///
/// Para covering designs usa o mais forte entre três fontes: o limite já provado
/// na literatura ([`crate::referencia`]), a cota de Schönheim e a contagem. Para
/// garantias parciais, apenas contagem — Schönheim não se aplica quando a
/// cartela pode atender um alvo sem contê-lo, e a tabela publicada tampouco
/// cobre esse caso.
///
/// Tomar o máximo é seguro porque os três são limites inferiores válidos: cada
/// um afirma "não existe solução menor que isto", e a afirmação mais forte
/// continua verdadeira. O que **não** pode entrar aqui é o melhor resultado
/// conhecido no mundo — esse é um limite superior, e usá-lo faria o motor
/// declarar optimalidade em cima de um recorde que ainda pode cair.
///
/// Com mais de uma cartela premiada por alvo, a contagem entra multiplicada e
/// as fontes do catálogo entram inteiras, sem multiplicar — ver o corpo.
pub fn limite_inferior(motor: &MotorCobertura) -> LimiteInferior {
    let viabilidade = motor.viabilidade();
    let premiadas = u64::from(motor.premiadas());
    let por_contagem =
        limite_por_contagem(viabilidade.total_alvos, viabilidade.alvos_por_cartela, premiadas);

    let e_covering_design = motor.alvo() == motor.intersecao();
    if !e_covering_design {
        return LimiteInferior { valor: por_contagem, metodo: MetodoLimite::Contagem };
    }

    // Schönheim e a tabela publicada falam de cobertura **simples**: cada alvo
    // atendido uma vez. Não valem multiplicadas por `r` — não há teorema que
    // autorize isso, e usá-las assim inventaria um piso.
    //
    // Mas valem **como estão**, e é fácil ver por quê: toda solução que atende
    // cada alvo `r` vezes atende cada alvo ao menos uma vez, então ela também é
    // uma cobertura simples e não pode ser menor que o mínimo de uma. O piso
    // final é o mais forte entre os dois argumentos independentes — o do
    // catálogo, sem multiplicar, e o de contagem, já multiplicado.
    let por_schonheim =
        schonheim(motor.tamanho_pool(), motor.tamanho_cartela(), motor.intersecao());
    let publicado = referencia::consultar(
        motor.tamanho_pool(),
        motor.tamanho_cartela(),
        motor.intersecao(),
    )
    .map(|r| r.limite_publicado)
    .unwrap_or(0);

    // Empates ficam com o método mais simples de explicar: uma cota fechada é
    // mais informativa na tela do que "está num catálogo".
    let melhor = por_contagem.max(por_schonheim).max(publicado);
    let metodo = if melhor == por_schonheim {
        MetodoLimite::Schonheim
    } else if melhor == por_contagem {
        MetodoLimite::Contagem
    } else {
        MetodoLimite::Publicado
    };

    LimiteInferior { valor: melhor, metodo }
}

/// Distância relativa entre a melhor solução conhecida e o limite inferior.
///
/// `gap = (melhor − limite) / limite`. Zero significa optimalidade provada.
/// Devolve `None` quando não há limite útil com que comparar.
pub fn gap(melhor_conhecida: u64, limite: u64) -> Option<f64> {
    if limite == 0 {
        return None;
    }
    Some((melhor_conhecida.saturating_sub(limite)) as f64 / limite as f64)
}

/// Verdadeiro quando a melhor solução conhecida alcançou o limite inferior —
/// e portanto é comprovadamente ótima.
pub fn optimalidade_provada(melhor_conhecida: u64, limite: LimiteInferior) -> bool {
    limite.valor > 0 && melhor_conhecida <= limite.valor
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::problema::{Objetivo, Problema, RegraCobertura};

    /// Números de cobertura `C(v, 3, 2)` já provados na literatura, para
    /// `v = 3..=13`. Nesta faixa a cota de Schönheim é conhecidamente exata,
    /// o que a torna um bom teste de corretude da recorrência.
    const COBERTURA_K3_T2: [(usize, u64); 11] = [
        (3, 1),
        (4, 3),
        (5, 4),
        (6, 6),
        (7, 7),
        (8, 11),
        (9, 12),
        (10, 17),
        (11, 19),
        (12, 24),
        (13, 26),
    ];

    #[test]
    fn schonheim_reproduz_os_numeros_de_cobertura_conhecidos() {
        for (v, esperado) in COBERTURA_K3_T2 {
            assert_eq!(
                schonheim(v, 3, 2),
                esperado,
                "C({v}, 3, 2) deveria ser {esperado}"
            );
        }
    }

    #[test]
    fn schonheim_acerta_planos_projetivos_e_sistemas_de_steiner() {
        // S(2, 4, 13) — plano projetivo de ordem 3: 13 blocos.
        assert_eq!(schonheim(13, 4, 2), 13);
        // S(2, 4, 16): 16·15 / (4·3) = 20 blocos.
        assert_eq!(schonheim(16, 4, 2), 20);
        // C(8, 4, 3) = 14, valor clássico e provado.
        assert_eq!(schonheim(8, 4, 3), 14);
        // Caso degenerado: um único bloco cobre o conjunto inteiro.
        assert_eq!(schonheim(5, 5, 3), 1);
    }

    #[test]
    fn schonheim_recusa_parametros_invalidos() {
        assert_eq!(schonheim(5, 3, 0), 0, "t = 0 não descreve um design");
        assert_eq!(schonheim(5, 3, 4), 0, "t > k é impossível");
        assert_eq!(schonheim(3, 5, 2), 0, "k > v é impossível");
    }

    #[test]
    fn contagem_e_um_limite_valido_e_conservador() {
        // C(9,3,2): 36 pares, cada bloco cobre 3 → pelo menos 12.
        assert_eq!(limite_por_contagem(36, 3, 1), 12);
        // Divisão inexata sempre arredonda para cima.
        assert_eq!(limite_por_contagem(37, 3, 1), 13);
        assert_eq!(limite_por_contagem(0, 3, 1), 0);
        assert_eq!(limite_por_contagem(10, 0, 1), 0);
    }

    fn motor_de(p: usize, k: usize, j: usize, t: usize) -> MotorCobertura {
        let problema = Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::garantia(j, t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        MotorCobertura::novo(&problema).unwrap()
    }

    #[test]
    fn covering_design_usa_o_limite_mais_forte() {
        // Em C(10,3,2) Schönheim dá 17 e a contagem dá 15; vence Schönheim.
        let limite = limite_inferior(&motor_de(10, 3, 2, 2));
        assert_eq!(limite.metodo, MetodoLimite::Schonheim);
        assert_eq!(limite.valor, 17);
    }

    #[test]
    fn garantia_parcial_cai_para_a_contagem() {
        // Com j > t a cartela atende alvos que não contém, então Schönheim
        // deixa de valer e seria incorreto aplicá-lo.
        let motor = motor_de(12, 6, 5, 3);
        let limite = limite_inferior(&motor);
        assert_eq!(limite.metodo, MetodoLimite::Contagem);

        let v = motor.viabilidade();
        assert_eq!(limite.valor, limite_por_contagem(v.total_alvos, v.alvos_por_cartela, 1));
    }

    #[test]
    fn gap_mede_a_distancia_ate_a_prova() {
        assert_eq!(gap(29, 29), Some(0.0));
        assert_eq!(gap(27, 25), Some(0.08));
        assert_eq!(gap(10, 0), None);
        // Uma solução abaixo do limite indicaria bug; o gap satura em zero.
        assert_eq!(gap(20, 25), Some(0.0));
    }

    #[test]
    fn optimalidade_so_e_declarada_quando_os_limites_se_encontram() {
        let limite = LimiteInferior { valor: 29, metodo: MetodoLimite::Schonheim };
        assert!(optimalidade_provada(29, limite));
        assert!(!optimalidade_provada(30, limite));

        let sem_limite = LimiteInferior { valor: 0, metodo: MetodoLimite::Contagem };
        assert!(
            !optimalidade_provada(1, sem_limite),
            "sem limite útil, nada pode ser declarado ótimo"
        );
    }
}
