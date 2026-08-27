//! O problema visto por órbitas do grupo cíclico `Z_pool`.
//!
//! ## A troca de unidade
//!
//! Escolher uma cartela é escolher uma cartela. Escolher uma **órbita** é
//! escolher todas as rotações dela de uma vez — em `23/17`, 4.389 candidatas em
//! vez de 100.947, e 21.318 alvos em vez de 490.314. Não é o mesmo problema mais
//! rápido: é outro problema, cuja resposta é sempre uma solução válida do
//! original, e nem sempre a melhor.
//!
//! ## Por que isto virou módulo
//!
//! Medindo o banco, oito dos vinte fechamentos ainda em aberto — 20/17, 22/17,
//! 22/18, 23/17, 23/18, 24/18, 24/21 e 25/18 — são **perfeitamente invariantes
//! por rotação**. Isso só acontece se a busca livre nunca aceitou um movimento
//! neles: ela move uma cartela por vez, e uma cartela mexida quebra a
//! invariância para sempre. Ou seja, nessas oito o que está no banco é a
//! construção por órbitas intacta, e toda a busca posterior foi gasto sem
//! retorno.
//!
//! A conclusão prática é que a simetria não é um truque da construção inicial —
//! é onde essas soluções vivem. Por isso as peças saíram de dentro do
//! [`crate::construtor`] e viraram um tipo próprio, que tanto a construção
//! quanto o resolvedor exato de [`crate::exato`] consomem.
//!
//! ## O peso
//!
//! Órbitas não custam todas igual. Em pool composto um conjunto pode voltar a si
//! mesmo antes de dar a volta inteira, e aí a órbita tem menos elementos. O que
//! se minimiza é a soma dos tamanhos — o número de cartelas — e nunca o número
//! de órbitas escolhidas.

use std::collections::HashMap;

use motor_core::cartela::Cartela;
use rand::Rng;
use rand_pcg::Pcg64Mcg;

use crate::controle::Controle;

/// Teto de memória para a tabela de ligações. Acima disto a instância não se
/// monta: num celular, montá-la já seria o problema.
const TETO_DE_LIGACOES: usize = 8_000_000;

/// O maior pool que cabe numa máscara de 32 bits.
pub const MAIOR_POOL: usize = 31;

fn mascara_cheia(v: u32) -> u32 {
    if v >= 32 {
        u32::MAX
    } else {
        (1u32 << v) - 1
    }
}

/// Gira o conjunto uma posição: `i → i + 1 (mod v)`.
pub fn girar(mascara: u32, v: u32) -> u32 {
    ((mascara << 1) | (mascara >> (v - 1))) & mascara_cheia(v)
}

