//! O veredito: o encontro entre o que se construiu e o que se provou.
//!
//! Os três números do relatório não têm o mesmo peso, e o aplicativo inteiro
//! depende de não confundi-los:
//!
//! - **encontrado** — existe esta solução, e o verificador conferiu alvo por
//!   alvo que ela cumpre a garantia. É um fato.
//! - **piso** — nada menor que isto existe. Também é um fato, e de tipo mais
//!   forte: vale para todas as coleções que ninguém escreveu ainda.
//! - **mínimo** — só quando os dois se encontram. Enquanto houver distância
//!   entre eles, o honesto é mostrar a distância.
//!
//! Um aplicativo que diz "mínimo: 32" quando encontrou 32 e provou 30 está
//! afirmando o que não sabe. Este diz `encontrado 32 · provado ≥ 30`, e a
//! folga de 2 fica na tela.

use serde::{Deserialize, Serialize};

use crate::construtor::{self, Construcao};
use crate::limites::{self, Limite, LimiteInferior};
use crate::problema::{Bloco, Problema};
use crate::prova::{self, Desfecho};

/// Quantos nós cada busca pode visitar antes de admitir que não sabe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Esforco {
    pub nos_ciclicos: u64,
    pub nos_livres: u64,
}

impl Default for Esforco {
    fn default() -> Esforco {
        Esforco { nos_ciclicos: 5_000_000, nos_livres: prova::ORCAMENTO_PADRAO }
    }
}

impl Esforco {
    /// O bastante para os casos pequenos, e curto para não travar uma tela.
    pub fn rapido() -> Esforco {
        Esforco { nos_ciclicos: 200_000, nos_livres: 500_000 }
    }

    /// O orçamento com que o subproblema é atacado.
    ///
    /// O mesmo orçamento, inteiro.
    ///
    /// Cortá-lo pela metade parecia prudente e era o contrário: o subproblema
    /// tem um universo a menos e um alvo a menos, e por isso é ordens de
    /// grandeza mais barato — o orçamento que sobra no problema de fora é
    /// justamente o que fecha a exaustão no de dentro. Em `C(11,5,3)`, cortar
    /// pela metade era a diferença entre provar 18 e provar 20.
    pub fn para_o_interno(self) -> Esforco {
        self
    }
}

/// O que se pode afirmar ao fim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Veredito {
    /// Construção e prova se encontraram: este é o mínimo, e há prova.
    Minimo,
    /// Nenhuma solução com a simetria cíclica é menor que esta. Fora da
    /// simetria, não se sabe — e a frase diz isso.
    MinimoCiclico,
    /// Encontrou-se uma solução e provou-se um piso, e sobrou distância.
    Intervalo,
    /// A construção não cobre. É defeito, e o relatório mostra em vez de calar.
    Falha,
}

impl std::fmt::Display for Veredito {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Veredito::Minimo => write!(f, "mínimo provado"),
            Veredito::MinimoCiclico => {
                write!(f, "mínimo dentro da simetria cíclica; fora dela, não provado")
            }
            Veredito::Intervalo => write!(f, "melhor solução encontrada, mínimo ainda em aberto"),
            Veredito::Falha => write!(f, "a construção não cumpre a garantia"),
        }
    }
}

/// Tudo o que a tela precisa mostrar, e nada que ela precise supor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relatorio {
    pub problema: Problema,
    /// Quantos subconjuntos de `t` elementos existem para cobrir.
    pub alvos: usize,
    /// Quantos blocos de `k` elementos existem ao todo.
    pub blocos_possiveis: u128,
    /// O tamanho da melhor solução que se tem em mãos.
    pub encontrado: usize,
    /// Como ela nasceu.
    pub metodo: &'static str,
    /// As cartelas, como máscaras.
    pub cartelas: Vec<Bloco>,
    /// O verificador passou alvo por alvo e não achou buraco.
    pub verificado: bool,
    /// Quantos alvos ficaram descobertos — zero quando `verificado`.
    pub descobertos: usize,
    /// Nada menor que isto existe.
    pub piso: u64,
    /// De onde esse piso veio.
    pub origem_do_piso: Limite,
    pub veredito: Veredito,
    /// Quantos nós a busca livre visitou.
    pub nos_livres: u64,
    /// Quantos nós a busca cíclica visitou.
    pub nos_ciclicos: u64,
    /// A busca cíclica varreu o espaço inteiro dela.
    pub ciclica_fechou: bool,
    /// A busca livre varreu o espaço inteiro.
    pub livre_fechou: bool,
}

