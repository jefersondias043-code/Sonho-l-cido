//! # motor-persistencia — o banco de soluções
//!
//! Implementa os §15, §16, §37 e §38 do documento conceitual: parar sem perder
//! trabalho, continuar de onde parou, e manter um repositório de tudo que já
//! foi encontrado.
//!
//! ## Por que SQLite
//!
//! A busca pode rodar por dias e ser interrompida a qualquer momento —
//! inclusive de forma abrupta, por queda de energia ou `kill`. Um arquivo
//! próprio exigiria escrever recuperação de falha; SQLite já tem transação
//! atômica e durabilidade resolvidas há décadas. O banco é um arquivo único,
//! copiável, e legível por qualquer ferramenta.
//!
//! ## Por que as cartelas são gravadas como rótulos
//!
//! Internamente uma cartela é uma bitmask sobre índices do pool. No banco ela
//! vira a lista de rótulos que o usuário reconhece — `[4, 11, 23, 38]`, não
//! `0b1001...`. Assim os dados continuam fazendo sentido fora deste programa,
//! e uma mudança futura na representação interna não invalida o histórico.
//!
//! ## O recorde é gravado no instante em que aparece
//!
//! Não há "salvar ao sair". Cada novo recorde é escrito imediatamente, então o
//! pior caso de uma interrupção violenta é perder alguns segundos de
//! exploração — nunca a melhor solução.

use std::path::Path;

use motor_core::{Avaliacao, Cartela, LimiteInferior, MetodoLimite, Objetivo, Problema, RegraCobertura};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub type Resultado<T> = Result<T, Erro>;

#[derive(Debug)]
pub enum Erro {
    Banco(rusqlite::Error),
    Serializacao(serde_json::Error),
    /// O banco contém um problema que não pôde ser reconstruído.
    ProblemaInvalido(String),
}

impl std::fmt::Display for Erro {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Erro::Banco(e) => write!(f, "erro de banco: {e}"),
            Erro::Serializacao(e) => write!(f, "erro ao converter dados: {e}"),
            Erro::ProblemaInvalido(m) => write!(f, "problema gravado é inválido: {m}"),
        }
    }
}

impl std::error::Error for Erro {}

impl From<rusqlite::Error> for Erro {
    fn from(e: rusqlite::Error) -> Self {
        Erro::Banco(e)
    }
}

impl From<serde_json::Error> for Erro {
    fn from(e: serde_json::Error) -> Self {
        Erro::Serializacao(e)
    }
}

/// Uma solução gravada, com toda a procedência que o §29 pede.
#[derive(Debug, Clone, PartialEq)]
pub struct RegistroSolucao {
    pub id: i64,
    /// Cartelas em rótulos do universo, cada uma em ordem crescente.
    pub cartelas: Vec<Vec<u32>>,
    pub avaliacao: Avaliacao,
    pub assinatura: u64,
    pub iteracao: u64,
    pub segundos: f64,
    pub operador: Option<String>,
    pub ancestral: Option<u64>,
    pub e_recorde: bool,
}

impl RegistroSolucao {
    pub fn cobertura(&self) -> f64 {
        self.avaliacao.cobertura()
    }

    /// Converte de volta para cartelas internas, no contexto de um problema.
    ///
    /// Devolve `None` se algum rótulo não pertencer ao pool — o que indicaria
    /// que o registro veio de outra configuração.
    pub fn para_cartelas(&self, problema: &Problema) -> Option<Vec<Cartela>> {
        self.cartelas
            .iter()
            .map(|rotulos| {
                let mut cartela = Cartela::vazia();
                for &rotulo in rotulos {
                    cartela.inserir(problema.indice_do_rotulo(rotulo)?);
                }
                Some(cartela)
            })
            .collect()
    }
}

/// Uma execução gravada — a configuração do problema mais o andamento.
#[derive(Debug, Clone)]
pub struct RegistroExecucao {
    pub id: i64,
    pub problema: Problema,
    pub semente: u64,
    pub iteracoes: u64,
    pub segundos: f64,
    pub limite: LimiteInferior,
    pub criada_em: String,
    pub atualizada_em: String,
}

