//! O modelo formal, e o verificador.
//!
//! Um fechamento é descrito por **cinco** números:
//!
//! ```text
//!   v   quantos números existem no seu pool
//!   k   quantos números em cada cartela
//!   j   quantos números são sorteados
//!   t   quantos deles uma cartela premiada precisa conter
//!   r   quantas cartelas precisam estar premiadas, e não apenas uma
//! ```
//!
//! Um alvo é um sorteio possível — um subconjunto de `j` elementos do pool. Uma
//! cartela **atende** um alvo quando compartilha ao menos `t` números com ele, e
//! o fechamento está correto quando todo alvo é atendido por ao menos `r`
//! cartelas distintas.
//!
//! ## Por que cinco e não três
//!
//! Quando `j == t` o problema é exatamente um *covering design* `C(v,k,t)` da
//! literatura: todo subconjunto de `t` cai **inteiro** dentro de alguma cartela.
//! É o caso bonito, onde cotas fortes existem — e era o único que este crate
//! sabia descrever.
//!
//! Só que o uso mais comum é outro: *saem 15, quero garantir 13*. Ali `j` e `t`
//! são diferentes, e nenhum arranjo dos três números antigos consegue dizer
//! isso. Separá-los não é generalidade gratuita: é a diferença entre o modelo
//! descrever o problema de quem usa ou não descrever.
//!
//! ## As máscaras
//!
//! Tudo aqui é máscara de bits num `u32`. O bit `i` ligado quer dizer "contém o
//! elemento `i`". Atender vira `and` e `count_ones`, que são duas instruções de
//! processador — e `v ≤ 31` porque acima disso nem os alvos nem as cartelas
//! candidatas caberiam na memória de um aparelho.

use serde::{Deserialize, Serialize};

/// Um bloco, como máscara de bits. O bit `i` ligado quer dizer "contém `i`".
pub type Bloco = u32;

/// O maior universo que cabe na máscara.
pub const MAIOR_UNIVERSO: usize = 31;

/// Acima disto a lista de alvos não cabe na memória de um celular.
pub const TETO_DE_ALVOS: usize = 4_000_000;

/// Acima disto a lista de cartelas candidatas não cabe.
///
/// A guarda não existia, e a falta dela era um travamento à espera: `blocos()`
/// alocava `C(v,k)` máscaras sem perguntar, e `C(25,12)` já são 5 milhões.
pub const TETO_DE_BLOCOS: usize = 4_000_000;

/// Mais cartelas premiadas do que isto não descreve um pedido de ninguém.
pub const TETO_DE_PREMIADAS: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Problema {
    /// `v` — quantos elementos existem no pool.
    pub v: usize,
    /// `k` — quantos elementos em cada cartela.
    pub k: usize,
    /// `j` — quantos elementos são sorteados.
    pub j: usize,
    /// `t` — quantos deles uma cartela premiada precisa conter.
    pub t: usize,
    /// `r` — quantas cartelas precisam atender cada alvo.
    pub r: usize,
}

/// Por que um pedido não descreve um problema.
///
/// Cada variante existe porque a mensagem que ela produz é diferente. "Inválido"
/// manda a pessoa adivinhar; "a cartela não cabe no universo" ela conserta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDoProblema {
    UniversoGrandeDemais { v: usize },
    NumerosNaoPositivos,
    CartelaMaiorQueOUniverso { k: usize, v: usize },
    SorteioMaiorQueOUniverso { j: usize, v: usize },
    GarantiaMaiorQueACartela { t: usize, k: usize },
    GarantiaMaiorQueOSorteio { t: usize, j: usize },
    PremiadasAlemDoPossivel { r: usize, teto: usize },
    AlvosDemais { quantos: u128 },
    BlocosDemais { quantos: u128 },
}

