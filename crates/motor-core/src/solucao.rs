//! Uma solução candidata e sua cobertura, mantidas em sincronia incremental.
//!
//! `Solucao` guarda as cartelas *e* o estado derivado (quantas cartelas atendem
//! cada alvo, quais alvos seguem descobertos, quanta redundância existe). Todo
//! esse estado é atualizado em O(alvos da cartela) a cada inserção ou remoção,
//! nunca recalculado do zero.
//!
//! O invariante que sustenta o motor inteiro:
//!
//! ```text
//! contagem[a] == |{ c ∈ cartelas : |c ∩ a| >= t }|   para todo alvo a
//! ```
//!
//! [`Solucao::conferir_invariantes`] verifica isso contra o oráculo de força
//! bruta e é usado nos testes.

use crate::avaliacao::Avaliacao;
use crate::cartela::Cartela;
use crate::cobertura::{MotorCobertura, Rascunho};
use crate::conjunto::ConjuntoEsparso;
use crate::Contagem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Solucao {
    cartelas: Vec<Cartela>,
    contagem: Vec<Contagem>,
    descobertos: ConjuntoEsparso,
    redundancia: u64,
}

/// Buffers de [`Solucao::restaurar_de`], reaproveitados entre chamadas para que
/// desfazer uma transformação não aloque nada.
#[derive(Debug, Default, Clone)]
pub struct Restaurador {
    atuais: Vec<Cartela>,
    desejadas: Vec<Cartela>,
    remover: Vec<Cartela>,
    adicionar: Vec<Cartela>,
}

impl Restaurador {
    pub fn novo() -> Self {
        Self::default()
    }
}

impl Solucao {
    /// Solução sem nenhuma cartela: todos os alvos descobertos.
    pub fn vazia(motor: &MotorCobertura) -> Self {
        let total = motor.total_alvos();
        Self {
            cartelas: Vec::new(),
            contagem: vec![0; total],
            descobertos: ConjuntoEsparso::completo(total),
            redundancia: 0,
        }
    }

    /// Constrói a partir de um conjunto de cartelas já existente (Modo A do
    /// documento: otimizar um fechamento que o usuário já tem).
    pub fn de_cartelas(
        motor: &MotorCobertura,
        cartelas: &[Cartela],
        rascunho: &mut Rascunho,
    ) -> Self {
        let mut solucao = Self::vazia(motor);
        for &cartela in cartelas {
            solucao.adicionar(motor, cartela, rascunho);
        }
        solucao
    }

    /// Devolve a solução ao estado vazio reaproveitando a memória já alocada.
    pub fn reiniciar(&mut self) {
        self.cartelas.clear();
        self.contagem.iter_mut().for_each(|c| *c = 0);
        self.descobertos.preencher();
        self.redundancia = 0;
    }

    #[inline]
    pub fn cartelas(&self) -> &[Cartela] {
        &self.cartelas
    }

    #[inline]
    pub fn quantidade(&self) -> usize {
        self.cartelas.len()
    }

    #[inline]
    pub fn esta_vazia(&self) -> bool {
        self.cartelas.is_empty()
    }

    /// Alvos ainda não atendidos. Sortear daqui é O(1).
    #[inline]
    pub fn descobertos(&self) -> &ConjuntoEsparso {
        &self.descobertos
    }

    #[inline]
    pub fn total_descobertos(&self) -> usize {
        self.descobertos.len()
    }

    #[inline]
    pub fn redundancia(&self) -> u64 {
        self.redundancia
    }

    /// Quantas cartelas atendem um alvo específico.
    #[inline]
    pub fn contagem_do_alvo(&self, alvo: u32) -> Contagem {
        self.contagem[alvo as usize]
    }

    #[inline]
    pub fn cobertura_total(&self) -> bool {
        self.descobertos.is_empty()
    }

    pub fn avaliacao(&self) -> Avaliacao {
        Avaliacao {
            cartelas: self.cartelas.len(),
            descobertos: self.descobertos.len(),
            total_alvos: self.contagem.len(),
            redundancia: self.redundancia,
        }
    }