/// Forma serializável do objetivo, para gravar em uma coluna só.
#[derive(Serialize, Deserialize)]
#[serde(tag = "tipo")]
enum ObjetivoGravado {
    MinimizarCartelas,
    MaximizarCobertura { orcamento: usize },
}

impl From<Objetivo> for ObjetivoGravado {
    fn from(o: Objetivo) -> Self {
        match o {
            Objetivo::MinimizarCartelas => ObjetivoGravado::MinimizarCartelas,
            Objetivo::MaximizarCobertura { orcamento } => {
                ObjetivoGravado::MaximizarCobertura { orcamento }
            }
        }
    }
}

impl From<ObjetivoGravado> for Objetivo {
    fn from(o: ObjetivoGravado) -> Self {
        match o {
            ObjetivoGravado::MinimizarCartelas => Objetivo::MinimizarCartelas,
            ObjetivoGravado::MaximizarCobertura { orcamento } => {
                Objetivo::MaximizarCobertura { orcamento }
            }
        }
    }
}

pub struct Banco {
    conexao: Connection,
}

impl Banco {
    /// Abre (ou cria) o banco no caminho indicado.
    pub fn abrir(caminho: impl AsRef<Path>) -> Resultado<Self> {
        let conexao = Connection::open(caminho)?;
        Self::preparar(conexao)
    }

