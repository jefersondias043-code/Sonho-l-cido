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

use motor_exato::escalada::{Escalada, EstadoSalvo};
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

/// A escalada de cobertura, com estado, andando por orçamento.
///
/// O teto de cartelas vem de fora — é o piso que o aplicativo provou — e nunca
/// é ultrapassado. O que cresce é a cobertura.
#[wasm_bindgen]
pub struct EscaladaExata {
    interno: Escalada,
    v: usize,
}

#[derive(Serialize)]
struct PassoDaEscalada {
    cartelas: usize,
    teto: usize,
    /// A cota inferior provada. Não muda nem quando o teto sobe.
    piso: usize,
    /// Se a construção já passou do piso — e portanto deixou de ser candidata
    /// a mínima. A tela é obrigada a dizer isso.
    alem_do_piso: bool,
    /// A reorganização no piso esgotou a paciência sem melhorar nada: é a hora
    /// de oferecer a construção avançada.
    piso_esgotado: bool,
    /// Quantas cartelas tem a menor coleção completa. Zero enquanto nenhuma
    /// cumpriu a garantia; é o número que a otimização faz cair.
    completo: usize,
    cobertura: f64,
    melhor_cobertura: f64,
    melhor_cartelas: usize,
    fase: String,
    trabalho: u64,
    rodadas: u64,
    fechou: bool,
}

fn passo_em_json(passo: &motor_exato::escalada::Passo) -> PassoDaEscalada {
    PassoDaEscalada {
        cartelas: passo.cartelas,
        teto: passo.teto,
        piso: passo.piso,
        alem_do_piso: passo.alem_do_piso,
        piso_esgotado: passo.piso_esgotado,
        completo: passo.completo,
        cobertura: passo.cobertura,
        melhor_cobertura: passo.melhor_cobertura,
        melhor_cartelas: passo.melhor_cartelas,
        fase: passo.fase.to_string(),
        trabalho: passo.trabalho,
        rodadas: passo.rodadas,
        fechou: passo.fechou,
    }
}

#[wasm_bindgen]
impl EscaladaExata {
    #[wasm_bindgen(constructor)]
    pub fn nova(pedido_json: &str, teto: u32) -> Result<EscaladaExata, JsValue> {
        let pedido = ler(pedido_json).map_err(|e| JsValue::from_str(&e))?;
        let p = pedido.problema().map_err(|e| JsValue::from_str(&e))?;
        Ok(EscaladaExata { interno: Escalada::nova(&p, teto.max(1) as usize), v: p.v })
    }

