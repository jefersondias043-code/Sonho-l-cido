//! A busca que nunca quebra a simetria.
//!
//! ## O problema que ela resolve
//!
//! Medindo o banco da Lotinha, oito dos vinte fechamentos ainda em aberto são
//! **perfeitamente invariantes por rotação** — 20/17, 22/17, 22/18, 23/17,
//! 23/18, 24/18, 24/21 e 25/18. Isso não é coincidência: a busca livre move uma
//! cartela por vez, e uma cartela mexida quebra a invariância para sempre. Um
//! fechamento perfeitamente cíclico no banco é a construção por órbitas intacta,
//! e significa que a busca livre rodou naquele caso sem nunca aceitar um
//! movimento.
//!
//! O obstáculo é o **formato do movimento**, não o ritmo dele: nenhum valor de
//! nenhum seletor faz a busca livre sair de um vale que só um salto coordenado
//! de vinte e cinco cartelas ao mesmo tempo abandonaria.
//!
//! [`BuscaCiclica`] dá esse salto por construção. A unidade que ela move é a
//! **órbita**, então toda solução que ela visita já é invariante, e as vinte e
//! cinco cartelas andam juntas de graça.
//!
//! ## Que ela ganha, medido no mesmo relógio
//!
//! A comparação honesta é contra o que o aplicativo faz hoje, com o mesmo tempo
//! para os dois lados — e não contra o banco, que foi produzido com 300 s por
//! caso. Com 45 s de cada lado:
//!
//! ```text
//!          banco    Construtor 45s   simétrica 45s
//! 20/17      240          300              240
//! 22/18      660          693              693
//! 21/18      182          244              217
//! 22/19      126          193              132
//! ```
//!
//! Ganha em três, empata em uma, não perde nenhuma. E em `22/19` os 132 que ela
//! alcança em 45 segundos são o **ótimo cíclico**, provado ao certo por
//! [`crate::exato`]: ali ela não deixou nada na mesa.
//!
//! Com tempo de sobra ela passa até do banco: em `23/18` chegou a **2.139**
//! cartelas contra as 2.162 que o aplicativo entrega hoje.
//!
//! ## Onde ela não tem o que fazer
//!
//! Não é um substituto da busca livre, e o resolvedor exato de [`crate::exato`]
//! diz por quê. Nos três casos em que o ótimo cíclico é conhecido:
//!
//! ```text
//! 22/19   melhor cíclico 132   banco 126   a busca livre ganha
//! 23/20   melhor cíclico 138   banco 100   a busca livre ganha muito
//! 24/21   melhor cíclico  80   banco  80   empatam, e o banco é ótimo cíclico
//! ```
//!
//! A simetria é um bom lugar para procurar, não o único lugar onde há o que
//! achar. Nos doze casos em que o banco **não** é cíclico, esta trilha não tem
//! o que acrescentar.
//!
//! ## Onde ela roda
//!
//! Fora do celular. O banco já cobre as 44 combinações da modalidade e viaja
//! pronto no aplicativo: melhorar o banco aqui entrega o fechamento menor a
//! todo mundo sem gastar bateria nenhuma, que é estritamente melhor do que
//! pedir ao aparelho para redescobri-lo. Ver o exemplo `melhorar-banco`.

use motor_core::avaliacao::ChaveCusto;
use motor_core::cartela::Cartela;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

use crate::aceitacao::AceitacaoTardia;
use crate::orbitas::InstanciaCiclica;

/// Quantas iterações sem recorde antes de recomeçar do guloso.
///
/// O espaço de órbitas é ordens de grandeza menor que o de cartelas — 2.125
/// candidatas em 25 dezenas contra 53.130 —, então ele se esgota antes e o
/// reinício precisa vir bem antes do gatilho da busca livre.
///
/// Medido em `20/17`, varrendo 36 combinações de ajuste: **sem reinício a
/// trilha nunca chega às 240 do banco** — o melhor foi 260, e com ruína
/// pequena, 360. Com reinício a cada 500, chega em 30 mil iterações.
pub const SEM_RECORDE_ATE_REINICIAR: u64 = 500;

/// A memória da aceitação tardia.
///
/// Na mesma varredura ela foi o parâmetro que **menos** importou: 1, 20, 120 e
/// 600 chegam todos a 240 quando a ruína e o reinício estão certos. Fica 120
/// por ser o valor que não aposta em nenhum extremo.
pub const MEMORIA_DA_ACEITACAO: usize = 120;

/// Divisor da ruína: tira até `escolhidas / DIVISOR` órbitas por iteração.
///
/// Foi o parâmetro que mais importou, e por larga margem. Com 4, todas as doze
/// combinações de memória e reinício que têm reinício chegam a 240; com 8,
/// metade fica em 260; com 20, nenhuma passa de 280. Uma órbita são vinte
/// cartelas — arruinar pouco não abre espaço para nada.
pub const DIVISOR_DA_RUINA: usize = 4;

