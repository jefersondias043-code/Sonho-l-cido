//! Dividir um fechamento em blocos — trocar garantia por custo, sabendo quanto.
//!
//! ## O que se compra e o que se perde
//!
//! Um fechamento de 500 cartelas garante que, se o sorteio cair dentro do pool,
//! alguma delas terá as 15. Jogar as 500 pode custar caro. Dividindo em quatro
//! blocos de 125 e jogando um, o custo cai a um quarto — e a garantia acaba.
//!
//! A pergunta que importa é o que sobra no lugar dela, e a resposta **não** é
//! "um quarto". Um fechamento real cobre cada sorteio várias vezes: medido no
//! banco da Lotinha, de 2,1 vezes em `20/17` a 3,2 em `23/20`. Essa redundância
//! é o que faz um bloco valer mais do que a fração que ele representa.
//!
//! Medido, dividindo em quatro:
//!
//! ```text
//!            1/k     divisão sorteada    divisão por cobertura
//! 20/17     25,0%         39,0%                  41,7%
//! 21/18     25,0%         47,2%                  50,9%
//! 22/19     25,0%         48,2%                  52,3%
//! ```
//!
//! E o número exato é calculável — não é estimativa. [`dividir`] devolve, para
//! cada bloco, **quantos sorteios ele cobre de fato**, contados um a um.
//!
//! ## O que não muda
//!
//! O retorno esperado por real apostado. Cada cartela tem a mesma chance de
//! acertar, esteja em que bloco estiver, e prêmios se somam: quem joga o
//! fechamento inteiro e acerta com três cartelas recebe três vezes. Dividir
//! compra **menos**, não compra **melhor** — o que muda é o preço e a
//! frequência, não a matemática da aposta.
//!
//! ## O algoritmo
//!
//! Guloso por cobertura, em rodízio entre os blocos: na vez de cada bloco,
//! entra a cartela que mais acrescenta ao que **aquele** bloco ainda não cobre.
//! Os blocos ficam com tamanhos iguais a menos de um.
//!
//! O guloso é avaliado de forma preguiçosa. O ganho de uma cartela só encolhe
//! conforme o bloco cresce — é submodular —, então o ganho antigo serve de teto:
//! se ele já perde para o segundo colocado, a cartela volta para a fila sem
//! precisar de recontagem. Sem isso, cada escolha custaria uma varredura
//! completa, e um fechamento de 26 mil cartelas não terminaria.

use crate::cartela::Cartela;
use crate::cobertura::{MotorCobertura, Rascunho};

/// Quanta memória o rodízio pode pedir antes de valer a pena trocar de método.
///
/// Não é o limite do aparelho: é o ponto em que a estratégia mais econômica já
/// entrega o mesmo resultado, e por isso guardar mais deixa de comprar nada.
const TETO_DE_MEMORIA: usize = 48 * 1024 * 1024;

/// Quantas varreduras de troca [`melhor_bloco`] faz antes de desistir.
const MAXIMO_DE_RODADAS_DE_TROCA: usize = 12;

/// Quanto trabalho a troca pode gastar, contado em sorteios visitados.
///
/// A troca é a parte cara e a que menos rende. Medido, com o tamanho do bloco
/// casado dos dois lados:
///
/// ```text
///                  melhor de k    guloso    guloso + troca
/// 21/18 em  2         75,19%      79,08%        79,34%
/// 22/19 em  2         74,99%      76,44%        76,78%
/// 23/20 em  4         59,58%      59,65%        60,87%
/// 20/17 em 10         20,27%      20,43%        20,43%
/// ```
///
/// O guloso sozinho já pega quase tudo; a troca acrescenta de zero a 1,2 ponto
/// custando de 5 a 13 vezes o tempo — e num fechamento de 2.139 cartelas ela
/// levava **339 segundos**, que não é espera, é travamento.
///
/// Daí o orçamento: ela roda enquanto couber, e para onde estiver. O resultado
/// nunca fica pior que o guloso, porque só troca o que melhora.
///
/// Contado em sorteios e não em segundos porque precisa ser o mesmo em toda
/// máquina — um orçamento por relógio daria respostas diferentes no celular e
/// no computador, para o mesmo pedido.
const ORCAMENTO_DA_TROCA: u64 = 150_000_000;

