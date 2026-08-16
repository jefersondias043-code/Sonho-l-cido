//! O portfólio de transformações — §9 do documento conceitual.
//!
//! Cada operador *destrói* parte da solução de um jeito diferente. A
//! reconstrução que vem depois é sempre a mesma; o que muda é o buraco que ela
//! precisa preencher, e é isso que leva a busca para regiões diferentes do
//! espaço de soluções.
//!
//! Nenhum operador é melhor que os outros em abstrato. Remoção relacionada
//! costuma render em problemas com muita estrutura; reconstrução profunda é o
//! que destrava um ótimo local teimoso; troca de elemento faz o ajuste fino
//! quando a solução já está quase lá. Qual serve para *este* problema é
//! justamente o que os pesos adaptativos descobrem sozinhos.

use motor_core::{Cartela, MotorCobertura, Solucao};
use rand::Rng;

use crate::construcao::{embaralhar, podar};
use crate::oficina::Oficina;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Operador {
    /// §9.1 — tira o que não faz falta. A redução que sai de graça.
    RemoverRedundantes,
    /// §9.2 — abre espaço ao acaso, para a reconstrução tentar outra coisa.
    RemoverAleatorias,
    /// §9.2 — tira as cartelas que menos contribuem de forma exclusiva.
    RemoverPiores,
    /// §9.3 — tira um grupo de cartelas parecidas entre si, desmontando uma
    /// região inteira em vez de furos espalhados.
    RemoverRelacionadas,
    /// §9.3 — troca um único elemento de uma cartela. Ajuste fino.
    TrocarElemento,
    /// §9.4 — desmonta cerca de um terço da solução.
    ReconstrucaoParcial,
    /// §9.5 — desmonta a maior parte, para escapar de ótimo local.
    ReconstrucaoProfunda,
    /// §9.6 — importa material genético de uma solução guardada no arquivo.
    RecombinarComElite,
}

impl Operador {
    pub const TODOS: [Operador; 8] = [
        Operador::RemoverRedundantes,
        Operador::RemoverAleatorias,
        Operador::RemoverPiores,
        Operador::RemoverRelacionadas,
        Operador::TrocarElemento,
        Operador::ReconstrucaoParcial,
        Operador::ReconstrucaoProfunda,
        Operador::RecombinarComElite,
    ];

    pub fn nome(&self) -> &'static str {
        match self {
            Operador::RemoverRedundantes => "remover redundantes",
            Operador::RemoverAleatorias => "remover aleatórias",
            Operador::RemoverPiores => "remover piores",
            Operador::RemoverRelacionadas => "remover relacionadas",
            Operador::TrocarElemento => "trocar elemento",
            Operador::ReconstrucaoParcial => "reconstrução parcial",
            Operador::ReconstrucaoProfunda => "reconstrução profunda",
            Operador::RecombinarComElite => "recombinar com elite",
        }
    }

    /// Quantas cartelas este operador tira, dado o tamanho da solução.
    ///
    /// Sempre ao menos uma, e nunca todas: uma solução zerada perde toda a
    /// informação acumulada e a reconstrução vira um recomeço.
    fn intensidade(&self, quantidade: usize, rng: &mut impl Rng) -> usize {
        let teto = quantidade.saturating_sub(1).max(1);
        let escolha = match self {
            Operador::RemoverRedundantes => 0,
            Operador::TrocarElemento => 1,
            Operador::RemoverAleatorias | Operador::RemoverPiores => {
                rng.gen_range(1..=3.min(teto))
            }
            Operador::RemoverRelacionadas => rng.gen_range(2..=4.min(teto).max(2)),
            Operador::ReconstrucaoParcial => {
                (quantidade as f64 * rng.gen_range(0.20..0.40)).round() as usize
            }
            Operador::ReconstrucaoProfunda => {
                (quantidade as f64 * rng.gen_range(0.50..0.80)).round() as usize
            }
            Operador::RecombinarComElite => {
                (quantidade as f64 * rng.gen_range(0.25..0.50)).round() as usize
            }
        };
        escolha.clamp(0, teto)
    }
}

