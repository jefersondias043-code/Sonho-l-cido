//! # O Motor Construtor — o estágio 0 da otimização
//!
//! ## O que ele faz de diferente
//!
//! A busca de sempre trabalha por redução: parte de uma solução qualquer e vai
//! tirando cartelas. Este estágio trabalha ao contrário — **procura construir
//! direto uma solução pequena**, e só entrega o resultado quando não consegue
//! mais melhorá-lo dentro do tempo que recebeu.
//!
//! Quanto melhor a construção, menos trabalho sobra para os motores seguintes. E
//! o trabalho que sobra é o caro: uma iteração de busca num fechamento de dez mil
//! cartelas varre milhões de alvos, enquanto uma construção inteira aqui custa
//! segundos.
//!
//! ## As construções que concorrem
//!
//! Todas são deste projeto. Nenhuma consulta tabela de terceiros, banco externo
//! ou resultado publicado por outra pessoa — o que entra são os parâmetros, e o
//! que sai é o que estes algoritmos produzem.
//!
//! 1. **Algébrica** — quando a configuração tem forma fechada, sai pronta e
//!    costuma ser ótima. Custa microssegundos.
//! 2. **Gulosa por cartela** — monta cartela a cara, escolhendo a que cobre mais
//!    do que falta. Funciona em qualquer configuração.
//! 3. **Gulosa global** — escolhe entre todas as cartelas possíveis a cada
//!    passo, com uma fila de prioridade preguiçosa. Ganha onde faltam muitas
//!    dezenas ao jogo, que é onde a solução tem milhares de cartelas.
//! 4. **Por órbitas** — impõe a simetria do grupo cíclico e escolhe órbitas em
//!    vez de cartelas soltas. Em `23/17` são 4.389 candidatas em vez de 100.947,
//!    e foi assim que o banco deste projeto encolheu 160 cartelas.
//!
//! Vence a menor. Não há preferência: comparar custa nada, e é o que garante que
//! acrescentar uma construção nunca piore nenhum caso.
//!
//! ## Validação antes de entregar
//!
//! Nenhuma construção sai daqui sem que a cobertura tenha sido conferida. Uma
//! solução pequena e furada é pior que uma grande e correta: ela vira uma
//! garantia falsa na mão de quem apostou.

use std::time::Duration;

// No navegador não existe relógio de sistema, e `std::time::Instant::now()`
// **panica** no wasm32 — um `unreachable` sem mensagem, que custou uma bissecção
// inteira para achar. `web-time` cobre isso com o relógio do próprio navegador, e
// é o que o resto do motor já usa.
#[cfg(target_arch = "wasm32")]
use web_time::Instant;

#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

use motor_core::{Cartela, MotorCobertura, Objetivo, Problema, Solucao};
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

use crate::construcao::{construir_do_zero, construir_guloso_global, podar};
use crate::controle::Controle;
use crate::oficina::Oficina;
use crate::orbitas::InstanciaCiclica;
use motor_core::planos::semente_algebrica;

/// Uma construção encontrada, com o nome de quem a produziu.
#[derive(Debug, Clone)]
pub struct Achado {
    pub cartelas: Vec<Cartela>,
    pub origem: String,
}

