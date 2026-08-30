//! O modelo formal, e o verificador.
//!
//! Um fechamento é um **covering design** `C(v, k, t)`: escolher blocos de `k`
//! elementos, entre `v`, de modo que todo subconjunto de `t` esteja contido em
//! algum bloco. Na linguagem de quem aposta: todo sorteio de `t` dezenas cai
//! inteiro dentro de alguma cartela de `k`.
//!
//! Tudo aqui é máscara de bits num `u32`. Um bloco é um número; conter é um
//! `and`; e `v ≤ 31` porque acima disso a enumeração dos alvos não caberia na
//! memória de um aparelho de qualquer jeito — `C(32,16)` já passa de 600
//! milhões.

use serde::{Deserialize, Serialize};

/// Um bloco, como máscara de bits. O bit `i` ligado quer dizer "contém `i`".
pub type Bloco = u32;

/// O maior universo que cabe na máscara.
pub const MAIOR_UNIVERSO: usize = 31;

/// Acima disto a lista de alvos não cabe na memória de um celular.
pub const TETO_DE_ALVOS: usize = 4_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Problema {
    /// Quantos elementos existem ao todo.
    pub v: usize,
    /// Quantos elementos em cada bloco.
    pub k: usize,
    /// Quantos elementos precisam estar cobertos, juntos, em algum bloco.
    pub t: usize,
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
    AlvoMaiorQueACartela { t: usize, k: usize },
    AlvosDemais { quantos: u128 },
}

impl std::fmt::Display for ErroDoProblema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroDoProblema::UniversoGrandeDemais { v } => write!(
                f,
                "o universo tem {v} elementos, e o limite é {MAIOR_UNIVERSO} — acima disso a \
                 enumeração dos alvos não cabe na memória"
            ),
            ErroDoProblema::NumerosNaoPositivos => {
                write!(f, "os três números precisam ser inteiros maiores que zero")
            }
            ErroDoProblema::CartelaMaiorQueOUniverso { k, v } => {
                write!(f, "a cartela tem {k} elementos e o universo só tem {v}: ela não cabe")
            }
            ErroDoProblema::AlvoMaiorQueACartela { t, k } => write!(
                f,
                "o alvo pede {t} elementos juntos numa cartela de {k}: nenhuma cartela consegue"
            ),
            ErroDoProblema::AlvosDemais { quantos } => write!(
                f,
                "são {quantos} alvos a cobrir, e o teto é {TETO_DE_ALVOS} — o problema é grande \
                 demais para ser resolvido dentro de um navegador"
            ),
        }
    }
}

impl Problema {
    /// Recusa o que não descreve um problema, antes de qualquer conta.
    pub fn novo(v: usize, k: usize, t: usize) -> Result<Problema, ErroDoProblema> {
        if v == 0 || k == 0 || t == 0 {
            return Err(ErroDoProblema::NumerosNaoPositivos);
        }
        if v > MAIOR_UNIVERSO {
            return Err(ErroDoProblema::UniversoGrandeDemais { v });
        }
        if k > v {
            return Err(ErroDoProblema::CartelaMaiorQueOUniverso { k, v });
        }
        if t > k {
            return Err(ErroDoProblema::AlvoMaiorQueACartela { t, k });
        }
        let quantos = binomial(v, t);
        if quantos > TETO_DE_ALVOS as u128 {
            return Err(ErroDoProblema::AlvosDemais { quantos });
        }
        Ok(Problema { v, k, t })
    }

    /// Quantos alvos existem: `C(v, t)`.
    pub fn total_de_alvos(&self) -> usize {
        binomial(self.v, self.t) as usize
    }

    /// Quantos blocos existem ao todo: `C(v, k)`.
    pub fn total_de_blocos(&self) -> u128 {
        binomial(self.v, self.k)
    }

    /// Quantos alvos um único bloco cobre: `C(k, t)`.
    pub fn alvos_por_bloco(&self) -> u128 {
        binomial(self.k, self.t)
    }

    /// Todos os alvos, como máscaras, em ordem colex.
    pub fn alvos(&self) -> Vec<Bloco> {
        combinacoes(self.v, self.t)
    }

    /// Todos os blocos candidatos, como máscaras.
    pub fn blocos(&self) -> Vec<Bloco> {
        combinacoes(self.v, self.k)
    }

    /// **O verificador.** Quantos alvos esta coleção deixa descobertos.
    ///
    /// Zero quer dizer que o fechamento cumpre a garantia — e é esta função, e
    /// não a confiança em quem construiu, que autoriza dizer isso. Um construtor
    /// com defeito produz coleções plausíveis; só a varredura pega.
    pub fn descobertos(&self, blocos: &[Bloco]) -> usize {
        let alvos = self.alvos();
        alvos.iter().filter(|&&alvo| !blocos.iter().any(|&b| alvo & b == alvo)).count()
    }

    /// Verdadeiro quando todo alvo está dentro de algum bloco.
    pub fn cobre(&self, blocos: &[Bloco]) -> bool {
        self.descobertos(blocos) == 0
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

    #[test]
    fn o_problema_recusa_o_que_nao_e_problema_e_diz_o_que_e() {
        assert!(matches!(
            Problema::novo(40, 5, 2),
            Err(ErroDoProblema::UniversoGrandeDemais { .. })
        ));
        assert!(matches!(
            Problema::novo(10, 20, 2),
            Err(ErroDoProblema::CartelaMaiorQueOUniverso { .. })
        ));
        assert!(matches!(
            Problema::novo(10, 3, 5),
            Err(ErroDoProblema::AlvoMaiorQueACartela { .. })
        ));
        assert!(matches!(Problema::novo(0, 3, 2), Err(ErroDoProblema::NumerosNaoPositivos)));
        // E a mensagem diz os números, não só o tipo do erro.
        let erro = Problema::novo(10, 20, 2).unwrap_err().to_string();
        assert!(erro.contains("20") && erro.contains("10"), "{erro}");
    }

    #[test]
    fn o_verificador_conta_o_que_falta_e_nao_confia_em_ninguem() {
        let p = Problema::novo(5, 3, 2).unwrap();
        assert_eq!(p.total_de_alvos(), 10);

        // Todos os blocos cobrem tudo, por definição.
        assert!(p.cobre(&p.blocos()));

        // Um bloco só cobre C(3,2) = 3 dos 10 pares.
        assert_eq!(p.descobertos(&[0b00111]), 7);

        // E o vazio não cobre nada.
        assert_eq!(p.descobertos(&[]), 10);
    }

    #[test]
    fn um_plano_conhecido_e_reconhecido_como_cobertura() {
        // O plano de Fano: 7 blocos de 3 cobrindo todos os pares de 7 pontos.
        // É um sistema de Steiner, e portanto o mínimo de C(7,3,2).
        let p = Problema::novo(7, 3, 2).unwrap();
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
}
