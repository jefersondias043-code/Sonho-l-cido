/*!
Bancada de qualidade da construção: casos pequenos com resposta conhecida.

## Por que esta bancada existe

Medir a qualidade da construção rodando as configurações grandes é caro e lento:
20 dezenas com jogos de 17 leva minutos, 21 leva muito mais, e o que se aprende
no fim é um número só. Pior: o custo desestimula medir, e sem medida a única
forma de saber se uma mudança melhorou é a impressão de quem olhou.

A saída é a que qualquer engenharia usa quando o ensaio em escala real é
proibitivo: **ensaiar em escala pequena, contra um padrão conhecido, e projetar**.

A família abaixo tem três propriedades que a tornam um padrão utilizável:

1. **A resposta é conhecida.** São os melhores fechamentos publicados para cada
   configuração — o mesmo conjunto que a Lotinha distribui. Não são mínimos
   provados em todos os casos, mas são o melhor que se conhece, e é contra eles
   que qualquer construção nova precisa se comparar.

2. **São rápidos.** Todos fecham com poucas dezenas de cartelas, e a bancada
   inteira roda em segundos. Medir deixa de ter custo, e o que não custa se mede
   a cada mudança.

3. **Varrem o eixo que importa.** O pool vai de 18 a 21 e a folga entre cartela e
   sorteio de 2 a 6 — que é a variável de que a dificuldade depende. Uma razão
   estável ao longo dessa varredura é o que autoriza projetar para 22, 23, 25.

## O que a bancada mede

Para cada caso, a razão entre o que a construção entrega e o melhor conhecido. A
razão média é a projeção: se a construção entrega 1,2× o melhor conhecido nos
casos pequenos, é isso que se espera dela nos grandes — e é assim que se compara
duas construções sem rodar nenhuma das duas em escala real.
*/

use motor_exato::escalada::Escalada;
use motor_exato::{limites, Problema};

/// `(pool, jogo, melhor conhecido)`, sorteio 15 e garantia cheia.
///
/// Os valores vêm do banco que a Lotinha distribui, conferido sorteio a sorteio
/// por uma terceira implementação antes de entrar no aplicativo.
const REFERENCIA: &[(usize, usize, usize)] = &[
    // Folga de 1 e de 2 entre pool e jogo: o regime fácil.
    (18, 17, 16),
    (19, 17, 51),
    (19, 18, 16),
    (20, 18, 40),
    (20, 19, 16),
    (21, 19, 34),
    (21, 20, 16),
    (22, 20, 30),
    // Folga de 3: o regime duro, e o que a bancada existe para vigiar. É aqui
    // que o piso deixa de ser alcançável — em 20 dezenas com jogos de 17 ele
    // vale 160 e o melhor conhecido tem 240 — e é aqui que uma construção
    // gulosa começa a desperdiçar.
    (20, 17, 240),
    (21, 18, 182),
    (22, 19, 126),
    (23, 20, 100),
];

/// Roda a construção e depois a otimização, e devolve os dois tamanhos.
///
/// Medir só a construção responde meia pergunta: o que o usuário recebe é o que
/// sai das duas etapas juntas. O orçamento da otimização é o mesmo para todos os
/// casos, para que a comparação entre eles seja de qualidade e não de paciência.
fn construir_e_otimizar(v: usize, k: usize, orcamento: u64) -> (usize, usize) {
    let p = Problema::novo(v, k, 15, 15, 1).unwrap();
    let piso = limites::sem_busca(&p).valor as usize;
    let mut escalada = Escalada::nova(&p, piso);
    escalada.liberar_o_teto();

    let mut passo = escalada.avancar(50_000_000);
    while !passo.fechou && passo.trabalho < 20_000_000_000 {
        passo = escalada.avancar(50_000_000);
    }
    assert!(passo.fechou, "({v},{k}) não fechou dentro do orçamento");
    let construido = escalada.melhor_completo().len();

    escalada.otimizar();
    let ate = passo.trabalho.saturating_add(orcamento);
    while escalada.passo().trabalho < ate {
        escalada.avancar(50_000_000);
    }

    (construido, escalada.melhor_completo().len())
}