    /// Banco temporário em memória, para testes.
    pub fn em_memoria() -> Resultado<Self> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conexao: Connection) -> Resultado<Self> {
        // WAL permite ler o banco enquanto a busca escreve — dá para consultar
        // o ranking de outra janela com o motor rodando.
        conexao.pragma_update(None, "journal_mode", "WAL")?;
        conexao.pragma_update(None, "synchronous", "NORMAL")?;

        conexao.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS execucoes (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                impressao         TEXT    NOT NULL,
                universo          INTEGER NOT NULL,
                pool              TEXT    NOT NULL,
                tamanho_cartela   INTEGER NOT NULL,
                regra_alvo        INTEGER NOT NULL,
                regra_intersecao  INTEGER NOT NULL,
                objetivo          TEXT    NOT NULL,
                semente           TEXT    NOT NULL,
                iteracoes         INTEGER NOT NULL DEFAULT 0,
                segundos          REAL    NOT NULL DEFAULT 0,
                limite_inferior   INTEGER NOT NULL,
                metodo_limite     TEXT    NOT NULL,
                criada_em         TEXT    NOT NULL DEFAULT (datetime('now')),
                atualizada_em     TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_execucoes_impressao
                ON execucoes(impressao);

            CREATE TABLE IF NOT EXISTS solucoes (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                execucao_id   INTEGER NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
                assinatura    TEXT    NOT NULL,
                cartelas      TEXT    NOT NULL,
                quantidade    INTEGER NOT NULL,
                descobertos   INTEGER NOT NULL,
                total_alvos   INTEGER NOT NULL,
                redundancia   INTEGER NOT NULL,
                iteracao      INTEGER NOT NULL,
                segundos      REAL    NOT NULL,
                operador      TEXT,
                ancestral     TEXT,
                e_recorde     INTEGER NOT NULL DEFAULT 0,
                criada_em     TEXT    NOT NULL DEFAULT (datetime('now')),
                UNIQUE(execucao_id, assinatura)
            );

            CREATE INDEX IF NOT EXISTS idx_solucoes_ranking
                ON solucoes(execucao_id, descobertos, quantidade, redundancia);
            "#,
        )?;

        Ok(Self { conexao })
    }

    /// Cria uma execução para este problema, ou devolve a existente.
    ///
    /// A "impressão" é a identidade da configuração: mesmo universo, mesmo
    /// pool, mesmas regras. É o que permite ao CONTINUAR reencontrar o
    /// trabalho anterior sem o usuário precisar decorar um número.
    pub fn abrir_execucao(
        &self,
        problema: &Problema,
        semente: u64,
        limite: LimiteInferior,
    ) -> Resultado<i64> {
        let impressao = impressao_do_problema(problema);

        let existente: Option<i64> = self
            .conexao
            .query_row(
                "SELECT id FROM execucoes WHERE impressao = ?1 ORDER BY id DESC LIMIT 1",
                params![impressao],
                |linha| linha.get(0),
            )
            .optional()?;

        if let Some(id) = existente {
            return Ok(id);
        }

        let pool = serde_json::to_string(problema.pool())?;
        let objetivo = serde_json::to_string(&ObjetivoGravado::from(problema.objetivo()))?;
        let regra = problema.regra();

        self.conexao.execute(
            "INSERT INTO execucoes
                (impressao, universo, pool, tamanho_cartela, regra_alvo, regra_intersecao,
                 objetivo, semente, limite_inferior, metodo_limite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                impressao,
                problema.universo(),
                pool,
                problema.tamanho_cartela() as i64,
                regra.alvo as i64,
                regra.intersecao as i64,
                objetivo,
                semente.to_string(),
                limite.valor as i64,
                nome_do_metodo(limite.metodo),
            ],
        )?;

        Ok(self.conexao.last_insert_rowid())
    }

    pub fn atualizar_andamento(
        &self,
        execucao_id: i64,
        iteracoes: u64,
        segundos: f64,
    ) -> Resultado<()> {
        self.conexao.execute(
            "UPDATE execucoes
                SET iteracoes = ?2, segundos = ?3, atualizada_em = datetime('now')
              WHERE id = ?1",
            params![execucao_id, iteracoes as i64, segundos],
        )?;
        Ok(())
    }

    /// Grava uma solução. Devolve `false` se ela já estava lá (§38).
    #[allow(clippy::too_many_arguments)]
    pub fn gravar_solucao(
        &self,
        execucao_id: i64,
        problema: &Problema,
        cartelas: &[Cartela],
        avaliacao: Avaliacao,
        assinatura: u64,
        iteracao: u64,
        segundos: f64,
        operador: Option<&str>,
        ancestral: Option<u64>,
        e_recorde: bool,
    ) -> Resultado<bool> {
        let rotulos: Vec<Vec<u32>> =
            cartelas.iter().map(|c| c.rotulos(problema.pool())).collect();
        let json = serde_json::to_string(&rotulos)?;

        let inseridas = self.conexao.execute(
            "INSERT OR IGNORE INTO solucoes
                (execucao_id, assinatura, cartelas, quantidade, descobertos, total_alvos,
                 redundancia, iteracao, segundos, operador, ancestral, e_recorde)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                execucao_id,
                assinatura.to_string(),
                json,
                avaliacao.cartelas as i64,
                avaliacao.descobertos as i64,
                avaliacao.total_alvos as i64,
                avaliacao.redundancia as i64,
                iteracao as i64,
                segundos,
                operador,
                ancestral.map(|a| a.to_string()),
                e_recorde as i64,
            ],
        )?;

        Ok(inseridas > 0)
    }

    /// A melhor solução gravada para esta execução.
    pub fn melhor_solucao(&self, execucao_id: i64) -> Resultado<Option<RegistroSolucao>> {
        let mut consulta = self.conexao.prepare(
            "SELECT id, cartelas, quantidade, descobertos, total_alvos, redundancia,
                    assinatura, iteracao, segundos, operador, ancestral, e_recorde
               FROM solucoes
              WHERE execucao_id = ?1
              ORDER BY descobertos ASC, quantidade ASC, redundancia ASC
              LIMIT 1",
        )?;

        let registro = consulta
            .query_row(params![execucao_id], montar_registro)
            .optional()?;

        registro.transpose()
    }

    /// Ranking do §18, da melhor para a pior.
    pub fn ranking(&self, execucao_id: i64, limite: usize) -> Resultado<Vec<RegistroSolucao>> {
        let mut consulta = self.conexao.prepare(
            "SELECT id, cartelas, quantidade, descobertos, total_alvos, redundancia,
                    assinatura, iteracao, segundos, operador, ancestral, e_recorde
               FROM solucoes
              WHERE execucao_id = ?1
              ORDER BY descobertos ASC, quantidade ASC, redundancia ASC
              LIMIT ?2",
        )?;

        let linhas = consulta.query_map(params![execucao_id, limite as i64], montar_registro)?;

        let mut saida = Vec::new();
        for linha in linhas {
            saida.push(linha??);
        }
        Ok(saida)
    }

    /// Todas as execuções gravadas, da mais recente para a mais antiga.
    pub fn listar_execucoes(&self) -> Resultado<Vec<RegistroExecucao>> {
        let mut consulta = self.conexao.prepare(
            "SELECT id, universo, pool, tamanho_cartela, regra_alvo, regra_intersecao,
                    objetivo, semente, iteracoes, segundos, limite_inferior, metodo_limite,
                    criada_em, atualizada_em
               FROM execucoes
              ORDER BY atualizada_em DESC",
        )?;

        let linhas = consulta.query_map([], montar_execucao)?;
        let mut saida = Vec::new();
        for linha in linhas {
            saida.push(linha??);
        }
        Ok(saida)
    }

    /// Reencontra a execução correspondente a um problema, se houver.
    pub fn execucao_do_problema(
        &self,
        problema: &Problema,
    ) -> Resultado<Option<RegistroExecucao>> {
        let impressao = impressao_do_problema(problema);
        let mut consulta = self.conexao.prepare(
            "SELECT id, universo, pool, tamanho_cartela, regra_alvo, regra_intersecao,
                    objetivo, semente, iteracoes, segundos, limite_inferior, metodo_limite,
                    criada_em, atualizada_em
               FROM execucoes
              WHERE impressao = ?1
              ORDER BY id DESC
              LIMIT 1",
        )?;

        let registro = consulta
            .query_row(params![impressao], montar_execucao)
            .optional()?;
        registro.transpose()
    }

    pub fn execucao_por_id(&self, id: i64) -> Resultado<Option<RegistroExecucao>> {
        let mut consulta = self.conexao.prepare(
            "SELECT id, universo, pool, tamanho_cartela, regra_alvo, regra_intersecao,
                    objetivo, semente, iteracoes, segundos, limite_inferior, metodo_limite,
                    criada_em, atualizada_em
               FROM execucoes
              WHERE id = ?1",
        )?;
        let registro = consulta.query_row(params![id], montar_execucao).optional()?;
        registro.transpose()
    }

    pub fn total_de_solucoes(&self, execucao_id: i64) -> Resultado<usize> {
        let total: i64 = self.conexao.query_row(
            "SELECT COUNT(*) FROM solucoes WHERE execucao_id = ?1",
            params![execucao_id],
            |linha| linha.get(0),
        )?;
        Ok(total as usize)
    }
}

