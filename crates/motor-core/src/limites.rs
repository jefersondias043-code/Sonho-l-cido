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
    /// Valor exato de um sistema de Turán pequeno, elevado até a configuração
    /// pedida. Ver [`TURAN_EXATOS`] e [`elevar_turan`].
    TuranElevado,
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
            MetodoLimite::TuranElevado => write!(f, "Turán exato, elevado"),
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

/// Valores **exatos** de sistemas de Turán pequenos, na forma `(a, b, n, T)`.
///
/// `T(n, b, a)` é a menor família de `a`-conjuntos de `n` pontos tal que todo
/// `b`-conjunto contenha algum dela. É a forma complementar em que a modalidade
/// vive: uma cartela de `k` dezenas num pool de `v` é o complemento de
/// `a = v − k`, e um sorteio de `t` é o complemento de `b = v − t`.
///
/// Todo valor aqui foi obtido por **busca exaustiva sem restrição de simetria**,
/// pela ferramenta `turan-exatos` do `motor-busca`. Essa exigência não é
/// cerimônia: um ótimo obtido dentro de uma família simétrica é limite
/// **superior**, e colocá-lo aqui faria o aplicativo declarar impossível uma
/// solução que existe.
///
/// Schönheim erra alguns destes para menos — em `(a=3, b=5)` ela dá 4 onde o
/// exato é 5, e 7 onde o exato é 8 —, e é dessa diferença que sai o piso melhor.
const TURAN_EXATOS: &[(u8, u8, u8, u32)] = &[
    (3, 5, 5, 1),
    (3, 5, 6, 2),
    (3, 5, 7, 5),
    (3, 5, 8, 8),
    (3, 6, 6, 1),
    (3, 6, 7, 2),
    (3, 6, 8, 4),
    (3, 6, 9, 7),
    (3, 7, 7, 1),
    (3, 7, 8, 2),
    (3, 7, 9, 3),
    (3, 7, 10, 6),
    (3, 8, 8, 1),
    (3, 8, 9, 2),
    (3, 8, 10, 3),
    (3, 8, 11, 5),
    (3, 9, 9, 1),
    (3, 9, 10, 2),
    (3, 9, 11, 3),
    (3, 9, 12, 4),
    (3, 10, 10, 1),
    (3, 10, 11, 2),
    (3, 10, 12, 3),
    (3, 10, 13, 4),
    (4, 6, 6, 1),
    (4, 6, 7, 3),
    (4, 6, 8, 6),
    (4, 7, 7, 1),
    (4, 7, 8, 2),
    (4, 7, 9, 5),
    (4, 8, 8, 1),
    (4, 8, 9, 2),
    (4, 8, 10, 4),
    (4, 9, 9, 1),
    (4, 9, 10, 2),
    (4, 9, 11, 4),
    (4, 10, 10, 1),
    (4, 10, 11, 2),
    (4, 10, 12, 3),
    (5, 7, 7, 1),
    (5, 7, 8, 3),
    (5, 8, 8, 1),
    (5, 8, 9, 3),
    (5, 8, 10, 6),
    (5, 9, 9, 1),
    (5, 9, 10, 2),
    (5, 10, 10, 1),
    (5, 10, 11, 2),
    (6, 8, 8, 1),
    (6, 8, 9, 3),
    (6, 9, 9, 1),
    (6, 9, 10, 3),
    (6, 10, 10, 1),
    (6, 10, 11, 3),
    (7, 9, 9, 1),
    (7, 9, 10, 4),
    (7, 10, 10, 1),
    (7, 10, 11, 3),
];

/// Leva um valor exato pequeno para `n` maior sem perder o direito de chamá-lo
/// de prova.
///
/// Fixe um ponto `x`. Os blocos que **não** contêm `x` já formam sozinhos um
/// sistema de Turán sobre os outros `n−1` pontos: todo `b`-conjunto de lá
/// precisa conter um bloco, e nenhum bloco que passe por `x` cabe dentro dele.
/// Então cada ponto é evitado por ao menos `T(n−1)` blocos. Somando sobre os `n`
/// pontos, e notando que cada bloco de tamanho `a` evita `n − a` pontos:
///
/// ```text
/// T(n) · (n − a) ≥ n · T(n−1)
/// ```
///
/// Medido: `T(8, 5, 3) = 8` elevado até `n = 20` devolve 185, contra os 160 de
/// Schönheim — e o melhor fechamento conhecido ali tem 240 cartelas.
pub fn elevar_turan(base_n: usize, base_valor: u64, ate_n: usize, a: usize) -> u64 {
    if ate_n <= base_n || a == 0 {
        return base_valor;
    }
    let mut valor = base_valor as u128;
    for n in (base_n + 1)..=ate_n {
        if n <= a {
            return 0;
        }
        valor = (n as u128 * valor).div_ceil((n - a) as u128);
    }
    valor.min(u64::MAX as u128) as u64
}

