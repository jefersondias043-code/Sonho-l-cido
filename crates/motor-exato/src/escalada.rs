//! A escalada de cobertura: o teto é o piso, e o que cresce é a cobertura.
//!
//! ## A inversão
//!
//! O caminho comum monta uma solução grande e tenta encolhê-la — e é isso que
//! faz um aplicativo apresentar 323 cartelas onde o piso é 160, prometendo
//! reduzir depois. Aqui a lógica é a oposta:
//!
//! > **A quantidade de cartelas é limitada pelo mínimo matemático. A variável
//! > que evolui é a cobertura.**
//!
//! Começa com uma cartela e mede quanto ela cobre. Acrescenta a segunda, mede
//! de novo. Sobe até o teto — que é o piso provado, e nunca é ultrapassado.
//!
//! ```text
//!    1 cartela  →  8,3%
//!    2 cartelas → 16,7%
//!   11 cartelas → 88,9%
//!   12 cartelas → 94,4%   ← o teto; a subida sozinha para aqui
//!   12 cartelas → 100%    ← e a reorganização fecha, sem pedir a décima terceira
//! ```
//!
//! ## Por que isto é o algoritmo, e não só outra tela
//!
//! Se para `n = 1…11` a cobertura máxima fica abaixo de 100% e em 12 ela fecha,
//! então 12 **é** o mínimo. A porcentagem deixa de ser enfeite de progresso e
//! passa a ser a medida do que falta.
//!
//! ## Chegando ao teto sem fechar
//!
//! O número de cartelas congela e o conjunto passa a ser reescrito no lugar:
//! troca uma por outra, derruba várias e repõe várias, reestrutura inteiro.
//! Nunca acrescenta a cartela seguinte.
//!
//! E se não houver disposição que feche? O piso diz "nada menor existe", não diz
//! "isto basta". Em 20 dezenas com jogos de 17 o piso é 160 e o melhor
//! fechamento que o mundo conhece tem cerca de 240: ali a escalada encosta num
//! platô perto de 86%. Isso é resultado, e não falha — "com 160 cartelas o
//! melhor que alcancei foi 86,4%" é uma frase verdadeira e útil.
//!
//! ## Gerar, e não varrer
//!
//! Nada aqui materializa matriz de cobertura. As candidatas a atender um alvo
//! são geradas ([`BlocosDoAlvo`]), e os alvos que uma cartela atende também
//! ([`AlvosDoBloco`]). Num pool de 25 com jogos de 17 são 45 candidatas por
//! passo em vez de 1.081.575 — é o que faz a escalada caber num telefone.

use serde::{Deserialize, Serialize};

use crate::problema::{AlvosDoBloco, Bloco, BlocosDoAlvo, Colex, ErroDoProblema, Problema};

/// Quantas candidatas a escalada chega a avaliar num passo.
///
/// Avaliar uma custa percorrer os alvos que ela atende, e há configurações em
/// que isso são centenas de milhares. Avaliar todas seria a mesma parede que
/// travava a versão anterior; avaliar uma amostra espalhada mantém a escolha boa
/// e o passo finito.
pub const TETO_DE_CANDIDATAS: usize = 256;

/// E nunca menos que isto, para a escolha não virar sorteio puro.
pub const MINIMO_DE_CANDIDATAS: usize = 8;

/// Quantos alvos um passo pode percorrer antes de devolver o controle.
pub const ALVOS_POR_PASSO: u128 = 400_000;

/// Quantas rodadas sem ganho antes de a reorganização derrubar um pedaço maior.
pub const PACIENCIA: u32 = 60;

/// Quantos pontos a curva de cobertura guarda, no máximo.
///
/// A curva é a resposta a "1 cartela → quanto? 2 cartelas → quanto?" — e ela
/// precisa existir como **dado**, e não como efeito do instante em que a tela
/// olhou: a subida costuma acontecer rápido demais para ser vista ao vivo. Num
/// teto de mil e quinhentas cartelas, guardar cada degrau seria desperdício;
/// acima deste número ela é afinada pela metade e passa a guardar de dois em
/// dois, de quatro em quatro, e assim por diante.
pub const PONTOS_DA_CURVA: usize = 240;

