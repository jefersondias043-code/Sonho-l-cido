//! # motor-web — o motor dentro do navegador
//!
//! Compila o mesmo motor que roda na linha de comando para WebAssembly, sem
//! nenhuma reimplementação: a matemática, os operadores, a aceitação tardia e
//! os pesos adaptativos são exatamente o mesmo código, validado pelos mesmos
//! testes.
//!
//! ## Por que em lotes
//!
//! Na linha de comando o motor roda até alguém pedir para parar. No navegador
//! isso congelaria a página: JavaScript é de thread única, e enquanto o
//! WebAssembly não devolve o controle, nada acontece — nem o botão PARAR
//! responde, nem a tela atualiza.
//!
//! Por isso a interface aqui é [`MotorWeb::avancar`]: roda um lote de
//! iterações, devolve o estado, e quem chama decide se continua. A página fica
//! viva entre um lote e outro. Na prática o lote roda dentro de um *Web
//! Worker*, então nem a thread principal é ocupada.
//!
//! ## Por que tudo passa por JSON
//!
//! A fronteira entre Rust e JavaScript aceita poucos tipos diretamente.
//! Serializar em JSON custa alguns microssegundos por lote — irrelevante frente
//! às dezenas de milhares de iterações que o lote executa — e em troca o
//! contrato fica legível, versionável e fácil de depurar no console do
//! navegador.

use motor_busca::{
    CondicoesDeParada, Configuracao, Controle, Evento, MotivoEncerramento, MotorBusca, Observador,
};
use motor_core::{interpretar_fechamento, Cartela, Objetivo, Problema, RegraCobertura};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Configuração vinda da interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguracaoEntrada {
    pub universo: u32,
    /// Rótulos do pool. A interface pode mandar `1..=p` ou uma seleção esparsa.
    pub pool: Vec<u32>,
    pub cartela: usize,
    /// `j` da regra de cobertura.
    pub alvo: usize,
    /// `t` da regra de cobertura.
    pub intersecao: usize,
    /// Quando presente, troca o objetivo para cobertura máxima sob orçamento.
    #[serde(default)]
    pub orcamento: Option<usize>,
    #[serde(default = "semente_padrao")]
    pub semente: u64,
}

fn semente_padrao() -> u64 {
    0x5150_1A55
}

impl ConfiguracaoEntrada {
    fn para_problema(&self) -> Result<Problema, String> {
        let objetivo = match self.orcamento {
            Some(orcamento) => Objetivo::MaximizarCobertura { orcamento },
            None => Objetivo::MinimizarCartelas,
        };
        Problema::novo(
            self.universo,
            self.pool.clone(),
            self.cartela,
            RegraCobertura::garantia(self.alvo, self.intersecao),
            objetivo,
        )
        .map_err(|e| e.to_string())
    }
}

/// Um recorde, no formato que a interface consome.
#[derive(Debug, Clone, Serialize)]
pub struct Recorde {
    pub cartelas: usize,
    pub cobertura: f64,
    pub redundancia: u64,
    pub iteracao: u64,
    pub operador: String,
}

/// Retrato do motor devolvido a cada lote — alimenta o painel do §27.
#[derive(Debug, Clone, Serialize)]
pub struct Estado {
    pub iteracoes: u64,
    pub aceitas: u64,
    pub recordes: u64,
    pub diversificacoes: u64,

    pub atual_cartelas: usize,
    pub atual_descobertos: usize,

    pub melhor_cartelas: usize,
    pub melhor_cobertura: f64,
    pub melhor_redundancia: u64,
    pub melhor_iteracao: u64,

    pub total_alvos: usize,
    pub meta_cartelas: usize,
    pub elites: usize,

    pub limite_inferior: u64,
    pub metodo_limite: String,
    pub gap: Option<f64>,
    pub optimalidade_provada: bool,