/// Constrói a menor solução que conseguir dentro do orçamento.
///
/// `ao_melhorar` é chamado a cada construção que bate a anterior — é o que
/// permite à tela mostrar o estágio andando, em vez de um tempo parado.
///
/// Devolve `None` quando nenhuma construção fechou a cobertura, o que só
/// acontece se a parada for pedida antes da primeira terminar.
pub fn construir_o_menor(
    cobertura: &MotorCobertura,
    problema: &Problema,
    orcamento: Duration,
    semente: u64,
    oficina: &mut Oficina,
    ao_melhorar: &mut dyn FnMut(&Achado),
    parar: Option<&Controle>,
) -> Option<Achado> {
    let comeco = Instant::now();
    let mut rng = Pcg64Mcg::seed_from_u64(semente);
    let mut melhor: Option<Achado> = None;

    let oferecer = |candidata: &Solucao, origem: &str, melhor: &mut Option<Achado>| -> bool {
        // Validação, e não confiança: uma construção que não fecha a cobertura
        // não entra na comparação, mesmo que seja a menor de todas.
        if !candidata.cobertura_total() {
            return false;
        }
        let quantas = candidata.quantidade();
        if melhor.as_ref().is_some_and(|m| m.cartelas.len() <= quantas) {
            return false;
        }
        *melhor = Some(Achado { cartelas: candidata.cartelas().to_vec(), origem: origem.to_string() });
        true
    };

    let mut solucao = Solucao::vazia(cobertura);

    // ─── 1. algébrica: microssegundos, e às vezes já é o ótimo ───
    if let Some(semente_pronta) = semente_algebrica(problema) {
        solucao.reiniciar();
        for &cartela in &semente_pronta.cartelas {
            solucao.adicionar(cobertura, cartela, &mut oficina.rascunho);
        }
        podar(cobertura, &mut solucao, oficina);
        if oferecer(&solucao, &semente_pronta.origem, &mut melhor) {
            ao_melhorar(melhor.as_ref().unwrap());
        }
    }

    // ─── 2. gulosa por cartela: funciona em qualquer configuração ───
    if !parou(parar) {
        solucao.reiniciar();
        construir_do_zero(cobertura, &mut solucao, 0.15, usize::MAX, &mut rng, oficina, parar);
        podar(cobertura, &mut solucao, oficina);
        if oferecer(&solucao, "construção gulosa", &mut melhor) {
            ao_melhorar(melhor.as_ref().unwrap());
        }
    }

    // ─── 3. gulosa global: ganha onde a solução tem milhares de cartelas ───
    if !parou(parar) {
        let sobra = orcamento.saturating_sub(comeco.elapsed());
        // Um terço do orçamento, e no máximo: o resto fica para as órbitas, que
        // é onde há mais a ganhar quando elas cabem.
        let fatia = sobra / 3;
        for tentativa in 0..3u64 {
            if parou(parar) || comeco.elapsed() >= orcamento {
                break;
            }
            solucao.reiniciar();
            let deu = construir_guloso_global(
                cobertura,
                &mut solucao,
                fatia.max(Duration::from_millis(200)),
                semente.wrapping_add(tentativa),
                oficina,
                parar,
            );
            if !deu {
                break;
            }
            podar(cobertura, &mut solucao, oficina);
            if oferecer(&solucao, "guloso global", &mut melhor) {
                ao_melhorar(melhor.as_ref().unwrap());
            }
        }
    }

    // ─── 4. por órbitas: o resto do orçamento ───
    if !parou(parar) {
        let sobra = orcamento.saturating_sub(comeco.elapsed());
        if let Some(achado) = por_orbitas(cobertura, problema, sobra, &mut rng, parar, &mut |cartelas| {
            // Cada melhoria da busca por órbitas já vale um aviso à tela.
            let _ = cartelas;
        }) {
            solucao.reiniciar();
            for cartela in &achado {
                solucao.adicionar(cobertura, *cartela, &mut oficina.rascunho);
            }
            podar(cobertura, &mut solucao, oficina);
            if oferecer(&solucao, "órbitas cíclicas", &mut melhor) {
                ao_melhorar(melhor.as_ref().unwrap());
            }
        }
    }

    melhor
}

fn parou(parar: Option<&Controle>) -> bool {
    parar.is_some_and(|c| c.foi_solicitada_parada())
}