impl std::fmt::Display for ErroDoProblema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroDoProblema::UniversoGrandeDemais { v } => write!(
                f,
                "o pool tem {v} números, e o limite é {MAIOR_UNIVERSO} — acima disso a \
                 enumeração não cabe na memória"
            ),
            ErroDoProblema::NumerosNaoPositivos => {
                write!(f, "todos os números precisam ser inteiros maiores que zero")
            }
            ErroDoProblema::CartelaMaiorQueOUniverso { k, v } => {
                write!(f, "a cartela tem {k} números e o pool só tem {v}: ela não cabe")
            }
            ErroDoProblema::SorteioMaiorQueOUniverso { j, v } => {
                write!(f, "o sorteio tira {j} números de um pool de {v}: não há de onde tirar")
            }
            ErroDoProblema::GarantiaMaiorQueACartela { t, k } => write!(
                f,
                "a garantia pede {t} acertos numa cartela de {k} números: nenhuma cartela consegue"
            ),
            ErroDoProblema::GarantiaMaiorQueOSorteio { t, j } => write!(
                f,
                "a garantia pede {t} acertos, e só saem {j} números: não há {t} para acertar"
            ),
            ErroDoProblema::PremiadasAlemDoPossivel { r, teto } => write!(
                f,
                "você pediu {r} cartelas premiadas, e só existem {teto} cartelas distintas capazes \
                 de atender um mesmo sorteio — acima disso só repetindo cartela"
            ),
            ErroDoProblema::AlvosDemais { quantos } => write!(
                f,
                "são {} sorteios possíveis a cobrir, e o teto é {} — o problema é grande \
                 demais para caber neste aparelho",
                milhares(*quantos),
                milhares(TETO_DE_ALVOS as u128)
            ),
            ErroDoProblema::BlocosDemais { quantos } => write!(
                f,
                "são {} cartelas possíveis para escolher, e o teto é {} — o problema é grande \
                 demais para caber neste aparelho",
                milhares(*quantos),
                milhares(TETO_DE_BLOCOS as u128)
            ),
        }
    }
}

/// Um número como se escreve em português: 5.200.300, e não 5200300.
///
/// Estas mensagens vão direto para a tela, e sete dígitos seguidos num aviso de
/// recusa são exatamente o tipo de coisa que faz alguém ler duas vezes sem
/// entender o tamanho do problema. O resto do aplicativo já separa os milhares;
/// aqui era o último lugar que não separava.
fn milhares(n: u128) -> String {
    let digitos = n.to_string();
    let mut saida = String::with_capacity(digitos.len() + digitos.len() / 3);
    for (i, d) in digitos.chars().enumerate() {
        if i > 0 && (digitos.len() - i) % 3 == 0 {
            saida.push('.');
        }
        saida.push(d);
    }
    saida
}

impl Problema {
    /// Recusa o que não descreve um problema, antes de qualquer conta.
    pub fn novo(
        v: usize,
        k: usize,
        j: usize,
        t: usize,
        r: usize,
    ) -> Result<Problema, ErroDoProblema> {
        if v == 0 || k == 0 || j == 0 || t == 0 || r == 0 {
            return Err(ErroDoProblema::NumerosNaoPositivos);
        }
        if v > MAIOR_UNIVERSO {
            return Err(ErroDoProblema::UniversoGrandeDemais { v });
        }
        if k > v {
            return Err(ErroDoProblema::CartelaMaiorQueOUniverso { k, v });
        }
        if j > v {
            return Err(ErroDoProblema::SorteioMaiorQueOUniverso { j, v });
        }
        if t > k {
            return Err(ErroDoProblema::GarantiaMaiorQueACartela { t, k });
        }
        if t > j {
            return Err(ErroDoProblema::GarantiaMaiorQueOSorteio { t, j });
        }

        let alvos = binomial(v, j);
        if alvos > TETO_DE_ALVOS as u128 {
            return Err(ErroDoProblema::AlvosDemais { quantos: alvos });
        }
        let blocos = binomial(v, k);
        if blocos > TETO_DE_BLOCOS as u128 {
            return Err(ErroDoProblema::BlocosDemais { quantos: blocos });
        }

        let p = Problema { v, k, j, t, r };
        // Mais cartelas premiadas do que cartelas capazes de atender um alvo é
        // um pedido que só se satisfaz repetindo cartela — o que soma custo sem
        // somar prêmio. Recusar aqui é mais honesto do que procurar para sempre.
        let teto = p.blocos_por_alvo().min(TETO_DE_PREMIADAS as u128) as usize;
        if r > teto {
            return Err(ErroDoProblema::PremiadasAlemDoPossivel { r, teto });
        }
        Ok(p)
    }

