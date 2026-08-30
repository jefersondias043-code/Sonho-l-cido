//! A ponte do Construtor Matemático Exato para o navegador.
//!
//! Duas coisas moram aqui, e a diferença entre elas é a diferença entre uma
//! tela viva e uma tela morta.
//!
//! **O que é instantâneo** — analisar o problema, calcular o piso pelas cotas
//! fechadas, conferir uma coleção — sai por função solta, numa chamada só.
//!
//! **O que demora** — construir e provar — sai por objeto com estado, que anda
//! por orçamento:
//!
//! ```text
//!   const c = new ConstrutorExato(pedido, teto);
//!   while (!pronto) { const passo = JSON.parse(c.avancar(fatia)); mostrar(passo); }
//! ```
//!
//! A primeira versão deste módulo fazia tudo por função solta, e a construção
//! de um problema de tamanho real simplesmente não voltava: a tela ficava
//! parada, sem progresso e sem botão de parar, indistinguível de um
//! travamento. Andar por orçamento é o conserto — e é por isso que estes dois
//! são objetos e não funções.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use motor_exato::construtor::{self, Construtor};
use motor_exato::limites;
use motor_exato::problema::{Bloco, Problema};
use motor_exato::prova::{self, BuscaExata, Desfecho, Instancia};
use motor_exato::veredito::{self, Esforco};

/// Os cinco números que descrevem o problema.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Pedido {
    /// Quantos números existem no pool.
    pub v: usize,
    /// Quantos números em cada cartela.
    pub k: usize,
    /// Quantos números são sorteados.
    pub j: usize,
    /// Quantos deles uma cartela premiada precisa conter.
    pub t: usize,
    /// Quantas cartelas precisam estar premiadas.
    #[serde(default = "uma")]
    pub r: usize,
}

fn uma() -> usize {
    1
}

impl Pedido {
    fn problema(&self) -> Result<Problema, String> {
        Problema::novo(self.v, self.k, self.j, self.t, self.r).map_err(|e| e.to_string())
    }
}

/// Uma cartela como a pessoa a lê: posições de 1 a `v`, em ordem.
///
/// Quais dezenas essas posições representam é assunto da tela: ela sabe quais
/// números a pessoa marcou na grade, e o motor não precisa saber.
fn cartelas(blocos: &[Bloco], v: usize) -> Vec<Vec<u32>> {
    let mut saida: Vec<Vec<u32>> = blocos
        .iter()
        .map(|&b| (0..v).filter(|i| b >> i & 1 == 1).map(|i| i as u32 + 1).collect())
        .collect();
    saida.sort();
    saida
}

#[derive(Serialize)]
struct Analise {
    v: usize,
    k: usize,
    j: usize,
    t: usize,
    r: usize,
    alvos: String,
    blocos: String,
    alvos_por_bloco: String,
    blocos_por_alvo: String,
    covering_design: bool,
}

#[derive(Serialize)]
struct Piso {
    valor: u64,
    origem: String,
    /// Verdadeiro quando as cotas fortes valem para este problema.
    fechado: bool,
}

#[derive(Serialize)]
struct Verificacao {
    cobre: bool,
    descobertos: usize,
    alvos: usize,
    premiadas: usize,
}

#[derive(Serialize)]
struct PassoDaConstrucao {
    partidas: usize,
    partidas_previstas: usize,
    melhor: usize,
    trabalho: u64,
    terminou: bool,
}

#[derive(Serialize)]
struct PassoDaProva {
    visitados: u64,
    recorde: usize,
    profundidade: usize,
    terminou: bool,
    /// Só quando terminou: o que ficou provado.
    desfecho: Option<String>,
    tamanho: Option<usize>,
}

#[derive(Serialize)]
struct SaidaDaProva {
    desfecho: String,
    fechou: bool,
    tamanho: Option<usize>,
    cartelas: Option<Vec<Vec<u32>>>,
    visitados: u64,
    candidatos: usize,
    alvos: usize,
}

fn json<T: Serialize>(valor: &T) -> Result<String, String> {
    serde_json::to_string(valor).map_err(|e| e.to_string())
}

fn ler(pedido_json: &str) -> Result<Pedido, String> {
    serde_json::from_str(pedido_json).map_err(|e| e.to_string())
}

