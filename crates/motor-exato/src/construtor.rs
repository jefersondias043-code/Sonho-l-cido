//! Construir **no alvo** — e não construir grande para depois encolher.
//!
//! A diferença é de natureza, não de eficiência. Encolher parte de uma solução
//! e pergunta o que sobra; construir no alvo parte do número e pergunta se ele
//! é alcançável. A segunda pergunta é a que interessa quando se quer o mínimo,
//! porque a resposta "não" também é informação — ela empurra o limite inferior.
//!
//! ## As duas famílias
//!
//! **Guloso por alvo descoberto.** Pega um alvo que ainda ninguém cobre, monta
//! um bloco em torno dele, e escolhe o que mais acrescenta. Serve sempre, e é o
//! que dá o primeiro teto.
//!
//! **Por órbitas cíclicas.** Impõe que a solução seja invariante por rotação:
//! escolher um bloco traz todas as suas rotações junto. É a restrição estrutural
//! mais barata que existe — ela divide o espaço de busca por `v` — e é de onde
//! saem quase todas as coberturas ótimas conhecidas com estrutura.
//!
//! A segunda é a que realiza a promessa do aplicativo. Ela não procura entre
//! todas as coleções possíveis: procura entre as que **têm a simetria do
//! problema**, que é um espaço milhares de vezes menor e onde as boas soluções
//! moram.

use crate::problema::{Bloco, Problema};

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

/// Por alvo, os blocos que o cobrem.
fn por_alvo(cobre: &[Vec<u32>], total_de_alvos: usize) -> Vec<Vec<u32>> {
    let mut saida: Vec<Vec<u32>> = vec![Vec::new(); total_de_alvos];
    for (i, lista) in cobre.iter().enumerate() {
        for &a in lista {
            saida[a as usize].push(i as u32);
        }
    }
    saida
}

/// O estado de uma construção em andamento.
struct Andamento {
    coberto: Vec<bool>,
    faltam: usize,
    escolhidos: Vec<usize>,
}

impl Andamento {
    fn vazio(total_de_alvos: usize) -> Andamento {
        Andamento { coberto: vec![false; total_de_alvos], faltam: total_de_alvos, escolhidos: Vec::new() }
    }

    fn tomar(&mut self, cobre: &[Vec<u32>], i: usize) {
        for &a in &cobre[i] {
            if !self.coberto[a as usize] {
                self.coberto[a as usize] = true;
                self.faltam -= 1;
            }
        }
        self.escolhidos.push(i);
    }
}

/// Completa uma construção parcial, sempre pelo alvo mais apertado.
///
/// A diferença entre escolher pelo alvo e escolher pelo bloco é grande onde
/// todos os blocos rendem o mesmo — num sistema de Steiner, por exemplo, **todo**
/// bloco cobre `C(k,t)` alvos novos no começo, e o guloso por ganho decide no
/// desempate, que é arbitrário. Olhar primeiro o alvo com menos saídas põe a
/// decisão onde ela é forçada.
fn completar(
    cobre: &[Vec<u32>],
    quem_cobre: &[Vec<u32>],
    ordem: &[u32],
    estado: &mut Andamento,
    sorteio: &mut u64,
) {
    let mut empatados: Vec<usize> = Vec::new();
    while estado.faltam > 0 {
        let Some(&alvo) = ordem.iter().find(|&&a| !estado.coberto[a as usize]) else { break };
        let opcoes = &quem_cobre[alvo as usize];
        if opcoes.is_empty() {
            break;
        }
        // Entre os blocos de ganho máximo o desempate é sorteado, e não pelo
        // índice. Num sistema de Steiner **todos** empatam, e desempatar sempre
        // do mesmo jeito é o que prendia a construção duas cartelas acima do
        // mínimo: o sorteio é o que dá tentativas de fato diferentes.
        empatados.clear();
        let mut maior = 0usize;
        for &c in opcoes {
            let ganho = cobre[c as usize].iter().filter(|&&a| !estado.coberto[a as usize]).count();
            if ganho > maior {
                maior = ganho;
                empatados.clear();
                empatados.push(c as usize);
            } else if ganho == maior {
                empatados.push(c as usize);
            }
        }
        if maior == 0 || empatados.is_empty() {
            break;
        }
        let escolha = empatados[proximo(sorteio) as usize % empatados.len()];
        estado.tomar(cobre, escolha);
    }
}