    /// O atalho do caso clássico: `C(v,k,t)`, uma cartela por alvo.
    ///
    /// Existe porque é o caso em que as cotas fortes valem, e porque metade dos
    /// testes deste crate fala nessa linguagem.
    pub fn cobertura(v: usize, k: usize, t: usize) -> Result<Problema, ErroDoProblema> {
        Problema::novo(v, k, t, t, 1)
    }

    /// Verdadeiro quando o problema é um covering design puro.
    ///
    /// É a pergunta que libera a cota de Schönheim e a elevação do subproblema:
    /// ambas falam de cobertura simples com `j == t`, e aplicá-las fora disso
    /// inventaria um piso.
    pub fn e_covering_design(&self) -> bool {
        self.j == self.t && self.r == 1
    }

    /// Quantos alvos existem: `C(v, j)`.
    pub fn total_de_alvos(&self) -> usize {
        binomial(self.v, self.j) as usize
    }

    /// Quantos blocos existem ao todo: `C(v, k)`.
    pub fn total_de_blocos(&self) -> u128 {
        binomial(self.v, self.k)
    }

    /// Quantos alvos uma única cartela atende.
    ///
    /// ```text
    /// Σ_{i=t}^{min(k,j)} C(k,i) · C(v−k, j−i)
    /// ```
    ///
    /// Escolhe-se `i` números dentro da cartela e `j−i` fora dela. No caso
    /// clássico (`j == t`) a soma tem um termo só e vira `C(k,t)`.
    pub fn alvos_por_bloco(&self) -> u128 {
        let mut total = 0u128;
        for i in self.t..=self.k.min(self.j) {
            total += binomial(self.k, i) * binomial(self.v - self.k, self.j - i);
        }
        total
    }

    /// Quantas cartelas distintas conseguem atender um mesmo alvo.
    ///
    /// ```text
    /// Σ_{i=t}^{min(k,j)} C(j,i) · C(v−j, k−i)
    /// ```
    ///
    /// É o número que decide se a construção é barata ou cara: ele é o tamanho
    /// da escolha em cada passo guloso. Num pool de 25 com jogos de 17 e
    /// garantia de 15 são **45** cartelas — contra 1.081.575 se fôssemos varrer
    /// todas.
    pub fn blocos_por_alvo(&self) -> u128 {
        let mut total = 0u128;
        for i in self.t..=self.k.min(self.j) {
            if self.k < i || self.k - i > self.v - self.j {
                continue;
            }
            total += binomial(self.j, i) * binomial(self.v - self.j, self.k - i);
        }
        total
    }

    /// Todos os alvos, como máscaras, em ordem colex.
    pub fn alvos(&self) -> Vec<Bloco> {
        combinacoes(self.v, self.j)
    }

    /// Todos os blocos candidatos, como máscaras.
    pub fn blocos(&self) -> Vec<Bloco> {
        combinacoes(self.v, self.k)
    }

    /// Uma cartela atende um alvo quando compartilha ao menos `t` números.
    pub fn atende(&self, alvo: Bloco, bloco: Bloco) -> bool {
        (alvo & bloco).count_ones() as usize >= self.t
    }