/// Roda a construção do zero, sem teto, e devolve o tamanho do fechamento.
#[allow(dead_code)]
fn construir(v: usize, k: usize) -> usize {
    let p = Problema::novo(v, k, 15, 15, 1).unwrap();
    let piso = limites::sem_busca(&p).valor as usize;
    let mut escalada = Escalada::nova(&p, piso);

    // Sem teto desde o começo: o que se mede aqui é a construção, e não a
    // escalada presa ao piso.
    escalada.liberar_o_teto();

    let mut passo = escalada.avancar(50_000_000);
    while !passo.fechou && passo.trabalho < 20_000_000_000 {
        passo = escalada.avancar(50_000_000);
    }
    assert!(passo.fechou, "({v},{k}) não fechou dentro do orçamento");
    escalada.melhor_completo().len()
}

/// Roda em `--release`, e por isso fora do `cargo test` de todo dia.
///
/// Em modo de depuração a mesma bancada leva minutos em vez de meia dúzia de
/// segundos, e uma bancada que atrasa quem está trabalhando deixa de ser
/// rodada. O fluxo de publicação a chama com `--release`, que é onde ela custa
/// pouco e vale como guarda.
///
///     cargo test --release -p motor-exato --test qualidade -- --ignored --nocapture
///
/// `DUROS=1` corre só o regime duro, para iterar em segundos. `CASO=20,17`
/// isola uma configuração. `ORCAMENTO=…` dá mais fôlego à otimização.
#[test]
#[ignore]
fn a_construcao_fica_perto_do_melhor_conhecido() {
    let orcamento: u64 = std::env::var("ORCAMENTO")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20_000_000);

    // `DUROS=1` corre só a folga de 3, que é onde a construção sofre. Serve
    // para iterar no algoritmo em segundos em vez de minutos; a bancada
    // completa continua sendo a que vale.
    let so_os_duros = std::env::var("DUROS").is_ok();
    // `CASO=20,17` corre um caso só, para estudar uma configuração de perto.
    let um_so = std::env::var("CASO").ok();
    let casos: Vec<_> = REFERENCIA
        .iter()
        .filter(|(v, k, _)| match &um_so {
            Some(pedido) => *pedido == format!("{v},{k}"),
            None => !so_os_duros || v - k >= 3,
        })
        .collect();
    assert!(!casos.is_empty(), "nenhum caso escolhido");

    let mut razoes = Vec::new();
    println!();
    for &&(v, k, conhecido) in &casos {
        let (construido, apertado) = construir_e_otimizar(v, k, orcamento);
        let razao = apertado as f64 / conhecido as f64;
        razoes.push(razao);
        println!(
            "  pool {v} · jogos de {k}: construiu {construido} · apertou para {apertado} \
             · conhecido {conhecido} · {razao:.2}×"
        );
    }

    let media = razoes.iter().sum::<f64>() / razoes.len() as f64;
    let pior = razoes.iter().cloned().fold(0.0_f64, f64::max);
    println!("\n  razão média {media:.2}× · pior caso {pior:.2}×\n");

    // Os limites não são decoração: são o que impede uma mudança de piorar o
    // motor sem ninguém perceber. Eles descem quando o motor melhora, e descer
    // é o trabalho.
    //
    // Onde estão hoje, com o orçamento padrão: média 1,17× e pior caso 1,67×. A
    // folga é pequena de propósito — grande, o limite deixa de cobrar nada.
    assert!(
        media <= 1.30,
        "o motor piorou: razão média {media:.2}×, e o limite é 1,30×"
    );
    assert!(
        pior <= 1.80,
        "o motor piorou no caso mais duro: {pior:.2}×, e o limite é 1,80×"
    );
}