/// Aplica a fase de destruição do operador. Devolve quantas cartelas saíram.
///
/// `elite` é o material de recombinação; quando ausente, o operador de
/// recombinação se comporta como remoção aleatória.
pub fn destruir(
    operador: Operador,
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    elite: Option<&[Cartela]>,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    let quantidade = solucao.quantidade();
    if quantidade == 0 {
        return 0;
    }
    let intensidade = operador.intensidade(quantidade, rng);

    match operador {
        Operador::RemoverRedundantes => podar(motor, solucao, oficina),

        Operador::RemoverAleatorias
        | Operador::ReconstrucaoParcial
        | Operador::ReconstrucaoProfunda => remover_aleatorias(motor, solucao, intensidade, rng, oficina),

        Operador::RemoverPiores => remover_piores(motor, solucao, intensidade, oficina),

        Operador::RemoverRelacionadas => {
            remover_relacionadas(motor, solucao, intensidade, rng, oficina)
        }

        Operador::TrocarElemento => trocar_elemento(motor, solucao, rng, oficina),

        Operador::RecombinarComElite => match elite {
            Some(cartelas) if !cartelas.is_empty() => {
                recombinar(motor, solucao, cartelas, intensidade, rng, oficina)
            }
            _ => remover_aleatorias(motor, solucao, intensidade, rng, oficina),
        },
    }
}

fn remover_aleatorias(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    quantas: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    let mut removidas = 0;
    for _ in 0..quantas {
        if solucao.quantidade() <= 1 {
            break;
        }
        let indice = rng.gen_range(0..solucao.quantidade());
        solucao.remover(motor, indice, &mut oficina.rascunho);
        removidas += 1;
    }
    removidas
}

fn remover_piores(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    quantas: usize,
    oficina: &mut Oficina,
) -> usize {
    if quantas == 0 || solucao.quantidade() <= 1 {
        return 0;
    }

    oficina.notas.clear();
    for indice in 0..solucao.quantidade() {
        let contribuicao = solucao.contribuicao_unica(motor, indice, &mut oficina.rascunho);
        oficina.notas.push(contribuicao as i64);
    }

    oficina.ordem.clear();
    oficina.ordem.extend(0..solucao.quantidade());
    oficina.ordem.sort_unstable_by_key(|&i| oficina.notas[i]);

    let limite = quantas.min(solucao.quantidade() - 1);
    oficina.remocoes.clear();
    for &indice in oficina.ordem.iter().take(limite) {
        oficina.remocoes.push(solucao.cartelas()[indice]);
    }

    remover_por_valor(motor, solucao, oficina)
}

fn remover_relacionadas(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    quantas: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    if quantas == 0 || solucao.quantidade() <= 1 {
        return 0;
    }

    // Remoção de Shaw: escolhe uma cartela âncora e leva junto as que mais se
    // parecem com ela. Desmontar uma região coerente dá à reconstrução uma
    // chance real de reorganizá-la; furos espalhados só seriam remendados.
    let ancora = solucao.cartelas()[rng.gen_range(0..solucao.quantidade())];

    oficina.ordem.clear();
    oficina.ordem.extend(0..solucao.quantidade());
    oficina.notas.clear();
    for &indice in oficina.ordem.iter() {
        // Proximidade em milésimos, para poder ordenar por inteiro.
        let distancia = ancora.distancia_jaccard(solucao.cartelas()[indice]);
        oficina.notas.push((distancia * 1000.0) as i64);
    }
    oficina.ordem.sort_unstable_by_key(|&i| oficina.notas[i]);

    let limite = quantas.min(solucao.quantidade() - 1);
    oficina.remocoes.clear();
    for &indice in oficina.ordem.iter().take(limite) {
        oficina.remocoes.push(solucao.cartelas()[indice]);
    }

    remover_por_valor(motor, solucao, oficina)
}

