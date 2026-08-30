//! Construir **no alvo** — e não construir grande para depois encolher.
//!
//! A diferença é de natureza, não de eficiência. Encolher parte de uma solução
//! e pergunta o que sobra; construir no alvo parte do número e pergunta se ele
//! é alcançável. A segunda pergunta é a que interessa quando se quer o mínimo,
//! porque a resposta "não" também é informação — ela empurra o limite inferior.
//!
//! ## Gerar em vez de procurar
//!
//! A primeira versão deste módulo varria **todas** as cartelas candidatas a cada
//! passo. Num pool de 25 com jogos de 17 são 1.081.575 cartelas — e a construção
//! simplesmente não voltava.
//!
//! Mas as cartelas que atendem um sorteio dado não precisam ser procuradas: elas
//! podem ser **geradas**, escolhendo `i` números entre os `j` sorteados e `k−i`
//! entre os de fora. Naquele mesmo pool são **45**. A conta que não terminava
//! passa a caber num piscar, e é a mesma conta.
//!
//! ```text
//!   varrer todas as cartelas       1.081.575 por passo
//!   gerar as que atendem o alvo            45 por passo
//! ```
//!
//! ## Continuável
//!
//! A construção guarda o seu estado e anda por orçamento: `avancar` trabalha o
//! tanto que lhe pedirem e devolve onde parou. É o que permite a tela mostrar
//! progresso em vez de ficar muda, e o que permite parar no meio.

use crate::problema::{AlvosDoBloco, Bloco, BlocosDoAlvo, Colex, Problema};

/// Uma solução construída, com o nome do método que a produziu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Construcao {
    pub blocos: Vec<Bloco>,
    pub metodo: &'static str,
}

impl Construcao {
    pub fn tamanho(&self) -> usize {
        self.blocos.len()
    }
}

/// Quantas partidas gulosas antes de passar ao refino.
pub const PARTIDAS_ALVO: usize = 48;

/// Quantas rodadas de ruína e recriação depois delas.
pub const RODADAS_DE_REFINO: usize = 400;

/// Acima disto a construção por órbitas não é tentada.
///
/// O teto é sobre o **produto** `alvos × cartelas`, e não sobre as cartelas
/// sozinhas, porque é esse o custo de uma rodada dela: cada órbita candidata é
/// medida contra todos os alvos. Num pool de 23 com jogos de 18 são 16 bilhões
/// de operações por rodada — foi assim que ela travou a primeira medição, e o
/// número de cartelas sozinho não denunciava nada.
pub const TETO_DO_PRODUTO_DAS_ORBITAS: u128 = 8_000_000;

/// Quanto trabalho uma construção faz, no total, quando ninguém disse outra
/// coisa.
///
/// Sem um teto, um problema grande faria as 448 tentativas previstas e não
/// voltaria nunca — cada tentativa custa mil vezes mais nele do que num pequeno.
/// Com o teto, os pequenos fazem todas e os grandes fazem quantas couberem: a
/// degradação é suave, e a chamada sempre volta.
pub const TRABALHO_DE_UMA_CONSTRUCAO: u64 = 400_000_000;

/// Quantas cartelas candidatas o guloso chega a avaliar num passo.
///
/// Avaliar uma candidata custa `alvos_por_bloco`, e há configurações em que isso
/// são 700 mil alvos. Avaliar todas as 450 mil candidatas seria a mesma parede
/// de antes com outro nome; avaliar uma amostra espalhada mantém a escolha boa e
/// o passo finito.
pub const TETO_DE_CANDIDATAS_AVALIADAS: usize = 256;

/// E nunca menos que isto, para a escolha não virar sorteio puro.
pub const MINIMO_DE_CANDIDATAS_AVALIADAS: usize = 8;

/// Gira a máscara uma posição: `i → i + 1 (mod v)`.
pub fn girar(mascara: Bloco, v: usize) -> Bloco {
    let cheia = if v >= 32 { u32::MAX } else { (1u32 << v) - 1 };
    ((mascara << 1) | (mascara >> (v - 1))) & cheia
}

/// A menor rotação de uma máscara — o nome pelo qual a órbita inteira atende.
pub fn canonico(mascara: Bloco, v: usize) -> Bloco {
    let mut menor = mascara;
    let mut atual = mascara;
    for _ in 1..v {
        atual = girar(atual, v);
        menor = menor.min(atual);
    }
    menor
}

