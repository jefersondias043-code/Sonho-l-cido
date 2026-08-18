//! O motor de cobertura — o caminho quente de todo o sistema.
//!
//! A ideia central: em vez de perguntar *"esta solução cobre tudo?"* refazendo
//! a conta a cada iteração, mantemos um vetor `contagem[alvo]` com quantas
//! cartelas atendem cada subconjunto-alvo. Adicionar ou remover uma cartela
//! mexe apenas nos alvos daquela cartela — tipicamente algumas dezenas ou
//! centenas de posições, em vez de dezenas de milhares.
//!
//! É a diferença entre milhares e milhões de iterações por segundo.

use crate::cartela::Cartela;
use crate::Contagem;
use crate::combinatoria::{iniciar_combinacao, indice_colex, proxima_combinacao, Binomiais};
use crate::problema::{
    checar_viabilidade, ErroViabilidade, Problema, Viabilidade, LIMITE_ALVOS_PADRAO,
};

/// Buffers reaproveitados entre chamadas, para que o laço quente não aloque.
///
/// Um `Rascunho` por thread de busca. Não é compartilhável, de propósito.
#[derive(Debug, Default, Clone)]
pub struct Rascunho {
    /// Índices do pool presentes na cartela.
    dentro: Vec<usize>,
    /// Índices do pool ausentes da cartela.
    fora: Vec<usize>,
    /// Estado da combinação sendo percorrida dentro da cartela.
    comb_dentro: Vec<usize>,
    /// Estado da combinação sendo percorrida fora da cartela.
    comb_fora: Vec<usize>,
    /// Alvo atual sendo montado, em ordem crescente.
    alvo_atual: Vec<usize>,
    /// Índices colex dos alvos atendidos pela última cartela consultada.
    alvos: Vec<u32>,
}

impl Rascunho {
    pub fn novo() -> Self {
        Self::default()
    }

    /// Alvos atendidos pela última cartela passada a
    /// [`MotorCobertura::alvos_da_cartela`].
    #[inline]
    pub fn alvos(&self) -> &[u32] {
        &self.alvos
    }
}

/// Traduz a regra de cobertura do problema em operações sobre índices de alvos.
#[derive(Debug, Clone)]
pub struct MotorCobertura {
    p: usize,
    tamanho_cartela: usize,
    alvo: usize,
    intersecao: usize,
    premiadas: Contagem,
    total_alvos: usize,
    viabilidade: Viabilidade,
    binom: Binomiais,
    /// `pesos[i * (p+1) + e] = C(e, i+1)` — a parcela que o elemento `e` na
    /// posição `i` acrescenta ao índice colex.
    ///
    /// É o caminho mais quente do sistema inteiro: cada alvo gerado soma `j`
    /// dessas parcelas, e uma iteração da busca gera dezenas de milhares de
    /// alvos. Ler de uma tabela plana troca três comparações, uma multiplicação
    /// e um acesso com limite por um único acesso indexado.
    pesos: Vec<u64>,
}

impl MotorCobertura {
    /// Monta o motor para um problema, recusando configurações grandes demais
    /// para caber na memória.
    pub fn novo(problema: &Problema) -> Result<Self, ErroViabilidade> {
        Self::com_limite(problema, LIMITE_ALVOS_PADRAO)
    }

    pub fn com_limite(problema: &Problema, limite_alvos: u64) -> Result<Self, ErroViabilidade> {
        let p = problema.tamanho_pool();
        let regra = problema.regra();

        // A tabela precisa cobrir toda consulta feita adiante: `C(p, ·)` na
        // contagem de alvos e `C(elemento, posicao)` no ranqueamento colex,
        // onde `elemento < p` e `posicao <= j`.
        let binom = Binomiais::novo(p, p);
        let viabilidade = checar_viabilidade(problema, &binom, limite_alvos)?;

        let alvo = regra.alvo;
        let mut pesos = vec![0u64; alvo * (p + 1)];
        for i in 0..alvo {
            for e in 0..=p {
                pesos[i * (p + 1) + e] = binom.c(e, i + 1);
            }
        }

        Ok(Self {
            p,
            tamanho_cartela: problema.tamanho_cartela(),
            alvo,
            intersecao: regra.intersecao,
            premiadas: regra.premiadas.max(1) as Contagem,
            total_alvos: viabilidade.total_alvos as usize,
            viabilidade,
            binom,
            pesos,
        })
    }

    /// `C(p, j)` — quantos subconjuntos-alvo existem.
    #[inline]
    pub fn total_alvos(&self) -> usize {
        self.total_alvos
    }

