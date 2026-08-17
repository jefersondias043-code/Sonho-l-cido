//! Construções algébricas — soluções ótimas escritas por fórmula, sem busca.
//!
//! ## O achado que motivou este módulo
//!
//! Na aferição contra ótimos publicados, o motor alcançava o ótimo provado em 9
//! de 11 configurações. As duas que resistiam:
//!
//! | configuração | ótimo | o motor achava | o que é |
//! |--------------|-------|----------------|---------|
//! | `C(21,5,2)`  | 21    | 27 (+29%)      | plano projetivo `PG(2,4)` |
//! | `C(25,5,2)`  | 30    | 39 (+30%)      | plano afim `AG(2,5)` |
//!
//! Não é coincidência, e não é falta de tempo de processamento. São objetos de
//! estrutura algébrica rígida: a solução ótima é *única a menos de simetria* e
//! não tem vizinhança — qualquer troca de um elemento a destrói por completo.
//! Busca local não chega lá por acidente, por mais horas que rode.
//!
//! Mas uma fórmula as escreve em milissegundos. É o que este módulo faz.
//!
//! ## O que cabe aqui
//!
//! - **Plano projetivo `PG(2,q)`** — os pontos e retas do plano projetivo sobre
//!   o corpo finito de `q` elementos. Dá `C(q²+q+1, q+1, 2)` com exatamente
//!   `q²+q+1` cartelas, que é o ótimo provado.
//! - **Plano afim `AG(2,q)`** — pontos e retas do plano afim. Dá `C(q², q, 2)`
//!   com `q²+q` cartelas, também ótimo provado.
//! - **Partição** — para `t = 1`, dividir o pool em blocos resolve o problema
//!   exatamente, com `⌈p/k⌉` cartelas, que é a cota de Schönheim.
//!
//! Conferido contra a tabela mundial ([`crate::referencia`]): as 13 construções
//! de plano que cabem no pool de 128 elementos acertam o melhor conhecido em 13
//! de 13 casos, e todas as 13 são ótimo provado.
//!
//! ## Truncagem: quando o pool não bate exatamente
//!
//! Um plano só existe para tamanhos muito específicos. Mas se o pool do usuário
//! for *menor* que o do plano, dá para apagar os pontos sobrando: um par que
//! estava coberto por uma reta continua coberto pelo que restou dela, e as retas
//! que encolheram são recompletadas com elementos quaisquer do pool — cartela
//! maior nunca cobre menos.
//!
//! Isso estende a construção para toda a faixa abaixo de cada plano. Nos
//! tamanhos grandes, onde a busca sofre mais, a truncagem já entrega o melhor
//! conhecido antes de qualquer iteração: `C(54,8,2)`, `C(70,9,2)` e `C(88,10,2)`
//! saem prontos.
//!
//! Em pools bem menores que o plano a truncagem fica folgada, e aí o guloso
//! costuma ser melhor. Por isso quem decide não é este módulo: o motor constrói
//! os dois pontos de partida e fica com o menor, em
//! `MotorBusca::garantir_inicio`. Assim, acrescentar as construções nunca piora
//! nenhum caso.

use crate::cartela::Cartela;
use crate::problema::Problema;

/// Um ponto de partida construído por fórmula.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Semente {
    pub cartelas: Vec<Cartela>,
    /// Como foi construída, para aparecer na tela e nos registros.
    pub origem: String,
}

/// Corpo finito `GF(q)`, com `q = pⁿ`.
///
/// Os elementos são os inteiros `0..q`, lidos como os dígitos de um polinômio na
/// base `p`: o valor `a₀ + a₁·p + a₂·p²` representa `a₀ + a₁x + a₂x²`. Somar é
/// somar os dígitos módulo `p`; multiplicar é multiplicar os polinômios e
/// reduzir por um polinômio irredutível de grau `n`.
///
/// As duas tabelas são construídas na criação. Com `q ≤ 128` elas têm no máximo
/// 16.384 posições — nada perto de caro, e consultá-las é um acesso a vetor.
pub struct CorpoFinito {
    q: usize,
    soma: Vec<u8>,
    produto: Vec<u8>,
}