/// Todas as rotações distintas de uma máscara.
pub fn orbita(mascara: Bloco, v: usize) -> Vec<Bloco> {
    let mut saida = vec![mascara];
    let mut atual = girar(mascara, v);
    while atual != mascara {
        saida.push(atual);
        atual = girar(atual, v);
    }
    saida
}

/// Os representantes das órbitas de blocos de tamanho `k`.
pub fn orbitas_de_blocos(p: &Problema) -> Vec<Bloco> {
    let mut vistos = std::collections::HashSet::new();
    let mut saida = Vec::new();
    for b in p.blocos() {
        let c = canonico(b, p.v);
        if vistos.insert(c) {
            saida.push(c);
        }
    }
    saida.sort_unstable();
    saida
}

/// Quantas cópias ainda faltam a cada alvo, e quanto falta ao todo.
struct Tentativa {
    /// Por posição colex do alvo, quantas cartelas já o atendem (teto em `r`).
    vezes: Vec<u16>,
    /// Soma das cópias que ainda faltam.
    faltam: usize,
    /// Até onde já se sabe que os alvos estão satisfeitos.
    ///
    /// A cobertura só cresce dentro de uma tentativa, então o cursor nunca
    /// precisa voltar: o custo de achar o próximo alvo descoberto é `O(alvos)`
    /// na tentativa inteira, e não a cada passo.
    cursor: usize,
    escolhidos: Vec<Bloco>,
    /// As cartelas já escolhidas nesta tentativa.
    ///
    /// Uma cartela contribui com **uma** cópia para cada alvo que atende, e
    /// escolhê-la duas vezes não acrescenta a segunda. Sem esta lembrança a
    /// contagem interna dizia que a cobertura fechou e a coleção, depois de
    /// tirar a repetida, não cobria — um erro que só o verificador pegava.
    usados: std::collections::HashSet<Bloco>,
}

/// Onde a construção está.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Andamento {
    /// Quantas partidas já terminaram.
    pub partidas: usize,
    /// Quantas estão previstas ao todo.
    pub partidas_previstas: usize,
    /// O tamanho da melhor solução até agora, ou zero se ainda não há uma.
    pub melhor: usize,
    /// Unidades de trabalho gastas desde o início.
    pub trabalho: u64,
    /// Verdadeiro quando não há mais o que tentar.
    pub terminou: bool,
}

/// A construção, com estado e continuável.
pub struct Construtor {
    p: Problema,
    colex: Colex,
    do_bloco: AlvosDoBloco,
    do_alvo: BlocosDoAlvo,
    total_de_alvos: usize,
    candidatas_por_passo: usize,
    melhor: Vec<Bloco>,
    metodo: &'static str,
    tentativa: Option<Tentativa>,
    partidas: usize,
    refinos: usize,
    trabalho: u64,
    sorteio: u64,
    orbitas_tentadas: bool,
    teto_de_trabalho: u64,
}

impl Construtor {
    pub fn novo(p: &Problema) -> Construtor {
        Construtor::com_teto(p, TRABALHO_DE_UMA_CONSTRUCAO)
    }

    /// A construção com um teto de trabalho escolhido de fora.
    ///
    /// Quem conhece o orçamento é a tela: num aparelho pequeno alguns segundos,
    /// num computador o tempo que a pessoa quiser dar.
    pub fn com_teto(p: &Problema, teto_de_trabalho: u64) -> Construtor {
        let alvos_por_bloco = p.alvos_por_bloco().max(1);
        // Quantas candidatas cabem num passo, dado o que custa avaliar cada uma.
        // O teto por passo é o que define a granularidade da fatia: o orçamento
        // só é conferido **entre** passos, então um passo caro demais faz a
        // fatia estourar o tempo e a tela engasgar. Quatrocentos mil alvos por
        // passo dão cerca de vinte milissegundos, que cabem confortavelmente
        // numa fatia de cento e vinte.
        let cabe = (400_000u128 / alvos_por_bloco) as usize;
        let candidatas_por_passo =
            cabe.clamp(MINIMO_DE_CANDIDATAS_AVALIADAS, TETO_DE_CANDIDATAS_AVALIADAS);

        Construtor {
            p: *p,
            colex: Colex::nova(),
            do_bloco: AlvosDoBloco::novo(p),
            do_alvo: BlocosDoAlvo::novo(p),
            total_de_alvos: p.total_de_alvos(),
            candidatas_por_passo,
            melhor: Vec::new(),
            metodo: "guloso pelo alvo mais apertado",
            tentativa: None,
            partidas: 0,
            refinos: 0,
            trabalho: 0,
            sorteio: 0x243F_6A88_85A3_08D3,
            orbitas_tentadas: false,
            teto_de_trabalho: teto_de_trabalho.max(1),
        }
    }