/// Um bloco: quais cartelas do fechamento original, e quanto ele cobre sozinho.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bloco {
    /// Índices no fechamento original, em ordem crescente.
    pub cartelas: Vec<usize>,
    /// Sorteios que **este** bloco cobre, contados um a um.
    pub cobertos: u64,
}

impl Bloco {
    /// A fração dos sorteios que este bloco cobre, em `0.0..=1.0`.
    pub fn cobertura(&self, total_alvos: u64) -> f64 {
        if total_alvos == 0 {
            return 0.0;
        }
        self.cobertos as f64 / total_alvos as f64
    }
}

/// O fechamento repartido.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Divisao {
    pub blocos: Vec<Bloco>,
    pub total_alvos: u64,
}

impl Divisao {
    /// O bloco que cobre menos. É o número honesto de tela: quem escolhe um
    /// bloco sem olhar não pode contar com mais do que isto.
    pub fn pior_cobertura(&self) -> f64 {
        self.blocos
            .iter()
            .map(|b| b.cobertura(self.total_alvos))
            .fold(f64::INFINITY, f64::min)
    }

    pub fn melhor_cobertura(&self) -> f64 {
        self.blocos
            .iter()
            .map(|b| b.cobertura(self.total_alvos))
            .fold(0.0, f64::max)
    }
}

/// O melhor bloco de `quantas` cartelas que este fechamento contém.
///
/// ## Por que não é o melhor pedaço de uma divisão
///
/// Repartir em `k` blocos e ficar com o melhor deles é pior do que procurar o
/// melhor conjunto direto, e o motivo é que a repartição amarra: cada bloco tem
/// de deixar cartelas boas para os outros. Aqui não há outros — todas as
/// cartelas do fechamento disputam as `quantas` vagas.
///
/// ## Como
///
/// Guloso e depois troca. O guloso escolhe, `quantas` vezes, a cartela que mais
/// acrescenta ao que já está escolhido; é o método clássico para cobertura
/// máxima, e o único com garantia — nunca fica abaixo de 63% do ótimo, porque a
/// cobertura é submodular.
///
/// A troca conserta o que o guloso deixa passar: uma cartela escolhida cedo
/// pode ter virado supérflua depois, e sai para dar lugar a outra que
/// acrescenta mais. Roda enquanto melhorar.
///
/// A contagem por sorteio é o que torna as duas baratas: `vezes[sorteio]` diz
/// quantas cartelas escolhidas o cobrem, e daí saem os dois números que
/// interessam sem varrer nada — o que uma candidata acrescentaria (sorteios com
/// `vezes == 0`) e o que uma escolhida levaria embora (sorteios com `vezes == 1`).
pub fn melhor_bloco(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    quantas: usize,
) -> Option<Bloco> {
    melhor_bloco_com(motor, cartelas, quantas, MAXIMO_DE_RODADAS_DE_TROCA)
}

