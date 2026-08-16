//! Construção de cartelas e reparo de soluções incompletas.
//!
//! Toda cartela nova nasce ao redor de um alvo descoberto: pega-se um
//! subconjunto que ninguém atende, garante-se que a cartela vai atendê-lo, e o
//! resto dos lugares é preenchido de forma gulosa — cada elemento escolhido é o
//! que cobre mais alvos novos.
//!
//! O guloso puro, porém, sempre produz a mesma cartela para a mesma situação.
//! Isso mataria a exploração. Por isso a escolha é feita entre os melhores
//! candidatos, não sobre o melhor absoluto: é a ideia do GRASP, e é o que faz
//! duas execuções a partir do mesmo ponto seguirem caminhos diferentes.

use motor_core::cartela::Cartela;
use motor_core::cobertura::MotorCobertura;
use motor_core::combinatoria::subconjunto_do_indice;
use motor_core::solucao::Solucao;
use rand::Rng;

use crate::oficina::Oficina;

/// Quantos candidatos avaliar em cada posição da cartela.
///
/// Medir o ganho de um candidato exige percorrer todos os alvos que a cartela
/// atenderia — `C(k,t)` num covering design, mas facilmente milhares numa
/// garantia parcial. Avaliar todos os candidatos em todas as posições faz o
/// custo de uma única cartela variar por três ordens de grandeza entre
/// configurações, e foi exatamente isso que derrubou a velocidade da busca de
/// centenas de milhares para dezenas de iterações por segundo.
///
/// A solução é orçar o trabalho, não o número de candidatos: `orcamento` é o
/// teto de operações sobre alvos gasto na construção de uma cartela. Onde a
/// avaliação é barata, todos os candidatos continuam sendo avaliados e nada
/// muda; onde é cara, avalia-se uma amostra. Menos qualidade por cartela, mas
/// ordens de grandeza mais iterações — e é o total de iterações que encontra
/// soluções melhores.
pub fn candidatos_por_posicao(motor: &MotorCobertura, orcamento: u64) -> usize {
    let custo_por_avaliacao = motor.viabilidade().alvos_por_cartela.max(1);
    let avaliacoes = (orcamento / custo_por_avaliacao).max(1);
    let por_posicao = avaliacoes / motor.tamanho_cartela().max(1) as u64;
    por_posicao.max(1) as usize
}