    pub fn melhor(&self) -> &[Bloco] {
        &self.melhor
    }

    pub fn construcao(&self) -> Construcao {
        Construcao { blocos: self.melhor.clone(), metodo: self.metodo }
    }

    pub fn andamento(&self) -> Andamento {
        Andamento {
            partidas: self.partidas,
            partidas_previstas: PARTIDAS_ALVO + RODADAS_DE_REFINO,
            melhor: self.melhor.len(),
            trabalho: self.trabalho,
            terminou: self.terminou(),
        }
    }

    /// Verdadeiro quando não há mais o que tentar — ou porque as tentativas
    /// previstas acabaram, ou porque o orçamento de trabalho acabou.
    ///
    /// A tentativa em curso nunca é abandonada no meio: sem isso um problema
    /// grande poderia estourar o teto antes da primeira solução e devolver as
    /// mãos vazias.
    pub fn terminou(&self) -> bool {
        if self.tentativa.is_some() {
            return false;
        }
        let previstas = self.partidas >= PARTIDAS_ALVO && self.refinos >= RODADAS_DE_REFINO;
        previstas || self.trabalho >= self.teto_de_trabalho
    }

    /// Trabalha o tanto que lhe pedirem, e devolve onde parou.
    ///
    /// O orçamento é medido em unidades de trabalho — alvos marcados e alvos
    /// avaliados — e não em partidas, porque uma partida pode custar mil vezes
    /// mais que outra conforme o tamanho do problema. Contar o que de fato se
    /// gastou é o que faz cada fatia durar o mesmo em qualquer configuração.
    pub fn avancar(&mut self, orcamento: u64) -> Andamento {
        let ate = self.trabalho.saturating_add(orcamento.max(1));

        // A construção por órbitas é a primeira tentativa quando cabe: ela
        // impõe a simetria do problema e costuma nascer bem abaixo do guloso.
        if !self.orbitas_tentadas {
            self.orbitas_tentadas = true;
            let produto = self.p.total_de_blocos() * self.p.total_de_alvos() as u128;
            if produto <= TETO_DO_PRODUTO_DAS_ORBITAS {
                if let Some(c) = por_orbitas(&self.p) {
                    self.guardar(c.blocos, "órbitas do grupo cíclico");
                }
                self.trabalho += self.total_de_alvos as u64;
            }
        }

        while self.trabalho < ate && !self.terminou() {
            if self.tentativa.is_none() {
                self.comecar_tentativa();
            }
            self.passos(ate);
            if self.tentativa.as_ref().is_some_and(|t| t.faltam == 0) {
                self.fechar_tentativa();
            }
        }
        self.andamento()
    }

    /* ─────────── uma tentativa ─────────── */

    fn comecar_tentativa(&mut self) {
        let mut vezes = vec![0u16; self.total_de_alvos];
        let mut faltam = self.total_de_alvos * self.p.r;
        let mut escolhidos = Vec::new();

        // Depois das partidas vem a ruína e recriação: derruba um pedaço da
        // melhor solução e reconstrói o resto. Uma construção gulosa costuma
        // ficar presa por causa de duas ou três escolhas ruins feitas cedo, que
        // ela não tem como desfazer — derrubar um pedaço desfaz exatamente isso.
        if self.partidas >= PARTIDAS_ALVO && self.melhor.len() >= 3 {
            let quantos = (self.melhor.len() / 4).max(1);
            let mut fora = vec![false; self.melhor.len()];
            for _ in 0..quantos {
                let sorte = proximo(&mut self.sorteio) as usize % self.melhor.len();
                fora[sorte] = true;
            }
            for (i, &b) in self.melhor.iter().enumerate() {
                if !fora[i] {
                    escolhidos.push(b);
                }
            }
            for &b in &escolhidos {
                Self::marcar(
                    &self.p,
                    &self.colex,
                    &self.do_bloco,
                    &mut vezes,
                    &mut faltam,
                    b,
                    &mut self.trabalho,
                );
            }
        }

        let usados = escolhidos.iter().copied().collect();
        self.tentativa = Some(Tentativa { vezes, faltam, cursor: 0, escolhidos, usados });
    }