    /// **O verificador.** Quantos alvos ficam com menos de `r` cartelas.
    ///
    /// Zero quer dizer que o fechamento cumpre a garantia — e é esta varredura,
    /// e não a confiança em quem construiu, que autoriza dizer isso. Um
    /// construtor com defeito produz coleções plausíveis; só a conferência pega.
    ///
    /// A conta é feita por cartela, e não por alvo: cada cartela **gera** os
    /// alvos que atende, em vez de todos os alvos perguntarem a todas as
    /// cartelas. A diferença é `blocos × alvos_por_bloco` contra
    /// `blocos × alvos`, que num pool de 25 são 40 mil operações contra um
    /// bilhão.
    pub fn descobertos(&self, blocos: &[Bloco]) -> usize {
        let total = self.total_de_alvos();
        let mut vezes = vec![0u16; total];
        let gerador = AlvosDoBloco::novo(self);
        let alvo_r = self.r.min(u16::MAX as usize) as u16;
        for &b in blocos {
            gerador.para_cada(self, b, &mut |alvo| {
                let i = posicao_colex(alvo) as usize;
                if vezes[i] < alvo_r {
                    vezes[i] += 1;
                }
            });
        }
        vezes.iter().filter(|&&n| n < alvo_r).count()
    }

    /// Verdadeiro quando todo alvo é atendido por ao menos `r` cartelas.
    pub fn cobre(&self, blocos: &[Bloco]) -> bool {
        self.descobertos(blocos) == 0
    }
}

/// Gera os alvos que uma cartela atende, sem varrer a lista de alvos.
///
/// As tabelas dependem só dos tamanhos, não da cartela: montá-las uma vez e
/// reusá-las em todas é o que faz a geração custar `C(k,i)·C(v−k,j−i)` por
/// cartela em vez de `C(v,j)`.
pub struct AlvosDoBloco {
    /// Por `i`, as combinações de `i` posições dentro da cartela e as de `j−i`
    /// posições fora dela.
    fatias: Vec<(Vec<Bloco>, Vec<Bloco>)>,
}

impl AlvosDoBloco {
    pub fn novo(p: &Problema) -> AlvosDoBloco {
        let mut fatias = Vec::new();
        for i in p.t..=p.k.min(p.j) {
            if p.j - i > p.v - p.k {
                fatias.push((Vec::new(), Vec::new()));
                continue;
            }
            fatias.push((combinacoes(p.k, i), combinacoes(p.v - p.k, p.j - i)));
        }
        AlvosDoBloco { fatias }
    }

    /// Chama `f` uma vez para cada alvo que esta cartela atende.
    pub fn para_cada(&self, p: &Problema, bloco: Bloco, f: &mut impl FnMut(Bloco)) {
        let dentro = elementos(bloco, p.v);
        let fora = elementos(!bloco & mascara_cheia(p.v), p.v);
        for (dentro_do_i, fora_do_i) in &self.fatias {
            for &a in dentro_do_i {
                let parte = espalhar(a, &dentro);
                for &b in fora_do_i {
                    f(parte | espalhar(b, &fora));
                }
            }
        }
    }
}

/// Gera as cartelas capazes de atender um alvo, sem varrer a lista de cartelas.
///
/// É o espelho de [`AlvosDoBloco`], e é ele que torna a construção viável nos
/// tamanhos grandes: escolhe-se `i` números entre os `j` sorteados e `k−i` entre
/// os `v−j` de fora.
pub struct BlocosDoAlvo {
    fatias: Vec<(Vec<Bloco>, Vec<Bloco>)>,
}

impl BlocosDoAlvo {
    pub fn novo(p: &Problema) -> BlocosDoAlvo {
        let mut fatias = Vec::new();
        for i in p.t..=p.k.min(p.j) {
            if p.k < i || p.k - i > p.v - p.j {
                fatias.push((Vec::new(), Vec::new()));
                continue;
            }
            fatias.push((combinacoes(p.j, i), combinacoes(p.v - p.j, p.k - i)));
        }
        BlocosDoAlvo { fatias }
    }

    pub fn para_cada(&self, p: &Problema, alvo: Bloco, f: &mut impl FnMut(Bloco)) {
        let dentro = elementos(alvo, p.v);
        let fora = elementos(!alvo & mascara_cheia(p.v), p.v);
        for (dentro_do_i, fora_do_i) in &self.fatias {
            for &a in dentro_do_i {
                let parte = espalhar(a, &dentro);
                for &b in fora_do_i {
                    f(parte | espalhar(b, &fora));
                }
            }
        }
    }
}

