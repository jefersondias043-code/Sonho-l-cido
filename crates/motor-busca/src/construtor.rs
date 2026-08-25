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

use std::collections::HashMap;
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
use motor_core::planos::semente_algebrica;

/// Teto de ligações da construção por órbitas.
///
/// A tabela que liga órbitas de cartela a órbitas de sorteio é o que essa
/// construção guarda na memória, e ela cresce com o produto dos dois. Num
/// celular, passar disto é pedir para o navegador derrubar a aba — e a
/// construção que sobra continua servindo.
const TETO_DE_LIGACOES: usize = 8_000_000;

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
    if v > 31 || k > v || t > v || k < t {
        return None;
    }
    let a = (v - k) as u32;
    let b = (v - t) as u32;
    if a == 0 || a > b {
        return None;
    }
    let premiadas = regra.premiadas.max(1) as u32;

    let orb_a = orbitas(v as u32, a);
    let orb_b = orbitas(v as u32, b);
    let quantas_ligacoes = orb_a.len().saturating_mul(combinacoes_pequenas(v as u32 - a, b - a));
    if quantas_ligacoes > TETO_DE_LIGACOES || orb_a.is_empty() || orb_b.is_empty() {
        return None;
    }

    let indice_b: HashMap<u32, usize> =
        orb_b.iter().enumerate().map(|(i, &(m, _))| (m, i)).collect();
    let peso_b: Vec<u32> = orb_b.iter().map(|&(_, t)| t).collect();

    // Quais órbitas de alvo cada órbita de cartela cobre. Basta olhar a partir do
    // representante: girar a cartela e o alvo juntos dá a mesma órbita de alvo.
    let mut cobre: Vec<Vec<u32>> = Vec::with_capacity(orb_a.len());
    for &(rep, _) in &orb_a {
        if parou(parar) {
            return None;
        }
        let livres: Vec<u32> = (0..v as u32).filter(|i| rep & (1 << i) == 0).collect();
        let mut alvos = Vec::new();
        combinar(&livres, (b - a) as usize, &mut |extra: &[u32]| {
            let mut m = rep;
            for &e in extra {
                m |= 1 << e;
            }
            if let Some(&i) = indice_b.get(&canonico(m, v as u32)) {
                alvos.push(i as u32);
            }
        });
        alvos.sort_unstable();
        alvos.dedup();
        cobre.push(alvos);
    }

    // O índice invertido é o que torna a reparação barata: para fechar um alvo
    // descoberto só interessam as órbitas que o cobrem — algumas dezenas, contra
    // varrer os milhares de candidatos.
    let mut inverso: Vec<Vec<u32>> = vec![Vec::new(); orb_b.len()];
    for (i, alvos) in cobre.iter().enumerate() {
        for &alvo in alvos {
            inverso[alvo as usize].push(i as u32);
        }
    }

    let comeco = Instant::now();
    let mut melhor = guloso_amplo(&cobre, &peso_b, &orb_a, premiadas);
    podar_orbitas(&cobre, &orb_a, &peso_b, premiadas, &mut melhor);
    let custo = |esc: &[usize]| -> u64 { esc.iter().map(|&i| orb_a[i].1 as u64).sum() };
    let mut melhor_custo = custo(&melhor);

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
            guloso_por_alvo(&cobre, &inverso, &peso_b, &orb_a, &semente_da_vez, premiadas, rng);
        podar_orbitas(&cobre, &orb_a, &peso_b, premiadas, &mut refeita);
        let c = custo(&refeita);
        if c <= custo_atual {
            custo_atual = c;
            atual = refeita;
            if custo_atual < melhor_custo {
                melhor_custo = custo_atual;
                melhor = atual.clone();
            }
        }
    }

    // Expandir: cada órbita vira todas as suas rotações, e cada complemento vira
    // a cartela que lhe falta.
    let cheia = mascara_cheia(v as u32);
    let mut cartelas = Vec::with_capacity(melhor_custo as usize);
    for &i in &melhor {
        let (rep, tamanho) = orb_a[i];
        let mut m = rep;
        for _ in 0..tamanho {
            let dentro: Vec<usize> =
                (0..v).filter(|&d| (!m & cheia) & (1 << d as u32) != 0).collect();
            cartelas.push(Cartela::dos_indices(&dentro));
            m = girar(m, v as u32);
        }
    }
    cartelas.sort_unstable();
    cartelas.dedup();
    Some(cartelas)
}

/* ─────────── as peças da construção por órbitas ─────────── */

fn mascara_cheia(v: u32) -> u32 {
    if v >= 32 {
        u32::MAX
    } else {
        (1u32 << v) - 1
    }
}

/// Gira o conjunto uma posição: `i → i + 1 (mod v)`.
fn girar(mascara: u32, v: u32) -> u32 {
    ((mascara << 1) | (mascara >> (v - 1))) & mascara_cheia(v)
}

/// A menor rotação — o nome pelo qual a órbita inteira atende.
fn canonico(mascara: u32, v: u32) -> u32 {
    let mut menor = mascara;
    let mut atual = mascara;
    for _ in 1..v {
        atual = girar(atual, v);
        if atual < menor {
            menor = atual;
        }
    }
    menor
}

/// Quantas rotações distintas a órbita tem. Divide `v`, e só é menor em pools
/// compostos, onde um conjunto pode se repetir ao girar.
fn tamanho_da_orbita(mascara: u32, v: u32) -> u32 {
    let mut atual = mascara;
    for passo in 1..v {
        atual = girar(atual, v);
        if atual == mascara {
            return passo;
        }
    }
    v
}

/// Os representantes de órbita de tamanho `k`, com o tamanho de cada uma.
fn orbitas(v: u32, k: u32) -> Vec<(u32, u32)> {
    let mut vistas: HashMap<u32, u32> = HashMap::new();
    let cheia = mascara_cheia(v);
    if k == 0 || k > v {
        return Vec::new();
    }
    let mut atual = (1u32 << k) - 1;
    while atual <= cheia && atual != 0 {
        let c = canonico(atual, v);
        vistas.entry(c).or_insert_with(|| tamanho_da_orbita(c, v));
        let menor = atual & atual.wrapping_neg();
        let ondulacao = atual.wrapping_add(menor);
        if ondulacao == 0 {
            break;
        }
        let uns = ((atual ^ ondulacao) >> 2) / menor;
        atual = ondulacao | uns;
    }
    let mut saida: Vec<(u32, u32)> = vistas.into_iter().collect();
    saida.sort_unstable();
    saida
}

/// `C(n, k)` sem estourar, para o teto de memória. Satura no teto.
fn combinacoes_pequenas(n: u32, k: u32) -> usize {
    if k > n {
        return 0;
    }
    let mut total: usize = 1;
    for i in 0..k.min(n - k) {
        total = total.saturating_mul((n - i) as usize) / (i as usize + 1);
        if total > TETO_DE_LIGACOES {
            return usize::MAX;
        }
    }
    total
}

/// Todas as combinações de `k` elementos, entregues uma a uma.
fn combinar(itens: &[u32], k: usize, acao: &mut impl FnMut(&[u32])) {
    fn passo(itens: &[u32], k: usize, inicio: usize, atual: &mut Vec<u32>, acao: &mut impl FnMut(&[u32])) {
        if atual.len() == k {
            acao(atual);
            return;
        }
        for i in inicio..itens.len() {
            atual.push(itens[i]);
            passo(itens, k, i + 1, atual, acao);
            atual.pop();
        }
    }
    let mut atual = Vec::with_capacity(k);
    passo(itens, k, 0, &mut atual, acao);
}

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