    /// Dá passos gulosos até fechar a cobertura ou o orçamento acabar.
    fn passos(&mut self, ate: u64) {
        let Some(mut tentativa) = self.tentativa.take() else { return };
        let alvo_r = self.p.r.min(u16::MAX as usize) as u16;
        let por_bloco = self.p.alvos_por_bloco().min(u64::MAX as u128) as u64;
        let mut candidatas: Vec<Bloco> = Vec::new();
        let mut empatadas: Vec<Bloco> = Vec::new();

        while self.trabalho < ate && tentativa.faltam > 0 {
            // O próximo alvo ainda descoberto. O cursor só anda para a frente
            // porque a cobertura só cresce dentro de uma tentativa.
            while tentativa.cursor < self.total_de_alvos
                && tentativa.vezes[tentativa.cursor] >= alvo_r
            {
                tentativa.cursor += 1;
            }
            if tentativa.cursor >= self.total_de_alvos {
                // Não há alvo descoberto e ainda assim `faltam` não zerou: só
                // aconteceria se a contagem se perdesse. Fecha como está, e o
                // verificador dirá o que houve.
                tentativa.faltam = 0;
                break;
            }
            let alvo = crate::problema::combinacao_colex(tentativa.cursor as u128, self.p.j);

            // As candidatas: geradas, não procuradas — e sem as que já entraram,
            // porque uma cartela repetida não acrescenta cópia nenhuma.
            candidatas.clear();
            self.do_alvo.para_cada(&self.p, alvo, &mut |b| {
                if !tentativa.usados.contains(&b) {
                    candidatas.push(b);
                }
            });
            self.trabalho += candidatas.len().max(1) as u64;
            if candidatas.is_empty() {
                tentativa.faltam = 0;
                break;
            }

            // A amostra a avaliar, espalhada pela lista para não ficar presa a
            // um canto do espaço.
            let quantas = self.candidatas_por_passo.min(candidatas.len());
            let salto = (candidatas.len() / quantas).max(1);
            let inicio = proximo(&mut self.sorteio) as usize % candidatas.len();

            // Entre as de ganho máximo o desempate é sorteado, e não pelo
            // índice. Num sistema de Steiner **todas** empatam no começo, e
            // desempatar sempre do mesmo jeito prendia a construção duas
            // cartelas acima do mínimo.
            empatadas.clear();
            let mut maior = 0usize;
            for n in 0..quantas {
                let i = (inicio + n * salto) % candidatas.len();
                let b = candidatas[i];
                let mut ganho = 0usize;
                self.do_bloco.para_cada(&self.p, b, &mut |a| {
                    let pos = self.colex.posicao(a) as usize;
                    if tentativa.vezes[pos] < alvo_r {
                        ganho += 1;
                    }
                });
                self.trabalho += por_bloco;
                if ganho > maior {
                    maior = ganho;
                    empatadas.clear();
                    empatadas.push(b);
                } else if ganho == maior {
                    empatadas.push(b);
                }
            }
            let escolha = empatadas[proximo(&mut self.sorteio) as usize % empatadas.len()];

            Self::marcar(
                &self.p,
                &self.colex,
                &self.do_bloco,
                &mut tentativa.vezes,
                &mut tentativa.faltam,
                escolha,
                &mut self.trabalho,
            );
            tentativa.usados.insert(escolha);
            tentativa.escolhidos.push(escolha);
        }

        self.tentativa = Some(tentativa);
    }

    fn fechar_tentativa(&mut self) {
        let Some(tentativa) = self.tentativa.take() else { return };
        let mut blocos = tentativa.escolhidos;
        blocos.sort_unstable();
        blocos.dedup();
        podar(&self.p, &mut blocos);
        self.trabalho += (blocos.len() as u64) * 2;

        if self.partidas < PARTIDAS_ALVO {
            self.partidas += 1;
            self.guardar(blocos, "guloso pelo alvo mais apertado");
        } else {
            self.refinos += 1;
            self.guardar(blocos, "guloso com ruína e recriação");
        }
    }