    /// O número da tabela mundial para esta configuração. `None` só fora da
    /// faixa catalogada.
    ///
    /// É sempre um limite **superior**, e a tela precisa tratá-lo como tal:
    /// serve para dizer "faltam 6 para o recorde mundial", nunca para declarar
    /// optimalidade — isso é papel de `limite_inferior`.
    pub melhor_conhecido: Option<u64>,
    /// Verdadeiro quando o número é o melhor conhecido **desta** configuração
    /// (cobertura completa). Falso quando é apenas um teto válido, o que
    /// acontece em garantia parcial — aí ficar abaixo dele é esperado, não
    /// recorde.
    pub referencia_exata: bool,
    /// Verdadeiro quando o melhor conhecido já encostou no limite provado: o
    /// mundo considera essa configuração encerrada.
    pub referencia_resolvida: bool,
    /// Como o ponto de partida foi construído.
    pub origem_do_inicio: String,
    /// Quantas cartelas o usuário trouxe, ou zero se começou sem fechamento.
    ///
    /// A tela precisa dos dois números para ser honesta: "você trouxe 26, o
    /// motor partiu de 21". Sem isso, um fechamento importado que perde para a
    /// construção interna sumiria sem explicação.
    pub cartelas_trazidas: usize,

    /// Recordes encontrados neste lote, em ordem cronológica.
    pub novos_recordes: Vec<Recorde>,
    /// Verdadeiro quando não há mais nada a procurar.
    pub encerrado: bool,
}

/// Tudo que é preciso para retomar a busca depois de fechar a página.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoSalvo {
    pub configuracao: ConfiguracaoEntrada,
    /// Melhor solução, em rótulos do universo.
    pub melhor: Vec<Vec<u32>>,
    pub iteracoes: u64,
}

/// Observador que apenas recolhe os recordes do lote.
///
/// Progresso e diversificação são ignorados de propósito: a interface se
/// atualiza no fim de cada lote, então eventos intermediários só gerariam
/// tráfego pela fronteira sem nada de novo para mostrar.
#[derive(Default)]
struct ColetorDeRecordes {
    recordes: Vec<Recorde>,
}

impl Observador for ColetorDeRecordes {
    fn ao_evento(&mut self, evento: &Evento) {
        if let Evento::NovoRecorde { avaliacao, iteracao, operador, .. } = evento {
            self.recordes.push(Recorde {
                cartelas: avaliacao.cartelas,
                cobertura: avaliacao.cobertura(),
                redundancia: avaliacao.redundancia,
                iteracao: *iteracao,
                operador: operador.to_string(),
            });
        }
    }
}

#[wasm_bindgen]
pub struct MotorWeb {
    interno: MotorBusca,
    configuracao: ConfiguracaoEntrada,
    controle: Controle,
    encerrado: bool,
}

/// A lógica de verdade, em Rust puro.
///
/// Nada aqui depende de `JsValue`, que só existe dentro do navegador e entra em
/// pânico em qualquer outro alvo. Manter a lógica deste lado da fronteira é o
/// que permite testá-la com `cargo test` na máquina de desenvolvimento, em vez
/// de depender de um navegador de testes.
impl MotorWeb {
    /// Cria o motor a partir da configuração em JSON.
    ///
    /// Devolve erro legível quando a configuração é inválida ou grande demais
    /// para a memória do dispositivo — importante no celular, onde o navegador
    /// derruba a página em vez de avisar.
    pub fn construir(configuracao_json: &str) -> Result<MotorWeb, String> {
        let configuracao: ConfiguracaoEntrada = serde_json::from_str(configuracao_json)
            .map_err(|e| format!("configuração ilegível: {e}"))?;

        let problema = configuracao.para_problema()?;

        let config = Configuracao { semente: configuracao.semente, ..Default::default() };
        let interno = MotorBusca::novo(problema, config).map_err(|e| e.to_string())?;

        Ok(MotorWeb { interno, configuracao, controle: Controle::novo(), encerrado: false })
    }

    /// Parte de um fechamento existente (Modo A do §6).
    ///
    /// Recebe as cartelas em rótulos do universo, como o usuário as digitou.
    pub fn semear_com(&mut self, cartelas_json: &str) -> Result<(), String> {
        let rotulos: Vec<Vec<u32>> = serde_json::from_str(cartelas_json)
            .map_err(|e| format!("cartelas ilegíveis: {e}"))?;
        let cartelas = self.converter(&rotulos)?;
        self.interno.semear(&cartelas);
        Ok(())
    }

