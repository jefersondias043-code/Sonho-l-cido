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