/// Em que ponto da escalada o motor está.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Fase {
    /// Ainda acrescentando cartelas, sem ter chegado ao teto.
    Subindo,
    /// No teto, reescrevendo o conjunto sem mudar o tamanho.
    Reorganizando,
    /// A cobertura fechou. Não há mais o que fazer.
    Fechada,
}

impl std::fmt::Display for Fase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fase::Subindo => write!(f, "subindo"),
            Fase::Reorganizando => write!(f, "reorganizando"),
            Fase::Fechada => write!(f, "fechada"),
        }
    }
}

/// Onde a escalada está, num instante.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Passo {
    /// Quantas cartelas o conjunto atual tem. **Nunca passa de `teto`.**
    pub cartelas: usize,
    /// O limite de cartelas — o piso provado.
    pub teto: usize,
    /// Cobertura do conjunto atual, de 0 a 1.
    pub cobertura: f64,
    /// A melhor cobertura já alcançada, de 0 a 1.
    pub melhor_cobertura: f64,
    /// Quantas cartelas tem o conjunto que alcançou a melhor cobertura.
    pub melhor_cartelas: usize,
    pub fase: Fase,
    /// Unidades de trabalho gastas desde o início.
    pub trabalho: u64,
    /// Quantas rodadas de reorganização já foram feitas.
    pub rodadas: u64,
    /// Verdadeiro quando a cobertura fechou em 100%.
    pub fechou: bool,
}

/// O estado inteiro, para guardar e retomar depois.
///
/// As cartelas vão como máscaras — um número por cartela — porque assim um
/// conjunto de milhares cabe folgado no armazenamento do navegador.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EstadoSalvo {
    pub v: usize,
    pub k: usize,
    pub j: usize,
    pub t: usize,
    pub r: usize,
    pub teto: usize,
    pub cartelas: Vec<Bloco>,
    pub melhor: Vec<Bloco>,
    pub fase: Fase,
    pub trabalho: u64,
    pub rodadas: u64,
    pub sem_ganho: u32,
    pub semente: u64,
    #[serde(default)]
    pub curva: Vec<(u32, f32)>,
    #[serde(default = "um")]
    pub passo_da_curva: usize,
}

fn um() -> usize {
    1
}

/// A escalada, com estado e continuável.
pub struct Escalada {
    p: Problema,
    teto: usize,
    colex: Colex,
    do_bloco: AlvosDoBloco,
    do_alvo: BlocosDoAlvo,
    total_de_alvos: usize,
    /// Cópias exigidas ao todo: `alvos × premiadas`.
    exigidas: u64,
    candidatas_por_passo: usize,

    /// Por posição colex do alvo, quantas cartelas do conjunto atual o atendem.
    ///
    /// A contagem **não** é limitada em `r`: assim tirar uma cartela é subtrair
    /// um de cada alvo dela, exato, sem precisar saber o que já estava cheio.
    vezes: Vec<u16>,
    /// Cópias efetivamente entregues — a soma de `min(vezes, r)`.
    entregues: u64,

    cartelas: Vec<Bloco>,
    melhor: Vec<Bloco>,
    melhor_entregues: u64,

    fase: Fase,
    trabalho: u64,
    rodadas: u64,
    sem_ganho: u32,
    semente: u64,

    /// A curva: por quantas cartelas, que cobertura.
    curva: Vec<(u32, f32)>,
    /// De quantas em quantas cartelas a curva ainda guarda um ponto.
    passo_da_curva: usize,
}