    /// Acrescenta uma cartela, atualizando a cobertura incrementalmente.
    ///
    /// O limiar é `motor.premiadas()`, não 1: um alvo só sai da lista de
    /// descobertos quando `r` cartelas o atendem, e só o que passa disso conta
    /// como redundância. Com `r = 1` — o caso de sempre — isto é exatamente o
    /// comportamento anterior.
    pub fn adicionar(&mut self, motor: &MotorCobertura, cartela: Cartela, rascunho: &mut Rascunho) {
        motor.alvos_da_cartela(cartela, rascunho);
        let exigido = motor.premiadas();

        for &alvo in rascunho.alvos() {
            let contador = &mut self.contagem[alvo as usize];
            *contador += 1;
            match (*contador).cmp(&exigido) {
                std::cmp::Ordering::Equal => self.descobertos.remover(alvo),
                // Já havia cartelas bastantes: esta é esforço duplicado.
                std::cmp::Ordering::Greater => self.redundancia += 1,
                // Ainda falta gente para este alvo; segue descoberto.
                std::cmp::Ordering::Less => {}
            }
        }

        self.cartelas.push(cartela);
    }

    /// Remove a cartela na posição `indice` e devolve qual era.
    ///
    /// A ordem das cartelas restantes não é preservada — a última ocupa o lugar
    /// da removida. Isso mantém a operação em O(1) fora da atualização de
    /// cobertura, e a ordem não carrega significado.
    pub fn remover(
        &mut self,
        motor: &MotorCobertura,
        indice: usize,
        rascunho: &mut Rascunho,
    ) -> Cartela {
        let cartela = self.cartelas.swap_remove(indice);
        motor.alvos_da_cartela(cartela, rascunho);

        let exigido = motor.premiadas();

        for &alvo in rascunho.alvos() {
            let contador = &mut self.contagem[alvo as usize];
            debug_assert!(*contador > 0, "contagem do alvo {alvo} não pode ficar negativa");
            *contador -= 1;
            match (*contador + 1).cmp(&exigido) {
                // Estava exatamente no limiar e acabou de cair abaixo dele.
                std::cmp::Ordering::Equal => self.descobertos.inserir(alvo),
                std::cmp::Ordering::Greater => self.redundancia -= 1,
                std::cmp::Ordering::Less => {}
            }
        }

        cartela
    }

    /// Quantos alvos ficariam descobertos se esta cartela fosse removida.
    ///
    /// Zero significa que a cartela é totalmente redundante: pode sair de graça.
    /// É a base do operador de remoção do §9.1.
    ///
    /// Descoberto aqui é relativo ao limiar: um alvo atendido exatamente `r`
    /// vezes depende de cada uma dessas `r` cartelas, e perder qualquer uma
    /// delas o descobre.
    pub fn contribuicao_unica(
        &self,
        motor: &MotorCobertura,
        indice: usize,
        rascunho: &mut Rascunho,
    ) -> usize {
        motor.alvos_da_cartela(self.cartelas[indice], rascunho);
        let exigido = motor.premiadas();
        rascunho
            .alvos()
            .iter()
            .filter(|&&alvo| self.contagem[alvo as usize] == exigido)
            .count()
    }

    /// Quantos alvos hoje descobertos passariam a ser cobertos por `cartela`.
    ///
    /// É o critério de ganho da reconstrução gulosa.
    pub fn ganho_de(
        &self,
        motor: &MotorCobertura,
        cartela: Cartela,
        rascunho: &mut Rascunho,
    ) -> usize {
        motor.alvos_da_cartela(cartela, rascunho);
        let exigido = motor.premiadas();
        rascunho
            .alvos()
            .iter()
            .filter(|&&alvo| self.contagem[alvo as usize] < exigido)
            .count()
    }