    /// Parte de um fechamento colado como texto pelo usuário.
    ///
    /// Usa o mesmo interpretador da linha de comando
    /// ([`motor_core::texto::interpretar_fechamento`]), então o que o celular
    /// aceita é exatamente o que o terminal aceita: uma cartela por linha,
    /// números separados por espaço, vírgula, ponto e vírgula, tabulação ou
    /// hífen, com `#` para comentários.
    pub fn semear_com_texto(&mut self, texto: &str) -> Result<(), String> {
        let rotulos = interpretar_fechamento(texto).map_err(|e| e.to_string())?;
        let cartelas = self.converter(&rotulos)?;
        self.interno.semear(&cartelas);
        Ok(())
    }

    /// Retoma uma busca salva anteriormente (§16).
    pub fn retomar_com(&mut self, estado_json: &str) -> Result<(), String> {
        let salvo: EstadoSalvo = serde_json::from_str(estado_json)
            .map_err(|e| format!("estado salvo ilegível: {e}"))?;
        let cartelas = self.converter(&salvo.melhor)?;
        self.interno.retomar_de(&cartelas, salvo.iteracoes);
        Ok(())
    }
}

/// A camada de adaptação para o JavaScript.
///
/// Cada método aqui é uma linha: chama a lógica acima e traduz o erro. Se
/// alguma regra aparecer neste bloco, ela deixou de ser testável — é o sinal de
/// que está no lugar errado.
#[wasm_bindgen]
impl MotorWeb {
    #[wasm_bindgen(constructor)]
    pub fn novo(configuracao_json: &str) -> Result<MotorWeb, JsValue> {
        Self::construir(configuracao_json).map_err(|e| JsValue::from_str(&e))
    }

    pub fn semear(&mut self, cartelas_json: &str) -> Result<(), JsValue> {
        self.semear_com(cartelas_json).map_err(|e| JsValue::from_str(&e))
    }

    pub fn semear_texto(&mut self, texto: &str) -> Result<(), JsValue> {
        self.semear_com_texto(texto).map_err(|e| JsValue::from_str(&e))
    }

    pub fn retomar(&mut self, estado_json: &str) -> Result<(), JsValue> {
        self.retomar_com(estado_json).map_err(|e| JsValue::from_str(&e))
    }

    /// Constrói a solução inicial sem começar a busca.
    ///
    /// Existe para a interface ter o que mostrar. A construção gulosa acontece
    /// dentro da primeira chamada de [`Self::avancar`], e num problema grande
    /// ela sozinha leva segundos — durante os quais a tela ficaria parada, sem
    /// número nenhum, indistinguível de um travamento.
    ///
    /// Separando-a, o usuário vê de imediato quantas cartelas o ponto de
    /// partida usa, e a partir daí acompanha o número cair.
    pub fn preparar(&mut self) -> String {
        let mut coletor = ColetorDeRecordes::default();

        // Teto igual à contagem atual: a construção inicial roda, o laço de
        // busca não chega a dar uma volta.
        let condicoes = CondicoesDeParada {
            max_iteracoes: Some(self.interno.estatisticas().iteracoes),
            max_duracao: None,
            parar_em_optimalidade: true,
        };

        let motivo = self.interno.executar(&self.controle, &condicoes, &mut coletor);
        if motivo == MotivoEncerramento::OptimalidadeProvada {
            // Acontece: em problemas pequenos o guloso já acerta o ótimo.
            self.encerrado = true;
        }

        self.montar_estado(coletor.recordes)
    }

