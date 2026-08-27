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
    CondicoesDeParada, Configuracao, Controle, Evento, MotorBusca, Observador,
};
use motor_core::{interpretar_fechamento, Cartela, Objetivo, Problema, RegraCobertura};
use rand_pcg::Pcg64Mcg;
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
    /// `r` — quantas cartelas precisam atender cada resultado possível.
    ///
    /// Ausente vale 1, que é o que toda configuração gravada antes desta opção
    /// existir queria dizer.
    #[serde(default = "uma_premiada")]
    pub premiadas: usize,
    /// Quando presente, troca o objetivo para cobertura máxima sob orçamento.
    #[serde(default)]
    pub orcamento: Option<usize>,
    #[serde(default = "semente_padrao")]
    pub semente: u64,
}

fn semente_padrao() -> u64 {
    0x5150_1A55
}

fn uma_premiada() -> usize {
    1
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
            // Sem `.max(1)` aqui, de propósito. Ele existia e escondia um
            // defeito: `premiadas: 0` virava 1 em silêncio, e a recusa que
            // `Problema::novo` faz para esse caso nunca chegava a rodar. Quem
            // mandou zero pedia uma coisa impossível e recebia outra sem saber.
            //
            // O campo **ausente** continua valendo 1, pelo `serde(default)` —
            // isso é compatibilidade com o que foi gravado antes da opção
            // existir, e é diferente de um zero escrito à mão.
            RegraCobertura::garantia_multipla(self.alvo, self.intersecao, self.premiadas),
            objetivo,
        )
        .map_err(|e| e.to_string())
    }
}

/// Um recorde, no formato que a interface consome.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recorde {
    pub cartelas: usize,
    pub cobertura: f64,
    pub redundancia: u64,
    pub iteracao: u64,
    pub operador: String,
}

/// Uma melhoria encontrada pelo estágio 0, para a tela acompanhar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassoDaConstrucao {
    pub cartelas: usize,
    pub origem: String,
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
    /// O gatilho da diversificação em vigor, em iterações sem recorde.
    ///
    /// Vai no estado para a tela poder mostrar o que o motor está mesmo usando,
    /// e não o que o seletor diz. São coisas diferentes enquanto a mensagem não
    /// chega ao worker, e é a do motor que vale.
    pub gatilho_da_diversificacao: u64,
    /// O teto de trocas por iteração em vigor.
    pub teto_de_trocas: u64,
    /// O esforço gasto ao montar cada cartela, em vigor.
    pub orcamento_por_cartela: u64,
    /// Quantos candidatos o motor avalia por dezena — o orçamento traduzido
    /// para esta configuração, que é o número que diz alguma coisa a quem olha.
    pub candidatos_por_dezena: usize,
    /// Há quantas iterações a busca está sem um recorde.
    ///
    /// Vai em **todo** lote, e não só no retrato de gravação, porque é o
    /// mostrador que torna o seletor de insistência utilizável: sem ele, quem
    /// move o seletor não vê contra o que o valor está sendo comparado.
    pub iteracoes_sem_recorde: u64,
    /// Como o ponto de partida foi construído.
    pub origem_do_inicio: String,
    /// Verdadeiro quando esta busca continua uma sessão salva.
    ///
    /// A tela usa isto para dois fins: dizer que retomou em vez de anunciar um
    /// estágio 0 que não vai acontecer, e provar — nos testes e a olho — que o
    /// Motor Construtor não rodou por cima do fechamento trazido de volta.
    pub sessao_retomada: bool,
    /// Quantas cartelas o usuário trouxe, ou zero se começou sem fechamento.
    ///
    /// A tela precisa dos dois números para ser honesta: "você trouxe 26, o
    /// motor partiu de 21". Sem isso, um fechamento importado que perde para a
    /// construção interna sumiria sem explicação.
    pub cartelas_trazidas: usize,

    /// Recordes encontrados neste lote, em ordem cronológica.
    pub novos_recordes: Vec<Recorde>,

    /// O estado interno do motor, em números.
    ///
    /// Vai em **todo** lote, e de propósito: é o que permite ao histórico gravar
    /// a sessão junto de cada melhoria, em vez de guardar só as cartelas. São
    /// alguns inteiros e os pesos dos operadores — desprezível ao lado do que já
    /// atravessa a fronteira a cada 220 ms, e é a diferença entre continuar um
    /// trabalho salvo e recomeçá-lo com o resultado na mão.
    ///
    /// As cartelas da solução em curso **não** vêm aqui. Num fechamento de dez
    /// mil elas seriam meio megabyte por lote, cinco vezes por segundo. Elas só
    /// saem na exportação, que acontece uma vez.
    pub retrato: RetratoSalvo,
}

/// Uma sessão de otimização inteira, em forma de arquivo.
///
/// ## O que este arquivo precisa ser
///
/// Não uma lista de cartelas. Se alguém deixou o motor trabalhando dez horas e
/// mudou de aparelho, as dez horas têm de ir junto — o que significa carregar o
/// recorde, a solução em curso, a meta que estava sendo perseguida, os
/// contadores e o que o seletor aprendeu sobre quais operadores funcionam
/// **nesta** configuração.
///
/// ## Por que quase tudo tem `default`
///
/// Para o arquivo de hoje abrir amanhã e o de amanhã abrir hoje. Um campo que
/// falta assume o valor neutro em vez de derrubar a leitura, e um campo que
/// sobra é ignorado — é assim que uma versão nova do aplicativo consegue ler uma
/// sessão antiga sem perder o trabalho já feito, que é justamente o que não pode
/// acontecer aqui.
///
/// O campo `iteracoes` na raiz é o formato anterior, que só guardava
/// configuração, melhor e contagem. Ele continua sendo lido: quem tem um arquivo
/// daquele tempo não fica de fora.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoSalvo {
    pub configuracao: ConfiguracaoEntrada,
    /// Melhor solução, em rótulos do universo.
    pub melhor: Vec<Vec<u32>>,
    /// Contagem do formato anterior. Vale quando `motor.iteracoes` é zero.
    #[serde(default)]
    pub iteracoes: u64,
    /// A solução que a busca estava mexendo. Pode ser pior que o recorde, e pode
    /// nem cobrir tudo — é o ponto de exploração, e é o que separa "retomar" de
    /// "voltar ao último recorde".
    #[serde(default)]
    pub atual: Vec<Vec<u32>>,
    #[serde(default)]
    pub motor: RetratoSalvo,
    /// O arquivo de elites: soluções boas e estruturalmente diferentes entre si.
    ///
    /// Fica fora do retrato porque é a única parte grande — cada elite tem o
    /// tamanho de um fechamento. Vai num orçamento de cartelas, e o que não
    /// couber fica de fora começando pelas piores.
    #[serde(default)]
    pub elites: Vec<Vec<Vec<u32>>>,
    /// As melhorias encontradas, em ordem. Não volta para dentro do motor —
    /// serve para a tela contar a história do trabalho a quem o recebeu.
    #[serde(default)]
    pub historico: Vec<Recorde>,
}