/// Identidade de uma configuração de problema.
///
/// Duas execuções com a mesma impressão atacam exatamente o mesmo problema
/// matemático e podem compartilhar histórico. A semente fica de fora de
/// propósito: mudar a semente explora o mesmo problema por outro caminho, e o
/// trabalho anterior continua válido.
pub fn impressao_do_problema(problema: &Problema) -> String {
    let regra = problema.regra();
    let objetivo = match problema.objetivo() {
        Objetivo::MinimizarCartelas => "min".to_string(),
        Objetivo::MaximizarCobertura { orcamento } => format!("cob{orcamento}"),
    };
    let pool: Vec<String> = problema.pool().iter().map(|r| r.to_string()).collect();

    format!(
        "u{}|p{}|k{}|a{}|i{}|{}",
        problema.universo(),
        pool.join(","),
        problema.tamanho_cartela(),
        regra.alvo,
        regra.intersecao,
        objetivo
    )
}

fn nome_do_metodo(metodo: MetodoLimite) -> &'static str {
    match metodo {
        MetodoLimite::Schonheim => "schonheim",
        MetodoLimite::Contagem => "contagem",
        MetodoLimite::Publicado => "publicado",
    }
}

fn metodo_do_nome(nome: &str) -> MetodoLimite {
    match nome {
        "schonheim" => MetodoLimite::Schonheim,
        "publicado" => MetodoLimite::Publicado,
        _ => MetodoLimite::Contagem,
    }
}