fn trocar_elemento(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    let indice = rng.gen_range(0..solucao.quantidade());
    let mut cartela = solucao.remover(motor, indice, &mut oficina.rascunho);

    cartela.indices_em(&mut oficina.candidatos);
    if !oficina.candidatos.is_empty() {
        let sai = oficina.candidatos[rng.gen_range(0..oficina.candidatos.len())];
        cartela.remover(sai);
    }

    cartela.indices_ausentes_em(motor.tamanho_pool(), &mut oficina.candidatos);
    if !oficina.candidatos.is_empty() {
        let entra = oficina.candidatos[rng.gen_range(0..oficina.candidatos.len())];
        cartela.inserir(entra);
    }

    solucao.adicionar(motor, cartela, &mut oficina.rascunho);
    // A quantidade de cartelas não mudou: nada a reconstruir.
    0
}

fn recombinar(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    elite: &[Cartela],
    quantas: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    let removidas = remover_aleatorias(motor, solucao, quantas, rng, oficina);
    if removidas == 0 {
        return 0;
    }

    // Traz cartelas da elite que ainda não estão presentes. As que já existem
    // não acrescentariam nada — seriam pura redundância.
    oficina.remocoes.clear();
    oficina.remocoes.extend_from_slice(elite);
    embaralhar(&mut oficina.remocoes, rng);

    let mut importadas = 0;
    for indice in 0..oficina.remocoes.len() {
        if importadas >= removidas {
            break;
        }
        let cartela = oficina.remocoes[indice];
        if !solucao.cartelas().contains(&cartela) {
            solucao.adicionar(motor, cartela, &mut oficina.rascunho);
            importadas += 1;
        }
    }

    removidas.saturating_sub(importadas)
}

