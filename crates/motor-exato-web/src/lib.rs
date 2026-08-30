//! A ponte do Construtor Matemático Exato para o navegador.
//!
//! Cada função aqui é **um estágio** do caminho, e não um pedaço dele. A tela
//! chama uma de cada vez e mostra o que voltou antes de pedir a próxima:
//!
//! ```text
//!   analisar          o modelo: quantos alvos, quantos blocos
//!   limitar           o piso pelas cotas fechadas — microssegundos
//!   limitar_por_dentro   o piso pelo subproblema resolvido aqui
//!   construir         as cartelas
//!   verificar         alvo por alvo, sem confiar em quem construiu
//!   provar            existe alguma coisa menor?
//! ```
//!
//! A divisão não é enfeite de interface: é a mesma separação que o aplicativo
//! promete entre **encontrar** e **provar**. Uma chamada só, que devolvesse um
//! número no fim de dez segundos, esconderia justamente o que há para ver.
//!
//! Todo estágio recebe um orçamento em nós e devolve quantos gastou. Estourar o
//! orçamento é um desfecho legítimo, com nome próprio — nunca vira silêncio nem
//! vira "não existe".

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use motor_exato::construtor;
use motor_exato::limites;
use motor_exato::problema::{Bloco, Problema};
use motor_exato::prova;
use motor_exato::veredito::{self, Esforco};

/// Os três números que descrevem o problema.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Pedido {
    pub v: usize,
    pub k: usize,
    pub t: usize,
}

impl Pedido {
    fn problema(&self) -> Result<Problema, String> {
        Problema::novo(self.v, self.k, self.t).map_err(|e| e.to_string())
    }
}

/// Uma cartela como a pessoa a lê: números de 1 a `v`, em ordem.
fn numeros(mascara: Bloco, v: usize) -> Vec<u32> {
    (0..v).filter(|i| mascara >> i & 1 == 1).map(|i| i as u32 + 1).collect()
}

fn cartelas(blocos: &[Bloco], v: usize) -> Vec<Vec<u32>> {
    let mut saida: Vec<Vec<u32>> = blocos.iter().map(|&b| numeros(b, v)).collect();
    saida.sort();
    saida
}

#[derive(Serialize)]
struct Analise {
    v: usize,
    k: usize,
    t: usize,
    alvos: String,
    blocos: String,
    alvos_por_bloco: String,
}

#[derive(Serialize)]
struct Piso {
    valor: u64,
    origem: String,
}

#[derive(Serialize)]
struct SaidaDaConstrucao {
    tamanho: usize,
    metodo: String,
    cartelas: Vec<Vec<u32>>,
}

#[derive(Serialize)]
struct Verificacao {
    cobre: bool,
    descobertos: usize,
    alvos: usize,
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

#[derive(Serialize)]
struct SaidaDoRelatorio {
    v: usize,
    k: usize,
    t: usize,
    encontrado: usize,
    metodo: String,
    cartelas: Vec<Vec<u32>>,
    verificado: bool,
    descobertos: usize,
    piso: u64,
    origem_do_piso: String,
    veredito: String,
    frase: String,
    folga: u64,
    nos_livres: u64,
    nos_ciclicos: u64,
    ciclica_fechou: bool,
    livre_fechou: bool,
}

fn json<T: Serialize>(valor: &T) -> Result<String, String> {
    serde_json::to_string(valor).map_err(|e| e.to_string())
}

fn ler(pedido_json: &str) -> Result<Pedido, String> {
    serde_json::from_str(pedido_json).map_err(|e| e.to_string())
}

/// **Estágio 1 — o modelo.** Quantos alvos existem, quantos blocos, quanto cada
/// bloco cobre. Sai antes de qualquer busca porque é só contagem.
pub fn analisar_com(pedido_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    json(&Analise {
        v: p.v,
        k: p.k,
        t: p.t,
        alvos: p.total_de_alvos().to_string(),
        blocos: p.total_de_blocos().to_string(),
        alvos_por_bloco: p.alvos_por_bloco().to_string(),
    })
}

/// **Estágio 2 — o piso, sem procurar nada.** Contagem e Schönheim.
pub fn limitar_com(pedido_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let piso = limites::sem_busca(&p);
    json(&Piso { valor: piso.valor, origem: piso.origem.to_string() })
}

/// **Estágio 2b — o piso pelo subproblema.**
///
/// Resolve `C(v−1, k−1, t−1)` aqui dentro e eleva o que provou. É caro e é o
/// que separa uma cota de manual de uma cota que este programa conquistou.
pub fn limitar_por_dentro_com(pedido_json: &str, orcamento: u32) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let mut piso = limites::sem_busca(&p);
    if let Some(dentro) = veredito::subproblema(&p) {
        let nos = (orcamento as u64).max(10_000);
        let relatorio =
            veredito::resolver(&dentro, Esforco { nos_ciclicos: nos, nos_livres: nos });
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
    json(&Piso { valor: piso.valor, origem: piso.origem.to_string() })
}

/// **Estágio 3 — a construção.** As cartelas, e de que método vieram.
pub fn construir_com(pedido_json: &str) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let c = construtor::construir(&p);
    json(&SaidaDaConstrucao {
        tamanho: c.tamanho(),
        metodo: c.metodo.to_string(),
        cartelas: cartelas(&c.blocos, p.v),
    })
}