impl CorpoFinito {
    /// Constrói `GF(q)`, ou devolve `None` se `q` não é potência de primo — caso
    /// em que corpo nenhum existe, e portanto plano nenhum.
    pub fn novo(q: usize) -> Option<Self> {
        let (p, n) = fatorar_potencia_de_primo(q)?;

        let mut soma = vec![0u8; q * q];
        for a in 0..q {
            for b in 0..q {
                let mut resultado = 0usize;
                let mut peso = 1usize;
                for i in 0..n {
                    let digito = (digito(a, p, i) + digito(b, p, i)) % p;
                    resultado += digito * peso;
                    peso *= p;
                }
                soma[a * q + b] = resultado as u8;
            }
        }

        // Procura um polinômio irredutível por tentativa, e confirma a escolha
        // pela propriedade que realmente importa: num corpo, produto de dois
        // elementos não nulos nunca dá zero. Isso dispensa uma tabela de
        // polinômios escrita à mão — que é exatamente o tipo de constante que
        // ninguém revisa e que quebra silenciosamente.
        for candidato in 0..q {
            let produto = tabela_de_produto(q, p, n, candidato);
            if sem_divisores_de_zero(&produto, q) {
                return Some(Self { q, soma, produto });
            }
        }
        None
    }

    pub fn tamanho(&self) -> usize {
        self.q
    }

    pub fn somar(&self, a: usize, b: usize) -> usize {
        self.soma[a * self.q + b] as usize
    }

    pub fn multiplicar(&self, a: usize, b: usize) -> usize {
        self.produto[a * self.q + b] as usize
    }
}

/// `i`-ésimo dígito de `valor` na base `p`.
fn digito(valor: usize, p: usize, i: usize) -> usize {
    let mut restante = valor;
    for _ in 0..i {
        restante /= p;
    }
    restante % p
}

/// Decompõe `q` em `(p, n)` com `q = pⁿ`, ou `None` se `q` não é potência de um
/// único primo.
fn fatorar_potencia_de_primo(q: usize) -> Option<(usize, usize)> {
    if q < 2 {
        return None;
    }
    let mut p = 2;
    while p * p <= q {
        if q % p == 0 {
            break;
        }
        p += 1;
    }
    if p * p > q {
        return Some((q, 1)); // q é primo
    }

    let mut restante = q;
    let mut n = 0;
    while restante % p == 0 {
        restante /= p;
        n += 1;
    }
    if restante == 1 {
        Some((p, n))
    } else {
        None
    }
}

/// Tabela de multiplicação do anel `GF(p)[x] / (f)`, onde `f` é o polinômio
/// mônico de grau `n` cujos coeficientes de grau menor estão codificados em
/// `resto` — isto é, `xⁿ ≡ resto`.
fn tabela_de_produto(q: usize, p: usize, n: usize, resto: usize) -> Vec<u8> {
    let mut tabela = vec![0u8; q * q];
    let mut acumulador = vec![0usize; 2 * n];

    for a in 0..q {
        for b in 0..q {
            acumulador.iter_mut().for_each(|c| *c = 0);

            for i in 0..n {
                let ai = digito(a, p, i);
                if ai == 0 {
                    continue;
                }
                for j in 0..n {
                    acumulador[i + j] = (acumulador[i + j] + ai * digito(b, p, j)) % p;
                }
            }

            // Reduz de cima para baixo: cada xᵐ com m ≥ n vira `resto · xᵐ⁻ⁿ`.
            for grau in (n..2 * n - 1).rev() {
                let coeficiente = acumulador[grau];
                if coeficiente == 0 {
                    continue;
                }
                acumulador[grau] = 0;
                for j in 0..n {
                    let alvo = grau - n + j;
                    acumulador[alvo] =
                        (acumulador[alvo] + coeficiente * digito(resto, p, j)) % p;
                }
            }

            let mut valor = 0usize;
            let mut peso = 1usize;
            for &coeficiente in acumulador.iter().take(n) {
                valor += coeficiente * peso;
                peso *= p;
            }
            tabela[a * q + b] = valor as u8;
        }
    }
    tabela
}

/// Verdadeiro quando nenhum par de elementos não nulos multiplica a zero — a
/// definição operacional de "isto é um corpo, não só um anel".
fn sem_divisores_de_zero(tabela: &[u8], q: usize) -> bool {
    for a in 1..q {
        for b in 1..q {
            if tabela[a * q + b] == 0 {
                return false;
            }
        }
    }
    true
}