    /// Roda um lote de iterações e devolve o estado resultante em JSON.
    ///
    /// Um lote grande demais trava a interface; pequeno demais gasta mais tempo
    /// atravessando a fronteira do que calculando. A interface calibra isso
    /// sozinha, medindo quanto o lote anterior demorou.
    ///
    /// O parâmetro é `u32`, não `u64`, de propósito: `u64` atravessa a fronteira
    /// como `BigInt`, e um número comum vindo do JavaScript seria recusado com
    /// "Cannot convert to a BigInt" — a busca simplesmente não sairia do lugar.
    /// Quatro bilhões de iterações por lote é folga de sobra, já que um lote
    /// mira duzentos milissegundos.
    pub fn avancar(&mut self, iteracoes: u32) -> String {
        let mut coletor = ColetorDeRecordes::default();

        if !self.encerrado {
            let teto = self
                .interno
                .estatisticas()
                .iteracoes
                .saturating_add(u64::from(iteracoes.max(1)));
            let condicoes = CondicoesDeParada {
                max_iteracoes: Some(teto),
                max_duracao: None,
                parar_em_optimalidade: true,
            };

            let motivo = self.interno.executar(&self.controle, &condicoes, &mut coletor);
            if motivo == MotivoEncerramento::OptimalidadeProvada {
                self.encerrado = true;
            }
        }

        self.montar_estado(coletor.recordes)
    }

    /// Estado atual, sem avançar nada.
    pub fn estado(&self) -> String {
        self.montar_estado(Vec::new())
    }

    /// A melhor solução em rótulos do universo, pronta para exibir ou exportar.
    pub fn melhor(&self) -> String {
        let rotulos = self.melhor_em_rotulos();
        serde_json::to_string(&rotulos).unwrap_or_else(|_| "[]".to_string())
    }

    /// Empacota o que é preciso para continuar depois (§15).
    pub fn exportar(&self) -> String {
        let salvo = EstadoSalvo {
            configuracao: self.configuracao.clone(),
            melhor: self.melhor_em_rotulos(),
            iteracoes: self.interno.estatisticas().iteracoes,
        };
        serde_json::to_string(&salvo).unwrap_or_else(|_| "{}".to_string())
    }

    /// Pesos aprendidos por cada operador, para a interface mostrar o que o
    /// motor descobriu sobre este problema (§36).
    pub fn pesos(&self) -> String {
        let pesos: Vec<(String, f64)> = self
            .interno
            .pesos_dos_operadores()
            .into_iter()
            .map(|(nome, peso)| (nome.to_string(), peso))
            .collect();
        serde_json::to_string(&pesos).unwrap_or_else(|_| "[]".to_string())
    }

    /// Quantos alvos esta configuração gera — a interface usa para avisar antes
    /// de tentar algo que não caberia na memória do celular.
    pub fn total_alvos(&self) -> usize {
        self.interno.cobertura().total_alvos()
    }
}

impl MotorWeb {
    fn converter(&self, rotulos: &[Vec<u32>]) -> Result<Vec<Cartela>, String> {
        let problema = self.interno.problema();
        rotulos
            .iter()
            .map(|linha| {
                let mut cartela = Cartela::vazia();
                for &rotulo in linha {
                    let indice = problema
                        .indice_do_rotulo(rotulo)
                        .ok_or_else(|| format!("o número {rotulo} não está no pool"))?;
                    cartela.inserir(indice);
                }
                Ok(cartela)
            })
            .collect()
    }

    fn melhor_em_rotulos(&self) -> Vec<Vec<u32>> {
        let pool = self.interno.problema().pool();
        self.interno.melhor_cartelas().iter().map(|c| c.rotulos(pool)).collect()
    }

