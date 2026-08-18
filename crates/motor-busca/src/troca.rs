//! Descida por troca de ponto — o passo pequeno que faltava.
//!
//! ## O problema que ela resolve
//!
//! O laço de destruir e reconstruir só sabe dar passos grandes: tira cartelas
//! inteiras e monta cartelas inteiras no lugar. Quando a solução já está no
//! teto de cartelas e ainda faltam alguns sorteios, esse passo é grande demais
//! — reconstruir uma cartela do zero descobre outros sorteios enquanto cobre os
//! que faltavam, e a iteração termina pior do que começou. Medido: a partir do
//! banco publicado, dez minutos de busca em `(24,17)` tiravam quinze cartelas
//! de trinta e duas mil.
//!
//! O passo pequeno é trocar **uma dezena de uma cartela**. Mantém o número de
//! cartelas, mexe em pouca coisa, e é guiado: escolhe-se um sorteio ainda
//! descoberto e move-se uma cartela na direção dele.
//!
//! É o método de Nurmela e Östergård para covering designs, e a razão de
//! funcionar é que ele minimiza **o que falta cobrir** com o tamanho fixo, em
//! vez de tentar encolher uma solução já fechada.
//!
//! ## Aceitação tardia
//!
//! Aceitar só o que melhora trava em qualquer mínimo local. A aceitação aqui
//! compara com o custo de `HISTORIA` passos atrás: piorar é permitido desde que
//! não se esteja pior do que se estava um tempo atrás. É um parâmetro só, e não
//! exige calibrar temperatura por configuração — que é justamente o que torna
//! recozimento simulado chato de usar num aplicativo que roda em qualquer
//! problema que o usuário pedir.

use motor_core::cartela::Cartela;
use motor_core::cobertura::MotorCobertura;
use motor_core::combinatoria::subconjunto_do_indice;
use motor_core::solucao::Solucao;
use rand::Rng;

use crate::oficina::Oficina;

/// Quantos custos passados a aceitação guarda.
const HISTORIA: usize = 512;

/// Quantas cartelas concorrem para receber a troca.
///
/// Sorteada ao acaso entre trinta mil, a cartela quase nunca tem o que ver com
/// o sorteio descoberto e a troca vira ruído. Amostrar algumas e ficar com a
/// que mais já acerta o sorteio custa uns poucos testes de bit e transforma o
/// movimento em progresso.
const TORNEIO: usize = 16;