/// Os três números que mudam o comportamento da trilha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ajuste {
    /// Tamanho da memória da aceitação tardia.
    pub memoria: usize,
    /// Iterações sem recorde antes de recomeçar. `u64::MAX` desliga o reinício.
    pub reinicio_apos: u64,
    /// Divisor da ruína: tira até `escolhidas / divisor` órbitas por iteração.
    pub divisor_da_ruina: usize,
}

impl Default for Ajuste {
    fn default() -> Self {
        Ajuste {
            memoria: MEMORIA_DA_ACEITACAO,
            reinicio_apos: SEM_RECORDE_ATE_REINICIAR,
            divisor_da_ruina: DIVISOR_DA_RUINA,
        }
    }
}

/// Busca local persistente no espaço das órbitas.
#[derive(Debug, Clone)]
pub struct BuscaCiclica {
    inst: InstanciaCiclica,
    premiadas: u32,
    atual: Vec<usize>,
    melhor: Vec<usize>,
    melhor_em_cartelas: u64,
    aceitacao: AceitacaoTardia,
    rng: Pcg64Mcg,
    iteracoes: u64,
    sem_recorde: u64,
    recordes: u64,
    reinicios: u64,
    ajuste: Ajuste,
}

impl BuscaCiclica {
    /// Parte do guloso da instância, já podado.
    pub fn nova(inst: InstanciaCiclica, premiadas: u32, semente: u64) -> Self {
        Self::com_ajuste(inst, premiadas, semente, Ajuste::default())
    }

    pub fn com_ajuste(
        inst: InstanciaCiclica,
        premiadas: u32,
        semente: u64,
        ajuste: Ajuste,
    ) -> Self {
        let premiadas = premiadas.max(1);
        let rng = Pcg64Mcg::seed_from_u64(semente);
        // O guloso amplo é o melhor começo que existe barato, e é o mesmo de que
        // o Construtor parte: começar pior seria dar handicap à trilha.
        let mut escolha = inst.guloso(premiadas);
        inst.podar(&mut escolha, premiadas);

        let custo = inst.custo(&escolha);
        let chave = chave_de(&inst, &escolha, premiadas);
        BuscaCiclica {
            inst,
            premiadas,
            atual: escolha.clone(),
            melhor: escolha,
            melhor_em_cartelas: custo,
            aceitacao: AceitacaoTardia::nova(ajuste.memoria.max(1), chave),
            rng,
            iteracoes: 0,
            sem_recorde: 0,
            recordes: 0,
            reinicios: 0,
            ajuste,
        }
    }

    /// Roda `quantas` iterações. Devolve `true` se bateu recorde em alguma.
    pub fn avancar(&mut self, quantas: u64) -> bool {
        let mut bateu = false;
        for _ in 0..quantas {
            self.iteracoes += 1;

            if self.sem_recorde >= self.ajuste.reinicio_apos {
                self.reiniciar();
                continue;
            }

            // Arruinar: tira um punhado de órbitas. Tirar **uma** deixa o reparo
            // devolver a mesma no mesmo buraco; tirar demais joga fora o que já
            // foi conquistado. A fração do oitavo é a que o Construtor já usava.
            let mut semente = self.atual.clone();
            let teto = (semente.len() / self.ajuste.divisor_da_ruina.max(1)).max(1);
            let quantas_fora = 1 + self.rng.gen_range(0..teto);
            for _ in 0..quantas_fora {
                if semente.is_empty() {
                    break;
                }
                let fora = self.rng.gen_range(0..semente.len());
                semente.swap_remove(fora);
            }

            let mut nova = self.inst.reparar(&semente, self.premiadas, &mut self.rng);
            self.inst.podar(&mut nova, self.premiadas);

            let chave_nova = chave_de(&self.inst, &nova, self.premiadas);
            let chave_atual = chave_de(&self.inst, &self.atual, self.premiadas);
            if self.aceitacao.decidir(chave_nova, chave_atual) {
                let custo = self.inst.custo(&nova);
                self.atual = nova;
                if chave_nova.primario == 0 && custo < self.melhor_em_cartelas {
                    self.melhor_em_cartelas = custo;
                    self.melhor = self.atual.clone();
                    self.recordes += 1;
                    self.sem_recorde = 0;
                    bateu = true;
                    continue;
                }
            }
            self.sem_recorde += 1;
        }
        bateu
    }

    /// Recomeça do guloso quando a trilha estagna. O recorde não se perde: ele
    /// mora fora do estado corrente, que é a distinção entre guardar o resultado
    /// e guardar o estado da busca.
    fn reiniciar(&mut self) {
        let mut nova = self.inst.guloso(self.premiadas);
        self.inst.podar(&mut nova, self.premiadas);
        let mut sorteada = self.inst.reparar(&[], self.premiadas, &mut self.rng);
        self.inst.podar(&mut sorteada, self.premiadas);
        if self.inst.custo(&sorteada) < self.inst.custo(&nova) {
            nova = sorteada;
        }
        self.aceitacao.reiniciar(chave_de(&self.inst, &nova, self.premiadas));
        self.atual = nova;
        self.sem_recorde = 0;
        self.reinicios += 1;
    }