    fn guardar(&mut self, blocos: Vec<Bloco>, metodo: &'static str) {
        if blocos.is_empty() {
            return;
        }
        if self.melhor.is_empty() || blocos.len() < self.melhor.len() {
            self.melhor = blocos;
            self.metodo = metodo;
        }
    }

    /// Marca os alvos que uma cartela atende, e desconta o que ela resolveu.
    fn marcar(
        p: &Problema,
        colex: &Colex,
        do_bloco: &AlvosDoBloco,
        vezes: &mut [u16],
        faltam: &mut usize,
        bloco: Bloco,
        trabalho: &mut u64,
    ) {
        let alvo_r = p.r.min(u16::MAX as usize) as u16;
        let mut marcados = 0u64;
        do_bloco.para_cada(p, bloco, &mut |a| {
            let pos = colex.posicao(a) as usize;
            marcados += 1;
            if vezes[pos] < alvo_r {
                vezes[pos] += 1;
                *faltam -= 1;
            }
        });
        *trabalho += marcados;
    }

}

/// Um gerador linear congruente, para desempatar sem chamar o sistema.
///
/// A semente é fixa: o construtor continua determinístico, e duas execuções com
/// os mesmos parâmetros produzem a mesma coleção — inclusive quando uma anda em
/// fatias e a outra de uma vez só.
fn proximo(estado: &mut u64) -> u64 {
    *estado = estado.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *estado >> 33
}

/// Constrói impondo a simetria cíclica: escolhe **órbitas**, não cartelas.
///
/// Cada órbita escolhida entra inteira, com todas as suas rotações. O espaço de
/// escolha encolhe por um fator de aproximadamente `v`, e o que sobra é
/// exatamente a família onde as coberturas com estrutura vivem.
pub fn por_orbitas(p: &Problema) -> Option<Construcao> {
    let representantes = orbitas_de_blocos(p);
    if representantes.is_empty() {
        return None;
    }
    let alvos = p.alvos();
    let alvo_r = p.r.min(u16::MAX as usize) as u16;
    let mut vezes = vec![0u16; alvos.len()];
    let mut faltam = alvos.len() * p.r;
    let mut escolhidos: Vec<Bloco> = Vec::new();
    // Uma órbita já escolhida não tem o que acrescentar de novo: as suas
    // cartelas já estão na coleção, e uma cartela contribui com uma cópia só.
    let mut usadas = vec![false; representantes.len()];

    // O ganho de uma órbita é o que **todas** as suas rotações acrescentam
    // juntas — é ela, e não uma cartela solta, a unidade de escolha.
    while faltam > 0 {
        let mut melhor: Option<(usize, usize, usize)> = None; // (índice, ganho, tamanho)
        for (i, &rep) in representantes.iter().enumerate() {
            if usadas[i] {
                continue;
            }
            let rotacoes = orbita(rep, p.v);
            let mut ganho = 0usize;
            for (j, &a) in alvos.iter().enumerate() {
                let mut sobra = alvo_r.saturating_sub(vezes[j]) as usize;
                if sobra == 0 {
                    continue;
                }
                for &b in &rotacoes {
                    if sobra == 0 {
                        break;
                    }
                    if p.atende(a, b) {
                        ganho += 1;
                        sobra -= 1;
                    }
                }
            }
            if ganho == 0 {
                continue;
            }
            // Entre órbitas, vence a que rende mais por cartela gasta.
            let melhor_agora = melhor.map_or(true, |(_, g, t)| ganho * t > g * rotacoes.len());
            if melhor_agora {
                melhor = Some((i, ganho, rotacoes.len()));
            }
        }
        let Some((i, _, _)) = melhor else { break };
        usadas[i] = true;
        for b in orbita(representantes[i], p.v) {
            for (j, &a) in alvos.iter().enumerate() {
                if vezes[j] < alvo_r && p.atende(a, b) {
                    vezes[j] += 1;
                    faltam -= 1;
                }
            }
            escolhidos.push(b);
        }
    }

    if faltam > 0 {
        return None;
    }
    escolhidos.sort_unstable();
    escolhidos.dedup();
    podar(p, &mut escolhidos);
    Some(Construcao { blocos: escolhidos, metodo: "órbitas do grupo cíclico" })
}