impl Escalada {
    /// Uma escalada nova, com o teto que o piso determinou.
    pub fn nova(p: &Problema, teto: usize) -> Escalada {
        let alvos_por_bloco = p.alvos_por_bloco().max(1);
        let cabe = (ALVOS_POR_PASSO / alvos_por_bloco) as usize;
        let candidatas_por_passo = cabe.clamp(MINIMO_DE_CANDIDATAS, TETO_DE_CANDIDATAS);
        let total_de_alvos = p.total_de_alvos();

        Escalada {
            p: *p,
            teto: teto.max(1),
            colex: Colex::nova(),
            do_bloco: AlvosDoBloco::novo(p),
            do_alvo: BlocosDoAlvo::novo(p),
            total_de_alvos,
            exigidas: total_de_alvos as u64 * p.r as u64,
            candidatas_por_passo,
            vezes: vec![0; total_de_alvos],
            entregues: 0,
            cartelas: Vec::new(),
            melhor: Vec::new(),
            melhor_entregues: 0,
            fase: Fase::Subindo,
            trabalho: 0,
            rodadas: 0,
            sem_ganho: 0,
            semente: 0x243F_6A88_85A3_08D3,
            curva: Vec::new(),
            passo_da_curva: 1,
        }
    }

    /// As cartelas do melhor conjunto já alcançado.
    pub fn melhor(&self) -> &[Bloco] {
        &self.melhor
    }

    /// As cartelas do conjunto em que ela está mexendo agora.
    pub fn atual(&self) -> &[Bloco] {
        &self.cartelas
    }

    pub fn teto(&self) -> usize {
        self.teto
    }

    pub fn fase(&self) -> Fase {
        self.fase
    }

    /// A curva de cobertura: por quantas cartelas, quanto já estava coberto.
    pub fn curva(&self) -> &[(u32, f32)] {
        &self.curva
    }

    fn fracao(&self, entregues: u64) -> f64 {
        if self.exigidas == 0 {
            return 1.0;
        }
        entregues as f64 / self.exigidas as f64
    }

    pub fn passo(&self) -> Passo {
        Passo {
            cartelas: self.cartelas.len(),
            teto: self.teto,
            cobertura: self.fracao(self.entregues),
            melhor_cobertura: self.fracao(self.melhor_entregues),
            melhor_cartelas: self.melhor.len(),
            fase: self.fase,
            trabalho: self.trabalho,
            rodadas: self.rodadas,
            fechou: self.melhor_entregues >= self.exigidas,
        }
    }

    /// Trabalha o tanto que lhe pedirem, e devolve onde parou.
    ///
    /// Depois de qualquer chamada, com qualquer orçamento, vale sempre
    /// `atual().len() <= teto()`. É a regra que o módulo existe para respeitar.
    pub fn avancar(&mut self, orcamento: u64) -> Passo {
        let ate = self.trabalho.saturating_add(orcamento.max(1));
        while self.trabalho < ate && self.fase != Fase::Fechada {
            match self.fase {
                Fase::Subindo => self.subir_um_degrau(),
                Fase::Reorganizando => self.reorganizar_uma_rodada(),
                Fase::Fechada => break,
            }
        }
        self.passo()
    }

    /* ─────────── fase 1: subindo ─────────── */

    /// Acrescenta uma cartela — a que mais aumenta a cobertura.
    fn subir_um_degrau(&mut self) {
        if self.cartelas.len() >= self.teto {
            self.fase = Fase::Reorganizando;
            return;
        }
        match self.melhor_acrescimo() {
            Some(cartela) => {
                self.por(cartela);
                self.anotar_na_curva();
                self.registrar();
                if self.entregues >= self.exigidas {
                    self.fase = Fase::Fechada;
                } else if self.cartelas.len() >= self.teto {
                    self.fase = Fase::Reorganizando;
                }
            }
            // Nenhuma cartela acrescenta nada: subir mais não ajuda.
            None => self.fase = Fase::Reorganizando,
        }
    }

    /// Anota um ponto da curva, afinando quando ela fica longa demais.
    fn anotar_na_curva(&mut self) {
        let cartelas = self.cartelas.len();
        if cartelas % self.passo_da_curva != 0 {
            return;
        }
        self.curva.push((cartelas as u32, self.fracao(self.entregues) as f32));
        if self.curva.len() > PONTOS_DA_CURVA {
            // Fica com um ponto sim, um não: a curva mantém a forma, pela
            // metade do tamanho.
            let mut n = 0;
            self.curva.retain(|_| {
                n += 1;
                n % 2 == 1
            });
            self.passo_da_curva *= 2;
        }
    }