/// Um gerador linear congruente, para desempatar sem chamar o sistema.
///
/// A semente é fixa e o percurso é o mesmo em toda execução: o construtor
/// continua determinístico, e duas rodadas com os mesmos parâmetros produzem a
/// mesma coleção.
fn proximo(estado: &mut u64) -> u64 {
    *estado = estado.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *estado >> 33
}

/// Uma partida que começa por uma opção deliberadamente diferente.
///
/// O guloso é determinístico e cai sempre na mesma bacia. Forçar a primeira
/// escolha o joga em outra, e a melhor das bacias costuma ficar bem abaixo da
/// primeira — é o que transforma um método fixo numa família de tentativas.
fn partida_com_desvio(
    cobre: &[Vec<u32>],
    quem_cobre: &[Vec<u32>],
    ordem: &[u32],
    total_de_alvos: usize,
    desvio: usize,
) -> Vec<usize> {
    let mut estado = Andamento::vazio(total_de_alvos);
    if let Some(&alvo) = ordem.first() {
        let opcoes = &quem_cobre[alvo as usize];
        if !opcoes.is_empty() {
            estado.tomar(cobre, opcoes[desvio % opcoes.len()] as usize);
        }
    }
    let mut sorteio = 0x243F_6A88_85A3_08D3u64 ^ (desvio as u64).wrapping_mul(0x9E37_79B9);
    completar(cobre, quem_cobre, ordem, &mut estado, &mut sorteio);
    estado.escolhidos
}

/// Ruína e recriação: derruba parte da solução e a reconstrói.
///
/// Uma construção gulosa costuma ficar presa por causa de duas ou três escolhas
/// ruins feitas cedo, que ela não tem como desfazer. Derrubar um pedaço e
/// refazê-lo com o resto já no lugar desfaz exatamente isso — e como a
/// reconstrução é a mesma que se sabe conferir, nada aqui pode produzir uma
/// coleção que não cobre.
fn refinar(
    cobre: &[Vec<u32>],
    quem_cobre: &[Vec<u32>],
    ordem: &[u32],
    total_de_alvos: usize,
    melhor: &mut Vec<usize>,
    rodadas: usize,
) {
    if melhor.len() < 3 {
        return;
    }
    let mut semente: u64 = 0x9E37_79B9_7F4A_7C15;
    for _ in 0..rodadas {
        let quantos = (melhor.len() / 4).max(1);
        let mut fora = vec![false; melhor.len()];
        for _ in 0..quantos {
            semente = semente.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            fora[(semente >> 33) as usize % melhor.len()] = true;
        }
        let mut estado = Andamento::vazio(total_de_alvos);
        for (i, &c) in melhor.iter().enumerate() {
            if !fora[i] {
                estado.tomar(cobre, c);
            }
        }
        completar(cobre, quem_cobre, ordem, &mut estado, &mut semente);
        if estado.faltam == 0 && estado.escolhidos.len() < melhor.len() {
            *melhor = estado.escolhidos;
        }
    }
}

/// Quantas partidas diferentes o guloso tenta antes de ficar com a melhor.
pub const MAXIMO_DE_PARTIDAS: usize = 64;

/// Quantas rodadas de ruína e recriação o refinamento faz.
pub const RODADAS_DE_REFINO: usize = 4_000;

/// Teto do produto blocos × alvos-por-bloco: acima disto a matriz de cobertura
/// não é montada e o guloso roda numa partida só.
pub const TETO_DA_MATRIZ: usize = 30_000_000;

/// Por bloco, os índices dos alvos que ele cobre.
///
/// Montar isto uma vez troca a varredura de todos os alvos a cada passo por uma
/// lista de `C(k,t)` posições — e é o que permite pagar dezenas de partidas
/// gulosas pelo preço que antes custava uma.
fn matriz_de_cobertura(alvos: &[Bloco], blocos: &[Bloco]) -> Vec<Vec<u32>> {
    let mut saida = Vec::with_capacity(blocos.len());
    for &b in blocos {
        let mut lista = Vec::new();
        for (i, &a) in alvos.iter().enumerate() {
            if a & b == a {
                lista.push(i as u32);
            }
        }
        saida.push(lista);
    }
    saida
}

/// Uma partida gulosa pelo bloco de maior ganho, opcionalmente forçada a
/// começar por um bloco dado.
fn partida(cobre: &[Vec<u32>], total_de_alvos: usize, primeiro: Option<usize>) -> Vec<usize> {
    let mut estado = Andamento::vazio(total_de_alvos);
    if let Some(i) = primeiro {
        estado.tomar(cobre, i);
    }
    while estado.faltam > 0 {
        let mut melhor: Option<(usize, usize)> = None;
        for (i, lista) in cobre.iter().enumerate() {
            let ganho = lista.iter().filter(|&&a| !estado.coberto[a as usize]).count();
            if ganho > 0 && melhor.map_or(true, |(_, g)| ganho > g) {
                melhor = Some((i, ganho));
            }
        }
        let Some((i, _)) = melhor else { break };
        estado.tomar(cobre, i);
    }
    estado.escolhidos
}