    /// Reverte a solução para exatamente o conjunto de cartelas de `alvo`.
    ///
    /// É o que torna a exploração barata. O motor testa uma transformação, mede
    /// o resultado e, se não gostou, desfaz. Refazer a solução do zero custaria
    /// O(total_alvos) só para zerar o vetor de contagens; aqui o custo é
    /// proporcional ao que de fato mudou — normalmente duas ou três cartelas.
    ///
    /// Trata as cartelas como multiconjunto: se `alvo` contém a mesma cartela
    /// duas vezes, o resultado também conterá.
    pub fn restaurar_de(
        &mut self,
        motor: &MotorCobertura,
        alvo: &[Cartela],
        restaurador: &mut Restaurador,
        rascunho: &mut Rascunho,
    ) {
        let Restaurador { atuais, desejadas, remover, adicionar } = restaurador;

        atuais.clear();
        atuais.extend_from_slice(&self.cartelas);
        atuais.sort_unstable();

        desejadas.clear();
        desejadas.extend_from_slice(alvo);
        desejadas.sort_unstable();

        remover.clear();
        adicionar.clear();

        // Varredura simultânea das duas listas ordenadas: o que sobra de cada
        // lado é exatamente o que precisa sair ou entrar.
        let (mut i, mut j) = (0usize, 0usize);
        while i < atuais.len() && j < desejadas.len() {
            match atuais[i].cmp(&desejadas[j]) {
                std::cmp::Ordering::Less => {
                    remover.push(atuais[i]);
                    i += 1;
                }
                std::cmp::Ordering::Greater => {
                    adicionar.push(desejadas[j]);
                    j += 1;
                }
                std::cmp::Ordering::Equal => {
                    i += 1;
                    j += 1;
                }
            }
        }
        remover.extend_from_slice(&atuais[i..]);
        adicionar.extend_from_slice(&desejadas[j..]);

        for &cartela in remover.iter() {
            let indice = self
                .cartelas
                .iter()
                .position(|&c| c == cartela)
                .expect("cartela a remover veio da própria solução");
            self.remover(motor, indice, rascunho);
        }
        for &cartela in adicionar.iter() {
            self.adicionar(motor, cartela, rascunho);
        }
    }