    /// A cartela que mais cópias em falta acrescenta, entre uma amostra das que
    /// atendem um alvo ainda descoberto.
    fn melhor_acrescimo(&mut self) -> Option<Bloco> {
        let alvo = self.um_alvo_em_falta()?;
        let mut candidatas: Vec<Bloco> = Vec::new();
        let (p, do_alvo) = (self.p, &self.do_alvo);
        do_alvo.para_cada(&p, alvo, &mut |b| candidatas.push(b));
        self.trabalho += candidatas.len().max(1) as u64;
        // Uma cartela que já está no conjunto não acrescenta cópia nenhuma, por
        // mais que a conta de ganho diga o contrário.
        candidatas.retain(|b| !self.cartelas.contains(b));
        if candidatas.is_empty() {
            return None;
        }

        let quantas = self.candidatas_por_passo.min(candidatas.len());
        let salto = (candidatas.len() / quantas).max(1);
        let inicio = proximo(&mut self.semente) as usize % candidatas.len();

        let mut melhores: Vec<Bloco> = Vec::new();
        let mut maior = 0u64;
        for n in 0..quantas {
            let b = candidatas[(inicio + n * salto) % candidatas.len()];
            let ganho = self.ganho_de(b);
            if ganho > maior {
                maior = ganho;
                melhores.clear();
                melhores.push(b);
            } else if ganho == maior {
                melhores.push(b);
            }
        }
        if maior == 0 {
            return None;
        }
        Some(melhores[proximo(&mut self.semente) as usize % melhores.len()])
    }

    /* ─────────── fase 2: reorganizando, com o número travado ─────────── */

    /// Uma rodada de reescrita: derruba um pedaço e o refaz.
    ///
    /// O pedaço cresce quando muitas rodadas passam sem ganho — é o que tira a
    /// busca de um platô sem nunca acrescentar cartela. Uma cartela derrubada é
    /// sempre reposta, então o conjunto volta ao mesmo tamanho.
    fn reorganizar_uma_rodada(&mut self) {
        self.rodadas += 1;
        if self.cartelas.is_empty() {
            self.fase = Fase::Subindo;
            return;
        }

        let antes = self.entregues;
        let guardado = self.cartelas.clone();

        let escala = (self.sem_ganho / PACIENCIA) as usize;
        let quantas = (1 + escala).min(self.cartelas.len().max(1) / 2).max(1);

        for _ in 0..quantas {
            if self.cartelas.is_empty() {
                break;
            }
            let i = proximo(&mut self.semente) as usize % self.cartelas.len();
            let fora = self.cartelas.swap_remove(i);
            self.tirar(fora);
        }

        // E repõe exatamente as que saíram: o tamanho é lei.
        while self.cartelas.len() < guardado.len() {
            match self.melhor_acrescimo() {
                Some(cartela) => self.por(cartela),
                None => break,
            }
        }

        if self.entregues >= antes {
            self.registrar();
            if self.entregues > antes {
                self.sem_ganho = 0;
            } else {
                self.sem_ganho = self.sem_ganho.saturating_add(1);
            }
        } else {
            // Piorou: desfaz e tenta outro caminho na próxima rodada.
            self.trocar_conjunto(guardado);
            self.sem_ganho = self.sem_ganho.saturating_add(1);
        }

        if self.entregues >= self.exigidas {
            self.registrar();
            self.fase = Fase::Fechada;
        }
    }

    /* ─────────── a contabilidade da cobertura ─────────── */