/// Como [`melhor_bloco`], com o número de rodadas de troca escolhido por quem
/// chama. Zero rodadas é o guloso puro — serve para medir o que a troca compra.
pub fn melhor_bloco_com(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    quantas: usize,
    rodadas: usize,
) -> Option<Bloco> {
    if quantas == 0 || quantas > cartelas.len() {
        return None;
    }
    let total_alvos = motor.total_alvos();
    let mut rascunho = Rascunho::novo();

    // Quantas cartelas escolhidas cobrem cada sorteio.
    let mut vezes = vec![0u32; total_alvos];
    let mut dentro = vec![false; cartelas.len()];
    let mut escolhidas: Vec<usize> = Vec::with_capacity(quantas);
    let mut cobertos: u64 = 0;

    let mut tetos: Vec<(u32, u32)> = Vec::with_capacity(cartelas.len());
    for (i, &c) in cartelas.iter().enumerate() {
        motor.alvos_da_cartela(c, &mut rascunho);
        tetos.push((rascunho.alvos().len() as u32, i as u32));
    }
    tetos.sort_unstable();
    let mut fila = tetos.clone();

    // ─── guloso ───
    while escolhidas.len() < quantas {
        let Some(i) = melhor_por_contagem(motor, cartelas, &mut fila, &dentro, &vezes, &mut rascunho)
        else {
            break;
        };
        motor.alvos_da_cartela(cartelas[i], &mut rascunho);
        for &alvo in rascunho.alvos() {
            if vezes[alvo as usize] == 0 {
                cobertos += 1;
            }
            vezes[alvo as usize] += 1;
        }
        dentro[i] = true;
        escolhidas.push(i);
    }

    // ─── troca ───
    let mut orcamento = ORCAMENTO_DA_TROCA;
    'rodadas: for _ in 0..rodadas {
        let mut melhorou = false;

        let mut posicao = 0;
        while posicao < escolhidas.len() {
            if orcamento == 0 {
                break 'rodadas;
            }
            let sai = escolhidas[posicao];

            // O que esta cartela leva embora: os sorteios que só ela cobre.
            motor.alvos_da_cartela(cartelas[sai], &mut rascunho);
            let perda = rascunho.alvos().iter().filter(|&&a| vezes[a as usize] == 1).count() as u64;

            // Tira-a de fato, para as candidatas serem medidas contra o buraco.
            for &alvo in rascunho.alvos() {
                vezes[alvo as usize] -= 1;
            }
            dentro[sai] = false;

            let mut melhor: Option<(usize, u64)> = None;
            for (j, &c) in cartelas.iter().enumerate() {
                if dentro[j] || j == sai {
                    continue;
                }
                motor.alvos_da_cartela(c, &mut rascunho);
                orcamento = orcamento.saturating_sub(rascunho.alvos().len() as u64);
                let ganho =
                    rascunho.alvos().iter().filter(|&&a| vezes[a as usize] == 0).count() as u64;
                if melhor.map_or(true, |(_, g)| ganho > g) {
                    melhor = Some((j, ganho));
                }
                if orcamento == 0 {
                    break;
                }
            }

            match melhor {
                Some((entra, ganho)) if ganho > perda => {
                    motor.alvos_da_cartela(cartelas[entra], &mut rascunho);
                    for &alvo in rascunho.alvos() {
                        vezes[alvo as usize] += 1;
                    }
                    dentro[entra] = true;
                    escolhidas[posicao] = entra;
                    cobertos = cobertos + ganho - perda;
                    melhorou = true;
                }
                _ => {
                    // Nada melhora: devolve a que saiu.
                    motor.alvos_da_cartela(cartelas[sai], &mut rascunho);
                    for &alvo in rascunho.alvos() {
                        vezes[alvo as usize] += 1;
                    }
                    dentro[sai] = true;
                }
            }
            posicao += 1;
        }

        if !melhorou {
            break;
        }
    }

    escolhidas.sort_unstable();
    Some(Bloco { cartelas: escolhidas, cobertos })
}

/// A candidata que mais acrescenta ao que já está coberto, com a mesma poda
/// preguiçosa de [`melhor_para`] — aqui contra a contagem por sorteio.
fn melhor_por_contagem(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    fila: &mut Vec<(u32, u32)>,
    dentro: &[bool],
    vezes: &[u32],
    rascunho: &mut Rascunho,
) -> Option<usize> {
    loop {
        let (_, indice) = *fila.last()?;
        let i = indice as usize;
        if dentro[i] {
            fila.pop();
            continue;
        }
        motor.alvos_da_cartela(cartelas[i], rascunho);
        let ganho = rascunho.alvos().iter().filter(|&&a| vezes[a as usize] == 0).count() as u32;

        if ganho == 0 {
            fila.pop();
            return Some(i);
        }
        let proximo =
            fila.iter().rev().skip(1).find(|(_, j)| !dentro[*j as usize]).map(|&(t, _)| t);
        match proximo {
            Some(teto) if ganho < teto => {
                fila.pop();
                let posicao = fila.partition_point(|&(t, _)| t < ganho);
                fila.insert(posicao, (ganho, indice));
            }
            _ => {
                fila.pop();
                return Some(i);
            }
        }
    }
}