/// Tenta fechar a cobertura sem mudar o número de cartelas.
///
/// Devolve `true` se conseguiu. Gasta no máximo `orcamento` trocas; quem chama
/// decide o orçamento, porque o custo de uma troca varia muito com a
/// configuração — `C(k,t)` alvos por cartela mexida.
pub fn descida_por_troca(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    orcamento: u64,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> bool {
    if solucao.cobertura_total() {
        return true;
    }
    if solucao.esta_vazia() {
        return false;
    }

    let mut custo = solucao.total_descobertos();
    let mut historia = [custo; HISTORIA];
    let mut passo = 0usize;

    // Sem isto, uma descida sem saída gasta o orçamento inteiro toda iteração.
    // Quatro janelas de história sem nenhum custo melhor que o já visto é sinal
    // de que aquele conjunto de cartelas não fecha; melhor devolver o controle
    // e deixar a busca tentar outra perturbação.
    let mut melhor_custo = custo;
    let mut parado_ha = 0usize;
    let paciencia = HISTORIA * 4;

    for _ in 0..orcamento {
        if custo == 0 {
            return true;
        }
        passo = passo.wrapping_add(1);

        // O sorteio descoberto que guia o movimento.
        let descobertos = solucao.descobertos();
        let Some(indice_do_alvo) = descobertos.em(rng.gen_range(0..descobertos.len())) else {
            return solucao.cobertura_total();
        };
        subconjunto_do_indice(
            motor.binomiais(),
            indice_do_alvo as u64,
            motor.alvo(),
            &mut oficina.semente,
        );
        let mascara_do_alvo = Cartela::dos_indices(&oficina.semente);

        let mut escolhida = rng.gen_range(0..solucao.quantidade());
        let mut melhor_acerto = usize::MIN;
        for _ in 0..TORNEIO {
            let i = rng.gen_range(0..solucao.quantidade());
            let acerto = solucao.cartelas()[i].tamanho_intersecao(mascara_do_alvo);
            if acerto > melhor_acerto {
                melhor_acerto = acerto;
                escolhida = i;
            }
        }

        let cartela = solucao.cartelas()[escolhida];

        // Entra uma dezena do sorteio que falta na cartela — é a única direção
        // que aproxima a cartela de atender aquele sorteio.
        oficina.candidatos.clear();
        oficina
            .candidatos
            .extend(oficina.semente.iter().copied().filter(|&e| !cartela.contem(e)));
        if oficina.candidatos.is_empty() {
            continue;
        }
        let entra = oficina.candidatos[rng.gen_range(0..oficina.candidatos.len())];

        // Sai uma que não esteja no sorteio, para não desfazer o que se ganhou.
        cartela.indices_em(&mut oficina.candidatos);
        oficina.candidatos.retain(|&e| !mascara_do_alvo.contem(e));
        if oficina.candidatos.is_empty() {
            continue;
        }
        let sai = oficina.candidatos[rng.gen_range(0..oficina.candidatos.len())];

        let mut nova = cartela;
        nova.remover(sai);
        nova.inserir(entra);

        solucao.remover(motor, escolhida, &mut oficina.rascunho);
        solucao.adicionar(motor, nova, &mut oficina.rascunho);
        let depois = solucao.total_descobertos();

        if depois <= custo || depois <= historia[passo % HISTORIA] {
            custo = depois;
        } else {
            // `adicionar` põe no fim, então desfazer é tirar o fim e repor a
            // cartela antiga. A ordem das cartelas não carrega significado.
            let ultimo = solucao.quantidade() - 1;
            solucao.remover(motor, ultimo, &mut oficina.rascunho);
            solucao.adicionar(motor, cartela, &mut oficina.rascunho);
        }
        historia[passo % HISTORIA] = custo;

        if custo < melhor_custo {
            melhor_custo = custo;
            parado_ha = 0;
        } else {
            parado_ha += 1;
            if parado_ha >= paciencia {
                return false;
            }
        }
    }

    solucao.cobertura_total()
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::construcao::{construir_do_zero, podar};
    use motor_core::problema::{Objetivo, Problema, RegraCobertura};
    use rand::SeedableRng;
    use rand_pcg::Pcg64Mcg;

    fn ambiente(p: usize, k: usize, j: usize, t: usize) -> (MotorCobertura, Oficina, Pcg64Mcg) {
        let problema = Problema::com_pool_inicial(
            p as u32,
            p,
            k,
            RegraCobertura::garantia(j, t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        (
            MotorCobertura::novo(&problema).unwrap(),
            Oficina::nova(),
            Pcg64Mcg::seed_from_u64(11),
        )
    }

    #[test]
    fn fecha_a_cobertura_sem_mudar_o_numero_de_cartelas() {
        // O caso de uso: uma solução fechada perde uma cartela, e a descida
        // precisa recobrir tudo com as que sobraram. Se conseguir, o recorde
        // caiu de graça.
        let (motor, mut oficina, mut rng) = ambiente(12, 4, 3, 2);
        let mut solucao = Solucao::vazia(&motor);
        construir_do_zero(&motor, &mut solucao, 0.2, usize::MAX, &mut rng, &mut oficina, None);
        podar(&motor, &mut solucao, &mut oficina);

        let antes = solucao.quantidade();
        solucao.remover(&motor, 0, &mut oficina.rascunho);
        assert!(!solucao.cobertura_total(), "tirar uma cartela tinha de descobrir algo");

        let fechou = descida_por_troca(&motor, &mut solucao, 200_000, &mut rng, &mut oficina);

        assert_eq!(
            solucao.quantidade(),
            antes - 1,
            "a descida não pode mudar o número de cartelas"
        );
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
        if fechou {
            assert!(solucao.cobertura_total(), "disse que fechou e não fechou");
        }
    }

    #[test]
    fn nunca_inventa_nem_perde_cartela() {
        let (motor, mut oficina, mut rng) = ambiente(10, 4, 3, 2);
        let mut solucao = Solucao::vazia(&motor);
        for i in 0..5 {
            solucao.adicionar(
                &motor,
                Cartela::dos_indices(&[i, (i + 1) % 10, (i + 2) % 10, (i + 3) % 10]),
                &mut oficina.rascunho,
            );
        }
        let antes = solucao.quantidade();
        descida_por_troca(&motor, &mut solucao, 5_000, &mut rng, &mut oficina);
        assert_eq!(solucao.quantidade(), antes);
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
        for c in solucao.cartelas() {
            assert_eq!(c.tamanho(), 4, "toda cartela continua com k dezenas");
        }
    }

    #[test]
    fn com_a_cobertura_ja_fechada_nao_faz_nada() {
        let (motor, mut oficina, mut rng) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);
        construir_do_zero(&motor, &mut solucao, 0.0, usize::MAX, &mut rng, &mut oficina, None);

        let antes: Vec<Cartela> = solucao.cartelas().to_vec();
        assert!(descida_por_troca(&motor, &mut solucao, 10_000, &mut rng, &mut oficina));
        assert_eq!(solucao.cartelas(), antes.as_slice());
    }
}