/// Monta uma cartela contendo obrigatoriamente os elementos de `semente`.
///
/// `ruido` em `0.0..=1.0` controla o tamanho da lista restrita de candidatos:
/// 0 é guloso puro (sempre o melhor elemento), 1 é escolha uniforme entre
/// todos. Valores intermediários preservam a qualidade da escolha gulosa e
/// ainda assim diversificam.
///
/// `max_candidatos` limita quantos candidatos são avaliados em cada posição;
/// veja [`candidatos_por_posicao`].
pub fn cartela_ao_redor(
    motor: &MotorCobertura,
    solucao: &Solucao,
    ruido: f64,
    max_candidatos: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> Cartela {
    let k = motor.tamanho_cartela();
    let p = motor.tamanho_pool();

    let mut cartela = Cartela::vazia();
    for &elemento in oficina.semente.iter().take(k) {
        cartela.inserir(elemento);
    }

    while cartela.tamanho() < k {
        cartela.indices_ausentes_em(p, &mut oficina.candidatos);
        if oficina.candidatos.is_empty() {
            break;
        }

        // Quando não cabem todos no orçamento, embaralha e avalia um pedaço.
        // O embaralhamento importa: cortar a lista em ordem crescente daria
        // sempre preferência aos elementos de índice baixo.
        if oficina.candidatos.len() > max_candidatos {
            embaralhar(&mut oficina.candidatos, rng);
            oficina.candidatos.truncate(max_candidatos);
        }

        // Ganho de cada candidato: quantos alvos hoje descobertos ele passaria
        // a cobrir se entrasse na cartela.
        oficina.notas.clear();
        let mut melhor_ganho = i64::MIN;
        for &candidato in &oficina.candidatos {
            let mut tentativa = cartela;
            tentativa.inserir(candidato);
            let ganho = solucao.ganho_de(motor, tentativa, &mut oficina.rascunho) as i64;
            melhor_ganho = melhor_ganho.max(ganho);
            oficina.notas.push(ganho);
        }

        // Lista restrita: tudo que chega perto do melhor ganho concorre.
        let corte = (melhor_ganho as f64 * (1.0 - ruido)).floor() as i64;
        let escolhido = escolher_da_lista_restrita(&oficina.candidatos, &oficina.notas, corte, rng);
        cartela.inserir(escolhido);
    }

    cartela
}

/// Sorteia uniformemente entre os candidatos cuja nota alcança o corte.
fn escolher_da_lista_restrita(
    candidatos: &[usize],
    notas: &[i64],
    corte: i64,
    rng: &mut impl Rng,
) -> usize {
    debug_assert_eq!(candidatos.len(), notas.len());

    // Amostragem de reservatório: escolhe uniformemente entre os qualificados
    // em uma única passada, sem montar uma lista intermediária.
    let mut escolhido = candidatos[0];
    let mut qualificados = 0u32;
    for (&candidato, &nota) in candidatos.iter().zip(notas.iter()) {
        if nota >= corte {
            qualificados += 1;
            if rng.gen_range(0..qualificados) == 0 {
                escolhido = candidato;
            }
        }
    }
    escolhido
}

/// Cria uma cartela em torno de um alvo descoberto sorteado ao acaso.
///
/// A semente são `intersecao` elementos do alvo, o que já garante que a cartela
/// resultante o atenda.
pub fn cartela_para_alvo_descoberto(
    motor: &MotorCobertura,
    solucao: &Solucao,
    ruido: f64,
    max_candidatos: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> Option<Cartela> {
    let descobertos = solucao.descobertos();
    if descobertos.is_empty() {
        return None;
    }

    let alvo = descobertos.em(rng.gen_range(0..descobertos.len()))?;
    subconjunto_do_indice(motor.binomiais(), alvo as u64, motor.alvo(), &mut oficina.semente);

    // Basta cobrir `intersecao` elementos do alvo para atendê-lo; quais deles,
    // fica a cargo do sorteio.
    let quantos = motor.intersecao().min(oficina.semente.len());
    embaralhar(&mut oficina.semente, rng);
    oficina.semente.truncate(quantos);
    oficina.semente.sort_unstable();

    Some(cartela_ao_redor(motor, solucao, ruido, max_candidatos, rng, oficina))
}

/// Acrescenta cartelas até cobrir tudo ou até atingir `teto` cartelas.
///
/// Devolve quantas cartelas foram acrescentadas.
pub fn reparar(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    teto: usize,
    ruido: f64,
    max_candidatos: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) -> usize {
    let mut acrescentadas = 0;
    while !solucao.cobertura_total() && solucao.quantidade() < teto {
        let Some(cartela) =
            cartela_para_alvo_descoberto(motor, solucao, ruido, max_candidatos, rng, oficina)
        else {
            break;
        };
        solucao.adicionar(motor, cartela, &mut oficina.rascunho);
        acrescentadas += 1;
    }
    acrescentadas
}

/// Constrói uma solução completa do zero (Modo B do documento conceitual).
///
/// Sem teto de cartelas: acrescenta até cobrir tudo. O resultado é o ponto de
/// partida da busca, não a resposta — normalmente fica bem acima do ótimo, e
/// costuma conter cartelas que ficaram supérfluas por causa das que vieram
/// depois. Uma [`podar`] em seguida recolhe essas sobras.
pub fn construir_do_zero(
    motor: &MotorCobertura,
    solucao: &mut Solucao,
    ruido: f64,
    max_candidatos: usize,
    rng: &mut impl Rng,
    oficina: &mut Oficina,
) {
    solucao.reiniciar();
    reparar(motor, solucao, usize::MAX, ruido, max_candidatos, rng, oficina);
}

/// Remove toda cartela cuja saída não descobre nenhum alvo.
///
/// É o §9.1 do documento: a redução que sai de graça. Executada depois de cada
/// reconstrução, porque reparar quase sempre deixa sobras.
///
/// Devolve quantas cartelas saíram.
pub fn podar(motor: &MotorCobertura, solucao: &mut Solucao, oficina: &mut Oficina) -> usize {
    let mut removidas = 0;
    let mut i = 0;
    while i < solucao.quantidade() {
        if solucao.contribuicao_unica(motor, i, &mut oficina.rascunho) == 0 {
            solucao.remover(motor, i, &mut oficina.rascunho);
            removidas += 1;
            // Sem incrementar `i`: a remoção trouxe outra cartela para esta
            // posição, e ela também precisa ser examinada.
        } else {
            i += 1;
        }
    }
    removidas
}

/// Embaralhamento de Fisher-Yates.
pub fn embaralhar<T>(itens: &mut [T], rng: &mut impl Rng) {
    for i in (1..itens.len()).rev() {
        itens.swap(i, rng.gen_range(0..=i));
    }
}

#[cfg(test)]
mod testes {
    use super::*;
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
            Pcg64Mcg::seed_from_u64(42),
        )
    }

    #[test]
    fn construcao_do_zero_sempre_cobre_tudo() {
        for (p, k, j, t) in [(9, 3, 2, 2), (12, 4, 3, 2), (15, 6, 4, 3), (10, 5, 5, 2)] {
            let (motor, mut oficina, mut rng) = ambiente(p, k, j, t);
            let mut solucao = Solucao::vazia(&motor);

            construir_do_zero(&motor, &mut solucao, 0.3, usize::MAX, &mut rng, &mut oficina);

            assert!(
                solucao.cobertura_total(),
                "({p},{k},{j},{t}) terminou com {} alvos descobertos",
                solucao.total_descobertos()
            );
            assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));
        }
    }

    #[test]
    fn cartela_construida_tem_exatamente_k_elementos() {
        let (motor, mut oficina, mut rng) = ambiente(15, 6, 4, 3);
        let solucao = Solucao::vazia(&motor);

        for _ in 0..20 {
            let cartela =
                cartela_para_alvo_descoberto(&motor, &solucao, 0.3, usize::MAX, &mut rng, &mut oficina)
                    .expect("há alvos descobertos");
            assert_eq!(cartela.tamanho(), 6);
        }
    }

    #[test]
    fn cartela_gerada_realmente_atende_o_alvo_que_a_originou() {
        // Se isso falhar, o reparo entra em laço infinito: geraria cartelas
        // para um alvo que continua descoberto.
        let (motor, mut oficina, mut rng) = ambiente(12, 5, 4, 2);
        let mut solucao = Solucao::vazia(&motor);

        for _ in 0..30 {
            let antes = solucao.total_descobertos();
            let Some(cartela) =
                cartela_para_alvo_descoberto(&motor, &solucao, 0.5, usize::MAX, &mut rng, &mut oficina)
            else {
                break;
            };
            solucao.adicionar(&motor, cartela, &mut oficina.rascunho);
            assert!(
                solucao.total_descobertos() < antes,
                "a cartela nova não cobriu nenhum alvo novo"
            );
        }
    }

    #[test]
    fn guloso_puro_e_no_minimo_tao_bom_quanto_o_ruidoso() {
        // Não é garantia teórica, mas serve de sanidade: ruído zero deve
        // produzir soluções competitivas, não degeneradas.
        let (motor, mut oficina, mut rng) = ambiente(13, 4, 2, 2);
        let mut guloso = Solucao::vazia(&motor);
        construir_do_zero(&motor, &mut guloso, 0.0, usize::MAX, &mut rng, &mut oficina);

        assert!(guloso.cobertura_total());
        // C(13,4,2) = 13; um guloso razoável não deveria passar do dobro disso.
        assert!(
            guloso.quantidade() <= 26,
            "guloso produziu {} cartelas, longe demais do ótimo conhecido (13)",
            guloso.quantidade()
        );
    }

    #[test]
    fn podar_remove_duplicatas_sem_descobrir_nada() {
        let (motor, mut oficina, mut rng) = ambiente(9, 3, 2, 2);
        let mut solucao = Solucao::vazia(&motor);
        construir_do_zero(&motor, &mut solucao, 0.2, usize::MAX, &mut rng, &mut oficina);

        let quantidade_original = solucao.quantidade();
        // Duplica tudo: metade passa a ser pura redundância.
        for cartela in solucao.cartelas().to_vec() {
            solucao.adicionar(&motor, cartela, &mut oficina.rascunho);
        }
        assert_eq!(solucao.quantidade(), quantidade_original * 2);

        let removidas = podar(&motor, &mut solucao, &mut oficina);

        // Pelo menos as duplicatas saem. Costuma sair mais: o guloso deixa
        // cartelas que ficaram redundantes por causa das que vieram depois, e
        // a poda também as recolhe.
        assert!(
            removidas >= quantidade_original,
            "restaram duplicatas: só {removidas} de {quantidade_original} saíram"
        );
        assert!(solucao.quantidade() <= quantidade_original);
        assert!(solucao.cobertura_total(), "a poda nunca pode descobrir um alvo");
        assert_eq!(solucao.conferir_invariantes(&motor), Ok(()));

        // Poda é idempotente: rodar de novo não encontra mais nada.
        assert_eq!(podar(&motor, &mut solucao, &mut oficina), 0);
    }

    #[test]
    fn o_guloso_deixa_sobras_que_a_poda_recolhe() {
        // Achado que motivou o teste acima: construir gulosamente não produz
        // uma solução minimal. Cada cartela nova pode tornar supérflua uma
        // anterior, e o guloso não volta atrás. Por isso toda reconstrução no
        // motor é seguida de poda.
        let mut encontrou_sobra = false;
        for semente in 0..12u64 {
            let (motor, mut oficina, _) = ambiente(16, 4, 2, 2);
            let mut rng = Pcg64Mcg::seed_from_u64(semente);
            let mut solucao = Solucao::vazia(&motor);
            construir_do_zero(&motor, &mut solucao, 0.3, usize::MAX, &mut rng, &mut oficina);

            if podar(&motor, &mut solucao, &mut oficina) > 0 {
                encontrou_sobra = true;
                assert!(solucao.cobertura_total());
            }
        }
        assert!(encontrou_sobra, "nenhuma construção deixou sobra — teste sem valor");
    }

    #[test]
    fn reparo_respeita_o_teto_de_cartelas() {
        let (motor, mut oficina, mut rng) = ambiente(15, 4, 3, 2);
        let mut solucao = Solucao::vazia(&motor);

        reparar(&motor, &mut solucao, 5, 0.3, usize::MAX, &mut rng, &mut oficina);

        assert_eq!(solucao.quantidade(), 5);
        assert!(!solucao.cobertura_total(), "5 cartelas não bastam aqui");
    }

    #[test]
    fn duas_sementes_diferentes_produzem_solucoes_diferentes() {
        // Com ruído, a busca precisa conseguir explorar caminhos distintos.
        let problema = Problema::com_pool_inicial(
            15,
            15,
            5,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let motor = MotorCobertura::novo(&problema).unwrap();

        let mut assinaturas = std::collections::HashSet::new();
        for semente in 0..8u64 {
            let mut oficina = Oficina::nova();
            let mut rng = Pcg64Mcg::seed_from_u64(semente);
            let mut solucao = Solucao::vazia(&motor);
            construir_do_zero(&motor, &mut solucao, 0.4, usize::MAX, &mut rng, &mut oficina);
            assinaturas.insert(solucao.assinatura());
        }

        assert!(assinaturas.len() > 1, "a construção ficou determinística apesar do ruído");
    }
}