/// A máscara com os `v` bits de baixo ligados.
pub fn mascara_cheia(v: usize) -> Bloco {
    if v >= 32 {
        u32::MAX
    } else {
        (1u32 << v) - 1
    }
}

/// Os elementos de uma máscara, em ordem crescente.
pub fn elementos(mascara: Bloco, v: usize) -> Vec<u8> {
    (0..v).filter(|&i| mascara >> i & 1 == 1).map(|i| i as u8).collect()
}

/// Traduz uma máscara de **posições** para uma máscara de elementos.
///
/// O bit `p` de `posicoes` ligado quer dizer "o `p`-ésimo da lista".
fn espalhar(posicoes: Bloco, lista: &[u8]) -> Bloco {
    let mut saida = 0;
    let mut restante = posicoes;
    while restante != 0 {
        let p = restante.trailing_zeros() as usize;
        restante &= restante - 1;
        saida |= 1 << lista[p];
    }
    saida
}

/// A posição de um subconjunto na ordem colexicográfica.
///
/// Para `{a₁ < a₂ < … < a_m}` a posição é `Σ C(aᵢ, i)`. É a numeração que a
/// enumeração de Gosper produz naturalmente — máscara crescente é ordem colex —
/// e é o que permite trocar "procurar o alvo na lista" por uma conta.
pub fn posicao_colex(mascara: Bloco) -> u128 {
    let mut posicao = 0u128;
    let mut restante = mascara;
    let mut i = 1usize;
    while restante != 0 {
        let a = restante.trailing_zeros() as usize;
        restante &= restante - 1;
        posicao += binomial(a, i);
        i += 1;
    }
    posicao
}

/// O caminho de volta: o subconjunto de `m` elementos que ocupa `posicao`.
pub fn combinacao_colex(mut posicao: u128, m: usize) -> Bloco {
    let mut saida = 0;
    for i in (1..=m).rev() {
        // O maior `a` com C(a, i) ≤ posicao.
        let mut a = i - 1;
        while binomial(a + 1, i) <= posicao {
            a += 1;
        }
        saida |= 1 << a;
        posicao -= binomial(a, i);
    }
    saida
}

/// A tabela de binomiais que torna o ranqueamento barato.
///
/// [`posicao_colex`] soma `j` binomiais por alvo, e calcular cada um com um laço
/// de divisões custaria mais do que gerar o alvo. Com a tabela pronta a posição
/// vira `j` somas — e é isso que permite marcar centenas de milhares de alvos
/// por cartela sem que a construção pare de andar.
pub struct Colex {
    /// `tabela[a * 32 + i]` é `C(a, i)`, saturado em `u32`.
    tabela: Vec<u32>,
}

impl Default for Colex {
    fn default() -> Colex {
        Colex::nova()
    }
}

impl Colex {
    pub fn nova() -> Colex {
        let mut tabela = vec![0u32; 32 * 32];
        for a in 0..32usize {
            for i in 0..32usize {
                tabela[a * 32 + i] = binomial(a, i).min(u32::MAX as u128) as u32;
            }
        }
        Colex { tabela }
    }

    /// A posição de uma máscara na ordem colexicográfica.
    pub fn posicao(&self, mascara: Bloco) -> u32 {
        let mut posicao = 0u32;
        let mut restante = mascara;
        let mut i = 1usize;
        while restante != 0 {
            let a = restante.trailing_zeros() as usize;
            restante &= restante - 1;
            posicao = posicao.wrapping_add(self.tabela[a * 32 + i]);
            i += 1;
        }
        posicao
    }
}

/// `C(n, k)` em `u128`, sem estourar nos tamanhos que este crate aceita.
pub fn binomial(n: usize, k: usize) -> u128 {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    let mut total: u128 = 1;
    for i in 0..k {
        total = total * (n - i) as u128 / (i as u128 + 1);
    }
    total
}