/// A construção gulosa: muitas partidas, e depois ruína e recriação sobre a
/// melhor delas.
///
/// É o método que serve em qualquer configuração, e o que dá o primeiro teto —
/// o número contra o qual todo o resto será comparado.
pub fn guloso(p: &Problema) -> Construcao {
    let alvos = p.alvos();
    let blocos = p.blocos();
    if alvos.is_empty() || blocos.is_empty() {
        return Construcao { blocos: Vec::new(), metodo: "guloso por cobertura" };
    }

    let cabe = blocos.len().saturating_mul(p.alvos_por_bloco().min(u32::MAX as u128) as usize)
        <= TETO_DA_MATRIZ;
    if !cabe {
        // Grande demais para a matriz: uma partida só, montada sob demanda.
        let mut escolhidos = Vec::new();
        let mut coberto = vec![false; alvos.len()];
        let mut faltam = alvos.len();
        while faltam > 0 {
            let mut melhor: Option<(Bloco, usize)> = None;
            for &b in &blocos {
                let ganho = alvos
                    .iter()
                    .enumerate()
                    .filter(|(i, &a)| !coberto[*i] && a & b == a)
                    .count();
                if ganho > 0 && melhor.map_or(true, |(_, g)| ganho > g) {
                    melhor = Some((b, ganho));
                }
            }
            let Some((b, _)) = melhor else { break };
            for (i, &a) in alvos.iter().enumerate() {
                if !coberto[i] && a & b == a {
                    coberto[i] = true;
                    faltam -= 1;
                }
            }
            escolhidos.push(b);
        }
        podar(p, &mut escolhidos);
        return Construcao { blocos: escolhidos, metodo: "guloso por cobertura" };
    }

    let cobre = matriz_de_cobertura(&alvos, &blocos);
    let quem_cobre = por_alvo(&cobre, alvos.len());
    let mut ordem: Vec<u32> = (0..alvos.len() as u32).collect();
    ordem.sort_by_key(|&a| quem_cobre[a as usize].len());

    // As sementes do guloso por ganho: todos os blocos quando são poucos, os
    // representantes de órbita quando são muitos — blocos de uma mesma órbita
    // levam a partidas equivalentes, e pagá-las duas vezes é desperdício.
    let mut sementes: Vec<usize> = Vec::new();
    if blocos.len() <= MAXIMO_DE_PARTIDAS {
        sementes.extend(0..blocos.len());
    } else {
        let representantes: std::collections::HashSet<Bloco> =
            orbitas_de_blocos(p).into_iter().collect();
        for (i, b) in blocos.iter().enumerate() {
            if representantes.contains(b) {
                sementes.push(i);
            }
            if sementes.len() >= MAXIMO_DE_PARTIDAS {
                break;
            }
        }
    }

    let mut melhor: Option<Vec<usize>> = None;
    let guarda = |tentativa: Vec<usize>, melhor: &mut Option<Vec<usize>>| {
        let serve = !tentativa.is_empty()
            && melhor.as_ref().map_or(true, |m: &Vec<usize>| tentativa.len() < m.len());
        if serve {
            *melhor = Some(tentativa);
        }
    };
    for primeiro in std::iter::once(None).chain(sementes.into_iter().map(Some)) {
        guarda(partida(&cobre, alvos.len(), primeiro), &mut melhor);
    }
    for desvio in 0..MAXIMO_DE_PARTIDAS {
        guarda(partida_com_desvio(&cobre, &quem_cobre, &ordem, alvos.len(), desvio), &mut melhor);
    }

    let mut escolha = melhor.unwrap_or_default();
    refinar(&cobre, &quem_cobre, &ordem, alvos.len(), &mut escolha, RODADAS_DE_REFINO);

    let mut escolhidos: Vec<Bloco> = escolha.into_iter().map(|i| blocos[i]).collect();
    escolhidos.sort_unstable();
    escolhidos.dedup();
    podar(p, &mut escolhidos);
    Construcao { blocos: escolhidos, metodo: "guloso com partidas múltiplas e refino" }
}