fn montar_registro(linha: &rusqlite::Row<'_>) -> rusqlite::Result<Resultado<RegistroSolucao>> {
    let cartelas_json: String = linha.get(1)?;
    let assinatura_texto: String = linha.get(6)?;
    let ancestral_texto: Option<String> = linha.get(10)?;

    let cartelas: Vec<Vec<u32>> = match serde_json::from_str(&cartelas_json) {
        Ok(v) => v,
        Err(e) => return Ok(Err(Erro::Serializacao(e))),
    };

    Ok(Ok(RegistroSolucao {
        id: linha.get(0)?,
        cartelas,
        avaliacao: Avaliacao {
            cartelas: linha.get::<_, i64>(2)? as usize,
            descobertos: linha.get::<_, i64>(3)? as usize,
            total_alvos: linha.get::<_, i64>(4)? as usize,
            redundancia: linha.get::<_, i64>(5)? as u64,
        },
        assinatura: assinatura_texto.parse().unwrap_or(0),
        iteracao: linha.get::<_, i64>(7)? as u64,
        segundos: linha.get(8)?,
        operador: linha.get(9)?,
        ancestral: ancestral_texto.and_then(|a| a.parse().ok()),
        e_recorde: linha.get::<_, i64>(11)? != 0,
    }))
}

fn montar_execucao(linha: &rusqlite::Row<'_>) -> rusqlite::Result<Resultado<RegistroExecucao>> {
    let pool_json: String = linha.get(2)?;
    let objetivo_json: String = linha.get(6)?;
    let semente_texto: String = linha.get(7)?;

    let pool: Vec<u32> = match serde_json::from_str(&pool_json) {
        Ok(v) => v,
        Err(e) => return Ok(Err(Erro::Serializacao(e))),
    };
    let objetivo: ObjetivoGravado = match serde_json::from_str(&objetivo_json) {
        Ok(v) => v,
        Err(e) => return Ok(Err(Erro::Serializacao(e))),
    };

    let problema = Problema::novo(
        linha.get(1)?,
        pool,
        linha.get::<_, i64>(3)? as usize,
        RegraCobertura {
            alvo: linha.get::<_, i64>(4)? as usize,
            intersecao: linha.get::<_, i64>(5)? as usize,
        },
        objetivo.into(),
    );

    let problema = match problema {
        Ok(p) => p,
        Err(e) => return Ok(Err(Erro::ProblemaInvalido(e.to_string()))),
    };

    let metodo_texto: String = linha.get(11)?;

    Ok(Ok(RegistroExecucao {
        id: linha.get(0)?,
        problema,
        semente: semente_texto.parse().unwrap_or(0),
        iteracoes: linha.get::<_, i64>(8)? as u64,
        segundos: linha.get(9)?,
        limite: LimiteInferior {
            valor: linha.get::<_, i64>(10)? as u64,
            metodo: metodo_do_nome(&metodo_texto),
        },
        criada_em: linha.get(12)?,
        atualizada_em: linha.get(13)?,
    }))
}

#[cfg(test)]
mod testes {
    use super::*;
    use motor_core::{MotorCobertura, Rascunho, Solucao};