    #[inline]
    pub fn tamanho_pool(&self) -> usize {
        self.p
    }

    #[inline]
    pub fn tamanho_cartela(&self) -> usize {
        self.tamanho_cartela
    }

    #[inline]
    pub fn alvo(&self) -> usize {
        self.alvo
    }

    #[inline]
    pub fn intersecao(&self) -> usize {
        self.intersecao
    }

    /// `r` — quantas cartelas precisam atender cada alvo para ele contar como
    /// coberto.
    ///
    /// É o limiar que [`crate::Solucao`] usa no lugar do 1 implícito: um alvo
    /// com contagem abaixo disto continua descoberto, por mais cartelas que a
    /// solução tenha.
    #[inline]
    pub fn premiadas(&self) -> Contagem {
        self.premiadas
    }

    pub fn viabilidade(&self) -> Viabilidade {
        self.viabilidade
    }

    pub fn binomiais(&self) -> &Binomiais {
        &self.binom
    }

    /// Calcula todos os alvos atendidos por `cartela`, deixando o resultado em
    /// `rascunho.alvos()`.
    ///
    /// Enumera por quantos elementos do alvo vêm de dentro da cartela: escolhe
    /// `i >= t` elementos entre os `k` da cartela e os `j - i` restantes entre
    /// os `p - k` de fora. Toda combinação assim formada tem interseção `i >= t`
    /// com a cartela, e toda combinação com interseção `>= t` é gerada
    /// exatamente uma vez — a partição por `i` garante que não há repetição.
    pub fn alvos_da_cartela(&self, cartela: Cartela, rascunho: &mut Rascunho) {
        rascunho.alvos.clear();

        cartela.indices_em(&mut rascunho.dentro);
        cartela.indices_ausentes_em(self.p, &mut rascunho.fora);

        let n_dentro = rascunho.dentro.len();
        let n_fora = rascunho.fora.len();
        rascunho.alvo_atual.resize(self.alvo, 0);

        let largura = self.p + 1;
        let i_max = self.alvo.min(n_dentro);
        for i in self.intersecao..=i_max {
            let resto = self.alvo - i;
            if resto > n_fora {
                continue;
            }

            iniciar_combinacao(i, &mut rascunho.comb_dentro);
            loop {
                iniciar_combinacao(resto, &mut rascunho.comb_fora);
                loop {
                    // Intercala os dois lados em ordem crescente **somando o
                    // índice colex na mesma passada**. Ambas as origens já
                    // estão ordenadas, então uma varredura basta — e como a
                    // posição de escrita é a mesma que entra no peso, o alvo
                    // nunca precisa ser materializado.
                    let (mut a, mut b, mut escrita) = (0usize, 0usize, 0usize);
                    let mut indice = 0u64;
                    while a < i && b < resto {
                        let de_dentro = rascunho.dentro[rascunho.comb_dentro[a]];
                        let de_fora = rascunho.fora[rascunho.comb_fora[b]];
                        let escolhido = if de_dentro < de_fora {
                            a += 1;
                            de_dentro
                        } else {
                            b += 1;
                            de_fora
                        };
                        indice += self.pesos[escrita * largura + escolhido];
                        escrita += 1;
                    }
                    while a < i {
                        let e = rascunho.dentro[rascunho.comb_dentro[a]];
                        indice += self.pesos[escrita * largura + e];
                        a += 1;
                        escrita += 1;
                    }
                    while b < resto {
                        let e = rascunho.fora[rascunho.comb_fora[b]];
                        indice += self.pesos[escrita * largura + e];
                        b += 1;
                        escrita += 1;
                    }

                    debug_assert!((indice as usize) < self.total_alvos);
                    rascunho.alvos.push(indice as u32);

                    if !proxima_combinacao(n_fora, resto, &mut rascunho.comb_fora) {
                        break;
                    }
                }

                if !proxima_combinacao(n_dentro, i, &mut rascunho.comb_dentro) {
                    break;
                }
            }
        }
    }