/// Retas do plano projetivo `PG(2, q)`, como listas de índices de pontos.
///
/// São `q²+q+1` pontos e `q²+q+1` retas, cada reta com `q+1` pontos, e cada par
/// de pontos em exatamente uma reta — que é precisamente o que um covering
/// design `C(q²+q+1, q+1, 2)` pede, sem uma única repetição.
///
/// Pontos e retas são as mesmas `q²+q+1` classes `[a:b:c]`; a reta `[a:b:c]` é o
/// conjunto dos pontos `[x:y:z]` com `ax + by + cz = 0`.
pub fn plano_projetivo(q: usize) -> Option<Vec<Vec<usize>>> {
    let corpo = CorpoFinito::novo(q)?;
    let pontos = representantes_projetivos(q);
    debug_assert_eq!(pontos.len(), q * q + q + 1);

    let mut retas = Vec::with_capacity(pontos.len());
    for reta in &pontos {
        let mut membros = Vec::with_capacity(q + 1);
        for (indice, ponto) in pontos.iter().enumerate() {
            let mut soma = 0;
            for eixo in 0..3 {
                soma = corpo.somar(soma, corpo.multiplicar(reta[eixo], ponto[eixo]));
            }
            if soma == 0 {
                membros.push(indice);
            }
        }
        if membros.len() != q + 1 {
            return None;
        }
        retas.push(membros);
    }
    Some(retas)
}

/// Representantes canônicos das direções de `GF(q)³`: `(1,y,z)`, depois
/// `(0,1,z)`, depois `(0,0,1)`. Cada direção aparece uma única vez.
fn representantes_projetivos(q: usize) -> Vec<[usize; 3]> {
    let mut pontos = Vec::with_capacity(q * q + q + 1);
    for y in 0..q {
        for z in 0..q {
            pontos.push([1, y, z]);
        }
    }
    for z in 0..q {
        pontos.push([0, 1, z]);
    }
    pontos.push([0, 0, 1]);
    pontos
}

/// Retas do plano afim `AG(2, q)`.
///
/// `q²` pontos `(x,y)`, indexados por `x·q + y`, e `q²+q` retas de `q` pontos:
/// as `q²` retas `y = m·x + c` e as `q` verticais `x = c`. Também aqui cada par
/// de pontos cai em exatamente uma reta.
pub fn plano_afim(q: usize) -> Option<Vec<Vec<usize>>> {
    let corpo = CorpoFinito::novo(q)?;

    let mut retas = Vec::with_capacity(q * q + q);
    for m in 0..q {
        for c in 0..q {
            let reta = (0..q)
                .map(|x| x * q + corpo.somar(corpo.multiplicar(m, x), c))
                .collect();
            retas.push(reta);
        }
    }
    for c in 0..q {
        retas.push((0..q).map(|y| c * q + y).collect());
    }
    Some(retas)
}

/// Divide o pool em `⌈p/k⌉` blocos de `k` elementos.
///
/// Resolve exatamente o caso `t = 1` — "todo elemento do pool aparece em alguma
/// cartela" — e atinge a cota de Schönheim, portanto é ótimo provado. O último
/// bloco é completado com elementos já usados, porque a cartela precisa ter
/// exatamente `k` elementos.
fn particao(p: usize, k: usize) -> Vec<Vec<usize>> {
    let mut blocos = Vec::new();
    let mut inicio = 0;
    while inicio < p {
        let mut bloco: Vec<usize> = (inicio..(inicio + k).min(p)).collect();
        let mut extra = 0;
        while bloco.len() < k {
            if !bloco.contains(&extra) {
                bloco.push(extra);
            }
            extra += 1;
        }
        blocos.push(bloco);
        inicio += k;
    }
    blocos
}

/// Ajusta blocos construídos sobre `pontos_do_plano` para um pool de `p`
/// elementos, com cartelas de exatamente `k`.
///
/// Descarta os pontos que não existem no pool e recompleta os blocos curtos.
/// Blocos que ficaram iguais são fundidos — a truncagem cria repetições, e
/// mandá-las para o motor só daria trabalho de poda depois.
fn truncar(blocos: Vec<Vec<usize>>, p: usize, k: usize) -> Vec<Cartela> {
    let mut vistas = std::collections::HashSet::new();
    let mut cartelas = Vec::with_capacity(blocos.len());

    for bloco in blocos {
        let mut cartela = Cartela::vazia();
        let mut tamanho = 0;
        for indice in bloco {
            if indice < p {
                cartela.inserir(indice);
                tamanho += 1;
            }
        }
        // Recompleta com os menores índices livres. Qualquer escolha serve para
        // a validade; a mais previsível serve melhor para depurar.
        let mut extra = 0;
        while tamanho < k && extra < p {
            if !cartela.contem(extra) {
                cartela.inserir(extra);
                tamanho += 1;
            }
            extra += 1;
        }
        if tamanho == k && vistas.insert(cartela) {
            cartelas.push(cartela);
        }
    }
    cartelas
}