    /// O recorde, em **cartelas** — que é o que o usuário paga, e não o número
    /// de órbitas escolhidas.
    pub fn melhor_em_cartelas(&self) -> u64 {
        self.melhor_em_cartelas
    }

    /// O recorde expandido: cada órbita vira todas as suas rotações.
    pub fn melhor_solucao(&self) -> Vec<Cartela> {
        self.inst.expandir(&self.melhor)
    }

    pub fn iteracoes(&self) -> u64 {
        self.iteracoes
    }

    pub fn recordes(&self) -> u64 {
        self.recordes
    }

    pub fn reinicios(&self) -> u64 {
        self.reinicios
    }

    pub fn iteracoes_sem_recorde(&self) -> u64 {
        self.sem_recorde
    }

    pub fn orbitas_do_recorde(&self) -> usize {
        self.melhor.len()
    }

    pub fn instancia(&self) -> &InstanciaCiclica {
        &self.inst
    }
}

/// Cobrir primeiro; entre soluções completas, menos cartelas; empatou, menos
/// redundância. É a mesma ordem lexicográfica do motor livre, e de propósito:
/// as duas trilhas precisam concordar sobre o que é "melhor" para que comparar
/// os recordes delas signifique alguma coisa.
fn chave_de(inst: &InstanciaCiclica, escolha: &[usize], premiadas: u32) -> ChaveCusto {
    let (descobertos, excesso) = inst.descobertos_e_excesso(escolha, premiadas);
    ChaveCusto { primario: descobertos, secundario: inst.custo(escolha), terciario: excesso }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn de(pool: usize, jogo: usize) -> BuscaCiclica {
        let inst = InstanciaCiclica::montar(pool, pool - jogo, pool - 15, None).unwrap();
        BuscaCiclica::nova(inst, 1, 7)
    }

    /// O fechamento continua igual a si mesmo depois de girar uma posição.
    fn e_ciclico(cartelas: &[Cartela], pool: usize) -> bool {
        use std::collections::HashSet;
        let conjunto: HashSet<Vec<usize>> = cartelas.iter().map(|c| c.indices()).collect();
        cartelas.iter().all(|c| {
            let girada: Vec<usize> = {
                let mut v: Vec<usize> = c.indices().iter().map(|&d| (d + 1) % pool).collect();
                v.sort_unstable();
                v
            };
            conjunto.contains(&girada)
        })
    }

    #[test]
    fn a_solucao_cobre_tudo_e_e_ciclica_depois_de_muitas_iteracoes() {
        let mut busca = de(20, 17);
        busca.avancar(3_000);
        let cartelas = busca.melhor_solucao();
        assert_eq!(cartelas.len() as u64, busca.melhor_em_cartelas());
        assert!(
            e_ciclico(&cartelas, 20),
            "a trilha simétrica virou busca livre: o recorde deixou de ser invariante"
        );
        let (descobertos, _) = busca.inst.descobertos_e_excesso(&busca.melhor, 1);
        assert_eq!(descobertos, 0, "recorde com alvo descoberto");
    }

    #[test]
    fn o_recorde_nunca_piora() {
        let mut busca = de(21, 18);
        let mut anterior = busca.melhor_em_cartelas();
        for _ in 0..30 {
            busca.avancar(100);
            let agora = busca.melhor_em_cartelas();
            assert!(agora <= anterior, "recorde subiu de {anterior} para {agora}");
            anterior = agora;
        }
    }

    #[test]
    fn a_mesma_semente_da_a_mesma_busca() {
        let mut a = de(20, 17);
        let mut b = de(20, 17);
        a.avancar(500);
        b.avancar(500);
        assert_eq!(a.melhor_em_cartelas(), b.melhor_em_cartelas());
        assert_eq!(a.melhor, b.melhor);
        // E parar no meio não muda o caminho: dois lotes de 250 valem 500.
        let mut c = de(20, 17);
        c.avancar(250);
        c.avancar(250);
        assert_eq!(c.melhor, a.melhor, "avançar em lotes precisa dar o mesmo que de uma vez");
    }

    #[test]
    fn em_20_17_ela_alcanca_as_240_conhecidas() {
        // O melhor fechamento cíclico conhecido para 20 dezenas com jogos de 17.
        // Medido: com o ajuste padrão ela chega em 30 mil iterações. O teste roda
        // 40 mil para não quebrar por acaso, e é lento de propósito — é a única
        // asserção que prova que a trilha faz o trabalho, e não só gira.
        let mut busca = de(20, 17);
        busca.avancar(40_000);
        assert!(
            busca.melhor_em_cartelas() <= 240,
            "chegou a {} cartelas, e 240 é conhecido",
            busca.melhor_em_cartelas()
        );
    }

    #[test]
    fn estagnar_reinicia_sem_perder_o_recorde() {
        let mut busca = de(22, 19);
        busca.avancar(SEM_RECORDE_ATE_REINICIAR * 3);
        let recorde = busca.melhor_em_cartelas();
        assert!(busca.reinicios() >= 1, "não reiniciou depois de estagnar");
        busca.avancar(200);
        assert!(busca.melhor_em_cartelas() <= recorde, "o reinício levou o recorde junto");
    }
}