/* ─────────── o que é instantâneo ─────────── */

/// **O modelo.** Quantos alvos existem, quantas cartelas, quanto cada uma
/// atende, e quantas conseguem atender um mesmo sorteio.
///
/// Sai antes de qualquer busca porque é só contagem — e o último desses números
/// é o que diz se a construção vai ser barata ou cara.
pub fn analisar_com(pedido_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    json(&Analise {
        v: p.v,
        k: p.k,
        j: p.j,
        t: p.t,
        r: p.r,
        alvos: p.total_de_alvos().to_string(),
        blocos: p.total_de_blocos().to_string(),
        alvos_por_bloco: p.alvos_por_bloco().to_string(),
        blocos_por_alvo: p.blocos_por_alvo().to_string(),
        covering_design: p.e_covering_design(),
    })
}

/// **O piso, sem procurar nada.** Contagem sempre; Schönheim quando ela vale.
pub fn limitar_com(pedido_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let piso = limites::sem_busca(&p);
    json(&Piso {
        valor: piso.valor,
        origem: piso.origem.to_string(),
        fechado: p.e_covering_design(),
    })
}

/// **O piso pelo subproblema**, resolvido aqui dentro e elevado.
///
/// Só existe no covering design puro — a recorrência que o eleva é a de
/// Schönheim, e ela não vale fora dali. Nos outros casos devolve o mesmo piso
/// de [`limitar_com`], sem fingir que aprofundou.
pub fn limitar_por_dentro_com(pedido_json: &str, orcamento: u32) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let mut piso = limites::sem_busca(&p);
    if let Some(dentro) = veredito::subproblema(&p) {
        let nos = (orcamento as u64).max(10_000);
        let relatorio = veredito::resolver(&dentro, Esforco { nos_ciclicos: nos, nos_livres: nos });
        let valor = limites::elevar_do_interno(p.v, p.k, relatorio.piso);
        piso = piso.melhor(limites::LimiteInferior {
            valor,
            origem: limites::Limite::Interno {
                v: dentro.v,
                k: dentro.k,
                t: dentro.t,
                piso: relatorio.piso,
            },
        });
    }
    json(&Piso {
        valor: piso.valor,
        origem: piso.origem.to_string(),
        fechado: p.e_covering_design(),
    })
}

/// **O verificador.**
///
/// Recebe as cartelas de volta da tela e as confere contra todos os alvos. Que
/// a conferência aconteça sobre o que a tela tem na mão, e não sobre o que o
/// construtor jurou ter feito, é o ponto: é assim que um erro de transporte
/// aparece em vez de passar.
pub fn verificar_com(pedido_json: &str, cartelas_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let lista: Vec<Vec<u32>> = serde_json::from_str(cartelas_json).map_err(|e| e.to_string())?;
    let mut blocos = Vec::with_capacity(lista.len());
    for cartela in &lista {
        let mut m: Bloco = 0;
        for &n in cartela {
            if n == 0 || n as usize > p.v {
                return Err(format!("a cartela tem a posição {n}, fora do pool de {}", p.v));
            }
            m |= 1 << (n - 1);
        }
        if m.count_ones() as usize != p.k {
            return Err(format!(
                "uma cartela tem {} números distintos, e a garantia é sobre cartelas de {}",
                m.count_ones(),
                p.k
            ));
        }
        blocos.push(m);
    }
    let descobertos = p.descobertos(&blocos);
    json(&Verificacao {
        cobre: descobertos == 0,
        descobertos,
        alvos: p.total_de_alvos(),
        premiadas: p.r,
    })
}

/* ─────────── o que demora ─────────── */

/// A construção, com estado, andando por orçamento.
#[wasm_bindgen]
pub struct ConstrutorExato {
    interno: Construtor,
    v: usize,
}

#[wasm_bindgen]
impl ConstrutorExato {
    #[wasm_bindgen(constructor)]
    pub fn novo(pedido_json: &str, teto_de_trabalho: f64) -> Result<ConstrutorExato, JsValue> {
        let pedido = ler(pedido_json).map_err(|e| JsValue::from_str(&e))?;
        let p = pedido.problema().map_err(|e| JsValue::from_str(&e))?;
        let teto = if teto_de_trabalho > 0.0 {
            teto_de_trabalho as u64
        } else {
            construtor::TRABALHO_DE_UMA_CONSTRUCAO
        };
        Ok(ConstrutorExato { interno: Construtor::com_teto(&p, teto), v: p.v })
    }