/// O melhor ponto de partida que uma fórmula consegue dar para este problema,
/// ou `None` quando nenhuma construção se aplica.
///
/// Só covering designs (`alvo == intersecao`) entram aqui: as construções cobrem
/// *pares contidos em retas*, e com garantia parcial o problema é outro.
pub fn semente_algebrica(problema: &Problema) -> Option<Semente> {
    let regra = problema.regra();
    if !regra.e_covering_design() {
        return None;
    }

    let p = problema.tamanho_pool();
    let k = problema.tamanho_cartela();
    let t = regra.intersecao;

    if k >= p {
        // Uma cartela contém o pool inteiro; não há o que otimizar.
        return Some(Semente {
            cartelas: vec![Cartela::dos_indices(&(0..k.min(p)).collect::<Vec<_>>())],
            origem: "cartela única".to_string(),
        });
    }

    if t == 1 {
        return Some(Semente {
            cartelas: truncar(particao(p, k), p, k),
            origem: "partição do pool".to_string(),
        });
    }

    if t != 2 {
        return None;
    }

    // Menor plano que ainda comporta o pool. Quanto mais justo o encaixe, menos
    // folga a truncagem deixa.
    let projetivo = (2..=12).contains(&k).then(|| k - 1).filter(|&q| q * q + q + 1 >= p);
    let afim = (k <= 12).then_some(k).filter(|&q| q * q >= p);

    if let Some(q) = projetivo {
        if let Some(retas) = plano_projetivo(q) {
            return Some(Semente {
                cartelas: truncar(retas, p, k),
                origem: format!("plano projetivo PG(2,{q})"),
            });
        }
    }
    if let Some(q) = afim {
        if let Some(retas) = plano_afim(q) {
            return Some(Semente {
                cartelas: truncar(retas, p, k),
                origem: format!("plano afim AG(2,{q})"),
            });
        }
    }
    None
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::cobertura::MotorCobertura;
    use crate::problema::{Objetivo, RegraCobertura};
    use crate::referencia;
    use crate::solucao::Solucao;

    /// Potências de primo com `q ≤ 11`: acima disso nem o plano afim cabe num
    /// pool de 128 elementos.
    const ORDENS: [usize; 8] = [2, 3, 4, 5, 7, 8, 9, 11];

    #[test]
    fn os_corpos_finitos_tem_as_propriedades_de_corpo() {
        for q in ORDENS {
            let corpo = CorpoFinito::novo(q).unwrap_or_else(|| panic!("GF({q}) deveria existir"));

            for a in 0..q {
                assert_eq!(corpo.somar(a, 0), a, "GF({q}): 0 não é neutro da soma");
                assert_eq!(corpo.multiplicar(a, 1), a, "GF({q}): 1 não é neutro do produto");
                assert_eq!(corpo.multiplicar(a, 0), 0, "GF({q}): 0 absorvente falhou");

                // Todo elemento não nulo tem inverso.
                if a != 0 {
                    assert!(
                        (0..q).any(|b| corpo.multiplicar(a, b) == 1),
                        "GF({q}): {a} não tem inverso"
                    );
                }
                // E oposto aditivo.
                assert!((0..q).any(|b| corpo.somar(a, b) == 0), "GF({q}): {a} não tem oposto");
            }

            // Distributividade, numa amostra completa para os corpos pequenos.
            for a in 0..q {
                for b in 0..q {
                    for c in 0..q {
                        assert_eq!(
                            corpo.multiplicar(a, corpo.somar(b, c)),
                            corpo.somar(corpo.multiplicar(a, b), corpo.multiplicar(a, c)),
                            "GF({q}): distributividade falhou em ({a},{b},{c})"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn nao_existe_corpo_de_ordem_composta() {
        for q in [6, 10, 12, 14, 15] {
            assert!(CorpoFinito::novo(q).is_none(), "GF({q}) não existe");
        }
    }

    /// Confere que um conjunto de blocos cobre de fato todos os `t`-subconjuntos
    /// — pela contabilidade do motor, não pela fórmula que os gerou.
    fn cobre_tudo(p: usize, k: usize, t: usize, cartelas: &[Cartela]) -> bool {
        let problema = crate::problema::Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::cobrir_subconjuntos(t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let motor = MotorCobertura::novo(&problema).unwrap();
        let mut solucao = Solucao::vazia(&motor);
        let mut rascunho = crate::cobertura::Rascunho::novo();
        for &cartela in cartelas {
            solucao.adicionar(&motor, cartela, &mut rascunho);
        }
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
        solucao.cobertura_total()
    }

    #[test]
    fn os_planos_projetivos_sao_coberturas_validas_e_otimas() {
        for q in ORDENS {
            let v = q * q + q + 1;
            if v > 128 {
                continue;
            }
            let retas = plano_projetivo(q).unwrap_or_else(|| panic!("PG(2,{q}) deveria existir"));
            assert_eq!(retas.len(), v, "PG(2,{q}) tem que ter {v} retas");

            let cartelas: Vec<Cartela> =
                retas.iter().map(|r| Cartela::dos_indices(r)).collect();
            assert!(cobre_tudo(v, q + 1, 2, &cartelas), "PG(2,{q}) não cobriu todos os pares");

            // E o tamanho tem de bater com o melhor conhecido no mundo.
            let r = referencia::consultar(v, q + 1, 2).unwrap();
            assert_eq!(
                retas.len() as u64,
                r.melhor_conhecido,
                "PG(2,{q}) deveria igualar o melhor conhecido de C({v},{},2)",
                q + 1
            );
            assert!(r.resolvido(), "C({v},{},2) deveria ser ótimo provado", q + 1);
        }
    }

    #[test]
    fn os_planos_afins_sao_coberturas_validas_e_otimas() {
        for q in ORDENS {
            let v = q * q;
            if v > 128 || q < 2 {
                continue;
            }
            let retas = plano_afim(q).unwrap_or_else(|| panic!("AG(2,{q}) deveria existir"));
            assert_eq!(retas.len(), v + q, "AG(2,{q}) tem que ter {} retas", v + q);

            let cartelas: Vec<Cartela> =
                retas.iter().map(|r| Cartela::dos_indices(r)).collect();
            assert!(cobre_tudo(v, q, 2, &cartelas), "AG(2,{q}) não cobriu todos os pares");

            if let Some(r) = referencia::consultar(v, q, 2) {
                assert_eq!(
                    retas.len() as u64,
                    r.melhor_conhecido,
                    "AG(2,{q}) deveria igualar o melhor conhecido de C({v},{q},2)"
                );
            }
        }
    }

    fn problema_de(p: usize, k: usize, t: usize) -> crate::problema::Problema {
        crate::problema::Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::cobrir_subconjuntos(t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap()
    }

    #[test]
    fn a_semente_resolve_os_dois_casos_que_a_busca_nao_alcancava() {
        // O motivo de existir deste módulo.
        for (p, k, otimo) in [(21, 5, 21), (25, 5, 30)] {
            let semente = semente_algebrica(&problema_de(p, k, 2)).expect("há construção");
            assert!(cobre_tudo(p, k, 2, &semente.cartelas), "C({p},{k},2) não ficou coberto");
            assert_eq!(
                semente.cartelas.len(),
                otimo,
                "C({p},{k},2) deveria sair com {otimo} cartelas por construção, saiu com {} ({})",
                semente.cartelas.len(),
                semente.origem
            );
        }
    }

    #[test]
    fn a_semente_truncada_continua_cobrindo_tudo() {
        // A truncagem é onde um erro passaria despercebido: o número de cartelas
        // parece razoável e a cobertura tem um buraco. Varre toda a faixa.
        for k in 3..=9 {
            for p in (k + 1)..=((k - 1) * (k - 1) + k).min(90) {
                let Some(semente) = semente_algebrica(&problema_de(p, k, 2)) else { continue };
                assert!(
                    cobre_tudo(p, k, 2, &semente.cartelas),
                    "C({p},{k},2) por {} deixou par descoberto",
                    semente.origem
                );
            }
        }
    }

    #[test]
    fn a_particao_resolve_o_caso_t_igual_a_um() {
        for (p, k) in [(10, 3), (16, 4), (25, 5), (13, 13)] {
            let semente = semente_algebrica(&problema_de(p, k, 1)).expect("há construção");
            assert!(cobre_tudo(p, k, 1, &semente.cartelas));
            assert_eq!(semente.cartelas.len(), p.div_ceil(k), "C({p},{k},1) = ⌈p/k⌉");
        }
    }

    #[test]
    fn garantia_parcial_nao_recebe_semente() {
        // A tabela e as construções falam de covering design. Com `alvo >
        // intersecao` o problema é outro, e inventar uma resposta seria pior que
        // não ter nenhuma.
        let problema = crate::problema::Problema::com_pool_inicial(
            20,
            20,
            6,
            RegraCobertura::garantia(6, 4),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        assert!(semente_algebrica(&problema).is_none());
    }
}