/// Constrói impondo a simetria do grupo cíclico `Z_pool`.
///
/// ## A troca que ela faz
///
/// Em vez de escolher cartelas, escolhe **órbitas**: cada cartela escolhida traz
/// de graça todas as suas rotações. Em `23/17` são 4.389 candidatas em vez de
/// 100.947, e 21.318 alvos em vez de 490.314 — outro problema, não o mesmo mais
/// rápido.
///
/// ## Onde ela trabalha
///
/// No espaço dos **complementos**. Uma cartela de `k` dezenas é o complemento de
/// `a = pool − k`; um alvo de `t` é o complemento de `b = pool − t`. "A cartela
/// contém o alvo" vira "as `a` que faltam à cartela estão entre as `b` que faltam
/// ao alvo" — `A ⊆ B`. A troca só vale quando a regra é conter o alvo inteiro,
/// então garantia parcial fica de fora e cai nas outras construções.
///
/// ## O que ela custa, e quando desiste
///
/// A tabela que liga órbitas a alvos é o que ocupa memória. Acima de
/// [`TETO_DE_LIGACOES`] ela devolve `None` sem tentar: num celular, montá-la
/// seria pedir para o navegador derrubar a aba.
fn por_orbitas(
    cobertura: &MotorCobertura,
    problema: &Problema,
    orcamento: Duration,
    rng: &mut Pcg64Mcg,
    parar: Option<&Controle>,
    _ao_melhorar: &mut dyn FnMut(&[Cartela]),
) -> Option<Vec<Cartela>> {
    let regra = problema.regra();
    // Só o caso de conter o alvo inteiro: é onde a troca por complementos vale.
    if regra.alvo != regra.intersecao {
        return None;
    }
    if !matches!(problema.objetivo(), Objetivo::MinimizarCartelas) {
        return None;
    }

    let v = cobertura.tamanho_pool();
    let k = cobertura.tamanho_cartela();
    let t = regra.alvo;
    if k > v || t > v || k < t {
        return None;
    }
    let premiadas = regra.premiadas.max(1) as u32;

    // Quem monta a instância — e quem sabe quanto custa cada órbita — é o módulo
    // `orbitas`. O resolvedor exato de `exato` consome exatamente a mesma coisa.
    let inst = InstanciaCiclica::montar(v, v - k, v - t, parar)?;
    let cobre = inst.cobre();
    let inverso = inst.inverso();
    let peso_b = inst.peso_dos_alvos();
    let orb_a = inst.orbitas_de_cartela();

    let comeco = Instant::now();
    let mut melhor = guloso_amplo(cobre, peso_b, orb_a, premiadas);
    podar_orbitas(cobre, orb_a, peso_b, premiadas, &mut melhor);
    let mut melhor_custo = inst.custo(&melhor);

    // Passeio que aceita empate: num problema de cobertura há muitas soluções do
    // mesmo tamanho, e é andando entre elas que se chega à borda de onde cabe uma
    // a menos. Com melhora estrita apenas, a busca não sai do lugar.
    let mut atual = melhor.clone();
    let mut custo_atual = melhor_custo;
    while comeco.elapsed() < orcamento && !parou(parar) {
        let quantas = 1 + rng.gen_range(0..(atual.len() / 8).max(1));
        let mut semente_da_vez = atual.clone();
        for _ in 0..quantas {
            if semente_da_vez.is_empty() {
                break;
            }
            let fora = rng.gen_range(0..semente_da_vez.len());
            semente_da_vez.swap_remove(fora);
        }
        let mut refeita =
            guloso_por_alvo(cobre, inverso, peso_b, orb_a, &semente_da_vez, premiadas, rng);
        podar_orbitas(cobre, orb_a, peso_b, premiadas, &mut refeita);
        let c = inst.custo(&refeita);
        if c <= custo_atual {
            custo_atual = c;
            atual = refeita;
            if custo_atual < melhor_custo {
                melhor_custo = custo_atual;
                melhor = atual.clone();
            }
        }
    }

    Some(inst.expandir(&melhor))
}

/* ─────────── as peças da construção por órbitas ─────────── */

/// O guloso que olha todas as candidatas a cada escolha.
///
/// Custa uma varredura completa por órbita escolhida — lento, e por isso só serve
/// para a primeira solução. Medido, ele parte de 441 órbitas em `23/17` onde o
/// guloso por alvo parte de 459, e as dezoito de diferença são adiantamento que o
/// passeio não precisa reconquistar.
fn guloso_amplo(
    cobre: &[Vec<u32>],
    peso_b: &[u32],
    orb_a: &[(u32, u32)],
    premiadas: u32,
) -> Vec<usize> {
    let mut vezes = vec![0u32; peso_b.len()];
    let mut faltam = peso_b.len();
    let mut dentro = vec![false; orb_a.len()];
    let mut escolhidas = Vec::new();

    while faltam > 0 {
        let mut melhor: Option<(usize, u64, u64)> = None;
        for (i, alvos) in cobre.iter().enumerate() {
            if dentro[i] {
                continue;
            }
            let ganho: u64 = alvos
                .iter()
                .filter(|&&alvo| vezes[alvo as usize] < premiadas)
                .map(|&alvo| peso_b[alvo as usize] as u64)
                .sum();
            if ganho == 0 {
                continue;
            }
            let custo = orb_a[i].1 as u64;
            if melhor.is_none_or_menor(ganho, custo) {
                melhor = Some((i, ganho, custo));
            }
        }
        let Some((i, _, _)) = melhor else { break };
        dentro[i] = true;
        escolhidas.push(i);
        for &alvo in &cobre[i] {
            let antes = vezes[alvo as usize];
            vezes[alvo as usize] = antes + 1;
            if antes + 1 == premiadas {
                faltam -= 1;
            }
        }
    }
    escolhidas
}

