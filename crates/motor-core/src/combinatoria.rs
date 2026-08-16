//! Utilidades combinatórias de baixo nível.
//!
//! Duas peças sustentam todo o resto do motor:
//!
//! 1. **Binomiais pré-calculados** — `C(n, k)` é consultado milhões de vezes por
//!    segundo, então nunca deve ser recalculado.
//! 2. **Ranqueamento colex** — dá a cada subconjunto de tamanho `j` um índice
//!    único e denso em `0..C(p, j)`. É isso que permite representar a cobertura
//!    como um vetor plano indexado por inteiro, em vez de um mapa de conjuntos.

/// Tabela de coeficientes binomiais `C(n, k)`.
///
/// Valores que estourariam `u64` são saturados. Isso é seguro porque qualquer
/// configuração cujo binomial chegue perto de `u64::MAX` já é inviável de
/// enumerar muito antes — a checagem de viabilidade rejeita esses casos antes
/// de qualquer alocação.
#[derive(Debug, Clone)]
pub struct Binomiais {
    n_max: usize,
    k_max: usize,
    largura: usize,
    tabela: Vec<u64>,
}

impl Binomiais {
    /// Pré-calcula todos os `C(n, k)` com `n <= n_max` e `k <= k_max`.
    pub fn novo(n_max: usize, k_max: usize) -> Self {
        let largura = k_max + 1;
        let mut tabela = vec![0u64; (n_max + 1) * largura];

        for n in 0..=n_max {
            for k in 0..=k_max {
                let valor = if k == 0 {
                    1
                } else if k > n {
                    0
                } else {
                    let acima_esq = tabela[(n - 1) * largura + (k - 1)];
                    let acima = tabela[(n - 1) * largura + k];
                    acima_esq.saturating_add(acima)
                };
                tabela[n * largura + k] = valor;
            }
        }

        Self { n_max, k_max, largura, tabela }
    }

    /// `C(n, k)`, retornando 0 quando `k > n` e para consultas fora da tabela.
    #[inline]
    pub fn c(&self, n: usize, k: usize) -> u64 {
        if k > n || n > self.n_max || k > self.k_max {
            // `k > n` é legitimamente zero. Fora da tabela também devolve zero,
            // mas isso indica uso incorreto: a tabela deve ser dimensionada
            // para cobrir todas as consultas do problema.
            return 0;
        }
        self.tabela[n * self.largura + k]
    }

    pub fn n_max(&self) -> usize {
        self.n_max
    }

    pub fn k_max(&self) -> usize {
        self.k_max
    }
}

/// Índice colex (ordem colexicográfica) de um subconjunto.
///
/// Dado um subconjunto ordenado de forma crescente `a_0 < a_1 < ... < a_{j-1}`
/// com elementos em `0..p`, seu índice é:
///
/// ```text
/// indice = Σ  C(a_i, i + 1)
/// ```
///
/// A imagem é exatamente `0..C(p, j)`, sem buracos, o que permite usar o índice
/// diretamente como posição em um vetor.
#[inline]
pub fn indice_colex(binom: &Binomiais, subconjunto: &[usize]) -> u64 {
    let mut indice = 0u64;
    for (i, &elemento) in subconjunto.iter().enumerate() {
        indice += binom.c(elemento, i + 1);
    }
    indice
}

/// Operação inversa de [`indice_colex`]: reconstrói o subconjunto a partir do índice.
///
/// Escreve `j` elementos em ordem crescente dentro de `saida`.
pub fn subconjunto_do_indice(binom: &Binomiais, mut indice: u64, j: usize, saida: &mut Vec<usize>) {
    saida.clear();
    saida.resize(j, 0);

    // Percorre das posições mais altas para as mais baixas, escolhendo em cada
    // passo o maior elemento cujo binomial ainda cabe no índice restante.
    for i in (1..=j).rev() {
        let mut elemento = i - 1;
        while binom.c(elemento + 1, i) <= indice {
            elemento += 1;
        }
        saida[i - 1] = elemento;
        indice -= binom.c(elemento, i);
    }
}

/// Preenche `estado` com a primeira combinação de `k` índices: `[0, 1, ..., k-1]`.
///
/// Par de [`proxima_combinacao`]. As duas juntas percorrem combinações sem
/// alocar nada, que é o que permite usá-las no laço quente do motor.
#[inline]
pub fn iniciar_combinacao(k: usize, estado: &mut Vec<usize>) {
    estado.clear();
    estado.extend(0..k);
}