    /// Quantas cópias em falta esta cartela acrescentaria.
    fn ganho_de(&mut self, bloco: Bloco) -> u64 {
        let alvo_r = self.p.r as u16;
        let mut ganho = 0u64;
        let mut vistos = 0u64;
        let (p, do_bloco, colex, vezes) = (self.p, &self.do_bloco, &self.colex, &self.vezes);
        do_bloco.para_cada(&p, bloco, &mut |a| {
            vistos += 1;
            if vezes[colex.posicao(a) as usize] < alvo_r {
                ganho += 1;
            }
        });
        self.trabalho += vistos;
        ganho
    }

    fn por(&mut self, bloco: Bloco) {
        let alvo_r = self.p.r as u16;
        let mut entregues = self.entregues;
        let mut vistos = 0u64;
        {
            let (p, do_bloco, colex) = (self.p, &self.do_bloco, &self.colex);
            let vezes = &mut self.vezes;
            do_bloco.para_cada(&p, bloco, &mut |a| {
                let i = colex.posicao(a) as usize;
                vistos += 1;
                if vezes[i] < alvo_r {
                    entregues += 1;
                }
                vezes[i] += 1;
            });
        }
        self.entregues = entregues;
        self.trabalho += vistos;
        self.cartelas.push(bloco);
    }

    fn tirar(&mut self, bloco: Bloco) {
        let alvo_r = self.p.r as u16;
        let mut entregues = self.entregues;
        let mut vistos = 0u64;
        {
            let (p, do_bloco, colex) = (self.p, &self.do_bloco, &self.colex);
            let vezes = &mut self.vezes;
            do_bloco.para_cada(&p, bloco, &mut |a| {
                let i = colex.posicao(a) as usize;
                vistos += 1;
                vezes[i] -= 1;
                if vezes[i] < alvo_r {
                    entregues -= 1;
                }
            });
        }
        self.entregues = entregues;
        self.trabalho += vistos;
    }

    /// Troca o conjunto inteiro, refazendo a contagem do zero.
    fn trocar_conjunto(&mut self, novo: Vec<Bloco>) {
        self.vezes.iter_mut().for_each(|n| *n = 0);
        self.entregues = 0;
        self.cartelas.clear();
        for b in novo {
            self.por(b);
        }
    }

    /// Guarda o conjunto atual se ele bateu o recorde de cobertura.
    ///
    /// O recorde nunca regride: a reorganização aceita um movimento lateral para
    /// sair de um platô, e sem esta cópia à parte a tela veria a cobertura
    /// piorar sozinha.
    fn registrar(&mut self) {
        if self.entregues > self.melhor_entregues || self.melhor.is_empty() {
            self.melhor_entregues = self.entregues;
            self.melhor = self.cartelas.clone();
        }
    }

    /// Um alvo que ainda não tem as `r` cópias, a partir de um ponto sorteado.
    ///
    /// A varredura recomeça a cada chamada porque, na reorganização, a cobertura
    /// **diminui** quando uma cartela sai — um cursor que só andasse para a
    /// frente perderia os alvos que voltaram a faltar.
    fn um_alvo_em_falta(&mut self) -> Option<Bloco> {
        let alvo_r = self.p.r as u16;
        if self.total_de_alvos == 0 {
            return None;
        }
        let inicio = proximo(&mut self.semente) as usize % self.total_de_alvos;
        for passo in 0..self.total_de_alvos {
            let i = (inicio + passo) % self.total_de_alvos;
            if self.vezes[i] < alvo_r {
                self.trabalho += passo as u64 + 1;
                return Some(crate::problema::combinacao_colex(i as u128, self.p.j));
            }
        }
        self.trabalho += self.total_de_alvos as u64;
        None
    }

    /* ─────────── guardar e retomar ─────────── */

    pub fn guardar(&self) -> EstadoSalvo {
        EstadoSalvo {
            v: self.p.v,
            k: self.p.k,
            j: self.p.j,
            t: self.p.t,
            r: self.p.r,
            teto: self.teto,
            cartelas: self.cartelas.clone(),
            melhor: self.melhor.clone(),
            fase: self.fase,
            trabalho: self.trabalho,
            rodadas: self.rodadas,
            sem_ganho: self.sem_ganho,
            semente: self.semente,
            curva: self.curva.clone(),
            passo_da_curva: self.passo_da_curva,
        }
    }