    /// Trabalha uma fatia e devolve onde parou.
    pub fn avancar(&mut self, fatia: f64) -> Result<String, JsValue> {
        let a = self.interno.avancar(fatia.max(1.0) as u64);
        json(&PassoDaConstrucao {
            partidas: a.partidas,
            partidas_previstas: a.partidas_previstas,
            melhor: a.melhor,
            trabalho: a.trabalho,
            terminou: a.terminou,
        })
        .map_err(|e| JsValue::from_str(&e))
    }

    /// As cartelas da melhor construção até agora.
    pub fn melhor(&self) -> Result<String, JsValue> {
        json(&cartelas(self.interno.melhor(), self.v)).map_err(|e| JsValue::from_str(&e))
    }

    /// De que método veio a melhor construção até agora.
    pub fn metodo(&self) -> String {
        self.interno.construcao().metodo.to_string()
    }
}

/// A varredura exata, com estado, andando por orçamento de nós.
#[wasm_bindgen]
pub struct ProvaExata {
    interno: BuscaExata,
    v: usize,
    candidatos: usize,
    alvos: usize,
    montou: bool,
}

#[wasm_bindgen]
impl ProvaExata {
    /// `familia` escolhe o espaço varrido: `"livre"` são todas as coleções, e o
    /// que ela prova vale sem ressalva; `"ciclica"` são só as invariantes por
    /// rotação, e o que ela prova vale dentro da simetria.
    #[wasm_bindgen(constructor)]
    pub fn nova(pedido_json: &str, teto: u32, familia: &str) -> Result<ProvaExata, JsValue> {
        let pedido = ler(pedido_json).map_err(|e| JsValue::from_str(&e))?;
        let p = pedido.problema().map_err(|e| JsValue::from_str(&e))?;
        let instancia =
            if familia == "ciclica" { Instancia::ciclica(&p) } else { Instancia::livre(&p) };
        match instancia {
            Some(inst) => {
                let candidatos = inst.cobre.len();
                let alvos = inst.alvos;
                Ok(ProvaExata {
                    interno: BuscaExata::nova(inst, teto as usize),
                    v: p.v,
                    candidatos,
                    alvos,
                    montou: true,
                })
            }
            None => {
                // Grande demais para montar. Devolver um objeto que já nasce
                // terminado é mais honesto do que um erro: a tela precisa dizer
                // "não coube", e não "deu ruim".
                let vazia = Instancia::livre(&Problema::cobertura(2, 1, 1).unwrap()).unwrap();
                Ok(ProvaExata {
                    interno: BuscaExata::nova(vazia, 0),
                    v: p.v,
                    candidatos: p.total_de_blocos().min(usize::MAX as u128) as usize,
                    alvos: p.total_de_alvos(),
                    montou: false,
                })
            }
        }
    }

    /// Verdadeiro quando a instância coube na memória e a varredura faz sentido.
    pub fn montou(&self) -> bool {
        self.montou
    }

    pub fn candidatos(&self) -> usize {
        self.candidatos
    }

    pub fn alvos(&self) -> usize {
        self.alvos
    }

    /// Visita uma fatia de nós e devolve onde parou.
    pub fn avancar(&mut self, nos: f64) -> Result<String, JsValue> {
        if !self.montou {
            return json(&PassoDaProva {
                visitados: 0,
                recorde: 0,
                profundidade: 0,
                terminou: true,
                desfecho: Some("grande-demais".to_string()),
                tamanho: None,
            })
            .map_err(|e| JsValue::from_str(&e));
        }
        let a = self.interno.avancar(nos.max(1.0) as u64);
        let (desfecho, tamanho) = if a.terminou {
            match self.interno.desfecho() {
                Desfecho::Minimo { tamanho, .. } => (Some("minimo".to_string()), Some(tamanho)),
                Desfecho::NadaAbaixoDe { teto } => (Some("nada-abaixo".to_string()), Some(teto)),
                Desfecho::Excedido => (Some("excedido".to_string()), None),
                Desfecho::GrandeDemais { .. } => (Some("grande-demais".to_string()), None),
            }
        } else {
            (None, None)
        };
        json(&PassoDaProva {
            visitados: a.visitados,
            recorde: a.recorde,
            profundidade: a.profundidade,
            terminou: a.terminou,
            desfecho,
            tamanho,
        })
        .map_err(|e| JsValue::from_str(&e))
    }