/// Tira cartelas que se tornaram supérfluas.
///
/// Um guloso deixa sobras: uma cartela escolhida cedo pode ter todos os seus
/// alvos já atendidos `r` vezes pelas que vieram depois. O que importa é que a
/// cobertura seja conferida a cada retirada, e não presumida.
pub fn podar(p: &Problema, blocos: &mut Vec<Bloco>) {
    let colex = Colex::nova();
    let do_bloco = AlvosDoBloco::novo(p);
    let total = p.total_de_alvos();
    let mut vezes = vec![0u32; total];
    for &b in blocos.iter() {
        do_bloco.para_cada(p, b, &mut |a| {
            vezes[colex.posicao(a) as usize] += 1;
        });
    }

    let r = p.r as u32;
    let mut sobrando = Vec::with_capacity(blocos.len());
    for &b in blocos.iter() {
        let mut dispensavel = true;
        do_bloco.para_cada(p, b, &mut |a| {
            if vezes[colex.posicao(a) as usize] <= r {
                dispensavel = false;
            }
        });
        if dispensavel {
            do_bloco.para_cada(p, b, &mut |a| {
                vezes[colex.posicao(a) as usize] -= 1;
            });
        } else {
            sobrando.push(b);
        }
    }
    *blocos = sobrando;
}