/// Avança `estado` para a próxima combinação de `k` índices em `0..n`.
///
/// Devolve `false` quando a última combinação já foi visitada. `estado` precisa
/// ter sido inicializado por [`iniciar_combinacao`] e ter exatamente `k`
/// posições.
#[inline]
pub fn proxima_combinacao(n: usize, k: usize, estado: &mut [usize]) -> bool {
    debug_assert_eq!(estado.len(), k);
    if k == 0 || k > n {
        return false;
    }

    // Posição mais à direita que ainda não chegou ao seu valor máximo.
    let mut i = k;
    loop {
        if i == 0 {
            return false;
        }
        i -= 1;
        if estado[i] < n - k + i {
            break;
        }
    }

    estado[i] += 1;
    for pos in (i + 1)..k {
        estado[pos] = estado[pos - 1] + 1;
    }
    true
}

/// Iterador sobre todas as combinações de `k` índices tomados de `0..n`,
/// em ordem lexicográfica crescente.
///
/// Fachada ergonômica sobre [`iniciar_combinacao`] / [`proxima_combinacao`],
/// para uso fora do laço quente.
pub struct Combinacoes {
    n: usize,
    k: usize,
    atual: Vec<usize>,
    iniciado: bool,
    esgotado: bool,
}

impl Combinacoes {
    pub fn nova(n: usize, k: usize) -> Self {
        Self {
            n,
            k,
            atual: Vec::with_capacity(k),
            iniciado: false,
            esgotado: k > n,
        }
    }

    /// Avança para a próxima combinação. Devolve `None` quando esgota.
    ///
    /// Para `k == 0` produz exatamente uma combinação: a vazia.
    pub fn proxima(&mut self) -> Option<&[usize]> {
        if self.esgotado {
            return None;
        }

        if !self.iniciado {
            self.iniciado = true;
            iniciar_combinacao(self.k, &mut self.atual);
            return Some(&self.atual);
        }

        if proxima_combinacao(self.n, self.k, &mut self.atual) {
            Some(&self.atual)
        } else {
            self.esgotado = true;
            None
        }
    }
}

/// Divisão inteira arredondando para cima.
#[inline]
pub fn div_teto(a: u64, b: u64) -> u64 {
    debug_assert!(b != 0);
    a.div_ceil(b)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn binomiais_conferem_com_valores_conhecidos() {
        let b = Binomiais::novo(60, 20);
        assert_eq!(b.c(0, 0), 1);
        assert_eq!(b.c(5, 0), 1);
        assert_eq!(b.c(5, 6), 0);
        assert_eq!(b.c(5, 2), 10);
        assert_eq!(b.c(10, 3), 120);
        assert_eq!(b.c(20, 6), 38760);
        assert_eq!(b.c(25, 15), 3268760);
        assert_eq!(b.c(60, 6), 50063860);
    }

    #[test]
    fn indice_colex_e_denso_e_biunivoco() {
        // Para cada (p, j) pequeno, os índices dos C(p, j) subconjuntos devem
        // ser exatamente a faixa 0..C(p, j), cada um aparecendo uma única vez.
        let binom = Binomiais::novo(14, 14);

        for p in 1..=12usize {
            for j in 0..=p.min(5) {
                let total = binom.c(p, j) as usize;
                let mut vistos = vec![false; total];

                let mut combos = Combinacoes::nova(p, j);
                let mut contados = 0;
                while let Some(sub) = combos.proxima() {
                    let idx = indice_colex(&binom, sub) as usize;
                    assert!(idx < total, "índice {idx} fora da faixa para C({p},{j})={total}");
                    assert!(!vistos[idx], "índice {idx} repetido para C({p},{j})");
                    vistos[idx] = true;
                    contados += 1;
                }

                assert_eq!(contados, total, "contagem de combinações errada para C({p},{j})");
                assert!(vistos.iter().all(|&v| v), "faixa de índices tem buracos em C({p},{j})");
            }
        }
    }

    #[test]
    fn desranquear_inverte_ranquear() {
        let binom = Binomiais::novo(20, 20);
        let mut recuperado = Vec::new();

        for j in 1..=4usize {
            let mut combos = Combinacoes::nova(15, j);
            while let Some(sub) = combos.proxima() {
                let idx = indice_colex(&binom, sub);
                subconjunto_do_indice(&binom, idx, j, &mut recuperado);
                assert_eq!(recuperado.as_slice(), sub, "desranqueamento divergiu no índice {idx}");
            }
        }
    }

    #[test]
    fn combinacoes_de_tamanho_zero_produzem_o_conjunto_vazio() {
        let mut combos = Combinacoes::nova(5, 0);
        assert_eq!(combos.proxima(), Some(&[][..]));
        assert_eq!(combos.proxima(), None);
    }

    #[test]
    fn combinacoes_maiores_que_o_universo_nao_produzem_nada() {
        let mut combos = Combinacoes::nova(3, 4);
        assert_eq!(combos.proxima(), None);
    }
}