/// O estado interno do motor, em números.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RetratoSalvo {
    #[serde(default)]
    pub iteracoes: u64,
    #[serde(default)]
    pub aceitas: u64,
    #[serde(default)]
    pub recordes: u64,
    #[serde(default)]
    pub diversificacoes: u64,
    #[serde(default)]
    pub duplicadas_evitadas: u64,
    #[serde(default)]
    pub segundos: f64,
    #[serde(default)]
    pub alvo_cartelas: usize,
    #[serde(default)]
    pub passo_atual: usize,
    #[serde(default)]
    pub iteracao_da_meta: u64,
    #[serde(default)]
    pub melhor_iteracao: u64,
    /// Pesos do seletor, na ordem dos operadores. Uma lista de outro tamanho é
    /// recusada inteira pelo motor — vem de uma versão com outros operadores, e
    /// aplicá-la em parte daria pesos trocados.
    #[serde(default)]
    pub pesos_dos_operadores: Vec<f64>,

    /// Iterações desde o último recorde — o relógio da diversificação.
    #[serde(default)]
    pub iteracoes_sem_recorde: u64,
    /// Identidade estrutural do recorde.
    #[serde(default)]
    pub melhor_assinatura: u64,
    /// A memória do critério de aceitação, achatada: cada custo são três
    /// números em sequência. Uma lista, e não uma de objetos, porque são 500
    /// custos e os nomes dos campos repetidos custariam mais que os números.
    #[serde(default)]
    pub memoria_aceitacao: Vec<u64>,
    #[serde(default)]
    pub passo_da_aceitacao: u64,
    /// O segmento que o seletor ainda não fechou.
    #[serde(default)]
    pub pontos_do_segmento: Vec<f64>,
    #[serde(default)]
    pub usos_do_segmento: Vec<u32>,
    #[serde(default)]
    pub passo_no_segmento: u64,
    /// O gerador de aleatórios, no ponto em que parou — em **texto**, e não em
    /// número. Ausente num arquivo antigo, e aí a retomada semeia de novo.
    ///
    /// O estado tem 128 bits e o JavaScript guarda números em ponto flutuante
    /// de 64. Medido: gravado como número, o estado atravessava o `JSON.parse`
    /// da interface como `3.221040305871867e+38` e o que voltava não era o que
    /// tinha saído — um gerador restaurado errado é pior que um gerador novo,
    /// porque parece continuidade e não é.
    #[serde(default)]
    pub gerador: Option<String>,
}

/// O estado do gerador, em texto decimal.
///
/// `rand_pcg` não expõe o estado, só o serializa. A volta é direta, porque
/// `Pcg64Mcg::new` recebe o estado; a ida passa por aqui.
fn gerador_para_texto(rng: &Pcg64Mcg) -> Option<String> {
    let bruto = serde_json::to_string(rng).ok()?;
    let inicio = bruto.find(':')? + 1;
    let fim = bruto.rfind('}')?;
    let numero = bruto.get(inicio..fim)?.trim();
    numero.parse::<u128>().ok().map(|n| n.to_string())
}