/// Divide preenchendo **um bloco de cada vez**, com um mapa de cobertura só.
///
/// O rodízio de [`dividir`] guarda um mapa por bloco. Com poucos blocos isso é
/// barato e dá o melhor resultado; com mil blocos são mil mapas sobre milhões
/// de sorteios, e o navegador derruba a aba antes de terminar.
///
/// Aqui o mapa é reaproveitado: o bloco 1 é montado inteiro, o mapa é zerado, e
/// o bloco 2 é montado com o que sobrou. A memória deixa de depender do número
/// de blocos.
///
/// O preço está no último bloco, que fica com o que ninguém quis — e é medindo
/// esse preço que se decide qual das duas usar.
pub fn dividir_em_sequencia(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    partes: usize,
) -> Option<Divisao> {
    let total_alvos = motor.total_alvos();
    let palavras = total_alvos.div_ceil(64);
    let mut rascunho = Rascunho::novo();

    let mut tetos: Vec<u32> = Vec::with_capacity(cartelas.len());
    for &c in cartelas {
        motor.alvos_da_cartela(c, &mut rascunho);
        tetos.push(rascunho.alvos().len() as u32);
    }

    let base = cartelas.len() / partes;
    let sobra = cartelas.len() % partes;
    let mut usada = vec![false; cartelas.len()];
    let mut blocos = Vec::with_capacity(partes);
    let mut mascara = vec![0u64; palavras];

    for b in 0..partes {
        let quantas = base + usize::from(b < sobra);
        mascara.iter_mut().for_each(|p| *p = 0);

        // A fila é refeita a cada bloco porque o mapa foi zerado: os ganhos
        // voltaram ao teto, e a poda preguiçosa precisa de tetos válidos.
        let mut fila: Vec<(u32, u32)> = (0..cartelas.len() as u32)
            .filter(|&i| !usada[i as usize])
            .map(|i| (tetos[i as usize], i))
            .collect();
        fila.sort_unstable();

        let mut escolhidas = Vec::with_capacity(quantas);
        while escolhidas.len() < quantas {
            let Some(i) = melhor_para(motor, cartelas, &mut fila, &usada, &mascara, &mut rascunho)
            else {
                break;
            };
            motor.alvos_da_cartela(cartelas[i], &mut rascunho);
            for &alvo in rascunho.alvos() {
                mascara[alvo as usize / 64] |= 1 << (alvo as usize % 64);
            }
            escolhidas.push(i);
            usada[i] = true;
        }

        escolhidas.sort_unstable();
        let cobertos = mascara.iter().map(|p| u64::from(p.count_ones())).sum();
        blocos.push(Bloco { cartelas: escolhidas, cobertos });
    }

    Some(Divisao { blocos, total_alvos: total_alvos as u64 })
}