/// O melhor piso que [`TURAN_EXATOS`] sustenta para `C(v, k, t)`.
///
/// Toma o máximo sobre todas as bases da família em vez de confiar na maior:
/// hoje a maior sempre vence, mas isso é um fato dos números que estão na
/// tabela, não um teorema — e uma base nova poderia inverter a ordem sem avisar.
///
/// Devolve 0 quando a família não está catalogada, que é o valor neutro do
/// `max` em [`limite_inferior`].
pub fn turan_elevado(v: usize, k: usize, t: usize) -> u64 {
    if k > v || t > k {
        return 0;
    }
    let a = v - k;
    let b = v - t;
    if a == 0 || a > b || b > v {
        return 0;
    }
    TURAN_EXATOS
        .iter()
        .filter(|&&(ta, tb, _, _)| ta as usize == a && tb as usize == b)
        .map(|&(_, _, n, valor)| elevar_turan(n as usize, u64::from(valor), v, a))
        .max()
        .unwrap_or(0)
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
    // O mesmo argumento vale para o Turán elevado: ele é o mínimo de uma
    // cobertura simples, e toda cobertura múltipla também é uma simples.
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
    let por_turan =
        turan_elevado(motor.tamanho_pool(), motor.tamanho_cartela(), motor.intersecao());

    let melhor = por_contagem.max(por_schonheim).max(publicado).max(por_turan);
    let metodo = if melhor == por_schonheim {
        MetodoLimite::Schonheim
    } else if melhor == por_contagem {
        MetodoLimite::Contagem
    } else if melhor == publicado {
        MetodoLimite::Publicado
    } else {
        MetodoLimite::TuranElevado
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

/// Verdadeiro quando a melhor solução conhecida **encontrou** o limite
/// inferior — e portanto é comprovadamente ótima.
///
/// Encontro é igualdade, e era `<=`. A diferença não é preciosismo: `limite` é
/// cota **inferior**, então uma solução menor que ela não é um ótimo melhor
/// ainda — é prova de que a cota está errada. Com `<=`, o único sinal que o
/// aplicativo teria de um piso mal calculado virava a afirmação mais forte que
/// ele sabe fazer, e essa afirmação chega à tela e fica gravada no histórico.
///
/// O nome do teste desta função já dizia "quando os limites se encontram"; era
/// o código que discordava dele.
pub fn optimalidade_provada(melhor_conhecida: u64, limite: LimiteInferior) -> bool {
    limite.valor > 0 && melhor_conhecida == limite.valor
}

/// A solução passou **por baixo** da cota inferior.
///
/// Não há leitura boa: ou a solução não é válida, ou a cota está errada. O que
/// não se pode é escolher a leitura bonita e anunciar optimalidade — e era
/// exatamente o que acontecia enquanto este caso não tinha nome.
pub fn contradiz_o_limite(melhor_conhecida: u64, limite: LimiteInferior) -> bool {
    limite.valor > 0 && melhor_conhecida > 0 && melhor_conhecida < limite.valor
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

    /// Os melhores fechamentos que o aplicativo já entrega, para as vinte
    /// configurações da Lotinha ainda sem mínimo conhecido. Vindos de
    /// `web/lotinha.json`, e conferidos sorteio a sorteio pela suíte do
    /// navegador.
    ///
    /// Estão aqui por um motivo só, e é o mais importante deste módulo: um piso
    /// **acima** de uma solução que existe é uma prova falsa, e faria o
    /// aplicativo declarar impossível o que ele mesmo já entregou.
    const MELHOR_QUE_TEMOS: [(usize, usize, u64); 20] = [
        (20, 17, 240),
        (21, 17, 1095),
        (21, 18, 182),
        (22, 17, 3454),
        (22, 18, 660),
        (22, 19, 126),
        (23, 17, 10051),
        (23, 18, 2139),
        (23, 19, 475),
        (23, 20, 100),
        (24, 17, 26837),
        (24, 18, 5876),
        (24, 19, 1506),
        (24, 20, 334),
        (24, 21, 80),
        (25, 18, 14875),
        (25, 19, 3856),
        (25, 20, 1104),
        (25, 21, 266),
        (25, 22, 72),
    ];

    #[test]
    fn o_piso_de_turan_nunca_passa_do_fechamento_que_ja_existe() {
        for (pool, jogo, temos) in MELHOR_QUE_TEMOS {
            let piso = turan_elevado(pool, jogo, 15);
            assert!(
                piso <= temos,
                "{pool}/{jogo}: piso {piso} acima das {temos} cartelas que já existem"
            );
        }
    }

    #[test]
    fn o_piso_de_turan_reproduz_as_quatro_melhorias_medidas() {
        // As únicas quatro em que o exato pequeno supera Schönheim. Se um valor
        // novo entrar em TURAN_EXATOS estes números sobem — e aí é para conferir
        // de novo contra MELHOR_QUE_TEMOS antes de atualizar aqui.
        assert_eq!(turan_elevado(20, 17, 15), 185, "Schönheim dá 160");
        assert_eq!(turan_elevado(21, 18, 15), 122, "Schönheim dá 117");
        assert_eq!(turan_elevado(22, 18, 15), 360, "Schönheim dá 261");
        assert_eq!(turan_elevado(22, 19, 15), 98, "Schönheim dá 79");
    }

    #[test]
    fn familia_fora_da_tabela_nao_inventa_piso() {
        // `a = v − k` de 1 e 2 são os casos que Turán já fecha por fórmula, e
        // não estão catalogados: precisam devolver o neutro do `max`.
        assert_eq!(turan_elevado(20, 19, 15), 0);
        assert_eq!(turan_elevado(20, 18, 15), 0);
        // Fora da modalidade também.
        assert_eq!(turan_elevado(9, 3, 2), 0);
        // E parâmetros sem sentido não entram em pânico.
        assert_eq!(turan_elevado(5, 9, 2), 0);
        assert_eq!(turan_elevado(20, 20, 15), 0);
    }

    #[test]
    fn elevar_e_monotono_e_devolve_a_base_quando_nao_ha_degrau() {
        assert_eq!(elevar_turan(8, 8, 20, 3), 185);
        assert_eq!(elevar_turan(8, 8, 9, 3), 12);
        assert_eq!(elevar_turan(8, 8, 10, 3), 18);
        assert_eq!(elevar_turan(8, 8, 8, 3), 8);
        assert_eq!(elevar_turan(8, 8, 5, 3), 8);
        // Subir um degrau nunca pode baixar o piso.
        let mut anterior = 8;
        for n in 9..=20 {
            let atual = elevar_turan(8, 8, n, 3);
            assert!(atual >= anterior, "n={n}");
            anterior = atual;
        }
    }

    #[test]
    fn a_tabela_so_guarda_familias_que_a_modalidade_usa() {
        for &(a, b, n, valor) in TURAN_EXATOS {
            assert!(a >= 3, "a ≤ 2 é fórmula fechada, não precisa de tabela");
            assert!(a <= b, "({a},{b},{n},{valor}): bloco maior que o alvo");
            assert!((n as usize) >= b as usize, "({a},{b},{n}): n abaixo de b");
            assert!(valor >= 1);
        }
    }

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

        // Abaixo da cota não é ótimo melhor ainda: é contradição, e o caso
        // nunca tinha sido exercido — o `<=` antigo devolvia `true` aqui.
        assert!(
            !optimalidade_provada(28, limite),
            "abaixo da cota inferior nada pode ser declarado ótimo"
        );
        assert!(contradiz_o_limite(28, limite));
        assert!(!contradiz_o_limite(29, limite));
        assert!(!contradiz_o_limite(30, limite));

        let sem_limite_2 = LimiteInferior { valor: 0, metodo: MetodoLimite::Contagem };
        assert!(
            !contradiz_o_limite(1, sem_limite_2),
            "sem cota útil não há o que contradizer"
        );

        let sem_limite = LimiteInferior { valor: 0, metodo: MetodoLimite::Contagem };
        assert!(
            !optimalidade_provada(1, sem_limite),
            "sem limite útil, nada pode ser declarado ótimo"
        );
    }
}