    /// Retoma de onde parou, refazendo a contagem a partir das cartelas.
    ///
    /// A contagem é reconstruída, e não guardada: são milhões de posições, e
    /// recalculá-las custa uma passada pelas cartelas — barato, e imune a um
    /// estado que tenha envelhecido mal.
    pub fn retomar(estado: &EstadoSalvo) -> Result<Escalada, ErroDoProblema> {
        let p = Problema::novo(estado.v, estado.k, estado.j, estado.t, estado.r)?;
        let mut escalada = Escalada::nova(&p, estado.teto);
        escalada.trocar_conjunto(estado.cartelas.clone());
        escalada.melhor.clone_from(&estado.melhor);
        escalada.melhor_entregues = escalada.entregues_de(&estado.melhor);
        escalada.fase = estado.fase;
        escalada.trabalho = estado.trabalho;
        escalada.rodadas = estado.rodadas;
        escalada.sem_ganho = estado.sem_ganho;
        escalada.semente = estado.semente;
        escalada.curva.clone_from(&estado.curva);
        escalada.passo_da_curva = estado.passo_da_curva.max(1);
        Ok(escalada)
    }

    /// Quantas cópias um conjunto qualquer entrega, contadas do zero.
    fn entregues_de(&self, cartelas: &[Bloco]) -> u64 {
        let alvo_r = self.p.r as u16;
        let mut vezes = vec![0u16; self.total_de_alvos];
        for &b in cartelas {
            self.do_bloco.para_cada(&self.p, b, &mut |a| {
                vezes[self.colex.posicao(a) as usize] += 1;
            });
        }
        vezes.iter().map(|&n| n.min(alvo_r) as u64).sum()
    }
}