/// Divide `cartelas` em `partes` blocos equilibrados, maximizando o que cada um
/// cobre sozinho.
///
/// Devolve `None` quando o pedido não faz sentido: menos de dois blocos, ou
/// blocos demais para o fechamento — um bloco vazio não é uma aposta.
pub fn dividir(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    partes: usize,
) -> Option<Divisao> {
    if partes < 2 || cartelas.is_empty() || partes > cartelas.len() {
        return None;
    }
    let total_alvos = motor.total_alvos();

    // O rodízio guarda um mapa de cobertura e uma fila **por bloco**. Com poucos
    // blocos isso é barato e dá o melhor resultado; com muitos, estoura a
    // memória do aparelho antes de terminar. Em 25 dezenas são 3,2 milhões de
    // sorteios, e cada mapa ocupa 400 KB: mil blocos seriam 400 MB só de mapas.
    //
    // A troca é indolor porque as duas concordam justamente onde o rodízio
    // ficaria caro. Medido, o pior bloco de cada uma:
    //
    // ```text
    //                 rodízio   sequência
    // 21/18 em   4     50,60%      37,93%     ← o rodízio ganha, e muito
    // 22/19 em   4     52,02%      49,42%
    // 23/18 em  50      6,95%       6,80%     ← empatam
    // 20/17 em 200      0,88%       0,88%
    // 24/17 em 200      1,39%       1,38%
    // ```
    //
    // Com blocos pequenos sobra pouco espaço para equilibrar, e as duas chegam
    // ao mesmo lugar.
    let por_bloco = total_alvos.div_ceil(64) * 8 + cartelas.len() * 8;
    if partes.saturating_mul(por_bloco) > TETO_DE_MEMORIA {
        return dividir_em_sequencia(motor, cartelas, partes);
    }

    let palavras = total_alvos.div_ceil(64);
    let mut rascunho = Rascunho::novo();

    // Teto inicial do ganho de cada cartela: tudo que ela cobre. Só encolhe
    // daqui para baixo, que é o que autoriza a avaliação preguiçosa.
    let mut fila: Vec<Vec<(u32, u32)>> = Vec::with_capacity(partes);
    let mut tetos: Vec<(u32, u32)> = Vec::with_capacity(cartelas.len());
    for (i, &c) in cartelas.iter().enumerate() {
        motor.alvos_da_cartela(c, &mut rascunho);
        tetos.push((rascunho.alvos().len() as u32, i as u32));
    }
    // Ordem decrescente de teto: a fila é consumida do fim, que é o mais barato
    // de remover de um `Vec`.
    tetos.sort_unstable();
    for _ in 0..partes {
        fila.push(tetos.clone());
    }

    let base = cartelas.len() / partes;
    let sobra = cartelas.len() % partes;
    let tamanho = |b: usize| base + usize::from(b < sobra);

    let mut mascaras: Vec<Vec<u64>> = vec![vec![0u64; palavras]; partes];
    let mut escolhidas: Vec<Vec<usize>> = vec![Vec::new(); partes];
    let mut usada = vec![false; cartelas.len()];

    let mut faltam = cartelas.len();
    while faltam > 0 {
        let mut andou = false;
        for b in 0..partes {
            if escolhidas[b].len() >= tamanho(b) || faltam == 0 {
                continue;
            }
            let Some(i) = melhor_para(
                motor,
                cartelas,
                &mut fila[b],
                &usada,
                &mascaras[b],
                &mut rascunho,
            ) else {
                continue;
            };
            motor.alvos_da_cartela(cartelas[i], &mut rascunho);
            for &alvo in rascunho.alvos() {
                mascaras[b][alvo as usize / 64] |= 1 << (alvo as usize % 64);
            }
            escolhidas[b].push(i);
            usada[i] = true;
            faltam -= 1;
            andou = true;
        }
        // Nenhum bloco pôde crescer: as filas se esgotaram. Não pode acontecer
        // enquanto sobrar cartela, mas sair daqui é melhor que girar para sempre.
        if !andou {
            break;
        }
    }

    // O que sobrou — só se o laço acima desistiu — vai para o bloco menor.
    for (i, &ja) in usada.iter().enumerate() {
        if ja {
            continue;
        }
        let b = (0..partes).min_by_key(|&b| escolhidas[b].len()).unwrap_or(0);
        motor.alvos_da_cartela(cartelas[i], &mut rascunho);
        for &alvo in rascunho.alvos() {
            mascaras[b][alvo as usize / 64] |= 1 << (alvo as usize % 64);
        }
        escolhidas[b].push(i);
    }

    let blocos = escolhidas
        .into_iter()
        .zip(mascaras)
        .map(|(mut cartelas, mascara)| {
            cartelas.sort_unstable();
            let cobertos = mascara.iter().map(|p| u64::from(p.count_ones())).sum();
            Bloco { cartelas, cobertos }
        })
        .collect();

    Some(Divisao { blocos, total_alvos: total_alvos as u64 })
}