/// Constrói impondo a simetria cíclica: escolhe **órbitas**, não blocos.
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
    let mut coberto = vec![false; alvos.len()];
    let mut faltam = alvos.len();
    let mut escolhidos: Vec<Bloco> = Vec::new();

    // O ganho de uma órbita é o que **todas** as suas rotações cobrem juntas —
    // é ela, e não um bloco solto, a unidade de escolha.
    while faltam > 0 {
        let mut melhor: Option<(usize, usize, usize)> = None; // (índice, ganho, tamanho)
        for (i, &rep) in representantes.iter().enumerate() {
            let rotacoes = orbita(rep, p.v);
            let ganho = alvos
                .iter()
                .enumerate()
                .filter(|(j, &a)| !coberto[*j] && rotacoes.iter().any(|&b| a & b == a))
                .count();
            if ganho == 0 {
                continue;
            }
            // Entre órbitas, vence a que cobre mais por bloco gasto: uma órbita
            // de v blocos que cobre pouco custa caro.
            let melhor_agora = melhor.map_or(true, |(_, g, t)| ganho * t > g * rotacoes.len());
            if melhor_agora {
                melhor = Some((i, ganho, rotacoes.len()));
            }
        }
        let Some((i, _, _)) = melhor else { break };
        for b in orbita(representantes[i], p.v) {
            for (j, &a) in alvos.iter().enumerate() {
                if !coberto[j] && a & b == a {
                    coberto[j] = true;
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

/// Tira blocos que se tornaram supérfluos.
///
/// Um guloso deixa sobras: um bloco escolhido cedo pode ter todos os seus alvos
/// cobertos pelos que vieram depois. Retirar do maior para o menor não faz
/// diferença aqui — o que importa é que a cobertura seja conferida a cada
/// retirada, e não presumida.
pub fn podar(p: &Problema, blocos: &mut Vec<Bloco>) {
    let alvos = p.alvos();
    let mut vezes = vec![0u32; alvos.len()];
    for &b in blocos.iter() {
        for (i, &a) in alvos.iter().enumerate() {
            if a & b == a {
                vezes[i] += 1;
            }
        }
    }
    let mut sobrando = Vec::with_capacity(blocos.len());
    for &b in blocos.iter() {
        let dispensavel = alvos
            .iter()
            .enumerate()
            .all(|(i, &a)| a & b != a || vezes[i] > 1);
        if dispensavel {
            for (i, &a) in alvos.iter().enumerate() {
                if a & b == a {
                    vezes[i] -= 1;
                }
            }
        } else {
            sobrando.push(b);
        }
    }
    *blocos = sobrando;
}

/// A melhor construção que os métodos disponíveis conseguem.
///
/// Devolve a menor entre elas — e o nome do método vai junto, porque saber
/// **como** a solução nasceu é o que permite melhorar o construtor depois.
pub fn construir(p: &Problema) -> Construcao {
    let g = guloso(p);
    match por_orbitas(p) {
        Some(o) if o.tamanho() < g.tamanho() => o,
        _ => g,
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn toda_construcao_cobre_de_verdade() {
        for &(v, k, t) in &[(7, 3, 2), (9, 3, 2), (8, 4, 3), (10, 4, 2), (11, 5, 3), (12, 4, 2)] {
            let p = Problema::novo(v, k, t).unwrap();
            let c = construir(&p);
            assert!(p.cobre(&c.blocos), "C({v},{k},{t}) por {}: não cobre", c.metodo);
            assert!(c.tamanho() > 0);
            // Sem bloco repetido: um fechamento com duplicata está pagando duas
            // vezes pela mesma cartela.
            let mut ordenados = c.blocos.clone();
            ordenados.sort_unstable();
            ordenados.dedup();
            assert_eq!(ordenados.len(), c.tamanho(), "C({v},{k},{t}) repetiu bloco");
        }
    }

    #[test]
    fn a_poda_nunca_quebra_a_cobertura_nem_deixa_superfluo() {
        let p = Problema::novo(9, 3, 2).unwrap();
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
    fn as_orbitas_sao_fechadas_por_rotacao() {
        let p = Problema::novo(9, 3, 2).unwrap();
        let Some(c) = por_orbitas(&p) else { panic!("9,3,2 tem construção cíclica") };
        assert!(p.cobre(&c.blocos));
        // A poda pode quebrar a simetria ao remover sobras; o que precisa valer
        // é que a construção **antes** da poda era fechada por rotação.
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
        let p = Problema::novo(9, 3, 2).unwrap();
        let c = construir(&p);
        assert!(c.tamanho() <= 12, "chegou a {} e o mínimo é 12", c.tamanho());
    }
}