/// Um gerador linear congruente, para escolher sem chamar o sistema.
///
/// A semente é fixa e viaja no estado salvo: retomar continua o mesmo percurso
/// que teria acontecido sem a parada.
fn proximo(estado: &mut u64) -> u64 {
    *estado = estado.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *estado >> 33
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::limites;

    /// **A regra do aplicativo.** Em nenhum momento, em nenhuma fase, com nenhum
    /// orçamento, o conjunto passa do teto. É a primeira coisa cobrada.
    #[test]
    fn o_teto_nunca_e_ultrapassado() {
        for &(v, k, j, t, r, teto) in &[
            (9usize, 3usize, 2usize, 2usize, 1usize, 12usize),
            (9, 3, 2, 2, 1, 5),
            (10, 4, 2, 2, 1, 8),
            (13, 5, 2, 2, 1, 8),
            (9, 4, 3, 2, 2, 10),
        ] {
            let p = Problema::novo(v, k, j, t, r).unwrap();
            let mut escalada = Escalada::nova(&p, teto);
            for _ in 0..400 {
                let passo = escalada.avancar(2_000);
                assert!(
                    passo.cartelas <= teto,
                    "({v},{k},{j},{t},r={r}): {} cartelas com teto {teto}",
                    passo.cartelas
                );
                assert!(escalada.atual().len() <= teto);
                assert!(escalada.melhor().len() <= teto);
            }
        }
    }

    /// A cobertura que ela anuncia tem de ser a que o verificador enxerga. Um
    /// contador incremental que divergisse da varredura mentiria a cada passo.
    #[test]
    fn a_cobertura_relatada_bate_com_o_verificador() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 12);
        for _ in 0..60 {
            escalada.avancar(3_000);
            let atual = escalada.atual().to_vec();
            let descobertos = p.descobertos(&atual);
            let atendidos = p.total_de_alvos() - descobertos;
            let esperado = atendidos as f64 / p.total_de_alvos() as f64;
            let dito = escalada.passo().cobertura;
            assert!(
                (dito - esperado).abs() < 1e-9,
                "a escalada diz {dito:.6} e o verificador vê {esperado:.6}"
            );
        }
    }

    /// Com duas cartelas premiadas a conta é sobre cópias, não sobre alvos.
    #[test]
    fn a_cobertura_conta_copias_quando_ha_premiadas() {
        let p = Problema::novo(9, 3, 2, 2, 2).unwrap();
        let mut escalada = Escalada::nova(&p, 30);
        for _ in 0..80 {
            escalada.avancar(5_000);
        }
        let passo = escalada.passo();
        assert!(passo.cobertura <= 1.0);
        if passo.melhor_cobertura >= 1.0 {
            assert_eq!(p.descobertos(escalada.melhor()), 0, "cobertura cheia tem de passar");
        }
    }

    /// O recorde nunca regride, mesmo quando a reorganização aceita um movimento
    /// lateral para sair do platô.
    #[test]
    fn a_melhor_cobertura_nunca_piora() {
        let p = Problema::novo(11, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 9);
        let mut anterior = 0.0;
        for _ in 0..300 {
            let passo = escalada.avancar(2_000);
            assert!(
                passo.melhor_cobertura >= anterior - 1e-12,
                "a melhor cobertura caiu de {anterior} para {}",
                passo.melhor_cobertura
            );
            anterior = passo.melhor_cobertura;
        }
    }

    /// **O caso em que o piso é alcançável, de ponta a ponta.**
    ///
    /// Em 18 dezenas com jogos de 17, saindo 15 e garantindo 15, o piso de
    /// Schönheim é 16 — e 16 cartelas fecham. A escalada tem de chegar a 100%
    /// com exatamente 16, sem nunca ter passado disso.
    #[test]
    fn onde_o_piso_e_alcancavel_ela_fecha_exatamente_nele() {
        let p = Problema::novo(18, 17, 15, 15, 1).unwrap();
        let piso = limites::sem_busca(&p).valor as usize;
        assert_eq!(piso, 16, "o piso de C(18,17,15)");

        let mut escalada = Escalada::nova(&p, piso);
        let mut passo = escalada.passo();
        for _ in 0..2_000 {
            passo = escalada.avancar(200_000);
            if passo.fechou {
                break;
            }
        }
        assert!(passo.fechou, "não fechou: parou em {:.1}%", passo.melhor_cobertura * 100.0);
        assert_eq!(escalada.melhor().len(), 16, "fechou com um número diferente do piso");
        assert!(p.cobre(escalada.melhor()), "o que ela diz que fecha precisa fechar");
    }

    /// **A curva que a tela mostra.** Um ponto por degrau da subida, na ordem,
    /// com a cobertura crescendo.
    ///
    /// E o que ela revela: a subida sozinha chega ao teto **sem** fechar. Quem
    /// fecha é a reorganização, achando a disposição certa das mesmas doze
    /// cartelas sem nunca pedir a décima terceira.
    #[test]
    fn a_curva_registra_a_subida_e_a_reorganizacao_e_quem_fecha() {
        let p = Problema::novo(9, 3, 2, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 12);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(50_000);
        }
        let curva = escalada.curva().to_vec();
        assert_eq!(curva.len(), 12, "um ponto por cartela até o teto");
        assert_eq!(curva[0].0, 1, "o primeiro ponto é uma cartela");
        assert_eq!(curva[11].0, 12, "o último é o teto");
        for par in curva.windows(2) {
            assert!(par[1].0 > par[0].0, "as cartelas têm de crescer");
            assert!(par[1].1 >= par[0].1, "a cobertura não pode cair na subida");
        }
        // Uma cartela de 3 cobre 3 dos 36 pares.
        assert!((curva[0].1 - 3.0 / 36.0).abs() < 1e-6, "primeiro ponto: {}", curva[0].1);

        let mut passo = escalada.passo();
        for _ in 0..2_000 {
            passo = escalada.avancar(200_000);
            if passo.fechou {
                break;
            }
        }
        assert!(passo.fechou, "parou em {:.1}%", passo.melhor_cobertura * 100.0);
        assert_eq!(escalada.melhor().len(), 12, "fechou com um número diferente do teto");
        assert!(p.cobre(escalada.melhor()));
    }

    /// Num teto grande a curva é afinada em vez de crescer sem limite.
    #[test]
    fn a_curva_nao_cresce_sem_limite() {
        let p = Problema::novo(13, 5, 2, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 600);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(200_000);
        }
        let curva = escalada.curva();
        assert!(curva.len() <= PONTOS_DA_CURVA, "a curva tem {} pontos", curva.len());
        assert!(curva.len() > 10, "e ainda assim tem forma: {} pontos", curva.len());
        for par in curva.windows(2) {
            assert!(par[1].0 > par[0].0);
        }
    }

    /// Guardar e retomar devolve o mesmo estado, e a contagem é refeita certa.
    #[test]
    fn guardar_e_retomar_devolve_o_mesmo_estado() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();
        let mut original = Escalada::nova(&p, 10);
        for _ in 0..20 {
            original.avancar(5_000);
        }
        let antes = original.passo();
        let salvo = original.guardar();

        let retomada = Escalada::retomar(&salvo).unwrap();
        let depois = retomada.passo();
        assert_eq!(antes.cartelas, depois.cartelas);
        assert_eq!(antes.fase, depois.fase);
        assert_eq!(antes.trabalho, depois.trabalho);
        assert!((antes.cobertura - depois.cobertura).abs() < 1e-12);
        assert!((antes.melhor_cobertura - depois.melhor_cobertura).abs() < 1e-12);
        assert_eq!(original.melhor(), retomada.melhor());
        assert_eq!(original.curva(), retomada.curva());
        assert!(!retomada.curva().is_empty());
    }

    /// E continuar depois de retomar dá o mesmo que nunca ter parado.
    #[test]
    fn parar_no_meio_nao_muda_o_caminho() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();

        let mut direto = Escalada::nova(&p, 10);
        for _ in 0..40 {
            direto.avancar(4_000);
        }

        let mut aos_poucos = Escalada::nova(&p, 10);
        for _ in 0..20 {
            aos_poucos.avancar(4_000);
        }
        let salvo = aos_poucos.guardar();
        let mut retomada = Escalada::retomar(&salvo).unwrap();
        for _ in 0..20 {
            retomada.avancar(4_000);
        }

        assert_eq!(direto.melhor(), retomada.melhor(), "o caminho divergiu ao retomar");
        assert_eq!(direto.passo().cartelas, retomada.passo().cartelas);
    }

    /// Um teto de uma cartela só é um pedido legítimo, e ela obedece.
    #[test]
    fn um_teto_de_uma_cartela_e_respeitado() {
        let p = Problema::novo(9, 3, 2, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 1);
        for _ in 0..50 {
            let passo = escalada.avancar(5_000);
            assert!(passo.cartelas <= 1);
        }
        assert_eq!(escalada.melhor().len(), 1);
        // Uma cartela de 3 cobre 3 dos 36 pares.
        assert!((escalada.passo().melhor_cobertura - 3.0 / 36.0).abs() < 1e-9);
    }

    /// Com um teto apertado demais para fechar, a subida enche o teto e a
    /// reorganização assume — sem mexer no tamanho.
    ///
    /// O teto aqui é o piso de contagem de `C(11,4,3,2)`, que é 4: contar não
    /// enxerga o que a estrutura impede, então quatro cartelas não fecham.
    #[test]
    fn a_reorganizacao_mantem_o_numero_de_cartelas() {
        let p = Problema::novo(11, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 4);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(10_000);
        }
        let tamanho = escalada.atual().len();
        assert_eq!(tamanho, 4, "a subida devia ter enchido o teto");
        assert_eq!(escalada.fase(), Fase::Reorganizando, "com quatro não fecha");
        for _ in 0..200 {
            escalada.avancar(5_000);
            if escalada.fase() == Fase::Fechada {
                break;
            }
            assert_eq!(escalada.atual().len(), tamanho, "a reorganização mudou o tamanho");
        }
    }
}