/// Completa a cobertura escolhendo, para cada alvo em falta, a melhor órbita que
/// o cobre.
///
/// Muito mais barato que o guloso amplo: em vez de varrer todas as candidatas,
/// olha só as que cobrem o alvo em questão. É o que permite dezenas de milhares
/// de reparações no tempo em que a varredura completa faz uma.
fn guloso_por_alvo(
    cobre: &[Vec<u32>],
    inverso: &[Vec<u32>],
    peso_b: &[u32],
    orb_a: &[(u32, u32)],
    ja_escolhidas: &[usize],
    premiadas: u32,
    rng: &mut Pcg64Mcg,
) -> Vec<usize> {
    let mut vezes = vec![0u32; peso_b.len()];
    let mut dentro = vec![false; orb_a.len()];
    let mut escolhidas = Vec::with_capacity(ja_escolhidas.len() + 32);

    for &i in ja_escolhidas {
        if dentro[i] {
            continue;
        }
        dentro[i] = true;
        escolhidas.push(i);
        for &alvo in &cobre[i] {
            vezes[alvo as usize] += 1;
        }
    }

    let mut ordem: Vec<u32> = (0..peso_b.len() as u32).collect();
    // Embaralhar é o que dá caminhos diferentes à mesma reparação; sem isso o
    // passeio devolve sempre a mesma peça no mesmo buraco.
    for i in (1..ordem.len()).rev() {
        ordem.swap(i, rng.gen_range(0..=i));
    }

    for alvo in ordem {
        while vezes[alvo as usize] < premiadas {
            let mut melhor: Option<(usize, u64, u64)> = None;
            for &cand in &inverso[alvo as usize] {
                let i = cand as usize;
                if dentro[i] {
                    continue;
                }
                let ganho: u64 = cobre[i]
                    .iter()
                    .filter(|&&x| vezes[x as usize] < premiadas)
                    .map(|&x| peso_b[x as usize] as u64)
                    .sum();
                if ganho == 0 {
                    continue;
                }
                let custo = orb_a[i].1 as u64;
                if melhor.is_none_or_menor(ganho, custo) {
                    melhor = Some((i, ganho, custo));
                }
            }
            let Some((i, _, _)) = melhor else { break };
            dentro[i] = true;
            escolhidas.push(i);
            for &x in &cobre[i] {
                vezes[x as usize] += 1;
            }
        }
    }
    escolhidas
}

/// Tira as órbitas cujos alvos já estão cobertos o bastante por outras.
///
/// Da mais cara para a mais barata: uma órbita de 23 vale 23 cartelas, e sair
/// com a maior primeiro rende mais.
fn podar_orbitas(
    cobre: &[Vec<u32>],
    orb_a: &[(u32, u32)],
    peso_b: &[u32],
    premiadas: u32,
    escolhidas: &mut Vec<usize>,
) {
    let mut vezes = vec![0u32; peso_b.len()];
    for &i in escolhidas.iter() {
        for &alvo in &cobre[i] {
            vezes[alvo as usize] += 1;
        }
    }
    let mut ordem = escolhidas.clone();
    ordem.sort_unstable_by_key(|&i| std::cmp::Reverse(orb_a[i].1));
    let mut sobrando = Vec::with_capacity(escolhidas.len());
    for i in ordem {
        if cobre[i].iter().all(|&alvo| vezes[alvo as usize] > premiadas) {
            for &alvo in &cobre[i] {
                vezes[alvo as usize] -= 1;
            }
        } else {
            sobrando.push(i);
        }
    }
    *escolhidas = sobrando;
}

/// Compara `ganho/custo` sem dividir: o produto cruzado decide.
trait MelhorQue {
    fn is_none_or_menor(&self, ganho: u64, custo: u64) -> bool;
}

impl MelhorQue for Option<(usize, u64, u64)> {
    fn is_none_or_menor(&self, ganho: u64, custo: u64) -> bool {
        match self {
            Some((_, g, c)) => ganho * c > g * custo,
            None => true,
        }
    }
}