/// A melhor construção que os métodos disponíveis conseguem, numa chamada só.
///
/// É o caminho de quem quer o resultado e não o espetáculo — a linha de comando
/// e os testes. A tela usa o [`Construtor`], que anda por orçamento e conta o
/// que está fazendo.
pub fn construir(p: &Problema) -> Construcao {
    let mut construtor = Construtor::novo(p);
    while !construtor.terminou() {
        construtor.avancar(20_000_000);
    }
    construtor.construcao()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn toda_construcao_cobre_de_verdade() {
        for &(v, k, t) in &[(7, 3, 2), (9, 3, 2), (8, 4, 3), (10, 4, 2), (11, 5, 3), (12, 4, 2)] {
            let p = Problema::cobertura(v, k, t).unwrap();
            let c = construir(&p);
            assert!(p.cobre(&c.blocos), "C({v},{k},{t}) por {}: não cobre", c.metodo);
            assert!(c.tamanho() > 0);
            // Sem cartela repetida: um fechamento com duplicata está pagando
            // duas vezes pela mesma cartela.
            let mut ordenados = c.blocos.clone();
            ordenados.sort_unstable();
            ordenados.dedup();
            assert_eq!(ordenados.len(), c.tamanho(), "C({v},{k},{t}) repetiu cartela");
        }
    }

    /// O caso que o modelo antigo não sabia descrever, e que agora precisa
    /// funcionar de ponta a ponta.
    #[test]
    fn constroi_com_sorteio_separado_da_garantia_e_com_premiadas() {
        for &(v, k, j, t, r) in
            &[(9, 4, 3, 2, 1), (10, 5, 4, 3, 1), (9, 4, 5, 2, 2), (8, 4, 4, 2, 3)]
        {
            let p = Problema::novo(v, k, j, t, r).unwrap();
            let c = construir(&p);
            assert!(
                p.cobre(&c.blocos),
                "({v},{k},{j},{t},r={r}) por {}: não cobre",
                c.metodo
            );
        }
    }

    #[test]
    fn a_poda_nunca_quebra_a_cobertura_nem_deixa_superfluo() {
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let mut blocos = p.blocos();
        podar(&p, &mut blocos);
        assert!(p.cobre(&blocos));
        // Depois de podar, tirar qualquer um quebra — é o que "sem supérfluo"
        // quer dizer, e é conferido e não presumido.
        for i in 0..blocos.len() {
            let mut sem = blocos.clone();
            sem.remove(i);
            assert!(!p.cobre(&sem), "o bloco {i} sobrou depois da poda");
        }
    }

    #[test]
    fn a_poda_respeita_as_copias_pedidas() {
        let p = Problema::novo(7, 3, 2, 2, 2).unwrap();
        let mut blocos = p.blocos();
        podar(&p, &mut blocos);
        assert!(p.cobre(&blocos), "a poda não pode derrubar a segunda cópia");
        for i in 0..blocos.len() {
            let mut sem = blocos.clone();
            sem.remove(i);
            assert!(!p.cobre(&sem), "o bloco {i} sobrou depois da poda");
        }
    }

    #[test]
    fn as_orbitas_sao_fechadas_por_rotacao() {
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let Some(c) = por_orbitas(&p) else { panic!("9,3,2 tem construção cíclica") };
        assert!(p.cobre(&c.blocos));
        let representantes = orbitas_de_blocos(&p);
        assert!(representantes.len() < p.blocos().len(), "as órbitas precisam encolher o espaço");
        for &r in &representantes {
            assert_eq!(canonico(r, 9), r, "o representante precisa ser o canônico");
        }
    }

    #[test]
    fn girar_v_vezes_devolve_a_mascara_original() {
        for v in 3..=16usize {
            for m in [0b1011u32, 0b111, 1, 0b10101] {
                let cheia = (1u32 << v) - 1;
                let m = m & cheia;
                let mut atual = m;
                for _ in 0..v {
                    atual = girar(atual, v);
                }
                assert_eq!(atual, m, "v={v}");
            }
        }
    }

    #[test]
    fn em_um_sistema_de_steiner_a_construcao_alcanca_o_minimo() {
        // C(9,3,2) = 12, e é um sistema de Steiner: a cota de contagem é exata.
        // Se o construtor não chega a 12 aqui, ele não está usando a estrutura.
        let p = Problema::cobertura(9, 3, 2).unwrap();
        let c = construir(&p);
        assert!(c.tamanho() <= 12, "chegou a {} e o mínimo é 12", c.tamanho());
    }

    /// **A garantia contra a tela muda.** Andar por orçamento tem de dar o mesmo
    /// resultado que andar de uma vez — se divergirem, o progresso na tela está
    /// contando uma história diferente do que o motor está fazendo.
    #[test]
    fn andar_em_fatias_da_no_mesmo_que_andar_de_uma_vez() {
        for &(v, k, j, t, r) in &[(9, 3, 2, 2, 1), (10, 4, 3, 2, 1), (8, 4, 4, 2, 2)] {
            let p = Problema::novo(v, k, j, t, r).unwrap();

            let inteiro = construir(&p);

            let mut fatiado = Construtor::novo(&p);
            let mut voltas = 0;
            while !fatiado.terminou() {
                fatiado.avancar(1_000);
                voltas += 1;
                assert!(voltas < 2_000_000, "a construção fatiada não termina");
            }
            assert!(voltas > 1, "a fatia precisa ser pequena o bastante para haver várias");
            assert_eq!(
                fatiado.construcao().blocos,
                inteiro.blocos,
                "({v},{k},{j},{t},r={r}) divergiu entre fatiado e inteiro"
            );
        }
    }

    /// O andamento precisa **andar**: é literalmente o que a tela mostra.
    #[test]
    fn o_andamento_avanca_e_termina() {
        let p = Problema::cobertura(10, 4, 2).unwrap();
        let mut construtor = Construtor::novo(&p);
        let primeiro = construtor.avancar(5_000);
        assert!(primeiro.trabalho > 0, "a primeira fatia não trabalhou");
        assert!(!primeiro.terminou);

        let mut anterior = primeiro;
        for _ in 0..100_000 {
            let agora = construtor.avancar(5_000);
            assert!(agora.trabalho >= anterior.trabalho, "o trabalho não pode andar para trás");
            if agora.terminou {
                assert!(agora.melhor > 0);
                return;
            }
            anterior = agora;
        }
        panic!("a construção não terminou em cem mil fatias");
    }

    /// O tamanho em que a versão anterior travava. Se este teste terminar, o
    /// defeito que motivou a reescrita está fechado.
    #[test]
    fn um_problema_de_tamanho_real_termina() {
        // Pool de 20, jogos de 15, saem 15, garante 13.
        let p = Problema::novo(20, 15, 15, 13, 1).unwrap();
        let mut construtor = Construtor::novo(&p);
        // Uma fatia generosa, mas finita: o que se cobra é que ela **volte**.
        let andamento = construtor.avancar(200_000_000);
        assert!(andamento.trabalho > 0);
        assert!(andamento.melhor > 0, "nem a primeira partida fechou");
        assert!(p.cobre(construtor.melhor()), "o que ele construiu não cobre");
    }
}