impl Relatorio {
    /// A distância que sobra entre o que se tem e o que se provou.
    pub fn folga(&self) -> u64 {
        (self.encontrado as u64).saturating_sub(self.piso)
    }

    /// A frase que a tela mostra, com os dois números separados.
    pub fn frase(&self) -> String {
        match self.veredito {
            Veredito::Falha => {
                format!("A construção deixou {} alvos descobertos.", self.descobertos)
            }
            Veredito::Minimo => format!(
                "Mínimo exato: {} cartelas — provado, nada menor existe.",
                self.encontrado
            ),
            Veredito::MinimoCiclico => format!(
                "Solução encontrada: {} · Mínimo comprovado: ≥ {} · Nenhuma solução cíclica é menor.",
                self.encontrado, self.piso
            ),
            Veredito::Intervalo => format!(
                "Solução encontrada: {} · Mínimo comprovado: ≥ {}",
                self.encontrado, self.piso
            ),
        }
    }
}

/// O caminho inteiro: modelar, limitar, construir, verificar, provar, concluir.
///
/// A ordem não é arbitrária. O limite sai antes de qualquer busca, porque ele
/// não custa nada e já diz onde o fundo está. A busca cíclica vem antes da
/// livre porque é barata e às vezes melhora a construção — e uma construção
/// menor aperta o teto que a busca livre vai ter de varrer.
/// O subproblema `C(v−1, k−1, t−1)`, quando ele existe.
///
/// É o que sobra ao fixar um elemento e olhar só os blocos que passam por ele.
pub fn subproblema(p: &Problema) -> Option<Problema> {
    // A recorrência é a de Schönheim, e Schönheim fala de cobertura simples com
    // sorteio igual à garantia. Fora daí não há recorrência a aplicar — e
    // aplicá-la assim mesmo produziria um piso que ninguém demonstrou.
    if !p.e_covering_design() || p.t < 2 {
        return None;
    }
    let dentro = Problema::cobertura(p.v - 1, p.k - 1, p.t - 1).ok()?;

    // E só vale entrar se a exaustão tiver chance de fechar lá dentro. Alimentar
    // a recorrência com a cota fechada do subproblema devolve exatamente a cota
    // de Schönheim de fora — está provado no teste
    // `a_elevacao_do_interno_reproduz_schonheim_quando_alimentada_com_schonheim`.
    // Ou seja: sem exaustão no subproblema, o caminho custa caro e não rende
    // nada. Num pool de 22 esse "nada" custava minutos de tela parada.
    if !prova::cabe_a_instancia(&dentro) {
        return None;
    }

    // E precisa ser **pequeno**, não só possível. A recorrência desce um nível
    // por vez até `t = 1`, e em `C(19,16,14)` isso são treze níveis, cada um com
    // a sua construção e as suas duas varreduras. O caminho inteiro custava
    // horas para devolver, no fim, exatamente a cota de Schönheim — porque
    // nenhuma daquelas exaustões tinha como fechar.
    //
    // Os casos em que ela de fato rende são miúdos: `C(11,5,3)` melhora porque
    // `C(10,4,2)` tem 45 alvos e fecha em segundos. O teto guarda esses e
    // dispensa o resto.
    if dentro.total_de_alvos() > TETO_DE_ALVOS_DO_SUBPROBLEMA {
        return None;
    }
    Some(dentro)
}

/// Acima disto o subproblema não é atacado: ele não fecharia, e o caminho só
/// custaria tempo para devolver a mesma cota que já se tinha.
pub const TETO_DE_ALVOS_DO_SUBPROBLEMA: usize = 5_000;