    /// Identidade estrutural da solução, independente da ordem das cartelas.
    ///
    /// Duas soluções com o mesmo conjunto de cartelas têm a mesma assinatura,
    /// mesmo que tenham sido construídas por caminhos diferentes. É o que
    /// permite a detecção de duplicidade do §38 sem reprocessar exploração já
    /// feita.
    ///
    /// Usa FNV-1a por ser determinístico e estável entre execuções e versões —
    /// ao contrário do hasher padrão da biblioteca, que não dá essa garantia e
    /// portanto não serviria para gravar em banco.
    pub fn assinatura(&self) -> u64 {
        let mut mascaras: Vec<u128> = self.cartelas.iter().map(|c| c.mascara()).collect();
        mascaras.sort_unstable();
        mascaras.dedup();

        const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIMO: u64 = 0x0000_0100_0000_01b3;

        let mut hash = OFFSET;
        for mascara in mascaras {
            for byte in mascara.to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(PRIMO);
            }
        }
        hash
    }

    /// Confere o invariante central contra o verificador de força bruta.
    ///
    /// Devolve `Err` com uma descrição do primeiro desvio encontrado. Custa
    /// O(C(p,j) · |cartelas|) — é ferramenta de teste, não de execução.
    pub fn conferir_invariantes(&self, motor: &MotorCobertura) -> Result<(), String> {
        let esperado = motor.contagens_por_forca_bruta(&self.cartelas);

        if esperado.len() != self.contagem.len() {
            return Err(format!(
                "tamanho do vetor de contagens: {} incremental vs {} força bruta",
                self.contagem.len(),
                esperado.len()
            ));
        }

        for (alvo, (&obtido, &referencia)) in
            self.contagem.iter().zip(esperado.iter()).enumerate()
        {
            if obtido != referencia {
                return Err(format!(
                    "alvo {alvo}: contagem incremental {obtido}, força bruta {referencia}"
                ));
            }
        }

        // "Descoberto" e "redundante" são relativos ao limiar da regra, não ao
        // 1 implícito. O oráculo de força bruta devolve contagens cruas; quem
        // aplica o limiar é esta conferência, exatamente como a `Solucao` faz.
        let exigido = motor.premiadas();

        let descobertos_esperados = esperado.iter().filter(|&&c| c < exigido).count();
        if self.descobertos.len() != descobertos_esperados {
            return Err(format!(
                "descobertos: {} incremental vs {descobertos_esperados} força bruta",
                self.descobertos.len()
            ));
        }
        for (alvo, &c) in esperado.iter().enumerate() {
            if (c < exigido) != self.descobertos.contem(alvo as u32) {
                return Err(format!(
                    "alvo {alvo}: contagem {c} contra exigência {exigido}, mas pertinência ao \
                     conjunto de descobertos é {}",
                    self.descobertos.contem(alvo as u32)
                ));
            }
        }

        let redundancia_esperada: u64 =
            esperado.iter().map(|&c| (c as u64).saturating_sub(exigido as u64)).sum();
        if self.redundancia != redundancia_esperada {
            return Err(format!(
                "redundância: {} incremental vs {redundancia_esperada} força bruta",
                self.redundancia
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::problema::{Objetivo, Problema, RegraCobertura};

    fn ambiente(p: usize, k: usize, j: usize, t: usize) -> (MotorCobertura, Rascunho) {
        let problema = Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::garantia(j, t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        (MotorCobertura::novo(&problema).unwrap(), Rascunho::novo())
    }

    /// Gerador determinístico simples, para não depender de `rand` no núcleo.
    struct Sorteio(u64);
    impl Sorteio {
        fn proximo(&mut self, teto: usize) -> usize {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as usize) % teto.max(1)
        }
    }

    fn cartela_aleatoria(p: usize, k: usize, sorteio: &mut Sorteio) -> Cartela {
        let mut c = Cartela::vazia();
        while c.tamanho() < k {
            c.inserir(sorteio.proximo(p));
        }
        c
    }

    /// Como [`ambiente`], exigindo `r` cartelas por alvo.
    fn ambiente_multiplo(
        p: usize,
        k: usize,
        j: usize,
        t: usize,
        r: usize,
    ) -> (MotorCobertura, Rascunho) {
        let problema = Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::garantia_multipla(j, t, r),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        (MotorCobertura::novo(&problema).unwrap(), Rascunho::novo())
    }

    #[test]
    fn cobrir_uma_vez_nao_e_cobrir_duas() {
        // O caso mínimo que separa cobertura simples de múltipla: pool de 5,
        // cartelas de 4, cobrindo pares. Estas três cartelas cobrem os dez
        // pares — cada uma delas ao menos uma vez.
        let tres = [
            Cartela::dos_indices(&[0, 1, 2, 3]),
            Cartela::dos_indices(&[0, 1, 2, 4]),
            Cartela::dos_indices(&[0, 1, 3, 4]),
        ];

        let (simples, mut rascunho) = ambiente_multiplo(5, 4, 2, 2, 1);
        let mut s = Solucao::vazia(&simples);
        for c in tres {
            s.adicionar(&simples, c, &mut rascunho);
        }
        assert!(s.cobertura_total(), "as três cartelas cobrem todo par uma vez");
        assert_eq!(s.conferir_invariantes(&simples), Ok(()));

        // As mesmas três, exigindo duas cartelas por par: os pares {2,3},
        // {2,4} e {3,4} aparecem numa cartela só, e passam a estar descobertos.
        let (dobrado, mut rascunho) = ambiente_multiplo(5, 4, 2, 2, 2);
        let mut s = Solucao::vazia(&dobrado);
        for c in tres {
            s.adicionar(&dobrado, c, &mut rascunho);
        }
        assert!(!s.cobertura_total(), "com r=2, um par atendido uma vez segue descoberto");
        assert_eq!(s.total_descobertos(), 3, "são os pares 23, 24 e 34");
        assert_eq!(s.conferir_invariantes(&dobrado), Ok(()));

        // Repetir um fechamento simples sempre resolve o dobro — é o teto
        // grosseiro que o motor precisa saber bater, não igualar.
        for c in tres {
            s.adicionar(&dobrado, c, &mut rascunho);
        }
        assert!(s.cobertura_total(), "o fechamento repetido cobre tudo duas vezes");
        assert_eq!(s.conferir_invariantes(&dobrado), Ok(()));
    }

    #[test]
    fn o_invariante_vale_para_qualquer_exigencia() {
        // O mesmo teste que protege o motor inteiro, agora percorrendo r=1..4.
        // Um erro no limiar — inserir ou remover do conjunto de descobertos na
        // hora errada — aparece aqui como divergência da força bruta, que não
        // compartilha caminho de código com a atualização incremental.
        for r in 1..=4 {
            let (motor, mut rascunho) = ambiente_multiplo(9, 4, 3, 2, r);
            let mut s = Solucao::vazia(&motor);
            let mut sorteio = Sorteio(0x5eed ^ r as u64);

            for passo in 0..60 {
                if s.quantidade() > 0 && sorteio.proximo(3) == 0 {
                    let indice = sorteio.proximo(s.quantidade());
                    s.remover(&motor, indice, &mut rascunho);
                } else {
                    s.adicionar(&motor, cartela_aleatoria(9, 4, &mut sorteio), &mut rascunho);
                }
                assert_eq!(
                    s.conferir_invariantes(&motor),
                    Ok(()),
                    "divergiu com r={r} no passo {passo}"
                );
            }
        }
    }

    #[test]
    fn remover_devolve_o_alvo_aos_descobertos_no_limiar_certo() {
        // A armadilha da implementação: com r=3, tirar uma cartela de um alvo
        // atendido 3 vezes tem de descobri-lo; tirar de um atendido 4 vezes
        // apenas reduz a redundância. Errar isso deixa o motor cego para
        // alvos que ele mesmo acabou de descobrir.
        let (motor, mut rascunho) = ambiente_multiplo(5, 4, 2, 2, 3);
        let mut s = Solucao::vazia(&motor);
        let cartela = Cartela::dos_indices(&[0, 1, 2, 3]);

        for _ in 0..4 {
            s.adicionar(&motor, cartela, &mut rascunho);
        }
        let par_interno = 0; // algum alvo dentro da cartela
        assert_eq!(s.contagem_do_alvo(par_interno), 4);
        let descobertos_com_quatro = s.total_descobertos();

        s.remover(&motor, 0, &mut rascunho);
        assert_eq!(s.contagem_do_alvo(par_interno), 3);
        assert_eq!(
            s.total_descobertos(),
            descobertos_com_quatro,
            "cair de 4 para 3 com r=3 não descobre nada"
        );

        s.remover(&motor, 0, &mut rascunho);
        assert_eq!(s.contagem_do_alvo(par_interno), 2);
        assert!(
            s.total_descobertos() > descobertos_com_quatro,
            "cair de 3 para 2 com r=3 tem de descobrir os alvos da cartela"
        );
        assert_eq!(s.conferir_invariantes(&motor), Ok(()));
    }

    #[test]
    fn solucao_vazia_tem_tudo_descoberto() {
        let (motor, _) = ambiente(9, 3, 2, 2);
        let s = Solucao::vazia(&motor);

        assert_eq!(s.quantidade(), 0);
        assert_eq!(s.total_descobertos(), motor.total_alvos());
        assert_eq!(s.redundancia(), 0);
        assert!(!s.cobertura_total());
        assert_eq!(s.conferir_invariantes(&motor), Ok(()));
    }

    #[test]
    fn adicionar_e_remover_em_sequencia_aleatoria_preserva_o_invariante() {
        // Este é o teste que protege o motor inteiro: qualquer erro na
        // atualização incremental aparece como divergência da força bruta.
        for (p, k, j, t) in [(9, 3, 2, 2), (10, 4, 3, 2), (8, 4, 4, 2), (11, 5, 3, 3)] {
            let (motor, mut rascunho) = ambiente(p, k, j, t);
            let mut solucao = Solucao::vazia(&motor);
            let mut sorteio = Sorteio(0x5eed_0000 + p as u64);

            for passo in 0..120 {
                let remover = solucao.quantidade() > 0 && sorteio.proximo(100) < 40;
                if remover {
                    let alvo = sorteio.proximo(solucao.quantidade());
                    solucao.remover(&motor, alvo, &mut rascunho);
                } else {
                    solucao.adicionar(
                        &motor,
                        cartela_aleatoria(p, k, &mut sorteio),
                        &mut rascunho,
                    );
                }

                if let Err(erro) = solucao.conferir_invariantes(&motor) {
                    panic!("({p},{k},{j},{t}) divergiu no passo {passo}: {erro}");
                }
            }
        }
    }

    #[test]
    fn remover_desfaz_exatamente_o_que_adicionar_fez() {
        let (motor, mut rascunho) = ambiente(10, 4, 3, 2);
        let mut solucao = Solucao::vazia(&motor);
        let mut sorteio = Sorteio(7);

        for _ in 0..6 {
            solucao.adicionar(&motor, cartela_aleatoria(10, 4, &mut sorteio), &mut rascunho);
        }
        let antes = solucao.clone();

        let extra = cartela_aleatoria(10, 4, &mut sorteio);
        solucao.adicionar(&motor, extra, &mut rascunho);
        let indice = solucao.quantidade() - 1;
        solucao.remover(&motor, indice, &mut rascunho);

        assert_eq!(solucao.total_descobertos(), antes.total_descobertos());
        assert_eq!(solucao.redundancia(), antes.redundancia());
        assert_eq!(solucao.assinatura(), antes.assinatura());
    }

    #[test]
    fn cartela_duplicada_e_puramente_redundante() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);
        let c = Cartela::dos_indices(&[0, 1, 2]);

        solucao.adicionar(&motor, c, &mut rascunho);
        let descobertos_apos_primeira = solucao.total_descobertos();

        solucao.adicionar(&motor, c, &mut rascunho);
        assert_eq!(solucao.total_descobertos(), descobertos_apos_primeira);
        assert_eq!(solucao.contribuicao_unica(&motor, 0, &mut rascunho), 0);
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
    }

    #[test]
    fn contribuicao_unica_identifica_cartela_descartavel() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);

        solucao.adicionar(&motor, Cartela::dos_indices(&[0, 1, 2]), &mut rascunho);
        solucao.adicionar(&motor, Cartela::dos_indices(&[3, 4, 5]), &mut rascunho);
        // Sobreposta às anteriores: cobre pares que já não estavam cobertos,
        // então contribui de forma única.
        solucao.adicionar(&motor, Cartela::dos_indices(&[0, 3, 6]), &mut rascunho);

        assert!(solucao.contribuicao_unica(&motor, 2, &mut rascunho) > 0);

        // Uma cópia exata da primeira não contribui com nada.
        solucao.adicionar(&motor, Cartela::dos_indices(&[0, 1, 2]), &mut rascunho);
        assert_eq!(solucao.contribuicao_unica(&motor, 3, &mut rascunho), 0);
    }

    #[test]
    fn ganho_conta_apenas_alvos_ainda_descobertos() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);
        let c = Cartela::dos_indices(&[0, 1, 2]);

        assert_eq!(solucao.ganho_de(&motor, c, &mut rascunho), 3); // C(3,2)
        solucao.adicionar(&motor, c, &mut rascunho);
        assert_eq!(solucao.ganho_de(&motor, c, &mut rascunho), 0);
    }

    #[test]
    fn assinatura_ignora_a_ordem_das_cartelas() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let a = Cartela::dos_indices(&[0, 1, 2]);
        let b = Cartela::dos_indices(&[3, 4, 5]);

        let mut primeira = Solucao::vazia(&motor);
        primeira.adicionar(&motor, a, &mut rascunho);
        primeira.adicionar(&motor, b, &mut rascunho);

        let mut segunda = Solucao::vazia(&motor);
        segunda.adicionar(&motor, b, &mut rascunho);
        segunda.adicionar(&motor, a, &mut rascunho);

        assert_eq!(primeira.assinatura(), segunda.assinatura());
    }

    #[test]
    fn assinatura_distingue_solucoes_diferentes() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut primeira = Solucao::vazia(&motor);
        primeira.adicionar(&motor, Cartela::dos_indices(&[0, 1, 2]), &mut rascunho);

        let mut segunda = Solucao::vazia(&motor);
        segunda.adicionar(&motor, Cartela::dos_indices(&[0, 1, 3]), &mut rascunho);

        assert_ne!(primeira.assinatura(), segunda.assinatura());
    }

    #[test]
    fn restaurar_desfaz_qualquer_transformacao() {
        // Sem isso o motor não conseguiria explorar: cada tentativa rejeitada
        // precisa voltar exatamente ao estado anterior, ou o estado incremental
        // se corrompe silenciosamente ao longo de milhões de iterações.
        let (motor, mut rascunho) = ambiente(10, 4, 3, 2);
        let mut restaurador = Restaurador::novo();
        let mut solucao = Solucao::vazia(&motor);
        let mut sorteio = Sorteio(0xabc);

        for _ in 0..8 {
            solucao.adicionar(&motor, cartela_aleatoria(10, 4, &mut sorteio), &mut rascunho);
        }

        for rodada in 0..40 {
            let instantaneo: Vec<Cartela> = solucao.cartelas().to_vec();
            let referencia = solucao.clone();

            // Mexe bastante: remove várias e adiciona outras tantas.
            let remocoes = sorteio.proximo(4);
            for _ in 0..remocoes {
                if solucao.quantidade() > 1 {
                    let alvo = sorteio.proximo(solucao.quantidade());
                    solucao.remover(&motor, alvo, &mut rascunho);
                }
            }
            for _ in 0..sorteio.proximo(4) {
                solucao.adicionar(&motor, cartela_aleatoria(10, 4, &mut sorteio), &mut rascunho);
            }

            solucao.restaurar_de(&motor, &instantaneo, &mut restaurador, &mut rascunho);

            assert_eq!(
                solucao.quantidade(),
                referencia.quantidade(),
                "rodada {rodada}: quantidade divergiu"
            );
            assert_eq!(solucao.assinatura(), referencia.assinatura(), "rodada {rodada}");
            assert_eq!(
                solucao.total_descobertos(),
                referencia.total_descobertos(),
                "rodada {rodada}"
            );
            assert_eq!(solucao.redundancia(), referencia.redundancia(), "rodada {rodada}");
            assert_eq!(solucao.conferir_invariantes(&motor), Ok(()), "rodada {rodada}");
        }
    }

    #[test]
    fn restaurar_preserva_cartelas_repetidas() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut restaurador = Restaurador::novo();
        let mut solucao = Solucao::vazia(&motor);
        let repetida = Cartela::dos_indices(&[0, 1, 2]);

        solucao.adicionar(&motor, repetida, &mut rascunho);
        solucao.adicionar(&motor, repetida, &mut rascunho);
        solucao.adicionar(&motor, Cartela::dos_indices(&[3, 4, 5]), &mut rascunho);
        let instantaneo: Vec<Cartela> = solucao.cartelas().to_vec();
        let redundancia_original = solucao.redundancia();

        solucao.reiniciar();
        solucao.adicionar(&motor, Cartela::dos_indices(&[6, 7, 8]), &mut rascunho);
        solucao.restaurar_de(&motor, &instantaneo, &mut restaurador, &mut rascunho);

        assert_eq!(solucao.quantidade(), 3, "a cartela repetida precisa voltar duas vezes");
        assert_eq!(solucao.redundancia(), redundancia_original);
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
    }

    #[test]
    fn reiniciar_devolve_ao_estado_inicial() {
        let (motor, mut rascunho) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);
        solucao.adicionar(&motor, Cartela::dos_indices(&[0, 1, 2]), &mut rascunho);
        solucao.reiniciar();

        assert_eq!(solucao.quantidade(), 0);
        assert_eq!(solucao.total_descobertos(), motor.total_alvos());
        assert_eq!(solucao.redundancia(), 0);
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
    }
}