    /// O desfecho completo, com as cartelas quando houve.
    pub fn desfecho(&self) -> Result<String, JsValue> {
        if !self.montou {
            return json(&SaidaDaProva {
                desfecho: "grande-demais".to_string(),
                fechou: false,
                tamanho: None,
                cartelas: None,
                visitados: 0,
                candidatos: self.candidatos,
                alvos: self.alvos,
            })
            .map_err(|e| JsValue::from_str(&e));
        }
        let d = self.interno.desfecho();
        let (nome, tamanho, achadas) = match &d {
            Desfecho::Minimo { tamanho, blocos } => {
                ("minimo", Some(*tamanho), Some(cartelas(blocos, self.v)))
            }
            Desfecho::NadaAbaixoDe { teto } => ("nada-abaixo", Some(*teto), None),
            Desfecho::Excedido => ("excedido", None, None),
            Desfecho::GrandeDemais { .. } => ("grande-demais", None, None),
        };
        json(&SaidaDaProva {
            desfecho: nome.to_string(),
            fechou: d.fechou(),
            tamanho,
            cartelas: achadas,
            visitados: self.interno.visitados(),
            candidatos: self.candidatos,
            alvos: self.alvos,
        })
        .map_err(|e| JsValue::from_str(&e))
    }
}

/// A camada de adaptação para o JavaScript.
///
/// Cada função aqui é uma linha: chama a lógica acima e traduz o erro. Se
/// alguma regra aparecer neste bloco, ela deixou de ser testável.
#[wasm_bindgen]
pub fn analisar(pedido_json: &str) -> Result<String, JsValue> {
    analisar_com(pedido_json).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn limitar(pedido_json: &str) -> Result<String, JsValue> {
    limitar_com(pedido_json).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn limitar_por_dentro(pedido_json: &str, orcamento: u32) -> Result<String, JsValue> {
    limitar_por_dentro_com(pedido_json, orcamento).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn verificar(pedido_json: &str, cartelas_json: &str) -> Result<String, JsValue> {
    verificar_com(pedido_json, cartelas_json).map_err(|e| JsValue::from_str(&e))
}

/// A varredura numa chamada só, para quem quer o resultado e não o espetáculo.
/// É o que a linha de comando e os testes usam.
pub fn provar_com(
    pedido_json: &str,
    teto: u32,
    orcamento: u32,
    familia: &str,
) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let nos = (orcamento as u64).max(1_000);
    let resultado = match familia {
        "ciclica" => prova::provar_ciclica(&p, teto as usize, nos),
        _ => prova::provar_livre(&p, teto as usize, nos),
    };
    let (desfecho, tamanho, achadas) = match &resultado.desfecho {
        Desfecho::Minimo { tamanho, blocos } => {
            ("minimo", Some(*tamanho), Some(cartelas(blocos, p.v)))
        }
        Desfecho::NadaAbaixoDe { teto } => ("nada-abaixo", Some(*teto), None),
        Desfecho::Excedido => ("excedido", None, None),
        Desfecho::GrandeDemais { .. } => ("grande-demais", None, None),
    };
    json(&SaidaDaProva {
        desfecho: desfecho.to_string(),
        fechou: resultado.desfecho.fechou(),
        tamanho,
        cartelas: achadas,
        visitados: resultado.visitados,
        candidatos: resultado.candidatos,
        alvos: resultado.alvos,
    })
}

#[wasm_bindgen]
pub fn provar(
    pedido_json: &str,
    teto: u32,
    orcamento: u32,
    familia: &str,
) -> Result<String, JsValue> {
    provar_com(pedido_json, teto, orcamento, familia).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn a_analise_conta_o_universo_antes_de_qualquer_busca() {
        let saida = analisar_com(r#"{"v":13,"k":5,"j":2,"t":2,"r":1}"#).unwrap();
        assert!(saida.contains("\"alvos\":\"78\""), "{saida}");
        assert!(saida.contains("\"blocos\":\"1287\""), "{saida}");
        assert!(saida.contains("\"alvos_por_bloco\":\"10\""), "{saida}");
        assert!(saida.contains("\"covering_design\":true"), "{saida}");
    }

    /// Os cinco parâmetros de verdade: sorteio separado da garantia, e mais de
    /// uma cartela premiada. É o que o modelo antigo não sabia receber.
    #[test]
    fn a_analise_aceita_sorteio_e_premiadas() {
        let saida = analisar_com(r#"{"v":20,"k":17,"j":15,"t":15,"r":2}"#).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&saida).unwrap();
        assert_eq!(valor["alvos"], "15504");
        assert_eq!(valor["blocos"], "1140");
        assert_eq!(valor["alvos_por_bloco"], "136");
        assert_eq!(valor["blocos_por_alvo"], "10");
        assert_eq!(valor["covering_design"], false);
    }

    #[test]
    fn o_pedido_sem_r_continua_valendo_como_uma_cartela() {
        let saida = analisar_com(r#"{"v":9,"k":3,"j":2,"t":2}"#).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&saida).unwrap();
        assert_eq!(valor["r"], 1);
    }

    #[test]
    fn um_pedido_impossivel_explica_o_que_esta_errado() {
        let erro = analisar_com(r#"{"v":5,"k":9,"j":2,"t":2}"#).unwrap_err();
        assert!(erro.contains("não cabe"), "{erro}");
        let erro = analisar_com(r#"{"v":9,"k":3,"j":2,"t":5}"#).unwrap_err();
        assert!(erro.contains("nenhuma cartela"), "{erro}");
        let erro = analisar_com(r#"{"v":9,"k":5,"j":3,"t":4}"#).unwrap_err();
        assert!(erro.contains("não há"), "{erro}");
    }

    /// "Saem 15 e garanto 15" ainda é um covering design — as cotas fortes
    /// valem. "Saem 15 e garanto 13" não é, e ali só a contagem vale. A tela
    /// precisa saber diferenciar os dois, porque a conclusão que ela pode tirar
    /// muda junto.
    #[test]
    fn a_ponte_distingue_o_covering_design_do_que_nao_e() {
        let total = limitar_com(r#"{"v":20,"k":17,"j":15,"t":15,"r":1}"#).unwrap();
        let total: serde_json::Value = serde_json::from_str(&total).unwrap();
        assert_eq!(total["fechado"], true, "j = t e r = 1 é covering design");
        assert!(total["valor"].as_u64().unwrap() >= 114, "{total}");

        let parcial = limitar_com(r#"{"v":20,"k":17,"j":15,"t":13,"r":1}"#).unwrap();
        let parcial: serde_json::Value = serde_json::from_str(&parcial).unwrap();
        assert_eq!(parcial["fechado"], false, "garantia parcial não é covering design");
        assert_eq!(parcial["origem"], "cota de contagem");

        let premiadas = limitar_com(r#"{"v":20,"k":17,"j":15,"t":15,"r":2}"#).unwrap();
        let premiadas: serde_json::Value = serde_json::from_str(&premiadas).unwrap();
        assert_eq!(premiadas["fechado"], false, "duas premiadas saem do catálogo");
        assert_eq!(premiadas["origem"], "cota de contagem");
        assert_eq!(premiadas["valor"], 228, "a contagem dobra com o pedido");
    }

    #[test]
    fn o_verificador_reprova_o_que_nao_cobre_e_aprova_o_que_cobre() {
        let pedido = r#"{"v":7,"k":3,"j":2,"t":2,"r":1}"#;
        let mut c = ConstrutorExato::novo(pedido, 0.0).unwrap();
        while !serde_json::from_str::<serde_json::Value>(&c.avancar(1_000_000.0).unwrap()).unwrap()
            ["terminou"]
            .as_bool()
            .unwrap()
        {}
        let lista = c.melhor().unwrap();
        let saida = verificar_com(pedido, &lista).unwrap();
        assert!(saida.contains("\"cobre\":true"), "{saida}");

        let mut cartelas: Vec<Vec<u32>> = serde_json::from_str(&lista).unwrap();
        cartelas.pop();
        let saida = verificar_com(pedido, &serde_json::to_string(&cartelas).unwrap()).unwrap();
        assert!(saida.contains("\"cobre\":false"), "{saida}");
    }

    #[test]
    fn o_verificador_recusa_cartela_de_tamanho_errado() {
        let erro = verificar_com(r#"{"v":7,"k":3,"j":2,"t":2}"#, "[[1,2]]").unwrap_err();
        assert!(erro.contains("2 números distintos"), "{erro}");
        let erro = verificar_com(r#"{"v":7,"k":3,"j":2,"t":2}"#, "[[1,2,9]]").unwrap_err();
        assert!(erro.contains("fora do pool"), "{erro}");
    }

    /// **A garantia contra a tela muda**, do lado da ponte: o andamento precisa
    /// andar entre uma fatia e outra, e terminar.
    #[test]
    fn a_construcao_anda_em_fatias_e_termina() {
        let mut c = ConstrutorExato::novo(r#"{"v":10,"k":4,"j":2,"t":2,"r":1}"#, 0.0).unwrap();
        let primeiro: serde_json::Value =
            serde_json::from_str(&c.avancar(5_000.0).unwrap()).unwrap();
        assert!(primeiro["trabalho"].as_u64().unwrap() > 0);

        let mut anterior = primeiro;
        for _ in 0..200_000 {
            let agora: serde_json::Value =
                serde_json::from_str(&c.avancar(5_000.0).unwrap()).unwrap();
            assert!(agora["trabalho"].as_u64().unwrap() >= anterior["trabalho"].as_u64().unwrap());
            if agora["terminou"].as_bool().unwrap() {
                assert!(agora["melhor"].as_u64().unwrap() > 0);
                return;
            }
            anterior = agora;
        }
        panic!("a construção não terminou");
    }

    #[test]
    fn a_prova_anda_em_fatias_e_diz_o_que_provou() {
        let mut p = ProvaExata::nova(r#"{"v":7,"k":3,"j":2,"t":2,"r":1}"#, 10, "livre").unwrap();
        assert!(p.montou());
        for _ in 0..100_000 {
            let passo: serde_json::Value =
                serde_json::from_str(&p.avancar(20.0).unwrap()).unwrap();
            if passo["terminou"].as_bool().unwrap() {
                let saida: serde_json::Value =
                    serde_json::from_str(&p.desfecho().unwrap()).unwrap();
                assert_eq!(saida["fechou"], true);
                assert_eq!(saida["tamanho"], 7);
                return;
            }
        }
        panic!("a prova não terminou");
    }

    /// Num tamanho em que a instância não cabe, a prova diz "não coube" — e não
    /// tenta, não trava, e não devolve erro cru.
    #[test]
    fn uma_prova_grande_demais_diz_que_nao_coube() {
        let p = ProvaExata::nova(r#"{"v":25,"k":17,"j":15,"t":15,"r":1}"#, 300, "livre").unwrap();
        assert!(!p.montou());
        let saida: serde_json::Value = serde_json::from_str(&p.desfecho().unwrap()).unwrap();
        assert_eq!(saida["desfecho"], "grande-demais");
        assert_eq!(saida["fechou"], false);
    }

    #[test]
    fn a_prova_diz_com_todas_as_letras_quando_nao_conseguiu() {
        let saida = provar_com(r#"{"v":13,"k":5,"j":2,"t":2,"r":1}"#, 10, 2_000, "livre").unwrap();
        assert!(saida.contains("\"desfecho\":\"excedido\""), "{saida}");
        assert!(saida.contains("\"fechou\":false"), "{saida}");
    }

    #[test]
    fn a_familia_ciclica_e_a_livre_sao_perguntas_diferentes() {
        let pedido = r#"{"v":9,"k":3,"j":2,"t":2,"r":1}"#;
        let ciclica = provar_com(pedido, 15, 5_000_000, "ciclica").unwrap();
        let livre = provar_com(pedido, 15, 5_000_000, "livre").unwrap();
        let c: serde_json::Value = serde_json::from_str(&ciclica).unwrap();
        let l: serde_json::Value = serde_json::from_str(&livre).unwrap();
        assert!(
            c["candidatos"].as_u64().unwrap() < l["candidatos"].as_u64().unwrap(),
            "cíclica {}, livre {}",
            c["candidatos"],
            l["candidatos"]
        );
    }
}