/// A cartela ainda livre que mais acrescenta a este bloco.
///
/// Consome a fila do bloco de trás para frente — teto maior primeiro. Quando o
/// ganho recontado de uma candidata ainda ganha do teto da próxima, ela é a
/// melhor e não há o que recontar; senão ela volta para a fila com o teto novo.
fn melhor_para(
    motor: &MotorCobertura,
    cartelas: &[Cartela],
    fila: &mut Vec<(u32, u32)>,
    usada: &[bool],
    mascara: &[u64],
    rascunho: &mut Rascunho,
) -> Option<usize> {
    loop {
        let (_, indice) = *fila.last()?;
        let i = indice as usize;
        if usada[i] {
            fila.pop();
            continue;
        }
        motor.alvos_da_cartela(cartelas[i], rascunho);
        let ganho = rascunho
            .alvos()
            .iter()
            .filter(|&&a| mascara[a as usize / 64] & (1 << (a as usize % 64)) == 0)
            .count() as u32;

        // Uma cartela que não acrescenta nada é tão boa quanto qualquer outra
        // que também não acrescente: leva-se esta e pronto. Sem esta saída, o
        // fim de um bloco já saturado devolve todas as candidatas à fila com
        // teto zero, uma por vez, e a reinserção vira trabalho quadrático.
        if ganho == 0 {
            fila.pop();
            return Some(i);
        }

        // O teto do próximo candidato ainda vivo.
        let proximo = fila
            .iter()
            .rev()
            .skip(1)
            .find(|(_, j)| !usada[*j as usize])
            .map(|&(t, _)| t);

        match proximo {
            Some(teto) if ganho < teto => {
                fila.pop();
                // Recoloca com o teto novo, mantendo a fila ordenada.
                let posicao = fila.partition_point(|&(t, _)| t < ganho);
                fila.insert(posicao, (ganho, indice));
            }
            _ => {
                fila.pop();
                return Some(i);
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::problema::{Objetivo, Problema, RegraCobertura};

    fn motor_de(pool: usize, cartela: usize, t: usize) -> MotorCobertura {
        let problema = Problema::novo(
            pool as u32,
            (1..=pool as u32).collect(),
            cartela,
            RegraCobertura { alvo: t, intersecao: t, premiadas: 1 },
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        MotorCobertura::novo(&problema).unwrap()
    }

    /// Todas as `C(pool, cartela)` cartelas — um fechamento gordo, e por isso
    /// bom para exercitar a divisão.
    fn todas(pool: usize, cartela: usize) -> Vec<Cartela> {
        let mut saida = Vec::new();
        let mut atual = Vec::new();
        fn passo(inicio: usize, pool: usize, k: usize, atual: &mut Vec<usize>, saida: &mut Vec<Cartela>) {
            if atual.len() == k {
                saida.push(Cartela::dos_indices(atual));
                return;
            }
            for i in inicio..pool {
                atual.push(i);
                passo(i + 1, pool, k, atual, saida);
                atual.pop();
            }
        }
        passo(0, pool, cartela, &mut atual, &mut saida);
        saida
    }

    #[test]
    fn os_blocos_particionam_o_fechamento_sem_perder_nem_repetir_cartela() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        for partes in 2..=6 {
            let d = dividir(&motor, &cartelas, partes).unwrap();
            assert_eq!(d.blocos.len(), partes);
            let mut vistas: Vec<usize> =
                d.blocos.iter().flat_map(|b| b.cartelas.iter().copied()).collect();
            vistas.sort_unstable();
            assert_eq!(vistas, (0..cartelas.len()).collect::<Vec<_>>(), "partes={partes}");
        }
    }

    #[test]
    fn os_blocos_ficam_iguais_a_menos_de_uma_cartela() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        for partes in 2..=7 {
            let d = dividir(&motor, &cartelas, partes).unwrap();
            let menor = d.blocos.iter().map(|b| b.cartelas.len()).min().unwrap();
            let maior = d.blocos.iter().map(|b| b.cartelas.len()).max().unwrap();
            assert!(maior - menor <= 1, "partes={partes}: de {menor} a {maior}");
        }
    }

    #[test]
    fn cada_bloco_cobre_mais_do_que_a_fracao_que_ele_representa() {
        // O ponto todo da ferramenta: a redundância do fechamento faz um bloco
        // valer mais que `1/k`. Se isto deixar de valer, a tela está prometendo
        // o que o algoritmo não entrega.
        let motor = motor_de(10, 5, 3);
        let cartelas = todas(10, 5);
        for partes in [2, 3, 4, 5] {
            let d = dividir(&motor, &cartelas, partes).unwrap();
            let pior = d.pior_cobertura();
            assert!(
                pior > 1.0 / partes as f64,
                "partes={partes}: pior bloco cobre {pior:.3}, e 1/k é {:.3}",
                1.0 / partes as f64
            );
        }
    }

    #[test]
    fn a_contagem_de_cobertos_bate_com_a_conta_feita_a_mao() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        let d = dividir(&motor, &cartelas, 3).unwrap();
        let mut rascunho = Rascunho::novo();
        for bloco in &d.blocos {
            let mut vistos = vec![false; motor.total_alvos()];
            for &i in &bloco.cartelas {
                motor.alvos_da_cartela(cartelas[i], &mut rascunho);
                for &a in rascunho.alvos() {
                    vistos[a as usize] = true;
                }
            }
            let conferido = vistos.iter().filter(|&&v| v).count() as u64;
            assert_eq!(bloco.cobertos, conferido);
        }
    }

    #[test]
    fn juntar_todos_os_blocos_devolve_a_cobertura_inteira() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        let d = dividir(&motor, &cartelas, 4).unwrap();
        let mut rascunho = Rascunho::novo();
        let mut vistos = vec![false; motor.total_alvos()];
        for bloco in &d.blocos {
            for &i in &bloco.cartelas {
                motor.alvos_da_cartela(cartelas[i], &mut rascunho);
                for &a in rascunho.alvos() {
                    vistos[a as usize] = true;
                }
            }
        }
        assert!(vistos.iter().all(|&v| v), "os blocos juntos precisam cobrir tudo");
    }

    #[test]
    fn a_divisao_por_cobertura_ganha_da_divisao_por_ordem() {
        // A exigência que motivou a ferramenta: não pode ser um corte qualquer.
        // A comparação é contra a divisão mais ingênua que existe — fatiar na
        // ordem em que as cartelas estão.
        let motor = motor_de(10, 5, 3);
        let cartelas = todas(10, 5);
        let partes = 4;
        let d = dividir(&motor, &cartelas, partes).unwrap();

        let mut rascunho = Rascunho::novo();
        let por_ordem: Vec<f64> = (0..partes)
            .map(|b| {
                let inicio = b * cartelas.len() / partes;
                let fim = (b + 1) * cartelas.len() / partes;
                let mut vistos = vec![false; motor.total_alvos()];
                for c in &cartelas[inicio..fim] {
                    motor.alvos_da_cartela(*c, &mut rascunho);
                    for &a in rascunho.alvos() {
                        vistos[a as usize] = true;
                    }
                }
                vistos.iter().filter(|&&v| v).count() as f64 / motor.total_alvos() as f64
            })
            .collect();
        let pior_ingenuo = por_ordem.iter().fold(f64::INFINITY, |a, &b| a.min(b));

        assert!(
            d.pior_cobertura() > pior_ingenuo,
            "por cobertura {:.3} não ganhou de por ordem {pior_ingenuo:.3}",
            d.pior_cobertura()
        );
    }

    #[test]
    fn as_duas_estrategias_particionam_igual_e_concordam_com_muitos_blocos() {
        let motor = motor_de(10, 5, 3);
        let cartelas = todas(10, 5);
        for partes in [2, 4, 20, 60, cartelas.len()] {
            let a = dividir(&motor, &cartelas, partes).unwrap();
            let b = dividir_em_sequencia(&motor, &cartelas, partes).unwrap();

            // As duas precisam repartir o fechamento inteiro, sempre.
            for d in [&a, &b] {
                let mut vistas: Vec<usize> =
                    d.blocos.iter().flat_map(|x| x.cartelas.iter().copied()).collect();
                vistas.sort_unstable();
                assert_eq!(vistas, (0..cartelas.len()).collect::<Vec<_>>(), "partes={partes}");
                let menor = d.blocos.iter().map(|x| x.cartelas.len()).min().unwrap();
                let maior = d.blocos.iter().map(|x| x.cartelas.len()).max().unwrap();
                assert!(maior - menor <= 1, "partes={partes}");
            }

            // E o rodízio nunca pode ser **pior** que a sequência: ele é a
            // estratégia cara, e só existe enquanto compra alguma coisa.
            assert!(
                a.pior_cobertura() >= b.pior_cobertura() - 1e-9,
                "partes={partes}: rodízio {:.4} perdeu da sequência {:.4}",
                a.pior_cobertura(),
                b.pior_cobertura()
            );
        }
    }

    #[test]
    fn com_blocos_demais_para_a_memoria_a_divisao_ainda_sai() {
        // A configuração mais pesada da modalidade tem 3,2 milhões de sorteios,
        // e mil mapas de cobertura seriam 400 MB. Aqui o que se prova é que o
        // pedido grande é atendido em vez de derrubar a aba — a escolha da
        // estratégia acontece por dentro, sem quem chamou precisar saber.
        let motor = motor_de(12, 6, 3);
        let cartelas = todas(12, 6);
        let d = dividir(&motor, &cartelas, 400).unwrap();
        assert_eq!(d.blocos.len(), 400);
        let soma: usize = d.blocos.iter().map(|b| b.cartelas.len()).sum();
        assert_eq!(soma, cartelas.len());
        assert!(d.pior_cobertura() > 1.0 / 400.0, "mesmo miúdo, o bloco vale mais que 1/k");
    }

    #[test]
    fn o_melhor_bloco_ganha_do_melhor_pedaco_de_uma_divisao() {
        // A razão de a seleção existir: repartir amarra cada bloco a deixar
        // cartelas boas para os outros, e procurar direto não tem essa amarra.
        let motor = motor_de(10, 5, 3);
        let cartelas = todas(10, 5);
        for partes in [2, 3, 4] {
            let d = dividir(&motor, &cartelas, partes).unwrap();
            let tamanho = d
                .blocos
                .iter()
                .max_by_key(|b| b.cobertos)
                .map(|b| b.cartelas.len())
                .unwrap();
            let escolhido = melhor_bloco(&motor, &cartelas, tamanho).unwrap();
            assert!(
                escolhido.cobertos >= d.blocos.iter().map(|b| b.cobertos).max().unwrap(),
                "partes={partes}: o escolhido cobre {} e o melhor pedaço cobre {}",
                escolhido.cobertos,
                d.blocos.iter().map(|b| b.cobertos).max().unwrap()
            );
            assert_eq!(escolhido.cartelas.len(), tamanho);
        }
    }

    #[test]
    fn a_troca_nunca_piora_o_guloso() {
        // Ela só aceita substituições que aumentam a cobertura, e o orçamento
        // pode interrompê-la em qualquer ponto. Nos dois casos o que sai tem de
        // ser ao menos o que o guloso tinha.
        let motor = motor_de(10, 5, 3);
        let cartelas = todas(10, 5);
        for tamanho in [3, 10, 40, 100] {
            let guloso = melhor_bloco_com(&motor, &cartelas, tamanho, 0).unwrap();
            let trocado = melhor_bloco_com(&motor, &cartelas, tamanho, 12).unwrap();
            assert!(
                trocado.cobertos >= guloso.cobertos,
                "tamanho={tamanho}: troca piorou de {} para {}",
                guloso.cobertos,
                trocado.cobertos
            );
            assert_eq!(trocado.cartelas.len(), tamanho);
            // E sem repetir cartela.
            let mut vistas = trocado.cartelas.clone();
            vistas.sort_unstable();
            vistas.dedup();
            assert_eq!(vistas.len(), tamanho);
        }
    }

    #[test]
    fn a_contagem_do_melhor_bloco_bate_com_a_conta_feita_a_mao() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        let b = melhor_bloco(&motor, &cartelas, 20).unwrap();
        let mut rascunho = Rascunho::novo();
        let mut vistos = vec![false; motor.total_alvos()];
        for &i in &b.cartelas {
            motor.alvos_da_cartela(cartelas[i], &mut rascunho);
            for &a in rascunho.alvos() {
                vistos[a as usize] = true;
            }
        }
        assert_eq!(b.cobertos, vistos.iter().filter(|&&v| v).count() as u64);
    }

    #[test]
    fn escolher_todas_as_cartelas_cobre_tudo_e_escolher_nenhuma_nao_existe() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        let inteiro = melhor_bloco(&motor, &cartelas, cartelas.len()).unwrap();
        assert_eq!(inteiro.cobertos, motor.total_alvos() as u64);
        assert!(melhor_bloco(&motor, &cartelas, 0).is_none());
        assert!(melhor_bloco(&motor, &cartelas, cartelas.len() + 1).is_none());
    }

    #[test]
    fn pedidos_sem_sentido_devolvem_nada_em_vez_de_bloco_vazio() {
        let motor = motor_de(9, 4, 3);
        let cartelas = todas(9, 4);
        assert!(dividir(&motor, &cartelas, 1).is_none(), "um bloco só não é divisão");
        assert!(dividir(&motor, &cartelas, 0).is_none());
        assert!(
            dividir(&motor, &cartelas, cartelas.len() + 1).is_none(),
            "mais blocos que cartelas deixaria bloco vazio"
        );
        assert!(dividir(&motor, &[], 2).is_none());
        // No limite — um bloco por cartela — ainda faz sentido.
        assert!(dividir(&motor, &cartelas, cartelas.len()).is_some());
    }
}
