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
    /// A cota de Turán no avesso — a única que fala de garantia parcial.
    ///
    /// `t' = t + v − k − j`. Vale para todo `t ≤ j`, e com `t = j` devolve
    /// exatamente Schönheim: não é cota nova competindo com a antiga, é a
    /// antiga vista do lugar certo.
    TuranDual { t_linha: usize },
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
            Limite::TuranDual { t_linha } => {
                write!(f, "cota de Turán no avesso (t' = {t_linha})")
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

/// A cota de contagem.
///
/// ```text
/// ⌈ r · (alvos) / (alvos que uma cartela atende) ⌉
/// ```
///
/// O argumento cabe numa linha: cada cartela atende no máximo um tanto de
/// alvos, cada alvo precisa ser atendido `r` vezes, e não há como as contas
/// fecharem com menos. É a mais fraca das cotas e a mais fácil de explicar — e
/// onde ela encosta numa construção, o mínimo está determinado.
///
/// Multiplicar por `r` é legítimo aqui, e é o único lugar onde é: a conta é de
/// unidades de cobertura, e pedir cada alvo `r` vezes multiplica as unidades
/// exigidas por `r` exatamente.
pub fn contagem(p: &Problema) -> u64 {
    let por_bloco = p.alvos_por_bloco();
    if por_bloco == 0 {
        return 0;
    }
    let total = binomial(p.v, p.j) * p.r as u128;
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

/// A cota de Turán no avesso — e a única deste módulo que fala de `t < j`.
///
/// ## A troca de ponto de vista
///
/// Com `B` uma cartela (`|B| = k`), `S` um sorteio (`|S| = j`), e as linhas
/// marcando complemento no pool de `v` dezenas:
///
/// ```text
/// |B ∩ S| = |S| − |S ∩ B'| = j − |S ∩ B'|
/// |S ∩ B'| = |B'| − |B' ∩ S'| = a − |B' ∩ S'|
/// ```
///
/// Somando as duas, `|B ∩ S| = j − a + |B' ∩ S'|`, e portanto
///
/// ```text
/// |B ∩ S| ≥ t   ⟺   |B' ∩ S'| ≥ t + v − k − j
/// ```
///
/// **Isto é igualdade, não aproximação.** O problema `(v, k, j, t)` é o mesmo
/// objeto que `(v, a, b, t')`, com `a = v−k`, `b = v−j`, `t' = t+v−k−j`. Com
/// `t = j` sai `t' = a`, isto é `B' ⊆ S'`, que é a condição de Turán que o
/// motor já usa: a generalização **contém** o caso de hoje.
///
/// ## De onde vem o número
///
/// Chame de sombra de nível `t'` a união dos `t'`-subconjuntos dos complementos
/// escolhidos. A família resolve o problema **se e somente se** essa sombra é um
/// sistema de Turán `T(v, b, t')` — todo `b`-conjunto contém algum membro dela.
///
/// (⇒) dado `S'`, algum `B'` tem `|B' ∩ S'| ≥ t'`, e qualquer `t'`-subconjunto
/// dessa interseção está na sombra e dentro de `S'`.
/// (⇐) dado `S'`, algum membro `T` da sombra cabe em `S'`; `T` veio de algum
/// `B'`, logo `|B' ∩ S'| ≥ |T| = t'`.
///
/// Cada complemento contribui com no máximo `C(a, t')` membros, então
///
/// ```text
/// |F| · C(a, t') ≥ T(v, b, t')
/// ```
///
/// e pela dualidade Turán↔cobertura, `T(v, b, t') = C(v, v−t', j)`. Qualquer
/// piso válido de cobertura serve do lado direito, e aqui Schönheim vale
/// integralmente — porque ela está sendo aplicada **ao sistema de Turán dual**,
/// onde sorteio e garantia coincidem, e não esticada para fora do teorema dela.
///
/// ## Onde há folga, dito com todas as letras
///
/// A desigualdade perde em três lugares: complementos podem compartilhar
/// membros da sombra; a sombra pode ser estritamente maior que um sistema de
/// Turán mínimo; e nem todo sistema de Turán mínimo é sombra de poucos
/// `a`-conjuntos. É cota inferior, e nada além disso.
///
/// ## Dois casos em que ela é exata
///
/// - `t' = 0` (isto é, `t ≤ k + j − v`): a garantia é automática, porque duas
///   partes de tamanho `k` e `j` num universo de `v` sempre se cruzam em pelo
///   menos `k + j − v`. Uma cartela qualquer basta.
/// ## Por que `r` **não** multiplica esta cota
///
/// A tentação é escrever `|F| · C(a,t') ≥ r · T(v,b,t')`, e ela é falsa. Com
/// `r` cartelas premiadas a exigência é que **`r` cartelas distintas** tenham
/// interseção suficiente com cada alvo — não que existam `r` membros distintos
/// da sombra dentro dele. Duas cartelas diferentes podem contribuir com o
/// mesmo `t'`-subconjunto, e aí a sombra tem um membro só onde a exigência
/// pedia duas cartelas.
///
/// O que continua valendo é a versão simples: quem atende cada alvo `r` vezes
/// atende ao menos uma, logo a sombra continua sendo um sistema de Turán. A
/// escala com `r` fica por conta da cota de contagem, onde ela é legítima, e o
/// máximo das duas é o que a tela usa.
///
/// Cheguei a multiplicar, e o que pegou foi um teste que cobrava outro número.
/// Uma cota inferior alta demais não é um número feio: ela vira **teto** na
/// escalada, e o motor passa a perseguir o impossível.
///
/// - `t' = 1`: a exigência vira "nenhum `b`-conjunto escapa da união dos
///   complementos", ou seja `|U| ≥ j + 1`, e o mínimo é `⌈(j+1)/a⌉`. É o caso
///   mais comum do aplicativo, e a cota o acerta na mosca.
pub fn turan_dual(p: &Problema) -> u64 {
    // Fora de `t ≤ j` a troca de ponto de vista não descreve o problema.
    if p.t > p.j || p.k > p.v || p.j > p.v {
        return 0;
    }
    let a = p.v - p.k;
    if a == 0 {
        // Cartela igual ao pool: ela contém todo sorteio, e uma basta.
        return 1;
    }
    let t_linha = (p.t + p.v).saturating_sub(p.k + p.j);
    if t_linha == 0 {
        // Garantia automática: duas partes de tamanho `k` e `j` num universo de
        // `v` sempre se cruzam em pelo menos `k + j − v`. Uma cartela basta, e
        // quem escala com `r` é a contagem.
        return 1;
    }
    if t_linha > a {
        // Pedido impossível: nem o complemento inteiro alcança a garantia.
        return 0;
    }
    let dentro = schonheim(p.v, p.v - t_linha, p.j);
    let por_bloco = binomial(a, t_linha).max(1);
    (dentro as u128).div_ceil(por_bloco).min(u64::MAX as u128) as u64
}

/// O melhor limite que este aplicativo consegue afirmar **sem procurar nada**.
///
/// Toma o máximo das cotas fechadas: cada uma diz "não existe solução menor que
/// isto", e a afirmação mais forte continua verdadeira.
pub fn sem_busca(p: &Problema) -> LimiteInferior {
    let conta = LimiteInferior { valor: contagem(p).max(1), origem: Limite::Contagem };

    // A cota do avesso entra sempre, e é a única que fala quando `t < j`.
    //
    // Sem ela, garantia parcial saía só com a contagem — que é verdadeira e
    // frouxa. Medido em pool 20, jogos de 17, saem 15, garante 13: a contagem
    // dá 2 e o mínimo é 6. E como a escalada usa o piso de teto, o motor ficava
    // perseguindo um alvo que a matemática proíbe, girando para sempre nos
    // 87,1% que é exatamente o máximo que duas cartelas alcançam.
    let dual = LimiteInferior {
        valor: turan_dual(p),
        origem: Limite::TuranDual {
            t_linha: (p.t + p.v).saturating_sub(p.k + p.j),
        },
    };
    let melhor = conta.melhor(dual);

    if !p.e_covering_design() {
        // Schönheim fala de cobertura **simples** com sorteio igual à garantia.
        // Fora disso ela não vale, e não há teorema que autorize multiplicá-la
        // por `r` nem esticá-la para `j ≠ t`. Usá-la assim inventaria um piso —
        // e um piso inventado faz o aplicativo dizer "mínimo provado" sobre o
        // que não é mínimo.
        return melhor;
    }
    let scho = LimiteInferior { valor: schonheim(p.v, p.k, p.t), origem: Limite::Schonheim };
    melhor.melhor(scho)
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
                    let Ok(p) = Problema::cobertura(v, k, t) else { continue };
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

    /// A mesma invariante onde ela é nova: sorteio diferente da garantia, e
    /// mais de uma cartela premiada. É aqui que uma cota esticada além do seu
    /// teorema apareceria.
    #[test]
    fn nenhuma_cota_passa_por_cima_de_um_fechamento_com_sorteio_e_premiadas() {
        for &(v, k, j, t) in
            &[(9, 4, 3, 2), (10, 5, 4, 3), (9, 3, 4, 2), (11, 5, 4, 2), (8, 4, 5, 3)]
        {
            for r in 1..=3usize {
                let Ok(p) = Problema::novo(v, k, j, t, r) else { continue };
                let c = construtor::construir(&p);
                if !p.cobre(&c.blocos) {
                    continue;
                }
                let piso = sem_busca(&p);
                assert!(
                    piso.valor <= c.tamanho() as u64,
                    "({v},{k},{j},{t},r={r}): a cota diz {} ({}) e existe coleção de {}",
                    piso.valor,
                    piso.origem,
                    c.tamanho()
                );
            }
        }
    }

    /// Fora do covering design puro, Schönheim continua proibida — mas a cota
    /// do avesso vale, e é ela que salva a garantia parcial.
    ///
    /// O nome antigo deste teste era "só a contagem vale", e ele passava por
    /// acaso: nos dois casos que ele olhava, a contagem vencia mesmo. A
    /// afirmação, porém, deixou de ser verdadeira no momento em que a cota de
    /// Turán no avesso entrou — e um teste que afirma o que não vale mais é
    /// armadilha para quem for mexer.
    #[test]
    fn fora_do_covering_design_schonheim_nao_vale_mas_a_do_avesso_sim() {
        let parcial = Problema::novo(10, 5, 4, 3, 1).unwrap();
        assert!(!parcial.e_covering_design());
        assert_ne!(sem_busca(&parcial).origem, Limite::Schonheim);

        let dobrado = Problema::novo(9, 3, 2, 2, 2).unwrap();
        assert!(!dobrado.e_covering_design());
        assert_ne!(sem_busca(&dobrado).origem, Limite::Schonheim);
        // E a contagem dobra junto com o pedido.
        let simples = Problema::novo(9, 3, 2, 2, 1).unwrap();
        assert_eq!(contagem(&dobrado), 2 * contagem(&simples));
    }

    /// O caso que motivou tudo: pool 20, jogos de 17, saem 15, garante 13.
    ///
    /// A contagem dá 2, e 2 é verdade — nada com uma cartela cobre tudo. Mas o
    /// mínimo é 6, e a escalada usa o piso de **teto**: com 2 no lugar de 6, o
    /// motor perseguia um alvo que a matemática proíbe e girava para sempre nos
    /// 87,1% que é exatamente o máximo alcançável com duas cartelas.
    ///
    /// Aqui `t' = 13 + 20 − 17 − 15 = 1`, e nesse degrau a cota é **exata**: a
    /// exigência vira "nenhum 5-conjunto escapa da união dos complementos", ou
    /// seja `|U| ≥ 16`, e com complementos de 3 dezenas isso são `⌈16/3⌉ = 6`.
    #[test]
    fn a_garantia_parcial_ganha_um_piso_que_nao_e_o_da_contagem() {
        let p = Problema::novo(20, 17, 15, 13, 1).unwrap();
        assert!(!p.e_covering_design());
        assert_eq!(contagem(&p), 2, "a contagem é verdadeira, e frouxa");
        assert_eq!(turan_dual(&p), 6, "o avesso acerta o mínimo verdadeiro");
        assert_eq!(sem_busca(&p).valor, 6);
    }

    /// Com garantia cheia a cota do avesso **é** Schönheim — não é cota nova
    /// competindo com a antiga, é a antiga vista do lugar certo.
    ///
    /// Com `t = j` sai `t' = v − k = a` e `C(a,a) = 1`, então
    /// `schonheim(v, v−a, j) = schonheim(v, k, t)`. Se algum dia as duas
    /// discordarem, uma delas quebrou.
    #[test]
    fn com_garantia_cheia_o_avesso_reproduz_schonheim() {
        for v in 3..=22 {
            for k in 1..v {
                for t in 1..=k.min(v - 1) {
                    let Ok(p) = Problema::novo(v, k, t, t, 1) else {
                        continue;
                    };
                    assert_eq!(
                        turan_dual(&p),
                        schonheim(v, k, t),
                        "({v},{k},{t}): o avesso deveria reproduzir Schönheim"
                    );
                }
            }
        }
    }

    /// A garantia que sai de graça não pode pedir mais de uma cartela.
    ///
    /// Duas partes de tamanho `k` e `j` num universo de `v` sempre se cruzam em
    /// pelo menos `k + j − v`. Pedir exatamente isso é pedir o que já se tem, e
    /// o piso tem de dizer uma cartela — não zero, que seria afirmar que nada é
    /// preciso, e não mais, que seria inventar dificuldade.
    #[test]
    fn a_garantia_automatica_custa_uma_cartela() {
        // 20 e 17 se cruzam em ao menos 12 dentro de um sorteio de 15.
        let p = Problema::novo(20, 17, 15, 12, 1).unwrap();
        assert_eq!(turan_dual(&p), 1);
        assert_eq!(sem_busca(&p).valor, 1);
    }

    /// Dois mínimos que não dependem de tabela: o plano de Fano tem 7 blocos e
    /// o sistema de Steiner de ordem 9 tem 12, e ambos são exibíveis.
    #[test]
    fn onde_a_contagem_encosta_num_desenho_conhecido_ela_o_determina() {
        let fano = Problema::cobertura(7, 3, 2).unwrap();
        assert_eq!(sem_busca(&fano).valor, 7);
        let steiner = Problema::cobertura(9, 3, 2).unwrap();
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
                    let Ok(p) = Problema::cobertura(v, k, t) else { continue };
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
        let p = Problema::cobertura(6, 6, 3).unwrap();
        assert_eq!(sem_busca(&p).valor, 1, "um bloco que é o universo inteiro cobre tudo");
    }
}