/// A menor rotação — o nome pelo qual a órbita inteira atende.
pub fn canonico(mascara: u32, v: u32) -> u32 {
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
pub fn tamanho_da_orbita(mascara: u32, v: u32) -> u32 {
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
pub fn orbitas(v: u32, k: u32) -> Vec<(u32, u32)> {
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
fn combinacoes_pequenas(n: u32, k: u32, teto: usize) -> usize {
    if k > n {
        return 0;
    }
    let mut total: usize = 1;
    for i in 0..k.min(n - k) {
        total = total.saturating_mul((n - i) as usize) / (i as usize + 1);
        if total > teto {
            return usize::MAX;
        }
    }
    total
}

/// Todas as combinações de `k` elementos, entregues uma a uma.
pub fn combinar(itens: &[u32], k: usize, acao: &mut impl FnMut(&[u32])) {
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

fn parou(parar: Option<&Controle>) -> bool {
    parar.is_some_and(|c| c.foi_solicitada_parada())
}

/// O problema reduzido a órbitas, pronto para qualquer método consumir.
///
/// Vive no espaço dos **complementos**: uma cartela de `k` dezenas num pool de
/// `v` é o complemento de `a = v − k`, e um alvo de `t` é o complemento de
/// `b = v − t`. "A cartela contém o alvo" vira "as `a` que faltam à cartela
/// estão entre as `b` que faltam ao alvo" — de cobrir para caber.
#[derive(Debug, Clone)]
pub struct InstanciaCiclica {
    v: u32,
    orb_a: Vec<(u32, u32)>,
    peso_b: Vec<u32>,
    cobre: Vec<Vec<u32>>,
    inverso: Vec<Vec<u32>>,
}

impl InstanciaCiclica {
    /// Monta a instância, ou devolve `None` quando ela não cabe.
    ///
    /// `v` é o pool, `a` o que falta à cartela e `b` o que falta ao alvo. Devolve
    /// `None` também se pedirem para parar no meio: montar leva tempo, e um
    /// pedido de parada não pode esperar o fim.
    ///
    /// O teto de memória é o do celular. Uma ferramenta que roda fora dele pode
    /// pedir mais com [`InstanciaCiclica::montar_ate`] — em 25 dezenas com jogos
    /// de 22 a tabela pede 15,7 milhões de ligações, e é só ali que ela existe.
    pub fn montar(v: usize, a: usize, b: usize, parar: Option<&Controle>) -> Option<Self> {
        Self::montar_ate(v, a, b, TETO_DE_LIGACOES, parar)
    }

    /// Como [`InstanciaCiclica::montar`], com o teto de ligações escolhido por
    /// quem chama. Só faz sentido afrouxá-lo fora do navegador.
    pub fn montar_ate(
        v: usize,
        a: usize,
        b: usize,
        teto: usize,
        parar: Option<&Controle>,
    ) -> Option<Self> {
        if v > MAIOR_POOL || a == 0 || a > b || b > v {
            return None;
        }
        let (v, a, b) = (v as u32, a as u32, b as u32);

        let orb_a = orbitas(v, a);
        let orb_b = orbitas(v, b);
        if orb_a.is_empty() || orb_b.is_empty() {
            return None;
        }
        if orb_a.len().saturating_mul(combinacoes_pequenas(v - a, b - a, teto)) > teto {
            return None;
        }

        let indice_b: HashMap<u32, usize> =
            orb_b.iter().enumerate().map(|(i, &(m, _))| (m, i)).collect();
        let peso_b: Vec<u32> = orb_b.iter().map(|&(_, t)| t).collect();

        // Basta olhar a partir do representante: girar a cartela e o alvo juntos
        // dá a mesma órbita de alvo, então a linha do representante já descreve
        // a órbita inteira.
        let mut cobre: Vec<Vec<u32>> = Vec::with_capacity(orb_a.len());
        for &(rep, _) in &orb_a {
            if parou(parar) {
                return None;
            }
            let livres: Vec<u32> = (0..v).filter(|i| rep & (1 << i) == 0).collect();
            let mut alvos = Vec::new();
            combinar(&livres, (b - a) as usize, &mut |extra: &[u32]| {
                let mut m = rep;
                for &e in extra {
                    m |= 1 << e;
                }
                if let Some(&i) = indice_b.get(&canonico(m, v)) {
                    alvos.push(i as u32);
                }
            });
            alvos.sort_unstable();
            alvos.dedup();
            cobre.push(alvos);
        }

        // O índice invertido é o que torna a reparação barata: para fechar um
        // alvo descoberto só interessam as órbitas que o cobrem — algumas
        // dezenas, contra varrer os milhares de candidatas.
        let mut inverso: Vec<Vec<u32>> = vec![Vec::new(); orb_b.len()];
        for (i, alvos) in cobre.iter().enumerate() {
            for &alvo in alvos {
                inverso[alvo as usize].push(i as u32);
            }
        }

        Some(InstanciaCiclica { v, orb_a, peso_b, cobre, inverso })
    }

    pub fn pool(&self) -> u32 {
        self.v
    }

    pub fn candidatos(&self) -> usize {
        self.orb_a.len()
    }

    pub fn alvos(&self) -> usize {
        self.peso_b.len()
    }

    pub fn cobre(&self) -> &[Vec<u32>] {
        &self.cobre
    }

    pub fn inverso(&self) -> &[Vec<u32>] {
        &self.inverso
    }

    pub fn peso_dos_alvos(&self) -> &[u32] {
        &self.peso_b
    }

    pub fn orbitas_de_cartela(&self) -> &[(u32, u32)] {
        &self.orb_a
    }

    /// Quantas **cartelas** a escolha custa — a soma dos tamanhos das órbitas,
    /// que é o número que o usuário vê e paga.
    pub fn custo(&self, escolha: &[usize]) -> u64 {
        escolha.iter().map(|&i| self.orb_a[i].1 as u64).sum()
    }

    /// Cada órbita vira todas as suas rotações, e cada complemento vira a cartela
    /// que lhe falta.
    pub fn expandir(&self, escolha: &[usize]) -> Vec<Cartela> {
        let cheia = mascara_cheia(self.v);
        let mut cartelas = Vec::with_capacity(self.custo(escolha) as usize);
        for &i in escolha {
            let (rep, tamanho) = self.orb_a[i];
            let mut m = rep;
            for _ in 0..tamanho {
                let dentro: Vec<usize> =
                    (0..self.v as usize).filter(|&d| (!m & cheia) & (1 << d as u32) != 0).collect();
                cartelas.push(Cartela::dos_indices(&dentro));
                m = girar(m, self.v);
            }
        }
        cartelas.sort_unstable();
        cartelas.dedup();
        cartelas
    }


    /// A primeira solução: o guloso que olha todas as candidatas a cada escolha.
    pub fn guloso(&self, premiadas: u32) -> Vec<usize> {
        guloso_amplo(&self.cobre, &self.peso_b, &self.orb_a, premiadas)
    }

    /// Fecha a cobertura a partir do que já está escolhido, em ordem sorteada.
    pub fn reparar(&self, ja: &[usize], premiadas: u32, rng: &mut Pcg64Mcg) -> Vec<usize> {
        guloso_por_alvo(&self.cobre, &self.inverso, &self.peso_b, &self.orb_a, ja, premiadas, rng)
    }

    /// Tira as órbitas cujos alvos já estão cobertos o bastante por outras.
    pub fn podar(&self, escolha: &mut Vec<usize>, premiadas: u32) {
        podar_orbitas(&self.cobre, &self.orb_a, &self.peso_b, premiadas, escolha);
    }

    /// Peso dos alvos que a escolha ainda não atende `premiadas` vezes, e o
    /// excesso pago nos que atende demais.
    ///
    /// Os dois compõem a chave de custo: cobrir vem primeiro, e entre soluções
    /// completas vence a que gasta menos cartelas; empatou, a menos redundante.
    pub fn descobertos_e_excesso(&self, escolha: &[usize], premiadas: u32) -> (u64, u64) {
        let mut vezes = vec![0u32; self.peso_b.len()];
        for &i in escolha {
            for &alvo in &self.cobre[i] {
                vezes[alvo as usize] += 1;
            }
        }
        let mut descobertos = 0u64;
        let mut excesso = 0u64;
        for (alvo, &v) in vezes.iter().enumerate() {
            let peso = u64::from(self.peso_b[alvo]);
            if v < premiadas {
                descobertos += peso * u64::from(premiadas - v);
            } else {
                excesso += peso * u64::from(v - premiadas);
            }
        }
        (descobertos, excesso)
    }

    /// A ponte para o resolvedor exato de [`crate::exato`].
    ///
    /// O peso de cada candidato é o tamanho da órbita, e não 1: minimizar o
    /// número de órbitas daria a resposta errada num pool composto, onde as
    /// órbitas têm tamanhos diferentes.
    ///
    /// O que sai daqui é o menor fechamento **cíclico**, e portanto um limite
    /// superior. Não diz nada sobre fechamentos que não têm essa simetria, e não
    /// pode alimentar limite inferior nenhum.
    pub fn para_exato(&self) -> Option<crate::exato::Instancia> {
        let peso: Vec<u64> = self.orb_a.iter().map(|&(_, t)| t as u64).collect();
        crate::exato::Instancia::nova(self.cobre.clone(), peso, self.alvos())
    }
}

/* ─────────── as peças que a construção e a busca dividem ─────────── */
/// O guloso que olha todas as candidatas a cada escolha.
///
/// Custa uma varredura completa por órbita escolhida — lento, e por isso só serve
/// para a primeira solução. Medido, ele parte de 441 órbitas em `23/17` onde o
/// guloso por alvo parte de 459, e as dezoito de diferença são adiantamento que o
/// passeio não precisa reconquistar.
pub(crate) fn guloso_amplo(
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
pub(crate) fn guloso_por_alvo(
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
pub(crate) fn podar_orbitas(
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

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn as_orbitas_particionam_todos_os_conjuntos() {
        for v in 4..=12u32 {
            for k in 1..=v {
                let soma: u32 = orbitas(v, k).iter().map(|&(_, t)| t).sum();
                let esperado = (1..=k).fold(1u32, |acc, i| acc * (v - i + 1) / i);
                assert_eq!(soma, esperado, "v={v} k={k}");
            }
        }
    }

    #[test]
    fn girar_v_vezes_volta_ao_lugar() {
        for v in 3..=20u32 {
            for m in [0b101u32, 0b1110, 0b1001, 1] {
                let m = m & mascara_cheia(v);
                let mut atual = m;
                for _ in 0..v {
                    atual = girar(atual, v);
                }
                assert_eq!(atual, m, "v={v} m={m:b}");
            }
        }
    }

    #[test]
    fn em_pool_composto_ha_orbita_menor_que_o_pool() {
        // Em 20 pontos, `{0,5,10,15}` volta a si mesmo depois de cinco giros.
        let curta = tamanho_da_orbita(0b1000_0100_0010_0001_0000 >> 4 | 1 << 0, 20);
        assert!(curta <= 20);
        let tem_curta = orbitas(20, 4).iter().any(|&(_, t)| t < 20);
        assert!(tem_curta, "pool composto precisa ter órbita curta");
        // E num pool primo isso nunca acontece.
        assert!(orbitas(23, 4).iter().all(|&(_, t)| t == 23));
    }

    #[test]
    fn a_instancia_de_20_17_tem_o_tamanho_que_a_conta_diz() {
        // pool 20, jogos de 17, sorteio de 15: a = 3 e b = 5.
        let inst = InstanciaCiclica::montar(20, 3, 5, None).unwrap();
        assert_eq!(inst.custo(&(0..inst.candidatos()).collect::<Vec<_>>()), 1140); // C(20,3)
        let total: u32 = inst.peso_dos_alvos().iter().sum();
        assert_eq!(total, 15_504); // C(20,5)
    }

    #[test]
    fn expandir_devolve_cartelas_do_tamanho_certo_e_sem_repetir() {
        let inst = InstanciaCiclica::montar(20, 3, 5, None).unwrap();
        let escolha = vec![0usize, 1, 2];
        let cartelas = inst.expandir(&escolha);
        assert_eq!(cartelas.len() as u64, inst.custo(&escolha));
        for c in &cartelas {
            assert_eq!(c.indices().len(), 17, "cartela de 20 − 3 dezenas");
        }
        let mut vistas = cartelas.clone();
        vistas.sort_unstable();
        vistas.dedup();
        assert_eq!(vistas.len(), cartelas.len(), "expandir não pode repetir cartela");
    }

    #[test]
    fn a_instancia_nao_se_monta_onde_nao_faz_sentido() {
        assert!(InstanciaCiclica::montar(20, 0, 5, None).is_none(), "a = 0 é aposta única");
        assert!(InstanciaCiclica::montar(20, 6, 5, None).is_none(), "a > b não cobre nada");
        assert!(InstanciaCiclica::montar(40, 3, 5, None).is_none(), "pool acima da máscara");
    }
}