/// **Estágio 4 — o verificador.**
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
                return Err(format!("a cartela tem o número {n}, fora do universo de {}", p.v));
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
    json(&Verificacao { cobre: descobertos == 0, descobertos, alvos: p.total_de_alvos() })
}

/// **Estágio 5 — a prova.** Existe alguma coisa abaixo de `teto`?
///
/// `familia` escolhe o espaço varrido: `"livre"` são todas as coleções, e o que
/// ela prova vale sem ressalva; `"ciclica"` são só as invariantes por rotação, e
/// o que ela prova vale dentro da simetria — a tela precisa dizer qual foi.
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
        prova::Desfecho::Minimo { tamanho, blocos } => {
            ("minimo", Some(*tamanho), Some(cartelas(blocos, p.v)))
        }
        prova::Desfecho::NadaAbaixoDe { teto } => ("nada-abaixo", Some(*teto), None),
        prova::Desfecho::Excedido => ("excedido", None, None),
        prova::Desfecho::GrandeDemais { .. } => ("grande-demais", None, None),
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

/// O caminho inteiro numa chamada só, para quem quer o resultado e não o
/// espetáculo. É o que a linha de comando e os testes usam.
pub fn resolver_com(pedido_json: &str, orcamento: u32) -> Result<String, String> {
    let p = ler(pedido_json)?.problema()?;
    let nos = (orcamento as u64).max(10_000);
    let r = veredito::resolver(&p, Esforco { nos_ciclicos: nos, nos_livres: nos });
    json(&SaidaDoRelatorio {
        v: p.v,
        k: p.k,
        t: p.t,
        encontrado: r.encontrado,
        metodo: r.metodo.to_string(),
        cartelas: cartelas(&r.cartelas, p.v),
        verificado: r.verificado,
        descobertos: r.descobertos,
        piso: r.piso,
        origem_do_piso: r.origem_do_piso.to_string(),
        veredito: format!("{:?}", r.veredito).to_lowercase(),
        frase: r.frase(),
        folga: r.folga(),
        nos_livres: r.nos_livres,
        nos_ciclicos: r.nos_ciclicos,
        ciclica_fechou: r.ciclica_fechou,
        livre_fechou: r.livre_fechou,
    })
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
pub fn construir(pedido_json: &str) -> Result<String, JsValue> {
    construir_com(pedido_json).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn verificar(pedido_json: &str, cartelas_json: &str) -> Result<String, JsValue> {
    verificar_com(pedido_json, cartelas_json).map_err(|e| JsValue::from_str(&e))
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

#[wasm_bindgen]
pub fn resolver(pedido_json: &str, orcamento: u32) -> Result<String, JsValue> {
    resolver_com(pedido_json, orcamento).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn a_analise_conta_o_universo_antes_de_qualquer_busca() {
        let saida = analisar_com(r#"{"v":13,"k":5,"t":2}"#).unwrap();
        assert!(saida.contains("\"alvos\":\"78\""), "{saida}");
        assert!(saida.contains("\"blocos\":\"1287\""), "{saida}");
        assert!(saida.contains("\"alvos_por_bloco\":\"10\""), "{saida}");
    }

    #[test]
    fn um_pedido_impossivel_explica_o_que_esta_errado() {
        let erro = analisar_com(r#"{"v":5,"k":9,"t":2}"#).unwrap_err();
        assert!(erro.contains("não cabe"), "{erro}");
        let erro = analisar_com(r#"{"v":9,"k":3,"t":5}"#).unwrap_err();
        assert!(erro.contains("nenhuma cartela"), "{erro}");
    }

    #[test]
    fn as_cartelas_saem_em_numeros_de_um_ate_v() {
        let saida = construir_com(r#"{"v":7,"k":3,"t":2}"#).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&saida).unwrap();
        let cartelas = valor["cartelas"].as_array().unwrap();
        assert_eq!(cartelas.len(), 7);
        for cartela in cartelas {
            let numeros = cartela.as_array().unwrap();
            assert_eq!(numeros.len(), 3);
            for n in numeros {
                let n = n.as_u64().unwrap();
                assert!((1..=7).contains(&n), "número fora do universo: {n}");
            }
        }
    }

    #[test]
    fn o_verificador_reprova_o_que_nao_cobre_e_aprova_o_que_cobre() {
        let pedido = r#"{"v":7,"k":3,"t":2}"#;
        let construida = construir_com(pedido).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&construida).unwrap();
        let cartelas = serde_json::to_string(&valor["cartelas"]).unwrap();
        let saida = verificar_com(pedido, &cartelas).unwrap();
        assert!(saida.contains("\"cobre\":true"), "{saida}");

        // Tirando uma cartela, a garantia cai — e o verificador precisa dizer
        // quantos alvos ficaram sem cobertura, não só que deu errado.
        let mut lista: Vec<Vec<u32>> = serde_json::from_value(valor["cartelas"].clone()).unwrap();
        lista.pop();
        let saida = verificar_com(pedido, &serde_json::to_string(&lista).unwrap()).unwrap();
        assert!(saida.contains("\"cobre\":false"), "{saida}");
        assert!(saida.contains("\"descobertos\":3"), "{saida}");
    }

    #[test]
    fn o_verificador_recusa_cartela_de_tamanho_errado() {
        let erro = verificar_com(r#"{"v":7,"k":3,"t":2}"#, "[[1,2]]").unwrap_err();
        assert!(erro.contains("2 números distintos"), "{erro}");
        let erro = verificar_com(r#"{"v":7,"k":3,"t":2}"#, "[[1,2,9]]").unwrap_err();
        assert!(erro.contains("fora do universo"), "{erro}");
    }

    #[test]
    fn a_prova_diz_com_todas_as_letras_quando_nao_conseguiu() {
        let saida = provar_com(r#"{"v":13,"k":5,"t":2}"#, 10, 2_000, "livre").unwrap();
        assert!(saida.contains("\"desfecho\":\"excedido\""), "{saida}");
        assert!(saida.contains("\"fechou\":false"), "{saida}");
    }

    #[test]
    fn o_caminho_inteiro_devolve_os_dois_numeros_separados() {
        let saida = resolver_com(r#"{"v":7,"k":3,"t":2}"#, 200_000).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&saida).unwrap();
        assert_eq!(valor["encontrado"], 7);
        assert_eq!(valor["piso"], 7);
        assert_eq!(valor["veredito"], "minimo");
        assert_eq!(valor["verificado"], true);
        assert_eq!(valor["folga"], 0);
    }

    #[test]
    fn onde_a_prova_nao_alcanca_o_relatorio_mostra_a_folga() {
        let saida = resolver_com(r#"{"v":13,"k":5,"t":2}"#, 100_000).unwrap();
        let valor: serde_json::Value = serde_json::from_str(&saida).unwrap();
        let encontrado = valor["encontrado"].as_u64().unwrap();
        let piso = valor["piso"].as_u64().unwrap();
        assert!(encontrado >= piso, "encontrado {encontrado}, piso {piso}");
        if encontrado > piso {
            assert!(valor["frase"].as_str().unwrap().contains("≥"), "{saida}");
        }
    }

    #[test]
    fn a_familia_ciclica_e_a_livre_sao_perguntas_diferentes() {
        let pedido = r#"{"v":9,"k":3,"t":2}"#;
        let ciclica = provar_com(pedido, 15, 5_000_000, "ciclica").unwrap();
        let livre = provar_com(pedido, 15, 5_000_000, "livre").unwrap();
        let c: serde_json::Value = serde_json::from_str(&ciclica).unwrap();
        let l: serde_json::Value = serde_json::from_str(&livre).unwrap();
        // A cíclica varre um espaço muito menor, e é isso que a torna útil.
        assert!(
            c["candidatos"].as_u64().unwrap() < l["candidatos"].as_u64().unwrap(),
            "cíclica {}, livre {}",
            c["candidatos"],
            l["candidatos"]
        );
    }
}