    /// Verificador independente, por força bruta: enumera *todos* os alvos e
    /// testa a interseção com cada cartela diretamente.
    ///
    /// Não compartilha caminho de código com a contagem incremental, então
    /// serve de oráculo nos testes. É `O(C(p,j) · |cartelas|)` — bom para
    /// verificar, inviável para buscar.
    pub fn contagens_por_forca_bruta(&self, cartelas: &[Cartela]) -> Vec<crate::Contagem> {
        let mut contagem = vec![0 as crate::Contagem; self.total_alvos];
        let mut estado = Vec::new();
        iniciar_combinacao(self.alvo, &mut estado);

        loop {
            let alvo_mascara = Cartela::dos_indices(&estado);
            let indice = indice_colex(&self.binom, &estado) as usize;

            contagem[indice] = cartelas
                .iter()
                .filter(|c| c.tamanho_intersecao(alvo_mascara) >= self.intersecao)
                .count() as crate::Contagem;

            if !proxima_combinacao(self.p, self.alvo, &mut estado) {
                break;
            }
        }

        contagem
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::problema::{Objetivo, RegraCobertura};

    fn motor(p: usize, k: usize, alvo: usize, intersecao: usize) -> MotorCobertura {
        let problema = Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::garantia(alvo, intersecao),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        MotorCobertura::novo(&problema).unwrap()
    }

    /// Recalcula a cobertura de uma cartela usando o caminho rápido.
    fn alvos(m: &MotorCobertura, c: Cartela) -> Vec<u32> {
        let mut r = Rascunho::novo();
        m.alvos_da_cartela(c, &mut r);
        r.alvos().to_vec()
    }

    #[test]
    fn covering_design_cobre_exatamente_os_subconjuntos_da_cartela() {
        // Com j == t, uma cartela de k elementos cobre os C(k, t) subconjuntos
        // de tamanho t contidos nela — nem um a mais.
        let m = motor(10, 4, 2, 2);
        let c = Cartela::dos_indices(&[1, 3, 5, 7]);
        let obtidos = alvos(&m, c);

        assert_eq!(obtidos.len(), 6); // C(4, 2)

        let mut esperados: Vec<u32> = Vec::new();
        for a in [1usize, 3, 5, 7] {
            for b in [1usize, 3, 5, 7] {
                if a < b {
                    esperados.push(indice_colex(m.binomiais(), &[a, b]) as u32);
                }
            }
        }
        let (mut o, mut e) = (obtidos.clone(), esperados);
        o.sort_unstable();
        e.sort_unstable();
        assert_eq!(o, e);
    }

    #[test]
    fn alvos_da_cartela_nunca_repete_indice() {
        // A partição por "quantos elementos vêm de dentro" precisa ser exata:
        // se houvesse sobreposição, a contagem incremental inflaria.
        for (p, k, j, t) in [(8, 4, 3, 2), (10, 5, 4, 2), (9, 3, 3, 1), (12, 6, 5, 3)] {
            let m = motor(p, k, j, t);
            let c = Cartela::dos_indices(&(0..k).collect::<Vec<_>>());
            let mut obtidos = alvos(&m, c);
            let antes = obtidos.len();
            obtidos.sort_unstable();
            obtidos.dedup();
            assert_eq!(antes, obtidos.len(), "índices repetidos em ({p},{k},{j},{t})");
        }
    }

    #[test]
    fn quantidade_de_alvos_bate_com_a_formula_fechada() {
        for (p, k, j, t) in [(8, 4, 3, 2), (10, 5, 4, 2), (12, 6, 6, 4), (10, 4, 2, 2)] {
            let m = motor(p, k, j, t);
            let c = Cartela::dos_indices(&(0..k).collect::<Vec<_>>());
            assert_eq!(
                alvos(&m, c).len() as u64,
                m.viabilidade().alvos_por_cartela,
                "contagem divergiu em ({p},{k},{j},{t})"
            );
        }
    }

    #[test]
    fn caminho_rapido_concorda_com_a_forca_bruta() {
        // O teste que mais importa: o índice card→alvos precisa produzir
        // exatamente a mesma cobertura que a verificação exaustiva.
        for (p, k, j, t) in [(8, 4, 3, 2), (10, 5, 4, 3), (9, 4, 4, 2), (11, 3, 2, 2)] {
            let m = motor(p, k, j, t);
            let cartelas = vec![
                Cartela::dos_indices(&(0..k).collect::<Vec<_>>()),
                Cartela::dos_indices(&(1..k + 1).collect::<Vec<_>>()),
                Cartela::dos_indices(&(p - k..p).collect::<Vec<_>>()),
            ];

            let mut incremental = vec![0 as crate::Contagem; m.total_alvos()];
            let mut r = Rascunho::novo();
            for &c in &cartelas {
                m.alvos_da_cartela(c, &mut r);
                for &alvo in r.alvos() {
                    incremental[alvo as usize] += 1;
                }
            }

            assert_eq!(
                incremental,
                m.contagens_por_forca_bruta(&cartelas),
                "divergência entre incremental e força bruta em ({p},{k},{j},{t})"
            );
        }
    }
}