    fn montar_estado(&self, novos_recordes: Vec<Recorde>) -> String {
        let estatisticas = self.interno.estatisticas();
        let melhor = self.interno.melhor_avaliacao();
        let atual = self.interno.avaliacao_atual();
        let limite = self.interno.limite_inferior();

        let estado = Estado {
            iteracoes: estatisticas.iteracoes,
            aceitas: estatisticas.aceitas,
            recordes: estatisticas.recordes,
            diversificacoes: estatisticas.diversificacoes,

            atual_cartelas: atual.cartelas,
            atual_descobertos: atual.descobertos,

            melhor_cartelas: melhor.cartelas,
            melhor_cobertura: melhor.cobertura(),
            melhor_redundancia: melhor.redundancia,
            melhor_iteracao: self.interno.melhor_iteracao(),

            total_alvos: melhor.total_alvos,
            meta_cartelas: self.interno.alvo_cartelas(),
            elites: self.interno.arquivo().quantidade(),

            limite_inferior: limite.valor,
            metodo_limite: limite.metodo.to_string(),
            gap: self.interno.gap(),
            optimalidade_provada: self.interno.optimalidade_provada(),

            melhor_conhecido: self.interno.referencia().map(|c| c.referencia.melhor_conhecido),
            referencia_exata: self
                .interno
                .referencia()
                .is_some_and(|c| c.aplicacao == motor_core::Aplicacao::Exata),
            referencia_resolvida: self
                .interno
                .referencia()
                .is_some_and(|c| c.aplicacao == motor_core::Aplicacao::Exata && c.referencia.resolvido()),
            origem_do_inicio: self.interno.origem_do_inicio().to_string(),
            cartelas_trazidas: self.interno.cartelas_trazidas(),

            novos_recordes,
            encerrado: self.encerrado,
        };

        serde_json::to_string(&estado).unwrap_or_else(|_| "{}".to_string())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn configuracao(pool: usize, cartela: usize, t: usize) -> String {
        serde_json::to_string(&ConfiguracaoEntrada {
            universo: pool as u32,
            pool: (1..=pool as u32).collect(),
            cartela,
            alvo: t,
            intersecao: t,
            orcamento: None,
            semente: 42,
        })
        .unwrap()
    }

    /// Uma configuração em que a busca tem trabalho de verdade.
    ///
    /// C(13,4,2) e C(16,4,2) passaram a sair prontas da construção algébrica,
    /// com optimalidade provada antes da primeira iteração — e um teste de
    /// lotes sobre elas mede zero iterações e zero recordes. Os testes da
    /// mecânica da ponte precisam de um caso sem fórmula fechada, e `t = 3` não
    /// tem nenhuma. E o melhor conhecido no mundo para `C(12,5,3)` (29) ainda
    /// está acima do limite provado (27), então a busca também nunca para
    /// sozinha por optimalidade.
    fn configuracao_para_buscar() -> String {
        configuracao(12, 5, 3)
    }

    fn estado_de(json: &str) -> serde_json::Value {
        serde_json::from_str(json).expect("estado precisa ser JSON válido")
    }

    /// `unwrap_err` exigiria `Debug` em `MotorWeb`, que carrega o motor inteiro.
    fn mensagem_de_erro(resultado: Result<MotorWeb, String>) -> String {
        match resultado {
            Ok(_) => panic!("esperava um erro, veio um motor válido"),
            Err(erro) => erro,
        }
    }

    #[test]
    fn cria_o_motor_a_partir_de_json() {
        let motor = MotorWeb::construir(&configuracao(9, 3, 2)).expect("configuração válida");
        assert_eq!(motor.total_alvos(), 36); // C(9,2)
    }

    #[test]
    fn configuracao_invalida_devolve_erro_legivel() {
        // Cartela maior que o pool.
        let texto = mensagem_de_erro(MotorWeb::construir(&configuracao(5, 9, 2)));
        assert!(texto.contains("pool"), "mensagem foi: {texto}");
    }

    #[test]
    fn json_malformado_devolve_erro_legivel() {
        let texto = mensagem_de_erro(MotorWeb::construir("{isto não é json}"));
        assert!(texto.contains("ilegível"), "mensagem foi: {texto}");
    }

    #[test]
    fn preparar_da_um_ponto_de_partida_sem_iterar() {
        // É o que tira a interface do escuro: um número na tela antes de a
        // busca começar.
        let mut motor = MotorWeb::construir(&configuracao(16, 4, 2)).unwrap();

        let antes = estado_de(&motor.estado());
        assert_eq!(antes["melhor_cartelas"].as_u64().unwrap(), 0, "nada ainda");

        let depois = estado_de(&motor.preparar());
        assert!(
            depois["melhor_cartelas"].as_u64().unwrap() > 0,
            "a construção inicial precisa produzir uma solução"
        );
        assert_eq!(
            depois["iteracoes"].as_u64().unwrap(),
            0,
            "preparar não pode consumir iterações da busca"
        );
        assert_eq!(depois["melhor_cobertura"].as_f64().unwrap(), 1.0);
    }

    #[test]
    fn preparar_e_avancar_se_encaixam() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        let inicial = estado_de(&motor.preparar())["melhor_cartelas"].as_u64().unwrap();

        let depois = estado_de(&motor.avancar(20_000));
        assert!(
            depois["melhor_cartelas"].as_u64().unwrap() <= inicial,
            "a busca só pode melhorar o que a construção entregou"
        );
        assert!(depois["iteracoes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn avancar_progride_e_devolve_estado_completo() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();

        let primeiro = estado_de(&motor.avancar(500));
        assert!(primeiro["iteracoes"].as_u64().unwrap() > 0);
        assert!(primeiro["melhor_cartelas"].as_u64().unwrap() > 0);
        assert_eq!(primeiro["limite_inferior"].as_u64().unwrap(), 27);

        let segundo = estado_de(&motor.avancar(500));
        assert!(
            segundo["iteracoes"].as_u64().unwrap() > primeiro["iteracoes"].as_u64().unwrap(),
            "o segundo lote deveria continuar de onde o primeiro parou"
        );
    }

    #[test]
    fn o_recorde_nunca_piora_entre_lotes() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        let mut anterior = usize::MAX;

        for _ in 0..20 {
            let estado = estado_de(&motor.avancar(2_000));
            let atual = estado["melhor_cartelas"].as_u64().unwrap() as usize;
            assert!(atual <= anterior, "o recorde subiu de {anterior} para {atual}");
            anterior = atual;
        }
    }

    #[test]
    fn os_recordes_do_lote_sao_reportados() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        let estado = estado_de(&motor.avancar(5_000));

        let recordes = estado["novos_recordes"].as_array().unwrap();
        assert!(!recordes.is_empty(), "o primeiro lote sempre encontra melhorias");
        assert!(recordes[0]["operador"].as_str().is_some());
        assert!(recordes[0]["cobertura"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn encerra_e_para_de_trabalhar_quando_prova_a_optimalidade() {
        let mut motor = MotorWeb::construir(&configuracao(9, 3, 2)).unwrap();

        let mut estado = estado_de(&motor.avancar(200_000));
        assert!(estado["optimalidade_provada"].as_bool().unwrap());
        assert!(estado["encerrado"].as_bool().unwrap());
        assert_eq!(estado["melhor_cartelas"].as_u64().unwrap(), 12); // C(9,3,2) = 12

        // Lotes seguintes não devem consumir tempo nenhum.
        let iteracoes = estado["iteracoes"].as_u64().unwrap();
        estado = estado_de(&motor.avancar(200_000));
        assert_eq!(estado["iteracoes"].as_u64().unwrap(), iteracoes);
    }

    #[test]
    fn a_melhor_solucao_sai_em_rotulos_do_universo() {
        let configuracao = serde_json::to_string(&ConfiguracaoEntrada {
            universo: 60,
            pool: vec![7, 13, 21, 34, 42, 55],
            cartela: 3,
            alvo: 2,
            intersecao: 2,
            orcamento: None,
            semente: 1,
        })
        .unwrap();

        let mut motor = MotorWeb::construir(&configuracao).unwrap();
        motor.avancar(3_000);

        let melhor: Vec<Vec<u32>> = serde_json::from_str(&motor.melhor()).unwrap();
        assert!(!melhor.is_empty());
        for cartela in &melhor {
            assert_eq!(cartela.len(), 3);
            for rotulo in cartela {
                assert!(
                    [7, 13, 21, 34, 42, 55].contains(rotulo),
                    "saiu um número fora do pool: {rotulo}"
                );
            }
        }
    }

    #[test]
    fn o_estado_traz_o_melhor_conhecido_no_mundo() {
        // C(13,5,2): a cota de Schönheim dá 8, mas já está provado que 10 é o
        // mínimo, e 10 é também o melhor que alguém já construiu.
        //
        // Sem o limite publicado, o motor acharia as 10 cartelas ótimas em
        // segundos, não reconheceria que terminou, e seguiria procurando para
        // sempre uma solução de 9 que não existe — gastando bateria à toa. É o
        // defeito que este campo corrige, e vale em metade das configurações.
        let motor = MotorWeb::construir(&configuracao(13, 5, 2)).unwrap();
        let estado = estado_de(&motor.estado());

        assert_eq!(estado["limite_inferior"].as_u64().unwrap(), 10);
        assert!(estado["metodo_limite"].as_str().unwrap().contains("provado"));
        assert_eq!(estado["melhor_conhecido"].as_u64().unwrap(), 10);
        assert!(estado["referencia_resolvida"].as_bool().unwrap());
    }

    fn fechamento_de_loteria() -> String {
        // O uso mais comum do aplicativo: pool de 20, cartelas de 6, garantir 4
        // acertos se saírem 6.
        serde_json::to_string(&ConfiguracaoEntrada {
            universo: 20,
            pool: (1..=20).collect(),
            cartela: 6,
            alvo: 6,
            intersecao: 4,
            orcamento: None,
            semente: 42,
        })
        .unwrap()
    }

    #[test]
    fn garantia_parcial_recebe_um_teto_e_nao_um_vazio() {
        // A primeira versão devolvia nada aqui, por a tabela catalogar apenas
        // coberturas completas. Tecnicamente correto e praticamente inútil: é a
        // configuração que a maioria das pessoas usa, e ela ficava sem
        // referência nenhuma.
        //
        // Cobrir todas as 4-uplas resolve esta garantia com folga, então
        // C(20,6,4) é um teto válido e publicado.
        let motor = MotorWeb::construir(&fechamento_de_loteria()).unwrap();
        let estado = estado_de(&motor.estado());

        let teto = estado["melhor_conhecido"].as_u64().expect("há teto publicado");
        assert_eq!(teto, motor_core::referencia::consultar(20, 6, 4).unwrap().melhor_conhecido);

        // Mas é teto, não o número desta configuração.
        assert!(!estado["referencia_exata"].as_bool().unwrap());
        assert!(!estado["referencia_resolvida"].as_bool().unwrap());
    }

    #[test]
    fn o_teto_da_garantia_parcial_nao_vira_limite_inferior() {
        // A confusão que arruinaria tudo: o limite provado de C(20,6,4) vale
        // para a cobertura completa, não para a garantia parcial — que se
        // resolve com muito menos. Usá-lo como piso faria o motor declarar
        // impossível aquilo que ele mesmo acabou de encontrar.
        let mut motor = MotorWeb::construir(&fechamento_de_loteria()).unwrap();
        let estado = estado_de(&motor.preparar());

        let limite = estado["limite_inferior"].as_u64().unwrap();
        let teto = estado["melhor_conhecido"].as_u64().unwrap();
        let achado = estado["melhor_cartelas"].as_u64().unwrap();

        assert!(limite < teto, "o limite inferior ({limite}) não pode ser o teto ({teto})");
        assert!(
            achado >= limite,
            "a solução ({achado}) ficou abaixo do limite inferior ({limite})"
        );
        assert!(
            achado < teto,
            "com garantia parcial a solução ({achado}) deve ficar bem abaixo do teto ({teto})"
        );
        assert!(!estado["optimalidade_provada"].as_bool().unwrap());
    }

    #[test]
    fn a_construcao_algebrica_resolve_antes_da_primeira_iteracao() {
        // C(21,5,2) é o plano projetivo PG(2,4). A busca sozinha parava em 27
        // cartelas depois de 3 segundos; a construção entrega as 21 ótimas antes
        // de qualquer iteração.
        let mut motor = MotorWeb::construir(&configuracao(21, 5, 2)).unwrap();
        let estado = estado_de(&motor.preparar());

        assert_eq!(estado["melhor_cartelas"].as_u64().unwrap(), 21);
        assert_eq!(estado["iteracoes"].as_u64().unwrap(), 0);
        assert!(estado["optimalidade_provada"].as_bool().unwrap());
        assert!(
            estado["origem_do_inicio"].as_str().unwrap().contains("PG(2,4)"),
            "origem foi: {}",
            estado["origem_do_inicio"]
        );
    }

    #[test]
    fn semear_por_texto_aceita_o_que_o_usuario_cola() {
        // O caminho da tela de importar: texto cru, com comentário, separadores
        // variados e espaçamento irregular.
        let mut motor = MotorWeb::construir(&configuracao(13, 4, 2)).unwrap();
        let colado = "# meu fechamento\n01 02 03 04\n5,6,7,8\n  9 - 10 - 11 - 12  \n";

        motor.semear_com_texto(colado).expect("o texto precisa ser aceito");

        // O que este teste garante é a leitura do texto: três linhas, com
        // comentário, separadores variados e espaçamento irregular, viram três
        // cartelas.
        let estado = estado_de(&motor.estado());
        assert_eq!(estado["cartelas_trazidas"].as_u64().unwrap(), 3);

        // Onde a busca de fato começa é outra decisão, e ela é comparativa:
        // três cartelas não cobrem C(13,4,2), enquanto a construção algébrica
        // entrega as 13 ótimas. O motor parte da melhor — trazer um fechamento
        // incompleto não pode piorar o ponto de partida.
        assert_eq!(estado["melhor_cartelas"].as_u64().unwrap(), 13);
        assert_eq!(estado["melhor_cobertura"].as_f64().unwrap(), 1.0);
    }

    #[test]
    fn semear_por_texto_recusa_texto_invalido_com_a_linha() {
        let mut motor = MotorWeb::construir(&configuracao(13, 4, 2)).unwrap();
        let erro = motor.semear_com_texto("1 2 3 4\n5 6 sete 8").unwrap_err();
        assert!(erro.contains("linha 2"), "mensagem foi: {erro}");

        let fora = motor.semear_com_texto("1 2 3 99").unwrap_err();
        assert!(fora.contains("99"), "mensagem foi: {fora}");
    }

    #[test]
    fn exportar_e_retomar_preservam_o_recorde() {
        // É o ciclo que faz a busca sobreviver a fechar a aba do navegador.
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.avancar(3_000);

        let recorde = estado_de(&original.estado())["melhor_cartelas"].as_u64().unwrap();
        let salvo = original.exportar();

        let mut retomado = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        retomado.retomar_com(&salvo).expect("estado salvo precisa ser aceito");

        let estado = estado_de(&retomado.estado());
        assert_eq!(estado["melhor_cartelas"].as_u64().unwrap(), recorde);
        assert!(
            estado["iteracoes"].as_u64().unwrap() >= 3_000,
            "a contagem de iterações precisa continuar, não zerar"
        );
    }

    #[test]
    fn semear_aceita_um_fechamento_do_usuario() {
        let mut motor = MotorWeb::construir(&configuracao(13, 4, 2)).unwrap();
        let fechamento = serde_json::json!([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
        ])
        .to_string();

        motor.semear_com(&fechamento).expect("fechamento válido");
        let estado = estado_de(&motor.estado());
        assert!(estado["iteracoes"].as_u64().unwrap() == 0);
    }

    #[test]
    fn semear_recusa_numero_fora_do_pool() {
        let mut motor = MotorWeb::construir(&configuracao(13, 4, 2)).unwrap();
        let texto = motor.semear_com("[[1,2,3,99]]").unwrap_err();
        assert!(texto.contains("99"), "mensagem foi: {texto}");
    }

    #[test]
    fn os_pesos_dos_operadores_sao_expostos() {
        let mut motor = MotorWeb::construir(&configuracao(16, 4, 2)).unwrap();
        motor.avancar(5_000);

        let pesos: Vec<(String, f64)> = serde_json::from_str(&motor.pesos()).unwrap();
        assert_eq!(pesos.len(), 8, "são oito operadores");
        assert!(pesos.iter().all(|(_, p)| *p > 0.0), "nenhum peso pode zerar");
    }

    #[test]
    fn garantia_parcial_tambem_funciona() {
        let configuracao = serde_json::to_string(&ConfiguracaoEntrada {
            universo: 60,
            pool: (1..=12).collect(),
            cartela: 6,
            alvo: 6,
            intersecao: 4,
            orcamento: None,
            semente: 3,
        })
        .unwrap();

        let mut motor = MotorWeb::construir(&configuracao).unwrap();
        let estado = estado_de(&motor.avancar(300));
        assert!(estado["melhor_cartelas"].as_u64().unwrap() > 0);
        assert!(estado["metodo_limite"].as_str().unwrap().contains("contagem"));
    }
}