/// Remove, por valor, as cartelas listadas em `oficina.remocoes`.
fn remover_por_valor(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    oficina: &mut Oficina,
) -> usize {
    let mut removidas = 0;
    for indice in 0..oficina.remocoes.len() {
        if solucao.quantidade() <= 1 {
            break;
        }
        let alvo = oficina.remocoes[indice];
        if let Some(posicao) = solucao.cartelas().iter().position(|&c| c == alvo) {
            solucao.remover(motor, posicao, &mut oficina.rascunho);
            removidas += 1;
        }
    }
    removidas
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::construcao::construir_do_zero;
    use motor_core::problema::{Objetivo, Problema, RegraCobertura};
    use rand::SeedableRng;
    use rand_pcg::Pcg64Mcg;

    fn ambiente() -> (MotorCobertura, Solucao, Oficina, Pcg64Mcg) {
        let problema = Problema::com_pool_inicial(
            16,
            16,
            4,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let motor = MotorCobertura::novo(&problema).unwrap();
        let mut oficina = Oficina::nova();
        let mut rng = Pcg64Mcg::seed_from_u64(11);
        let mut solucao = Solucao::vazia(&motor);
        construir_do_zero(&motor, &mut solucao, 0.3, usize::MAX, &mut rng, &mut oficina);
        (motor, solucao, oficina, rng)
    }

    #[test]
    fn todo_operador_preserva_os_invariantes_da_solucao() {
        // Se qualquer operador corromper o estado incremental, milhões de
        // iterações depois a "melhor solução" seria uma mentira.
        for operador in Operador::TODOS {
            let (motor, mut solucao, mut oficina, mut rng) = ambiente();
            let elite: Vec<Cartela> = solucao.cartelas().to_vec();

            for rodada in 0..25 {
                destruir(operador, &motor, &mut solucao, Some(&elite), &mut rng, &mut oficina);
                assert_eq!(
                    solucao.conferir_invariantes(&motor),
                    Ok(()),
                    "{} corrompeu o estado na rodada {rodada}",
                    operador.nome()
                );
                crate::construcao::reparar(
                    &motor,
                    &mut solucao,
                    usize::MAX,
                    0.3,
                    usize::MAX,
                    &mut rng,
                    &mut oficina,
                );
                assert_eq!(
                    solucao.conferir_invariantes(&motor),
                    Ok(()),
                    "reparo após {} corrompeu o estado na rodada {rodada}",
                    operador.nome()
                );
            }
        }
    }

    #[test]
    fn nenhum_operador_esvazia_a_solucao() {
        for operador in Operador::TODOS {
            let (motor, mut solucao, mut oficina, mut rng) = ambiente();
            for _ in 0..60 {
                destruir(operador, &motor, &mut solucao, None, &mut rng, &mut oficina);
                assert!(
                    solucao.quantidade() >= 1,
                    "{} zerou a solução e apagaria toda a informação acumulada",
                    operador.nome()
                );
            }
        }
    }

    #[test]
    fn reconstrucao_profunda_destroi_mais_que_a_parcial() {
        let (_, solucao, _, _) = ambiente();
        let quantidade = solucao.quantidade();
        let mut rng = Pcg64Mcg::seed_from_u64(99);

        let mut parcial = 0usize;
        let mut profunda = 0usize;
        for _ in 0..200 {
            parcial += Operador::ReconstrucaoParcial.intensidade(quantidade, &mut rng);
            profunda += Operador::ReconstrucaoProfunda.intensidade(quantidade, &mut rng);
        }

        assert!(profunda > parcial, "profunda={profunda} deveria superar parcial={parcial}");
    }

    #[test]
    fn trocar_elemento_mantem_a_quantidade_e_o_tamanho_das_cartelas() {
        let (motor, mut solucao, mut oficina, mut rng) = ambiente();
        let quantidade = solucao.quantidade();

        for _ in 0..40 {
            destruir(
                Operador::TrocarElemento,
                &motor,
                &mut solucao,
                None,
                &mut rng,
                &mut oficina,
            );
            assert_eq!(solucao.quantidade(), quantidade);
            for cartela in solucao.cartelas() {
                assert_eq!(cartela.tamanho(), 4, "a cartela precisa manter k elementos");
            }
        }
    }

    #[test]
    fn remover_redundantes_nunca_descobre_um_alvo() {
        let (motor, mut solucao, mut oficina, mut rng) = ambiente();
        assert!(solucao.cobertura_total());

        destruir(
            Operador::RemoverRedundantes,
            &motor,
            &mut solucao,
            None,
            &mut rng,
            &mut oficina,
        );

        assert!(solucao.cobertura_total(), "a poda descobriu um alvo");
    }

    #[test]
    fn recombinar_traz_material_da_elite() {
        let (motor, mut solucao, mut oficina, mut rng) = ambiente();

        // Elite feita de cartelas que a solução atual não tem.
        let elite: Vec<Cartela> = (0..6)
            .map(|i| Cartela::dos_indices(&[i, (i + 5) % 16, (i + 9) % 16, (i + 13) % 16]))
            .filter(|c| !solucao.cartelas().contains(c))
            .collect();
        assert!(!elite.is_empty(), "o teste precisa de elite realmente nova");

        let antes: Vec<Cartela> = solucao.cartelas().to_vec();
        destruir(
            Operador::RecombinarComElite,
            &motor,
            &mut solucao,
            Some(&elite),
            &mut rng,
            &mut oficina,
        );

        let importou = solucao.cartelas().iter().any(|c| elite.contains(c) && !antes.contains(c));
        assert!(importou, "a recombinação não trouxe nada da elite");
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
    }

    #[test]
    fn remover_piores_prefere_as_de_menor_contribuicao() {
        let (motor, mut solucao, mut oficina, mut rng) = ambiente();

        // Uma duplicata tem contribuição única zero: deve ser a primeira a sair.
        let duplicada = solucao.cartelas()[0];
        solucao.adicionar(&motor, duplicada, &mut oficina.rascunho);
        let quantidade_com_duplicata = solucao.cartelas().iter().filter(|&&c| c == duplicada).count();
        assert_eq!(quantidade_com_duplicata, 2);

        destruir(Operador::RemoverPiores, &motor, &mut solucao, None, &mut rng, &mut oficina);

        let restantes = solucao.cartelas().iter().filter(|&&c| c == duplicada).count();
        assert!(restantes < 2, "a cartela duplicada deveria ter sido escolhida para sair");
    }
}