    fn problema_exemplo() -> Problema {
        Problema::com_pool_inicial(
            60,
            13,
            4,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap()
    }

    fn limite_exemplo() -> LimiteInferior {
        LimiteInferior { valor: 13, metodo: MetodoLimite::Schonheim }
    }

    fn cartelas_exemplo() -> Vec<Cartela> {
        vec![
            Cartela::dos_indices(&[0, 1, 2, 3]),
            Cartela::dos_indices(&[4, 5, 6, 7]),
            Cartela::dos_indices(&[8, 9, 10, 11]),
        ]
    }

    fn avaliacao_exemplo(cartelas: usize, descobertos: usize) -> Avaliacao {
        Avaliacao { cartelas, descobertos, total_alvos: 78, redundancia: 0 }
    }

    #[test]
    fn abrir_execucao_e_idempotente_para_o_mesmo_problema() {
        // É o que permite ao CONTINUAR reencontrar o trabalho sem o usuário
        // precisar guardar um identificador.
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();

        let primeira = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();
        let segunda = banco.abrir_execucao(&problema, 999, limite_exemplo()).unwrap();

        assert_eq!(primeira, segunda, "a mesma configuração deveria reabrir a mesma execução");
    }

    #[test]
    fn problemas_diferentes_ficam_em_execucoes_diferentes() {
        let banco = Banco::em_memoria().unwrap();
        let a = banco.abrir_execucao(&problema_exemplo(), 1, limite_exemplo()).unwrap();

        let outro = Problema::com_pool_inicial(
            60,
            13,
            5, // cartela de tamanho diferente
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let b = banco.abrir_execucao(&outro, 1, limite_exemplo()).unwrap();

        assert_ne!(a, b);
    }

    #[test]
    fn a_semente_nao_separa_execucoes() {
        // Trocar de semente é explorar o mesmo problema por outro caminho; o
        // histórico anterior continua valendo.
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();
        assert_eq!(
            impressao_do_problema(&problema),
            impressao_do_problema(&problema_exemplo())
        );
        let a = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();
        let b = banco.abrir_execucao(&problema, 2, limite_exemplo()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn solucao_gravada_volta_identica() {
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();
        let execucao = banco.abrir_execucao(&problema, 7, limite_exemplo()).unwrap();
        let cartelas = cartelas_exemplo();

        banco
            .gravar_solucao(
                execucao,
                &problema,
                &cartelas,
                avaliacao_exemplo(3, 0),
                0xdead_beef,
                4242,
                12.5,
                Some("remover piores"),
                Some(0x1234),
                true,
            )
            .unwrap();

        let registro = banco.melhor_solucao(execucao).unwrap().expect("gravada");
        assert_eq!(registro.avaliacao.cartelas, 3);
        assert_eq!(registro.assinatura, 0xdead_beef);
        assert_eq!(registro.iteracao, 4242);
        assert_eq!(registro.operador.as_deref(), Some("remover piores"));
        assert_eq!(registro.ancestral, Some(0x1234));
        assert!(registro.e_recorde);

        // E volta a ser cartela de verdade, no contexto do problema.
        let recuperadas = registro.para_cartelas(&problema).expect("rótulos do pool");
        assert_eq!(recuperadas, cartelas);
    }

    #[test]
    fn cartelas_sao_gravadas_como_rotulos_do_universo() {
        // Um pool esparso é o caso que revela se a tradução está certa.
        let problema = Problema::novo(
            60,
            vec![7, 13, 42, 55],
            2,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MinimizarCartelas,
        )
        .unwrap();
        let banco = Banco::em_memoria().unwrap();
        let execucao = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();

        banco
            .gravar_solucao(
                execucao,
                &problema,
                &[Cartela::dos_indices(&[0, 2])],
                avaliacao_exemplo(1, 0),
                1,
                0,
                0.0,
                None,
                None,
                true,
            )
            .unwrap();

        let registro = banco.melhor_solucao(execucao).unwrap().unwrap();
        assert_eq!(
            registro.cartelas,
            vec![vec![7u32, 42]],
            "o banco precisa guardar os números que o usuário reconhece"
        );
    }

    #[test]
    fn solucao_repetida_nao_e_gravada_duas_vezes() {
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();
        let execucao = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();

        let gravar = |assinatura: u64| {
            banco
                .gravar_solucao(
                    execucao,
                    &problema,
                    &cartelas_exemplo(),
                    avaliacao_exemplo(3, 0),
                    assinatura,
                    0,
                    0.0,
                    None,
                    None,
                    false,
                )
                .unwrap()
        };

        assert!(gravar(111));
        assert!(!gravar(111), "a mesma assinatura não pode entrar de novo");
        assert!(gravar(222));
        assert_eq!(banco.total_de_solucoes(execucao).unwrap(), 2);
    }

    #[test]
    fn ranking_ordena_por_qualidade() {
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();
        let execucao = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();

        for (assinatura, cartelas, descobertos) in [(1u64, 20, 0), (2, 15, 0), (3, 5, 7)] {
            banco
                .gravar_solucao(
                    execucao,
                    &problema,
                    &cartelas_exemplo(),
                    avaliacao_exemplo(cartelas, descobertos),
                    assinatura,
                    0,
                    0.0,
                    None,
                    None,
                    false,
                )
                .unwrap();
        }

        let ranking = banco.ranking(execucao, 10).unwrap();
        assert_eq!(ranking[0].avaliacao.cartelas, 15, "completa e menor vem primeiro");
        assert_eq!(ranking[1].avaliacao.cartelas, 20);
        assert_eq!(ranking[2].avaliacao.descobertos, 7, "a incompleta vai por último");
    }

    #[test]
    fn execucao_volta_com_o_problema_reconstruido() {
        // Sem isso o CONTINUAR não teria como saber qual problema resolver.
        let banco = Banco::em_memoria().unwrap();
        let original = Problema::novo(
            60,
            vec![3, 9, 27, 31, 44],
            3,
            RegraCobertura::garantia(4, 2),
            Objetivo::MaximizarCobertura { orcamento: 6 },
        )
        .unwrap();
        banco.abrir_execucao(&original, 555, limite_exemplo()).unwrap();

        let recuperada = banco.execucao_do_problema(&original).unwrap().expect("achou");
        assert_eq!(recuperada.problema, original);
        assert_eq!(recuperada.semente, 555);
        assert_eq!(recuperada.limite.valor, 13);
        assert_eq!(recuperada.limite.metodo, MetodoLimite::Schonheim);
    }

    #[test]
    fn andamento_e_atualizado() {
        let banco = Banco::em_memoria().unwrap();
        let problema = problema_exemplo();
        let execucao = banco.abrir_execucao(&problema, 1, limite_exemplo()).unwrap();

        banco.atualizar_andamento(execucao, 1_234_567, 89.5).unwrap();

        let registro = banco.execucao_por_id(execucao).unwrap().unwrap();
        assert_eq!(registro.iteracoes, 1_234_567);
        assert!((registro.segundos - 89.5).abs() < 1e-9);
    }

    #[test]
    fn o_ciclo_completo_de_parar_e_continuar_preserva_a_solucao() {
        // Ensaia o §15/§16 de ponta a ponta: grava uma solução real, fecha o
        // banco, reabre e confirma que ela volta utilizável.
        let arquivo = std::env::temp_dir().join(format!(
            "sonho-lucido-teste-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&arquivo);

        let problema = problema_exemplo();
        let cobertura = MotorCobertura::novo(&problema).unwrap();
        let mut rascunho = Rascunho::novo();
        let cartelas = cartelas_exemplo();
        let solucao = Solucao::de_cartelas(&cobertura, &cartelas, &mut rascunho);

        {
            let banco = Banco::abrir(&arquivo).unwrap();
            let execucao = banco.abrir_execucao(&problema, 42, limite_exemplo()).unwrap();
            banco
                .gravar_solucao(
                    execucao,
                    &problema,
                    &cartelas,
                    solucao.avaliacao(),
                    solucao.assinatura(),
                    9_000,
                    30.0,
                    Some("guloso"),
                    None,
                    true,
                )
                .unwrap();
            banco.atualizar_andamento(execucao, 9_000, 30.0).unwrap();
        }

        let banco = Banco::abrir(&arquivo).unwrap();
        let execucao = banco.execucao_do_problema(&problema).unwrap().expect("execução salva");
        assert_eq!(execucao.iteracoes, 9_000);

        let melhor = banco.melhor_solucao(execucao.id).unwrap().expect("solução salva");
        let recuperadas = melhor.para_cartelas(&execucao.problema).expect("rótulos válidos");
        let reconstruida = Solucao::de_cartelas(&cobertura, &recuperadas, &mut rascunho);

        assert_eq!(reconstruida.assinatura(), solucao.assinatura());
        assert_eq!(reconstruida.total_descobertos(), solucao.total_descobertos());

        let _ = std::fs::remove_file(&arquivo);
    }

    #[test]
    fn rotulo_fora_do_pool_e_recusado_na_reconstrucao() {
        let problema = problema_exemplo();
        let registro = RegistroSolucao {
            id: 1,
            cartelas: vec![vec![1, 2, 3, 999]],
            avaliacao: avaliacao_exemplo(1, 0),
            assinatura: 0,
            iteracao: 0,
            segundos: 0.0,
            operador: None,
            ancestral: None,
            e_recorde: false,
        };
        assert!(
            registro.para_cartelas(&problema).is_none(),
            "um rótulo fora do pool indica registro de outra configuração"
        );
    }
}