/// O caminho de volta. Texto que não seja um estado válido devolve `None`, e a
/// retomada segue com o gerador recém-semeado.
fn texto_para_gerador(texto: &str) -> Option<Pcg64Mcg> {
    texto.trim().parse::<u128>().ok().map(Pcg64Mcg::new)
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

        Ok(MotorWeb { interno, configuracao, controle: Controle::novo() })
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

    /// Parte do fechamento que já vem pronto dentro do aplicativo.
    ///
    /// Idêntico a [`Self::semear_com`], exceto pelo rótulo que aparece na tela:
    /// o usuário precisa saber que aquelas cartelas vieram prontas, e não de
    /// algo que o motor construiu na hora.
    pub fn semear_do_banco_com(&mut self, cartelas_json: &str) -> Result<(), String> {
        let rotulos: Vec<Vec<u32>> = serde_json::from_str(cartelas_json)
            .map_err(|e| format!("cartelas ilegíveis: {e}"))?;
        let cartelas = self.converter(&rotulos)?;
        self.interno.semear_como(&cartelas, "fechamento do aplicativo");
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

    /// Retoma uma sessão salva anteriormente (§16).
    ///
    /// O que chega aqui já passou pela validação da tela, mas a checagem é
    /// refeita: um arquivo que promete cartelas de 17 dezenas e traz uma de 16
    /// viraria um fechamento furado, e um fechamento furado é uma garantia falsa
    /// na mão de quem apostou.
    pub fn retomar_com(&mut self, estado_json: &str) -> Result<(), String> {
        let salvo: EstadoSalvo = serde_json::from_str(estado_json)
            .map_err(|e| format!("estado salvo ilegível: {e}"))?;

        if salvo.melhor.is_empty() {
            return Err("a sessão não traz nenhuma cartela".to_string());
        }
        let tamanho = self.configuracao.cartela;
        if let Some(fora) = salvo.melhor.iter().find(|c| c.len() != tamanho) {
            return Err(format!(
                "a sessão promete cartelas de {tamanho} dezenas e traz uma de {}",
                fora.len()
            ));
        }
        let melhor = self.converter(&salvo.melhor)?;
        // A solução em curso pode faltar, ou vir de uma configuração que não é
        // esta. Nos dois casos a busca continua pelo recorde, que é o que
        // carrega o trabalho — não vale recusar o arquivo inteiro por causa dela.
        let atual = if salvo.atual.iter().all(|c| c.len() == tamanho) {
            self.converter(&salvo.atual).unwrap_or_default()
        } else {
            Vec::new()
        };

        // O formato anterior guardava a contagem na raiz. Quem tem um arquivo
        // daquele tempo continua retomando com as iterações certas.
        let mut retrato = motor_busca::RetratoDoMotor {
            iteracoes: salvo.motor.iteracoes.max(salvo.iteracoes),
            aceitas: salvo.motor.aceitas,
            recordes: salvo.motor.recordes,
            diversificacoes: salvo.motor.diversificacoes,
            duplicadas_evitadas: salvo.motor.duplicadas_evitadas,
            segundos: salvo.motor.segundos,
            alvo_cartelas: salvo.motor.alvo_cartelas,
            passo_atual: salvo.motor.passo_atual,
            iteracao_da_meta: salvo.motor.iteracao_da_meta,
            melhor_iteracao: salvo.motor.melhor_iteracao,
            pesos_dos_operadores: salvo.motor.pesos_dos_operadores.clone(),

            iteracoes_sem_recorde: salvo.motor.iteracoes_sem_recorde,
            melhor_assinatura: salvo.motor.melhor_assinatura,
            // A memória chega achatada, três números por custo. Um resto
            // diferente de zero é arquivo truncado: o motor recusa uma memória
            // de tamanho errado, então mandar o pedaço não estragaria nada —
            // mas descartar aqui diz a verdade sobre o que se tem.
            memoria_aceitacao: salvo
                .motor
                .memoria_aceitacao
                .chunks_exact(3)
                .map(|c| motor_core::ChaveCusto { primario: c[0], secundario: c[1], terciario: c[2] })
                .collect(),
            passo_da_aceitacao: salvo.motor.passo_da_aceitacao,
            pontos_do_segmento: salvo.motor.pontos_do_segmento.clone(),
            usos_do_segmento: salvo.motor.usos_do_segmento.clone(),
            passo_no_segmento: salvo.motor.passo_no_segmento,
            gerador: salvo.motor.gerador.as_deref().and_then(texto_para_gerador),
        };
        if !retrato.segundos.is_finite() || retrato.segundos < 0.0 {
            retrato.segundos = 0.0;
        }

        // As elites entram depois da sessão, e não antes: `repor_elites` cita o
        // recorde como ancestral de cada uma, e o recorde só existe depois de
        // `retomar_sessao`. Uma elite que não caiba nesta configuração é
        // descartada em silêncio, como a solução em curso — o arquivo continua
        // valendo pelo que traz de certo.
        self.interno.retomar_sessao(&melhor, &atual, &retrato);

        let elites: Vec<Vec<Cartela>> = salvo
            .elites
            .iter()
            .filter(|e| e.iter().all(|c| c.len() == tamanho))
            .filter_map(|e| self.converter(e).ok())
            .collect();
        self.interno.repor_elites(&elites);

        Ok(())
    }

    /// Empacota a sessão inteira, para gravar num arquivo.
    fn exportar_sessao(&self, historico: Vec<Recorde>) -> String {
        let pool = self.interno.problema().pool();
        let retrato = self.interno.retrato();
        let salvo = EstadoSalvo {
            configuracao: self.configuracao.clone(),
            melhor: self.melhor_em_rotulos(),
            iteracoes: retrato.iteracoes,
            atual: self.interno.cartelas_atuais().iter().map(|c| c.rotulos(pool)).collect(),
            motor: RetratoSalvo {
                iteracoes: retrato.iteracoes,
                aceitas: retrato.aceitas,
                recordes: retrato.recordes,
                diversificacoes: retrato.diversificacoes,
                duplicadas_evitadas: retrato.duplicadas_evitadas,
                segundos: retrato.segundos,
                alvo_cartelas: retrato.alvo_cartelas,
                passo_atual: retrato.passo_atual,
                iteracao_da_meta: retrato.iteracao_da_meta,
                melhor_iteracao: retrato.melhor_iteracao,
                pesos_dos_operadores: retrato.pesos_dos_operadores,

                iteracoes_sem_recorde: retrato.iteracoes_sem_recorde,
                melhor_assinatura: retrato.melhor_assinatura,
                memoria_aceitacao: retrato
                    .memoria_aceitacao
                    .iter()
                    .flat_map(|c| [c.primario, c.secundario, c.terciario])
                    .collect(),
                passo_da_aceitacao: retrato.passo_da_aceitacao,
                pontos_do_segmento: retrato.pontos_do_segmento,
                usos_do_segmento: retrato.usos_do_segmento,
                passo_no_segmento: retrato.passo_no_segmento,
                gerador: retrato.gerador.as_ref().and_then(gerador_para_texto),
            },
            elites: self
                .interno
                .elites_ate(motor_busca::TETO_DE_ELITES)
                .iter()
                .map(|e| e.iter().map(|c| c.rotulos(pool)).collect())
                .collect(),
            historico,
        };
        serde_json::to_string(&salvo).unwrap_or_else(|_| "{}".to_string())
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

    pub fn semear_do_banco(&mut self, cartelas_json: &str) -> Result<(), JsValue> {
        self.semear_do_banco_com(cartelas_json).map_err(|e| JsValue::from_str(&e))
    }

    pub fn semear_texto(&mut self, texto: &str) -> Result<(), JsValue> {
        self.semear_com_texto(texto).map_err(|e| JsValue::from_str(&e))
    }

    pub fn retomar(&mut self, estado_json: &str) -> Result<(), JsValue> {
        self.retomar_com(estado_json).map_err(|e| JsValue::from_str(&e))
    }

    /// Verdadeiro quando este motor foi carregado de uma sessão salva.
    ///
    /// É por aqui que a tela decide entre os dois caminhos: sessão retomada vai
    /// direto para a busca, otimização nova passa pelo estágio 0. Perguntar ao
    /// motor, e não guardar a resposta do lado do JavaScript, é o que faz os
    /// dois lados concordarem sempre.
    pub fn sessao_retomada(&self) -> bool {
        self.interno.sessao_retomada()
    }

    /// **Estágio 0** — o Motor Construtor.
    ///
    /// Procura construir direto a menor solução que conseguir, em vez de montar
    /// uma qualquer para a busca reduzir depois. Devolve, a cada melhoria, uma
    /// linha com quantas cartelas e de que construção veio — é o que a tela
    /// mostra enquanto o estágio corre.
    ///
    /// O orçamento vem de fora porque quem o conhece é a tela: num celular
    /// alguns segundos, num computador o tempo que a pessoa quiser dar.
    ///
    /// Numa sessão retomada este estágio não roda: devolve a lista vazia sem
    /// gastar um segundo do orçamento. O fechamento salvo é o ponto de partida,
    /// e construir outro por cima dele seria trocar o trabalho do usuário por
    /// trabalho novo.
    pub fn construir_partida(&mut self, segundos: u32) -> String {
        if self.interno.sessao_retomada() {
            return "[]".to_string();
        }

        let mut passos: Vec<PassoDaConstrucao> = Vec::new();
        self.interno.construir_partida(
            std::time::Duration::from_secs(segundos.max(1) as u64),
            &mut |achado| {
                passos.push(PassoDaConstrucao {
                    cartelas: achado.cartelas.len(),
                    origem: achado.origem.clone(),
                });
            },
        );
        serde_json::to_string(&passos).unwrap_or_else(|_| "[]".to_string())
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
            parar_em_optimalidade: false,
        };

        self.interno.executar(&self.controle, &condicoes, &mut coletor);
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
    pub fn avancar(&mut self, iteracoes: u32, max_ms: u32) -> String {
        let mut coletor = ColetorDeRecordes::default();

        let teto = self
            .interno
            .estatisticas()
            .iteracoes
            .saturating_add(u64::from(iteracoes.max(1)));
        let condicoes = CondicoesDeParada {
            max_iteracoes: Some(teto),
            // O lote é limitado pelos dois: contagem e tempo.
            //
            // A contagem sozinha não basta, e a medição mostra por quê: num
            // pool de 25 com jogos de 20, uma iteração varre 3,2 milhões de
            // alvos e leva quase dois segundos. O lote de abertura de 250
            // iterações levaria um quarto de hora dentro de uma única chamada —
            // e como o worker só lê mensagens entre chamadas, Pausar e Encerrar
            // ficavam sem efeito todo esse tempo, com a tela parada em zero.
            //
            // O teto de tempo devolve o controle ao worker mesmo quando uma
            // única iteração é cara. A calibragem por contagem continua, para o
            // caso barato, onde ela evita atravessar a fronteira à toa.
            max_duracao: Some(std::time::Duration::from_millis(u64::from(max_ms.max(1)))),
            // Nunca encerrar sozinho. Quem decide quando parar é o usuário.
            //
            // A versão anterior parava ao provar optimalidade, e a intenção era
            // boa: não gastar bateria procurando o que não existe. Mas ela
            // decidia por quem está usando, e escondia o caso que mais importa
            // aqui — nos dez fechamentos da Lotinha cujo mínimo é problema em
            // aberto, "ótimo" quer dizer apenas "o melhor que se conhece", e
            // parar ali é justamente desistir onde ainda há o que achar.
            //
            // O motor segue. A tela diz quando a optimalidade está provada,
            // para a decisão de parar ser informada — mas a decisão continua
            // sendo de quem está olhando.
            parar_em_optimalidade: false,
        };

        self.interno.executar(&self.controle, &condicoes, &mut coletor);
        self.montar_estado(coletor.recordes)
    }

    /// Troca o gatilho da diversificação com o motor rodando.
    ///
    /// A tela oferece isto num seletor porque não existe um número certo para
    /// todas as configurações — e porque quem acompanha a busca percebe antes de
    /// qualquer medição quando ela parou de render. Nada do trabalho é
    /// descartado: muda o limiar, e o relógio que o persegue recomeça.
    pub fn ajustar_diversificacao(&mut self, iteracoes: u32) {
        self.interno.ajustar_diversificacao(u64::from(iteracoes));
    }

    /// Troca o teto de trocas por iteração com o motor rodando.
    ///
    /// A descida por troca move uma dezena de uma cartela para outra. É
    /// acabamento: quanto dele cabe em cada tentativa decide se o motor faz
    /// poucas tentativas lapidadas ou muitas tentativas rápidas — e qual dos
    /// dois rende depende da configuração e do momento.
    pub fn ajustar_teto_de_trocas(&mut self, trocas: u32) {
        self.interno.ajustar_teto_de_trocas(u64::from(trocas));
    }

    /// Troca o esforço gasto ao montar cada cartela, com o motor rodando.
    ///
    /// A outra metade do custo de uma iteração: o teto de trocas manda no que
    /// acontece depois de remontar, este manda no que acontece durante.
    pub fn ajustar_orcamento_por_cartela(&mut self, orcamento: u32) {
        self.interno.ajustar_orcamento_por_cartela(u64::from(orcamento));
    }

    /// Estado atual, sem avançar nada.
    pub fn estado(&self) -> String {
        self.montar_estado(Vec::new())
    }

    /// O retrato **inteiro** do motor, para o histórico gravar.
    ///
    /// Separado do estado que vai em cada lote por uma questão de peso: a
    /// memória do critério de aceitação são 500 custos, e mandá-la cinco vezes
    /// por segundo seria quinze quilobytes por lote atravessando a fronteira
    /// para nada. Quem grava chama isto — uma vez a cada trinta segundos, e a
    /// cada recorde novo.
    ///
    /// Sem as cartelas: nem as do recorde, que a interface já tem, nem as das
    /// elites, que só cabem no arquivo exportado.
    pub fn retrato_de_sessao(&self) -> String {
        let r = self.interno.retrato();
        let salvo = RetratoSalvo {
            iteracoes: r.iteracoes,
            aceitas: r.aceitas,
            recordes: r.recordes,
            diversificacoes: r.diversificacoes,
            duplicadas_evitadas: r.duplicadas_evitadas,
            segundos: r.segundos,
            alvo_cartelas: r.alvo_cartelas,
            passo_atual: r.passo_atual,
            iteracao_da_meta: r.iteracao_da_meta,
            melhor_iteracao: r.melhor_iteracao,
            pesos_dos_operadores: r.pesos_dos_operadores,
            iteracoes_sem_recorde: r.iteracoes_sem_recorde,
            melhor_assinatura: r.melhor_assinatura,
            memoria_aceitacao: r
                .memoria_aceitacao
                .iter()
                .flat_map(|c| [c.primario, c.secundario, c.terciario])
                .collect(),
            passo_da_aceitacao: r.passo_da_aceitacao,
            pontos_do_segmento: r.pontos_do_segmento,
            usos_do_segmento: r.usos_do_segmento,
            passo_no_segmento: r.passo_no_segmento,
            gerador: r.gerador.as_ref().and_then(gerador_para_texto),
        };
        serde_json::to_string(&salvo).unwrap_or_else(|_| "{}".to_string())
    }

    /// As elites que cabem num orçamento de cartelas, para o histórico gravar.
    ///
    /// Separadas do retrato porque são a única parte grande — cada elite tem o
    /// tamanho de um fechamento — e porque os dois destinos têm orçamentos
    /// diferentes. O arquivo exportado sai uma vez e vai por mensagem; o
    /// histórico mora no armazenamento do navegador, que é de alguns megabytes
    /// e guarda vários trabalhos. Quem conhece o próprio limite é quem chama.
    ///
    /// Vale a pena mesmo apertado: medido, retomar sem o arquivo de elites
    /// gastava doze mil iterações sem achar nada, onde a corrida contínua caiu
    /// de 307 para 263 cartelas no mesmo intervalo. A diversificação reinicia de
    /// uma elite metade das vezes, e sem arquivo essa metade vira reconstrução
    /// do zero — que é ir para longe sem levar nada.
    pub fn elites_para_gravar(&self, teto_de_cartelas: u32) -> String {
        let pool = self.interno.problema().pool();
        let elites: Vec<Vec<Vec<u32>>> = self
            .interno
            .elites_ate(teto_de_cartelas as usize)
            .iter()
            .map(|e| e.iter().map(|c| c.rotulos(pool)).collect())
            .collect();
        serde_json::to_string(&elites).unwrap_or_else(|_| "[]".to_string())
    }

    /// A melhor solução em rótulos do universo, pronta para exibir ou exportar.
    pub fn melhor(&self) -> String {
        let rotulos = self.melhor_em_rotulos();
        serde_json::to_string(&rotulos).unwrap_or_else(|_| "[]".to_string())
    }

    /// Empacota a sessão inteira, para continuar depois — aqui ou noutro
    /// aparelho (§15).
    pub fn exportar(&self) -> String {
        self.exportar_sessao(Vec::new())
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

        let retrato_interno = self.interno.retrato();
        let estado = Estado {
            retrato: RetratoSalvo {
                iteracoes: retrato_interno.iteracoes,
                aceitas: retrato_interno.aceitas,
                recordes: retrato_interno.recordes,
                diversificacoes: retrato_interno.diversificacoes,
                duplicadas_evitadas: retrato_interno.duplicadas_evitadas,
                segundos: retrato_interno.segundos,
                alvo_cartelas: retrato_interno.alvo_cartelas,
                passo_atual: retrato_interno.passo_atual,
                iteracao_da_meta: retrato_interno.iteracao_da_meta,
                melhor_iteracao: retrato_interno.melhor_iteracao,
                pesos_dos_operadores: retrato_interno.pesos_dos_operadores,
                // O estado pesado da busca — a memória da aceitação, o gerador,
                // o segmento do seletor — fica de fora **deste** retrato, que
                // atravessa a fronteira cinco vezes por segundo. Ele sai por
                // [`Self::retrato_de_sessao`], que quem grava chama uma vez a
                // cada trinta segundos. São quinze quilobytes: desprezíveis uma
                // vez, caros trezentas.
                ..Default::default()
            },
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
            gatilho_da_diversificacao: self.interno.gatilho_da_diversificacao(),
            teto_de_trocas: self.interno.teto_de_trocas(),
            orcamento_por_cartela: self.interno.orcamento_por_cartela(),
            candidatos_por_dezena: self.interno.candidatos_por_dezena(),
            iteracoes_sem_recorde: self.interno.iteracoes_sem_recorde(),
            origem_do_inicio: self.interno.origem_do_inicio().to_string(),
            sessao_retomada: self.interno.sessao_retomada(),
            cartelas_trazidas: self.interno.cartelas_trazidas(),

            novos_recordes,
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
            premiadas: 1,
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
    fn a_sessao_exportada_atravessa_o_json_inteira() {
        // A promessa do arquivo: dez horas de trabalho num aparelho continuam
        // sendo dez horas no outro. Aqui a travessia é curta, mas é a mesma —
        // exportar, jogar fora o motor, ler o arquivo num motor novo.
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..6 {
            original.avancar(4_000, 60_000);
        }
        let arquivo = original.exportar();
        let antes = estado_de(&original.estado());

        let bruto: serde_json::Value = serde_json::from_str(&arquivo).unwrap();
        assert!(bruto["atual"].as_array().is_some_and(|c| !c.is_empty()), "falta a solução em curso");
        assert!(bruto["motor"]["iteracoes"].as_u64().unwrap() > 0, "faltam as iterações");
        assert!(
            bruto["motor"]["pesos_dos_operadores"].as_array().unwrap().len() > 1,
            "faltam os pesos aprendidos"
        );

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&arquivo).expect("a sessão precisa ser aceita");
        let depois = estado_de(&outro.estado());

        assert_eq!(depois["melhor_cartelas"], antes["melhor_cartelas"], "o recorde tem de vir junto");
        assert_eq!(depois["iteracoes"], antes["iteracoes"], "as iterações têm de vir junto");
        assert_eq!(depois["recordes"], antes["recordes"]);
    }

    /// Uma sessão retomada tem prioridade sobre o Motor Construtor.
    #[test]
    fn uma_sessao_retomada_atravessa_o_estagio_zero_sem_perder_uma_cartela() {
        // A viagem inteira, em miniatura: trabalhar um pouco, exportar, jogar
        // fora o motor, e voltar num motor novo — que é exatamente o que
        // acontece ao trocar de aparelho.
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..6 {
            original.avancar(4_000, 60_000);
        }
        let arquivo = original.exportar();
        let salvas: Vec<Vec<u32>> =
            serde_json::from_value(serde_json::from_str::<serde_json::Value>(&arquivo).unwrap()["melhor"].clone())
                .unwrap();
        let antes = estado_de(&original.estado());

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&arquivo).expect("a sessão precisa ser aceita");

        assert!(outro.sessao_retomada(), "o motor tem de saber que veio de um arquivo");

        // O estágio 0 não roda, e não gasta nem um segundo do orçamento.
        let passos = outro.construir_partida(1);
        assert_eq!(passos, "[]", "o Motor Construtor não pode rodar sobre uma sessão retomada");

        let depois = estado_de(&outro.estado());
        assert_eq!(
            depois["melhor_cartelas"], antes["melhor_cartelas"],
            "o recorde importado tem de continuar sendo o recorde"
        );
        assert_eq!(
            depois["atual_cartelas"], antes["atual_cartelas"],
            "a solução em curso tem de ser a que veio no arquivo, e não uma construída"
        );
        assert_eq!(depois["sessao_retomada"], serde_json::json!(true));
        assert_eq!(
            depois["origem_do_inicio"], serde_json::json!("sessão importada"),
            "a tela não pode anunciar uma construção gulosa que não houve"
        );

        // E cartela por cartela: nenhuma foi trocada por uma construção nova.
        let voltaram: Vec<Vec<u32>> = serde_json::from_str(&outro.melhor()).unwrap();
        assert_eq!(voltaram, salvas, "o fechamento tem de voltar idêntico");

        // A partir daqui a redução continua normal, e a partir do número
        // importado — não de um pior.
        for _ in 0..6 {
            outro.avancar(4_000, 60_000);
        }
        let reduzindo = estado_de(&outro.estado());
        assert!(
            reduzindo["melhor_cartelas"].as_u64().unwrap()
                <= antes["melhor_cartelas"].as_u64().unwrap(),
            "o recorde só pode cair a partir do que foi importado"
        );
        assert!(
            reduzindo["iteracoes"].as_u64().unwrap() > antes["iteracoes"].as_u64().unwrap(),
            "e a busca tem de continuar somando trabalho ao que já havia"
        );
    }

    /// A outra metade da regra: sem sessão retomada, o estágio 0 roda.
    ///
    /// Sem este teste, desligar o construtor para todo mundo passaria pelo teste
    /// acima sem nenhum sinal.
    #[test]
    fn uma_otimizacao_nova_continua_passando_pelo_estagio_zero() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        motor.preparar();

        assert!(!motor.sessao_retomada(), "não veio de arquivo nenhum");

        let passos: Vec<serde_json::Value> =
            serde_json::from_str(&motor.construir_partida(1)).unwrap();
        assert!(!passos.is_empty(), "o estágio 0 tem de rodar numa otimização nova");
        assert!(passos.last().unwrap()["origem"].as_str().is_some_and(|o| !o.is_empty()));
    }

    /// O gerador atravessa o arquivo **em texto**, e é por isso que ele volta.
    #[test]
    fn o_gerador_atravessa_sem_perder_bit() {
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        original.avancar(2_000, 60_000);

        let arquivo = original.exportar();
        // A prova de que precisa ser texto: passar por `Value`, que é o que a
        // interface faz com `JSON.parse`, tem de deixar o campo intacto.
        let como_a_tela_ve: serde_json::Value = serde_json::from_str(&arquivo).unwrap();
        let texto = como_a_tela_ve["motor"]["gerador"].as_str().expect("o gerador vai em texto");
        assert!(
            texto.chars().all(|c| c.is_ascii_digit()),
            "o estado tem de ser um inteiro em decimal, e veio {texto}"
        );

        let voltou = super::texto_para_gerador(texto).expect("o texto tem de virar gerador");
        assert_eq!(
            super::gerador_para_texto(&voltou).as_deref(),
            Some(texto),
            "a ida e a volta têm de fechar no mesmo estado, dígito por dígito"
        );
        assert_eq!(super::texto_para_gerador("nem número"), None, "lixo não vira gerador");

        // E o arquivo reescrito pela interface continua sendo aceito, com o
        // estado inteiro do outro lado.
        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&como_a_tela_ve.to_string()).expect("a ida e volta pela tela vale");

        let antes = estado_de(&original.retrato_de_sessao());
        let depois = estado_de(&outro.retrato_de_sessao());
        // Tudo que é inteiro tem de bater dígito por dígito. Os pesos dos
        // operadores ficam de fora desta comparação de propósito: são `f64`, e
        // atravessar o `JSON.parse` da interface pode mexer no último bit —
        // diferença que não muda decisão nenhuma, e que exigir seria exigir do
        // teste uma precisão que o formato não promete.
        for campo in [
            "iteracoes", "aceitas", "recordes", "diversificacoes", "duplicadas_evitadas",
            "alvo_cartelas", "passo_atual", "iteracao_da_meta", "melhor_iteracao",
            "iteracoes_sem_recorde", "melhor_assinatura", "memoria_aceitacao",
            "passo_da_aceitacao", "usos_do_segmento", "passo_no_segmento", "gerador",
        ] {
            assert_eq!(depois[campo], antes[campo], "o campo {campo} não atravessou o arquivo");
        }
    }

    /// O arquivo carrega o estado da busca, e não só o resultado dela.
    #[test]
    fn a_sessao_leva_o_trabalho_do_motor_e_nao_so_as_cartelas() {
        // A diferença que este teste guarda: um motor que recebe as cartelas
        // certas e o resto zerado é um motor novo segurando um bom fechamento.
        // Foi o que se mediu antes desta versão — a retomada divergia da
        // corrida contínua em menos de duzentas iterações, decidindo diferente
        // porque não sabia mais o que sabia.
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..12 {
            original.avancar(4_000, 60_000);
        }

        let arquivo = original.exportar();
        let bruto: serde_json::Value = serde_json::from_str(&arquivo).unwrap();
        let m = &bruto["motor"];

        assert!(
            m["memoria_aceitacao"].as_array().unwrap().len() >= 3,
            "falta a memória do critério de aceitação, que decide cada iteração"
        );
        assert_eq!(
            m["memoria_aceitacao"].as_array().unwrap().len() % 3,
            0,
            "a memória vai achatada, três números por custo"
        );
        assert!(!m["gerador"].is_null(), "falta o estado do gerador de aleatórios");
        assert!(
            m["pontos_do_segmento"].as_array().unwrap().len() > 1,
            "falta o segmento em formação do seletor"
        );
        assert!(
            m["melhor_assinatura"].as_u64().unwrap() > 0,
            "falta a identidade estrutural do recorde"
        );

        // Agora o outro aparelho: tudo tem de chegar.
        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&arquivo).expect("a sessão precisa ser aceita");

        let antes = estado_de(&original.retrato_de_sessao());
        let depois = estado_de(&outro.retrato_de_sessao());

        // Tudo que é inteiro bate dígito por dígito. Os pesos dos operadores
        // ficam fora desta comparação: são `f64` escritos em texto, e a volta
        // pode mexer no último bit — diferença que não muda decisão nenhuma, e
        // exigi-la seria exigir do formato uma precisão que ele não promete.
        for campo in [
            "iteracoes", "aceitas", "recordes", "diversificacoes", "duplicadas_evitadas",
            "alvo_cartelas", "passo_atual", "iteracao_da_meta", "melhor_iteracao",
            "iteracoes_sem_recorde", "melhor_assinatura", "memoria_aceitacao",
            "passo_da_aceitacao", "usos_do_segmento", "passo_no_segmento", "gerador",
        ] {
            assert_eq!(depois[campo], antes[campo], "o campo {campo} não atravessou o arquivo");
        }

        // E os pesos chegam, com a precisão que um `f64` em texto permite.
        let (a, b) = (
            antes["pesos_dos_operadores"].as_array().unwrap(),
            depois["pesos_dos_operadores"].as_array().unwrap(),
        );
        assert_eq!(a.len(), b.len(), "faltam pesos do outro lado");
        for (x, y) in a.iter().zip(b) {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            assert!((x - y).abs() <= x.abs() * 1e-12, "peso mudou de verdade: {x} contra {y}");
        }
    }

    /// As elites viajam: é delas que sai o material da recombinação.
    #[test]
    fn o_arquivo_de_elites_atravessa_a_sessao() {
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..12 {
            original.avancar(4_000, 60_000);
        }
        let quantas = estado_de(&original.estado())["elites"].as_u64().unwrap();
        assert!(quantas > 0, "sem elites no original não há o que este teste observe");

        let arquivo = original.exportar();
        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&arquivo).unwrap();

        assert_eq!(
            estado_de(&outro.estado())["elites"].as_u64().unwrap(),
            quantas,
            "o arquivo de elites tem de chegar inteiro do outro lado"
        );
    }

    /// Um arquivo sem os campos novos continua abrindo, como o de antes.
    #[test]
    fn um_arquivo_sem_o_estado_da_busca_ainda_e_aceito() {
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..6 {
            original.avancar(4_000, 60_000);
        }
        let mut bruto: serde_json::Value = serde_json::from_str(&original.exportar()).unwrap();
        let motor = bruto["motor"].as_object_mut().unwrap();
        for campo in [
            "memoria_aceitacao", "passo_da_aceitacao", "gerador", "iteracoes_sem_recorde",
            "melhor_assinatura", "pontos_do_segmento", "usos_do_segmento", "passo_no_segmento",
        ] {
            motor.remove(campo);
        }
        bruto.as_object_mut().unwrap().remove("elites");

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro
            .retomar_com(&bruto.to_string())
            .expect("um arquivo de antes destes campos continua valendo");

        let estado = estado_de(&outro.estado());
        assert!(
            estado["melhor_cartelas"].as_u64().unwrap() > 0,
            "e continua retomando o fechamento, que é o que ele traz"
        );
        assert_eq!(estado["elites"].as_u64().unwrap(), 0, "sem elites no arquivo, sem elites aqui");
    }

    /// Uma memória do tamanho errado não pode entrar pela metade.
    #[test]
    fn uma_memoria_de_aceitacao_truncada_e_recusada_sem_derrubar_o_arquivo() {
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        original.avancar(4_000, 60_000);
        let mut bruto: serde_json::Value = serde_json::from_str(&original.exportar()).unwrap();

        // Metade da memória: descreve outra busca, e aplicá-la seria pior que
        // não aplicar nada.
        let memoria = bruto["motor"]["memoria_aceitacao"].as_array().unwrap().clone();
        bruto["motor"]["memoria_aceitacao"] =
            serde_json::Value::Array(memoria[..memoria.len() / 2].to_vec());

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&bruto.to_string()).expect("o arquivo continua valendo pelo resto");
        assert!(estado_de(&outro.estado())["melhor_cartelas"].as_u64().unwrap() > 0);
    }

    #[test]
    fn a_sessao_retomada_soma_trabalho_em_vez_de_recomecar() {
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        for _ in 0..6 {
            original.avancar(4_000, 60_000);
        }
        let arquivo = original.exportar();
        let iteracoes_gravadas =
            estado_de(&original.estado())["iteracoes"].as_u64().unwrap();

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&arquivo).unwrap();
        outro.preparar();
        outro.avancar(2_000, 60_000);

        let agora = estado_de(&outro.estado())["iteracoes"].as_u64().unwrap();
        assert!(
            agora > iteracoes_gravadas,
            "retomar tem de somar às {iteracoes_gravadas} anteriores, e ficou em {agora}"
        );
    }

    #[test]
    fn um_arquivo_do_formato_anterior_continua_sendo_lido() {
        // Só configuração, melhor e a contagem na raiz — como o aplicativo
        // gravava antes de a sessão inteira existir. Quem tem um desses não pode
        // ficar sem poder retomar.
        let mut original = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        original.preparar();
        original.avancar(3_000, 60_000);
        let completo: serde_json::Value = serde_json::from_str(&original.exportar()).unwrap();

        let antigo = serde_json::json!({
            "configuracao": completo["configuracao"],
            "melhor": completo["melhor"],
            "iteracoes": 1234,
        });

        let mut outro = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        outro.retomar_com(&antigo.to_string()).expect("o formato anterior precisa ser aceito");
        assert_eq!(estado_de(&outro.estado())["iteracoes"].as_u64().unwrap(), 1234);
    }

    #[test]
    fn uma_sessao_com_cartelas_do_tamanho_errado_e_recusada() {
        // Um fechamento furado gravado aqui vira garantia falsa na mão de quem
        // apostou. A recusa precisa dizer o que está errado, não só falhar.
        let mut motor = MotorWeb::construir(&configuracao(12, 5, 3)).unwrap();
        motor.preparar();
        let mut arquivo: serde_json::Value =
            serde_json::from_str(&motor.exportar()).unwrap();
        arquivo["melhor"][0] = serde_json::json!([1, 2, 3, 4]);

        let erro = MotorWeb::construir(&configuracao(12, 5, 3))
            .unwrap()
            .retomar_com(&arquivo.to_string())
            .expect_err("cartela de tamanho errado tem de ser recusada");
        assert!(erro.contains("5 dezenas") && erro.contains("4"), "erro pouco claro: {erro}");
    }

    #[test]
    fn uma_sessao_sem_cartelas_e_recusada() {
        let arquivo = serde_json::json!({
            "configuracao": serde_json::from_str::<serde_json::Value>(&configuracao(12, 5, 3)).unwrap(),
            "melhor": [],
        });
        let erro = MotorWeb::construir(&configuracao(12, 5, 3))
            .unwrap()
            .retomar_com(&arquivo.to_string())
            .expect_err("sessão vazia tem de ser recusada");
        assert!(erro.contains("nenhuma cartela"), "erro pouco claro: {erro}");
    }

    #[test]
    fn o_estagio_zero_roda_depois_de_uma_partida_ja_semeada() {
        // A sequência exata do aplicativo: semeia o fechamento pronto, prepara
        // para a tela ter um número, e só então roda o estágio 0 por cima. É o
        // caminho em que o motor estourou no navegador.
        // A forma exata do aplicativo: universo de 25, dezoito dezenas
        // escolhidas **esparsas** entre elas, jogos de 17 cobrindo todo grupo de
        // 15. O pool esparso é o que diferencia este caminho.
        let escolhidas: Vec<u32> = vec![1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25];
        let config = serde_json::to_string(&ConfiguracaoEntrada {
            universo: 25,
            pool: escolhidas.clone(),
            cartela: 17,
            alvo: 15,
            intersecao: 15,
            premiadas: 1,
            orcamento: None,
            semente: 42,
        })
        .unwrap();
        let mut motor = MotorWeb::construir(&config).unwrap();
        // Pelo mesmo caminho do aplicativo: o fechamento pronto entra por
        // `semear_do_banco`, não por `semear`.
        let pronto = serde_json::to_string(&vec![escolhidas[1..].to_vec()]).unwrap();
        motor.semear_do_banco_com(&pronto).unwrap();
        motor.preparar();
        let passos = motor.construir_partida(1);
        let lidos: Vec<PassoDaConstrucao> = serde_json::from_str(&passos).unwrap();
        assert!(!lidos.is_empty(), "o estágio 0 precisa registrar ao menos uma construção");

        let estado = estado_de(&motor.estado());
        assert!(estado["melhor_cartelas"].as_u64().unwrap() > 0);
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

        let depois = estado_de(&motor.avancar(20_000, 600_000));
        assert!(
            depois["melhor_cartelas"].as_u64().unwrap() <= inicial,
            "a busca só pode melhorar o que a construção entregou"
        );
        assert!(depois["iteracoes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn avancar_progride_e_devolve_estado_completo() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();

        let primeiro = estado_de(&motor.avancar(500, 600_000));
        assert!(primeiro["iteracoes"].as_u64().unwrap() > 0);
        assert!(primeiro["melhor_cartelas"].as_u64().unwrap() > 0);
        assert_eq!(primeiro["limite_inferior"].as_u64().unwrap(), 27);

        let segundo = estado_de(&motor.avancar(500, 600_000));
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
            let estado = estado_de(&motor.avancar(2_000, 600_000));
            let atual = estado["melhor_cartelas"].as_u64().unwrap() as usize;
            assert!(atual <= anterior, "o recorde subiu de {anterior} para {atual}");
            anterior = atual;
        }
    }

    #[test]
    fn os_recordes_do_lote_sao_reportados() {
        let mut motor = MotorWeb::construir(&configuracao_para_buscar()).unwrap();
        let estado = estado_de(&motor.avancar(5_000, 600_000));

        let recordes = estado["novos_recordes"].as_array().unwrap();
        assert!(!recordes.is_empty(), "o primeiro lote sempre encontra melhorias");
        assert!(recordes[0]["operador"].as_str().is_some());
        assert!(recordes[0]["cobertura"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn a_configuracao_recusa_exigencias_impossiveis() {
        // A fronteira é JSON, e JSON aceita qualquer número. Estes três casos
        // precisam virar erro legível em vez de pânico ou de uma busca que
        // nunca faz sentido — um pânico dentro do WebAssembly derruba o worker
        // inteiro, com uma mensagem que não ajuda ninguém.
        let com = |premiadas: usize, intersecao: usize| {
            serde_json::to_string(&ConfiguracaoEntrada {
                universo: 25,
                pool: (1..=18).collect(),
                cartela: 17,
                alvo: 15,
                intersecao,
                premiadas,
                orcamento: None,
                semente: 1,
            })
            .unwrap()
        };

        assert!(
            MotorWeb::construir(&com(0, 15)).is_err(),
            "exigir zero cartelas premiadas não descreve problema nenhum"
        );
        assert!(
            MotorWeb::construir(&com(1, 16)).is_err(),
            "garantir mais acertos do que o sorteio tem é impossível"
        );

        // E o caso válido continua válido, com a exigência chegando ao motor.
        let motor = MotorWeb::construir(&com(3, 15)).expect("três premiadas é pedido legítimo");
        let estado = estado_de(&motor.estado());
        // Três cartelas por sorteio triplicam a cota de contagem: 816/136 = 6,
        // e o piso passa a 18.
        assert_eq!(estado["limite_inferior"].as_u64().unwrap(), 18);
    }

    #[test]
    fn premiadas_ausente_no_json_vale_um() {
        // Toda configuração gravada antes desta opção existir não tem o campo.
        // Ler como zero recusaria o histórico inteiro de quem já usava.
        let sem_campo = r#"{"universo":25,"pool":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],
                            "cartela":17,"alvo":15,"intersecao":15,"semente":1}"#;
        let motor = MotorWeb::construir(sem_campo).expect("configuração antiga continua válida");
        let estado = estado_de(&motor.estado());
        assert_eq!(estado["limite_inferior"].as_u64().unwrap(), 16, "uma cartela por sorteio");
    }

    #[test]
    fn quem_manda_no_lote_e_o_relogio_e_nao_a_contagem() {
        // O defeito medido, e o mais grave desta auditoria: num pool de 25 com
        // jogos de 20, uma iteração varre 3,2 milhões de alvos e leva quase dois
        // segundos. O lote pedia 250 iterações e não tinha teto de tempo, então
        // uma única chamada a `avancar` levava um quarto de hora. Como o worker
        // só lê mensagens entre chamadas, a tela ficava parada em zero e os
        // botões Pausar e Encerrar não tinham efeito nenhum.
        //
        // A configuração aqui é pequena de propósito — este teste roda em build
        // de depuração, onde a de 25 dezenas levaria minutos por iteração. O que
        // se prova é o mecanismo: pedindo um milhão de iterações com teto de
        // 150 ms, quem tem de mandar é o relógio.
        let mut motor = MotorWeb::construir(&configuracao(12, 5, 3)).unwrap();
        motor.preparar();
        let antes = estado_de(&motor.estado())["iteracoes"].as_u64().unwrap();

        let inicio = std::time::Instant::now();
        let estado = estado_de(&motor.avancar(1_000_000, 150));
        let decorrido = inicio.elapsed();

        let feitas = estado["iteracoes"].as_u64().unwrap() - antes;
        assert!(
            decorrido < std::time::Duration::from_secs(5),
            "o lote ignorou o teto de 150 ms e levou {decorrido:?}"
        );
        assert!(
            feitas < 1_000_000,
            "o lote correu o milhão de iterações pedido em vez de parar no tempo"
        );
        assert!(feitas > 0, "o lote não fez iteração nenhuma");
    }

    #[test]
    fn nao_para_sozinho_quando_prova_a_optimalidade() {
        // A versão anterior encerrava aqui, e a intenção era boa: não gastar
        // bateria procurando o que não existe. Mas ela decidia por quem está
        // usando — e o motor do celular não tem esse direito. Quem manda parar
        // é quem está olhando a tela.
        //
        // O que a optimalidade provada muda é o que a tela *diz*, não se o
        // motor continua. Isso importa especialmente na Lotinha, onde o limite
        // inferior é fraco: nos dez fechamentos cujo mínimo é problema aberto,
        // "ótimo" significaria apenas "o melhor que se conhece", e parar ali
        // seria desistir justamente onde ainda há o que achar.
        let mut motor = MotorWeb::construir(&configuracao(9, 3, 2)).unwrap();

        let estado = estado_de(&motor.avancar(200_000, 600_000));
        assert!(estado["optimalidade_provada"].as_bool().unwrap());
        assert_eq!(estado["melhor_cartelas"].as_u64().unwrap(), 12); // C(9,3,2) = 12

        // E o lote seguinte trabalha, em vez de devolver na hora.
        let iteracoes = estado["iteracoes"].as_u64().unwrap();
        let depois = estado_de(&motor.avancar(50_000, 600_000));
        assert!(
            depois["iteracoes"].as_u64().unwrap() > iteracoes,
            "o motor parou sozinho: as iterações ficaram em {iteracoes}"
        );

        // Continuar procurando nunca pode custar o recorde já alcançado.
        assert_eq!(depois["melhor_cartelas"].as_u64().unwrap(), 12);
        assert!(depois["optimalidade_provada"].as_bool().unwrap());
    }

    #[test]
    fn a_melhor_solucao_sai_em_rotulos_do_universo() {
        let configuracao = serde_json::to_string(&ConfiguracaoEntrada {
            universo: 60,
            pool: vec![7, 13, 21, 34, 42, 55],
            cartela: 3,
            alvo: 2,
            intersecao: 2,
            premiadas: 1,
            orcamento: None,
            semente: 1,
        })
        .unwrap();

        let mut motor = MotorWeb::construir(&configuracao).unwrap();
        motor.avancar(3_000, 600_000);

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
            premiadas: 1,
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
        original.avancar(3_000, 600_000);

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
        motor.avancar(5_000, 600_000);

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
            premiadas: 1,
            orcamento: None,
            semente: 3,
        })
        .unwrap();

        let mut motor = MotorWeb::construir(&configuracao).unwrap();
        let estado = estado_de(&motor.avancar(300, 600_000));
        assert!(estado["melhor_cartelas"].as_u64().unwrap() > 0);
        assert!(estado["metodo_limite"].as_str().unwrap().contains("contagem"));
    }
}