/// Todas as combinações de `k` elementos entre `n`, como máscaras.
///
/// Gera em ordem crescente de máscara pelo truque de Gosper: dado um número com
/// `k` bits ligados, o próximo com `k` bits é uma conta de três operações. Sem
/// recursão e sem alocar a cada passo.
pub fn combinacoes(n: usize, k: usize) -> Vec<Bloco> {
    let mut saida = Vec::new();
    if k > n || n > MAIOR_UNIVERSO || k == 0 {
        if k == 0 {
            saida.push(0);
        }
        return saida;
    }
    let limite: u32 = if n >= 32 { u32::MAX } else { (1u32 << n) - 1 };
    let mut atual: u32 = (1u32 << k) - 1;
    loop {
        saida.push(atual);
        if atual == 0 {
            break;
        }
        let menor = atual & atual.wrapping_neg();
        let Some(ondulacao) = atual.checked_add(menor) else { break };
        if ondulacao > limite {
            break;
        }
        atual = ondulacao | (((atual ^ ondulacao) >> 2) / menor);
        if atual > limite {
            break;
        }
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn as_combinacoes_saem_na_quantidade_certa_e_sem_repetir() {
        for n in 1..=14 {
            for k in 1..=n {
                let c = combinacoes(n, k);
                assert_eq!(c.len() as u128, binomial(n, k), "C({n},{k})");
                assert!(c.iter().all(|m| m.count_ones() as usize == k));
                let mut ordenadas = c.clone();
                ordenadas.sort_unstable();
                ordenadas.dedup();
                assert_eq!(ordenadas.len(), c.len(), "C({n},{k}) repetiu");
            }
        }
    }

    /// A numeração colex precisa concordar com a ordem em que as combinações
    /// saem, e precisa ter volta. Sem isso a cobertura não pode ser um vetor
    /// plano, e sem o vetor plano nada nos tamanhos grandes funciona.
    #[test]
    fn a_posicao_colex_e_a_ordem_da_enumeracao_e_tem_volta() {
        for n in 1..=14usize {
            for m in 1..=n {
                for (i, &mascara) in combinacoes(n, m).iter().enumerate() {
                    assert_eq!(posicao_colex(mascara), i as u128, "C({n},{m}) na posição {i}");
                    assert_eq!(combinacao_colex(i as u128, m), mascara, "volta de C({n},{m})");
                }
            }
        }
    }

    /// A tabela precisa concordar com a conta lenta, sempre. Se divergirem, os
    /// alvos passam a ser marcados na posição errada e nada acusa.
    #[test]
    fn a_tabela_colex_concorda_com_a_conta_lenta() {
        let colex = Colex::nova();
        for n in 1..=16usize {
            for m in 1..=n.min(6) {
                for &mascara in &combinacoes(n, m) {
                    assert_eq!(colex.posicao(mascara) as u128, posicao_colex(mascara));
                }
            }
        }
    }

    #[test]
    fn o_problema_recusa_o_que_nao_e_problema_e_diz_o_que_e() {
        assert!(matches!(
            Problema::cobertura(40, 5, 2),
            Err(ErroDoProblema::UniversoGrandeDemais { .. })
        ));
        assert!(matches!(
            Problema::cobertura(10, 20, 2),
            Err(ErroDoProblema::CartelaMaiorQueOUniverso { .. })
        ));
        assert!(matches!(
            Problema::cobertura(10, 3, 5),
            Err(ErroDoProblema::GarantiaMaiorQueACartela { .. })
        ));
        assert!(matches!(
            Problema::novo(10, 5, 3, 4, 1),
            Err(ErroDoProblema::GarantiaMaiorQueOSorteio { .. })
        ));
        assert!(matches!(
            Problema::novo(10, 5, 12, 3, 1),
            Err(ErroDoProblema::SorteioMaiorQueOUniverso { .. })
        ));
        assert!(matches!(
            Problema::cobertura(0, 3, 2),
            Err(ErroDoProblema::NumerosNaoPositivos)
        ));
        // E a mensagem diz os números, não só o tipo do erro.
        let erro = Problema::cobertura(10, 20, 2).unwrap_err().to_string();
        assert!(erro.contains("20") && erro.contains("10"), "{erro}");
    }

    #[test]
    fn os_tetos_recusam_antes_de_alocar() {
        // C(25,12) = 5.200.300 alvos: acima do teto.
        assert!(matches!(
            Problema::novo(25, 15, 12, 11, 1),
            Err(ErroDoProblema::AlvosDemais { .. })
        ));
        // E o teto de cartelas existe: era a guarda que faltava.
        assert!(matches!(
            Problema::novo(25, 12, 15, 11, 1),
            Err(ErroDoProblema::BlocosDemais { .. })
        ));
    }

    #[test]
    fn pedir_mais_premiadas_do_que_o_possivel_e_recusado_com_o_teto() {
        // Num pool de 18 com jogos de 17 e garantia de 15, poucas cartelas
        // distintas conseguem conter um mesmo sorteio.
        let p = Problema::novo(18, 17, 15, 15, 1).unwrap();
        let teto = p.blocos_por_alvo() as usize;
        assert!(teto >= 1);
        assert!(matches!(
            Problema::novo(18, 17, 15, 15, teto + 1),
            Err(ErroDoProblema::PremiadasAlemDoPossivel { .. })
        ));
    }

    /// As duas contagens fechadas precisam bater com a enumeração. São elas que
    /// sustentam a cota de contagem e a viabilidade da construção.
    #[test]
    fn as_contagens_batem_com_a_enumeracao() {
        for &(v, k, j, t) in &[(9, 4, 3, 2), (10, 5, 4, 3), (8, 3, 3, 2), (7, 3, 2, 2), (10, 6, 5, 4)]
        {
            let p = Problema::novo(v, k, j, t, 1).unwrap();
            let alvos = p.alvos();
            let blocos = p.blocos();

            let primeiro = blocos[0];
            let atendidos = alvos.iter().filter(|&&a| p.atende(a, primeiro)).count();
            assert_eq!(atendidos as u128, p.alvos_por_bloco(), "alvos por bloco em ({v},{k},{j},{t})");

            let primeiro_alvo = alvos[0];
            let capazes = blocos.iter().filter(|&&b| p.atende(primeiro_alvo, b)).count();
            assert_eq!(
                capazes as u128,
                p.blocos_por_alvo(),
                "blocos por alvo em ({v},{k},{j},{t})"
            );
        }
    }

    /// O gerador tem de produzir exatamente os alvos que a varredura acharia —
    /// nem um a mais, nem um a menos, sem repetir.
    #[test]
    fn o_gerador_de_alvos_concorda_com_a_varredura() {
        for &(v, k, j, t) in &[(9, 4, 3, 2), (10, 5, 4, 3), (8, 5, 4, 2), (7, 3, 2, 2)] {
            let p = Problema::novo(v, k, j, t, 1).unwrap();
            let gerador = AlvosDoBloco::novo(&p);
            let alvos = p.alvos();
            for &b in p.blocos().iter().take(8) {
                let mut gerados = Vec::new();
                gerador.para_cada(&p, b, &mut |a| gerados.push(a));
                gerados.sort_unstable();
                let repetidos = gerados.len();
                gerados.dedup();
                assert_eq!(repetidos, gerados.len(), "o gerador repetiu em ({v},{k},{j},{t})");

                let mut varridos: Vec<Bloco> =
                    alvos.iter().copied().filter(|&a| p.atende(a, b)).collect();
                varridos.sort_unstable();
                assert_eq!(gerados, varridos, "({v},{k},{j},{t}) bloco {b:b}");
            }
        }
    }

    #[test]
    fn o_gerador_de_blocos_concorda_com_a_varredura() {
        for &(v, k, j, t) in &[(9, 4, 3, 2), (10, 5, 4, 3), (8, 5, 4, 2), (7, 3, 2, 2)] {
            let p = Problema::novo(v, k, j, t, 1).unwrap();
            let gerador = BlocosDoAlvo::novo(&p);
            let blocos = p.blocos();
            for &a in p.alvos().iter().take(8) {
                let mut gerados = Vec::new();
                gerador.para_cada(&p, a, &mut |b| gerados.push(b));
                gerados.sort_unstable();
                let repetidos = gerados.len();
                gerados.dedup();
                assert_eq!(repetidos, gerados.len(), "o gerador repetiu em ({v},{k},{j},{t})");

                let mut varridos: Vec<Bloco> =
                    blocos.iter().copied().filter(|&b| p.atende(a, b)).collect();
                varridos.sort_unstable();
                assert_eq!(gerados, varridos, "({v},{k},{j},{t}) alvo {a:b}");
            }
        }
    }

    #[test]
    fn o_verificador_conta_o_que_falta_e_nao_confia_em_ninguem() {
        let p = Problema::cobertura(5, 3, 2).unwrap();
        assert_eq!(p.total_de_alvos(), 10);

        // Todos os blocos cobrem tudo, por definição.
        assert!(p.cobre(&p.blocos()));

        // Um bloco só cobre C(3,2) = 3 dos 10 pares.
        assert_eq!(p.descobertos(&[0b00111]), 7);

        // E o vazio não cobre nada.
        assert_eq!(p.descobertos(&[]), 10);
    }

    /// Com `r = 2` o mesmo fechamento que bastava deixa de bastar, e é o
    /// verificador — não a construção — que precisa notar.
    #[test]
    fn o_verificador_cobra_as_copias_pedidas() {
        let simples = Problema::novo(7, 3, 2, 2, 1).unwrap();
        let dobrado = Problema::novo(7, 3, 2, 2, 2).unwrap();
        let fano: Vec<Bloco> = [
            [0, 1, 2], [0, 3, 4], [0, 5, 6], [1, 3, 5], [1, 4, 6], [2, 3, 6], [2, 4, 5],
        ]
        .iter()
        .map(|linha| linha.iter().fold(0u32, |m, &i| m | 1 << i))
        .collect();
        assert!(simples.cobre(&fano));
        assert_eq!(dobrado.descobertos(&fano), 21, "cada par é coberto uma vez só");
        // Duas cópias de todos os blocos não existem (são conjuntos), mas todos
        // os blocos possíveis atendem cada par mais de uma vez.
        assert!(dobrado.cobre(&dobrado.blocos()));
    }

    #[test]
    fn um_plano_conhecido_e_reconhecido_como_cobertura() {
        // O plano de Fano: 7 blocos de 3 cobrindo todos os pares de 7 pontos.
        // É um sistema de Steiner, e portanto o mínimo de C(7,3,2).
        let p = Problema::cobertura(7, 3, 2).unwrap();
        let fano: Vec<Bloco> = [
            [0, 1, 2], [0, 3, 4], [0, 5, 6], [1, 3, 5], [1, 4, 6], [2, 3, 6], [2, 4, 5],
        ]
        .iter()
        .map(|linha| linha.iter().fold(0u32, |m, &i| m | 1 << i))
        .collect();
        assert_eq!(fano.len(), 7);
        assert!(p.cobre(&fano), "o plano de Fano precisa cobrir todos os 21 pares");

        // E tirar qualquer bloco quebra a cobertura — ele é justo.
        for i in 0..fano.len() {
            let mut sem = fano.clone();
            sem.remove(i);
            assert!(!p.cobre(&sem), "sem o bloco {i} ainda cobriria: não seria mínimo");
        }
    }

    /// A garantia parcial é o uso que o modelo antigo não sabia descrever.
    #[test]
    fn a_garantia_parcial_e_mais_facil_do_que_a_total() {
        // Saem 4 números, basta acertar 2: uma cartela sozinha já atende muito.
        let parcial = Problema::novo(9, 4, 4, 2, 1).unwrap();
        let total = Problema::novo(9, 4, 4, 4, 1).unwrap();
        assert!(
            parcial.alvos_por_bloco() > total.alvos_por_bloco(),
            "{} contra {}",
            parcial.alvos_por_bloco(),
            total.alvos_por_bloco()
        );
        assert!(!parcial.e_covering_design());
        assert!(total.e_covering_design());
    }
}