pub fn resolver(p: &Problema, esforco: Esforco) -> Relatorio {
    // 1 · Construir, com o teto de trabalho amarrado ao mesmo orçamento.
    //
    // Sem essa amarra a construção usava o teto padrão e podia sozinha custar
    // minutos, num caminho que quem chamou pediu com pressa.
    let mut construtor = construtor::Construtor::com_teto(p, esforco.nos_livres.saturating_mul(4));
    while !construtor.terminou() {
        construtor.avancar(20_000_000);
    }
    let mut construcao: Construcao = construtor.construcao();

    // 2 · O piso, sem busca nenhuma.
    let mut piso: LimiteInferior = limites::sem_busca(p);

    // 2b · O piso pelo subproblema, resolvido aqui.
    //
    //      A recorrência de Schönheim eleva qualquer piso válido de
    //      `C(v−1,k−1,t−1)` até `C(v,k,t)`. Schönheim se eleva a si mesma; mas
    //      se o subproblema for pequeno o bastante para a exaustão fechar, o
    //      que sobe é o **mínimo exato** dele, e a cota de cima fica bem acima
    //      da de Schönheim. É a porta pela qual a força bruta de um caso
    //      pequeno vira matemática de um caso grande — e ela se abre sozinha,
    //      sem tabela nenhuma. Em `C(11,5,3)` é o que separa provar 18 de
    //      provar 20.
    if let Some(dentro) = subproblema(p) {
        let relatorio = resolver(&dentro, esforco.para_o_interno());
        let valor = limites::elevar_do_interno(p.v, p.k, relatorio.piso);
        piso = piso.melhor(LimiteInferior {
            valor,
            origem: Limite::Interno {
                v: dentro.v,
                k: dentro.k,
                t: dentro.t,
                piso: relatorio.piso,
            },
        });
    }

    // 3 · A busca dentro da simetria: barata, e às vezes melhora o que se tem.
    let mut nos_ciclicos = 0;
    let mut ciclica_fechou = false;
    if construcao.tamanho() as u64 > piso.valor {
        let prova = prova::provar_ciclica(p, construcao.tamanho(), esforco.nos_ciclicos);
        nos_ciclicos = prova.visitados;
        ciclica_fechou = prova.desfecho.fechou();
        if let Desfecho::Minimo { tamanho, blocos } = prova.desfecho {
            if tamanho < construcao.tamanho() {
                construcao = Construcao { blocos, metodo: "busca exata sobre órbitas" };
                debug_assert_eq!(construcao.tamanho(), tamanho);
            }
        }
    }

    // 4 · Verificar. É esta varredura, e não a confiança em quem construiu, que
    //     autoriza dizer que a garantia está cumprida.
    let descobertos = p.descobertos(&construcao.blocos);
    let verificado = descobertos == 0;

    // 5 · A prova sem restrição, se ainda houver distância a fechar.
    let mut nos_livres = 0;
    let mut livre_fechou = false;
    if verificado && construcao.tamanho() as u64 > piso.valor {
        let prova = prova::provar_livre(p, construcao.tamanho(), esforco.nos_livres);
        nos_livres = prova.visitados;
        livre_fechou = prova.desfecho.fechou();
        match prova.desfecho {
            Desfecho::Minimo { tamanho, blocos } => {
                construcao = Construcao { blocos, metodo: "busca exata sobre todos os blocos" };
                piso = LimiteInferior { valor: tamanho as u64, origem: Limite::Exaustao };
            }
            Desfecho::NadaAbaixoDe { teto } => {
                piso = LimiteInferior { valor: teto as u64, origem: Limite::Exaustao };
            }
            _ => {}
        }
    }

    // 6 · O veredito, que é só a leitura honesta dos dois números.
    let encontrado = construcao.tamanho();
    let veredito = if !verificado {
        Veredito::Falha
    } else if encontrado as u64 <= piso.valor {
        Veredito::Minimo
    } else if ciclica_fechou {
        Veredito::MinimoCiclico
    } else {
        Veredito::Intervalo
    };

    Relatorio {
        problema: *p,
        alvos: p.total_de_alvos(),
        blocos_possiveis: p.total_de_blocos(),
        encontrado,
        metodo: construcao.metodo,
        cartelas: construcao.blocos,
        verificado,
        descobertos,
        piso: piso.valor,
        origem_do_piso: piso.origem,
        veredito,
        nos_livres,
        nos_ciclicos,
        ciclica_fechou,
        livre_fechou,
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn o_relatorio_nunca_promete_mais_do_que_provou() {
        for &(v, k, t) in &[(7, 3, 2), (9, 3, 2), (8, 4, 3), (10, 4, 2), (12, 4, 2), (13, 5, 2)] {
            let p = Problema::cobertura(v, k, t).unwrap();
            let r = resolver(&p, Esforco::rapido());
            assert!(r.verificado, "C({v},{k},{t}): a construção não cobre");
            assert_eq!(r.cartelas.len(), r.encontrado);
            assert!(
                r.encontrado as u64 >= r.piso,
                "C({v},{k},{t}): encontrado {} abaixo do piso {}",
                r.encontrado,
                r.piso
            );
            if r.veredito == Veredito::Minimo {
                assert_eq!(r.encontrado as u64, r.piso, "C({v},{k},{t}): mínimo com folga");
            }
        }
    }

    #[test]
    fn onde_o_minimo_e_alcancavel_ele_e_provado_e_nao_apenas_encontrado() {
        // C(7,3,2) = 7 é o plano de Fano, e a exaustão fecha em milissegundos.
        let p = Problema::cobertura(7, 3, 2).unwrap();
        let r = resolver(&p, Esforco::default());
        assert_eq!(r.encontrado, 7);
        assert_eq!(r.piso, 7);
        assert_eq!(r.veredito, Veredito::Minimo);
        assert!(p.cobre(&r.cartelas));
    }

    /// A exaustão precisa **subir** o piso onde as cotas fechadas param antes
    /// do mínimo, e o subproblema resolvido aqui precisa subi-lo mais ainda.
    ///
    /// Os dois casos que provam isso — `C(10,4,2)`, onde a contagem diz 8 e a
    /// varredura prova 9, e `C(11,5,3)`, onde Schönheim diz 18 e o `C(10,4,2)`
    /// elevado dá 20 — custam dezenas de milhões de nós. Compilados com
    /// otimização são segundos; sem otimização são minutos, e a integração
    /// contínua roda sem otimização. Por isso o teste se cala no perfil de
    /// depuração em vez de atrasar todo mundo: ele vale em `--release`, que é
    /// como o motor de verdade roda.
    #[test]
    fn a_exaustao_e_o_subproblema_sobem_o_piso_acima_das_cotas_fechadas() {
        if cfg!(debug_assertions) {
            return;
        }

        // A varredura fecha uma unidade que a contagem não alcançava.
        let dez = Problema::cobertura(10, 4, 2).unwrap();
        let antes = limites::sem_busca(&dez);
        assert_eq!(antes.valor, 8, "a cota fechada de C(10,4,2)");
        let r = resolver(&dez, Esforco::default());
        assert_eq!(r.piso, 9, "a exaustão devia provar 9");
        assert_eq!(r.origem_do_piso, Limite::Exaustao);
        assert_eq!(r.veredito, Veredito::Minimo);

        // E esse 9, elevado, vira cota de um problema que a exaustão não
        // alcançaria nunca — sem consultar tabela nenhuma.
        let onze = Problema::cobertura(11, 5, 3).unwrap();
        assert_eq!(limites::sem_busca(&onze).valor, 18, "Schönheim de C(11,5,3)");
        let r = resolver(&onze, Esforco::default());
        assert_eq!(r.piso, 20, "C(10,4,2) = 9 elevado por 11/5 dá 20");
        assert!(
            matches!(r.origem_do_piso, Limite::Interno { v: 10, k: 4, t: 2, piso: 9 }),
            "origem: {}",
            r.origem_do_piso
        );
    }

    #[test]
    fn onde_a_prova_nao_alcanca_a_frase_mostra_os_dois_numeros() {
        // C(13,5,2): o mínimo é 10 e sabe-se disso por trabalho pesado de
        // terceiros. Sozinho, este crate encontra 10 e prova bem menos — e a
        // frase tem de mostrar a distância, não escondê-la.
        let p = Problema::cobertura(13, 5, 2).unwrap();
        let r = resolver(&p, Esforco::rapido());
        assert!(r.verificado);
        assert_ne!(r.veredito, Veredito::Falha);
        if r.veredito != Veredito::Minimo {
            let frase = r.frase();
            assert!(frase.contains("Solução encontrada"), "frase: {frase}");
            assert!(frase.contains("≥"), "frase: {frase}");
            assert!(r.folga() > 0);
        }
    }

    #[test]
    fn um_problema_trivial_e_resolvido_sem_drama() {
        // t = k: cada alvo é uma cartela, e o mínimo é o número de alvos.
        let p = Problema::cobertura(8, 3, 3).unwrap();
        let r = resolver(&p, Esforco::rapido());
        assert_eq!(r.encontrado, r.alvos);
        assert_eq!(r.veredito, Veredito::Minimo);
    }
}