    /// Retoma um trabalho guardado, de onde ele parou.
    pub fn retomada(estado_json: &str) -> Result<EscaladaExata, JsValue> {
        let estado: EstadoSalvo =
            serde_json::from_str(estado_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let interno =
            Escalada::retomar(&estado).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(EscaladaExata { interno, v: estado.v })
    }

    /// Trabalha uma fatia e devolve onde parou.
    pub fn avancar(&mut self, fatia: f64) -> Result<String, JsValue> {
        let passo = self.interno.avancar(fatia.max(1.0) as u64);
        json(&passo_em_json(&passo)).map_err(|e| JsValue::from_str(&e))
    }

    /// Onde ela está, sem trabalhar nada.
    pub fn passo(&self) -> Result<String, JsValue> {
        json(&passo_em_json(&self.interno.passo())).map_err(|e| JsValue::from_str(&e))
    }

    /// As cartelas do melhor conjunto já alcançado.
    pub fn melhor(&self) -> Result<String, JsValue> {
        json(&cartelas(self.interno.melhor(), self.v)).map_err(|e| JsValue::from_str(&e))
    }

    /// A curva de cobertura: por quantas cartelas, quanto já estava coberto.
    ///
    /// É a resposta a "1 cartela → quanto? 2 cartelas → quanto?", e existe como
    /// dado guardado, e não como efeito do instante em que a tela olhou — a
    /// subida costuma acontecer rápido demais para ser vista ao vivo.
    /// Liga a construção avançada: o teto sai e a subida recomeça.
    ///
    /// Manual de propósito. Passar do piso troca um mínimo provado por uma
    /// solução que apenas funciona, e quem faz essa troca é quem está olhando.
    pub fn liberar_o_teto(&mut self) {
        self.interno.liberar_o_teto();
    }

    /// Liga a otimização: procura cobrir tudo com uma cartela a menos, e outra.
    ///
    /// Só tem efeito depois de a garantia estar cumprida. A coleção completa já
    /// encontrada fica guardada e nunca é perdida.
    pub fn otimizar(&mut self) {
        self.interno.otimizar();
    }

    pub fn curva(&self) -> Result<String, JsValue> {
        let pontos: Vec<(u32, f32)> = self.interno.curva().to_vec();
        json(&pontos).map_err(|e| JsValue::from_str(&e))
    }

    /// O estado inteiro, para guardar e continuar depois.
    pub fn guardar(&self) -> Result<String, JsValue> {
        json(&self.interno.guardar()).map_err(|e| JsValue::from_str(&e))
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

    /// Sobe a escalada até fechar, e devolve o que ela achou.
    fn escalar_ate_fechar(pedido: &str, teto: u32) -> EscaladaExata {
        let mut e = EscaladaExata::nova(pedido, teto).unwrap();
        for _ in 0..10_000 {
            let passo: serde_json::Value =
                serde_json::from_str(&e.avancar(1_000_000.0).unwrap()).unwrap();
            if passo["fechou"].as_bool().unwrap() {
                break;
            }
        }
        e
    }

    #[test]
    fn o_verificador_reprova_o_que_nao_cobre_e_aprova_o_que_cobre() {
        let pedido = r#"{"v":7,"k":3,"j":2,"t":2,"r":1}"#;
        let c = escalar_ate_fechar(pedido, 7);
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

    /// **A regra do aplicativo, do lado da ponte:** o número de cartelas nunca
    /// passa do teto, em nenhuma fatia.
    #[test]
    fn a_escalada_nunca_passa_do_teto() {
        let mut e = EscaladaExata::nova(r#"{"v":10,"k":4,"j":2,"t":2,"r":1}"#, 6).unwrap();
        for _ in 0..500 {
            let passo: serde_json::Value =
                serde_json::from_str(&e.avancar(5_000.0).unwrap()).unwrap();
            let teto = passo["teto"].as_u64().unwrap();
            assert!(passo["cartelas"].as_u64().unwrap() <= teto, "{passo}");
            // O piso é o que foi provado, e a ponte precisa entregá-lo à parte:
            // é dele que a tela depende para saber quando pode falar em mínimo.
            assert_eq!(passo["piso"], 6);
            assert_eq!(passo["alem_do_piso"], teto > 6);
        }
    }

    /// Os três estágios, ligados à mão como a tela os liga.
    ///
    /// **Garantia parcial**, e é o que importa aqui: com garantia cheia o
    /// problema tem a forma complementar de Turán, quem trabalha é aquele motor,
    /// e não há estágio nenhum a ligar — ele entrega um fechamento no primeiro
    /// lote e vai baixando o número sozinho. Os três estágios continuam
    /// governando tudo o que não tem essa forma, e é isso que se cobra.
    ///
    /// O que se cobra é a ordem e a propriedade que a torna segura: a
    /// construção avançada só entra quando alguém manda, a otimização só depois
    /// de a garantia estar cumprida, e apertar **nunca** devolve uma coleção
    /// que não cobre — a completa fica guardada à parte.
    #[test]
    fn os_tres_estagios_sao_ligados_a_mao() {
        let pedido = r#"{"v":10,"k":4,"j":3,"t":2,"r":1}"#;
        let mut e = EscaladaExata::nova(pedido, 1).unwrap();

        // Uma cartela não cobre os 120 ternos: o piso se esgota e fica esperando.
        let mut passo: serde_json::Value = serde_json::from_str(&e.passo().unwrap()).unwrap();
        for _ in 0..4_000 {
            passo = serde_json::from_str(&e.avancar(20_000.0).unwrap()).unwrap();
            if passo["piso_esgotado"].as_bool().unwrap() {
                break;
            }
        }
        assert_eq!(passo["piso_esgotado"], true, "{passo}");
        assert_eq!(passo["alem_do_piso"], false, "não passa do piso sem mandarem");
        assert_eq!(passo["fechou"], false);

        // Ligada à mão, a construção avançada fecha.
        e.liberar_o_teto();
        for _ in 0..4_000 {
            passo = serde_json::from_str(&e.avancar(20_000.0).unwrap()).unwrap();
            if passo["fechou"].as_bool().unwrap() {
                break;
            }
        }
        assert_eq!(passo["fechou"], true, "{passo}");
        assert_eq!(passo["alem_do_piso"], true);
        let completo = passo["completo"].as_u64().unwrap();
        assert!(completo > 1);

        // Ligada à mão, a otimização aperta — e o que ela devolve continua
        // cobrindo tudo.
        e.otimizar();
        for _ in 0..4_000 {
            passo = serde_json::from_str(&e.avancar(20_000.0).unwrap()).unwrap();
        }
        let apertado = passo["completo"].as_u64().unwrap();
        assert!(apertado <= completo, "a otimização não pode piorar o número");
        let cartelas: Vec<Vec<u32>> = serde_json::from_str(&e.melhor().unwrap()).unwrap();
        assert_eq!(cartelas.len() as u64, apertado, "o melhor é a menor coleção completa");
        let conferido: serde_json::Value =
            serde_json::from_str(&verificar_com(pedido, &e.melhor().unwrap()).unwrap()).unwrap();
        assert_eq!(conferido["cobre"], true, "apertar devolveu algo que não cobre");
    }

    /// A ponte precisa entregar os dois números, e a diferença entre eles é o
    /// que autoriza — ou proíbe — a palavra "mínimo" na tela.
    #[test]
    fn a_ponte_entrega_o_piso_e_o_modo_avancado() {
        // Garantia parcial: é onde a escalada governa, e onde passar do piso
        // continua sendo decisão de quem está olhando. Uma cartela não cobre os
        // 120 ternos de dez números, o piso se esgota, e ela **fica lá**.
        let mut e = EscaladaExata::nova(r#"{"v":10,"k":4,"j":3,"t":2,"r":1}"#, 1).unwrap();
        let mut passo: serde_json::Value =
            serde_json::from_str(&e.avancar(50_000.0).unwrap()).unwrap();
        assert_eq!(passo["piso"], 1);
        assert_eq!(passo["alem_do_piso"], false);

        for _ in 0..2_000 {
            passo = serde_json::from_str(&e.avancar(50_000.0).unwrap()).unwrap();
        }
        assert_eq!(passo["fechou"], false, "não pode fechar sem passar do piso");
        assert_eq!(passo["alem_do_piso"], false, "e não passa do piso sozinha");
        assert_eq!(passo["piso_esgotado"], true, "mas avisa que o piso se esgotou");

        // Mandada, ela passa — e aí sim fecha.
        e.liberar_o_teto();
        for _ in 0..2_000 {
            passo = serde_json::from_str(&e.avancar(50_000.0).unwrap()).unwrap();
            if passo["fechou"].as_bool().unwrap() {
                break;
            }
        }
        assert_eq!(passo["fechou"], true, "{passo}");
        assert_eq!(passo["alem_do_piso"], true, "fechar aqui exige passar do piso");
        assert_eq!(passo["piso"], 1, "o piso continua sendo o que foi provado");
    }

    /// A cobertura sobe, e a melhor nunca regride — é o que a barra desenha.
    #[test]
    fn a_cobertura_sobe_e_a_melhor_nunca_regride() {
        let mut e = EscaladaExata::nova(r#"{"v":9,"k":3,"j":2,"t":2,"r":1}"#, 12).unwrap();
        let mut anterior = 0.0;
        let mut subiu = false;
        for _ in 0..500 {
            let passo: serde_json::Value =
                serde_json::from_str(&e.avancar(5_000.0).unwrap()).unwrap();
            let melhor = passo["melhor_cobertura"].as_f64().unwrap();
            assert!(melhor >= anterior - 1e-12, "a melhor cobertura caiu");
            if melhor > anterior {
                subiu = true;
            }
            anterior = melhor;
        }
        assert!(subiu, "a cobertura precisa subir");
        assert!(anterior > 0.0);
    }

    /// A curva atravessa a ponte, com a forma que a tela desenha.
    ///
    /// A curva é o registro da **subida**, um ponto por cartela acrescentada, e
    /// só existe onde há subida: com garantia cheia quem trabalha é o motor de
    /// Turán, que não sobe degrau nenhum, e a tela esconde o cartão da curva em
    /// vez de mostrar um vazio.
    #[test]
    fn a_curva_atravessa_a_ponte() {
        let mut e = EscaladaExata::nova(r#"{"v":10,"k":4,"j":3,"t":2,"r":1}"#, 12).unwrap();
        for _ in 0..200 {
            e.avancar(20_000.0).unwrap();
        }
        let curva: Vec<(u32, f32)> = serde_json::from_str(&e.curva().unwrap()).unwrap();
        assert!(!curva.is_empty(), "a subida precisa ter deixado registro");
        assert_eq!(curva[0].0, 1, "o primeiro ponto é uma cartela");
        assert!(curva[0].1 > 0.0, "e ela já cobre alguma coisa");
        for par in curva.windows(2) {
            assert!(par[1].0 > par[0].0, "as cartelas têm de crescer");
            assert!(par[1].1 >= par[0].1, "a cobertura não pode cair na subida");
        }
    }

    /// **Com garantia cheia não há estágios.** O motor entrega e vai baixando.
    ///
    /// É a regra nova, e ela substitui os três estágios exatamente onde a razão
    /// de eles existirem deixou de valer: a escalada empacava no piso sem saber
    /// se ele bastava, e passar do piso não podia ser decisão do motor. Este não
    /// empaca — no primeiro lote já há um fechamento completo, e daí em diante o
    /// número só cai.
    #[test]
    fn com_garantia_cheia_o_fechamento_sai_no_primeiro_lote() {
        let pedido = r#"{"v":10,"k":4,"j":2,"t":2,"r":1}"#;
        let mut e = EscaladaExata::nova(pedido, 6).unwrap();

        let passo: serde_json::Value =
            serde_json::from_str(&e.avancar(200_000.0).unwrap()).unwrap();
        assert_eq!(passo["fase"], "construindo", "{passo}");
        assert!(passo["completo"].as_u64().unwrap() > 0, "sem fechamento nenhum: {passo}");
        assert_eq!(passo["fechou"], true, "{passo}");

        // E o número não sobe: o que já valia fica guardado.
        let primeiro = passo["completo"].as_u64().unwrap();
        let mut ultimo = primeiro;
        for _ in 0..200 {
            let passo: serde_json::Value =
                serde_json::from_str(&e.avancar(200_000.0).unwrap()).unwrap();
            let agora = passo["completo"].as_u64().unwrap();
            assert!(agora <= ultimo, "o número subiu: {ultimo} → {agora}");
            ultimo = agora;
        }

        // E o que ele entrega cobre de verdade.
        let conferido: serde_json::Value =
            serde_json::from_str(&verificar_com(pedido, &e.melhor().unwrap()).unwrap()).unwrap();
        assert_eq!(conferido["cobre"], true, "entregou algo que não cobre");
    }

    /// Guardar e retomar: o trabalho continua de onde parou.
    #[test]
    fn a_escalada_guarda_e_retoma() {
        let pedido = r#"{"v":10,"k":4,"j":3,"t":2,"r":1}"#;
        let mut e = EscaladaExata::nova(pedido, 10).unwrap();
        for _ in 0..30 {
            e.avancar(5_000.0).unwrap();
        }
        let antes: serde_json::Value = serde_json::from_str(&e.passo().unwrap()).unwrap();
        let salvo = e.guardar().unwrap();

        let retomada = EscaladaExata::retomada(&salvo).unwrap();
        let depois: serde_json::Value = serde_json::from_str(&retomada.passo().unwrap()).unwrap();
        assert_eq!(antes["cartelas"], depois["cartelas"]);
        assert_eq!(antes["fase"], depois["fase"]);
        assert_eq!(antes["trabalho"], depois["trabalho"]);
        assert_eq!(e.melhor().unwrap(), retomada.melhor().unwrap());
        assert_eq!(e.curva().unwrap(), retomada.curva().unwrap());
    }

    /// Onde o piso é alcançável, a escalada fecha exatamente nele — e o que ela
    /// devolve passa pelo verificador.
    #[test]
    fn onde_o_piso_e_alcancavel_a_ponte_fecha_nele() {
        let pedido = r#"{"v":18,"k":17,"j":15,"t":15,"r":1}"#;
        let piso: serde_json::Value = serde_json::from_str(&limitar_com(pedido).unwrap()).unwrap();
        assert_eq!(piso["valor"], 16);

        let e = escalar_ate_fechar(pedido, 16);
        let passo: serde_json::Value = serde_json::from_str(&e.passo().unwrap()).unwrap();
        assert_eq!(passo["fechou"], true, "{passo}");
        assert_eq!(passo["melhor_cartelas"], 16);

        let conferido = verificar_com(pedido, &e.melhor().unwrap()).unwrap();
        assert!(conferido.contains("\"cobre\":true"), "{conferido}");
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
