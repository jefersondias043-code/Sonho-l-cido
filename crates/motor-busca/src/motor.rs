//! O laço persistente — §7, §8 e §14 do documento conceitual.
//!
//! ## As duas realidades
//!
//! O motor mantém, sempre, duas soluções distintas:
//!
//! - **`melhor`** é o recorde. Nunca é destruído por exploração. É a resposta
//!   que o usuário leva para casa.
//! - **`atual`** é onde a busca está agora. Pode ser pior, muito pior, ou
//!   estruturalmente irreconhecível. Isso não é regressão — é exploração.
//!
//! Essa separação é o que permite ao motor sair de uma solução excelente para
//! investigar outra região, sem arriscar nada.
//!
//! ## A estratégia: perseguir uma cardinalidade fixa
//!
//! "Minimizar cartelas" é um objetivo vago demais para guiar uma busca local.
//! O motor faz diferente: fixa uma meta — *"resolver com exatamente N
//! cartelas"* — e passa a minimizar apenas os alvos descobertos. Assim que
//! chega a zero descobertos, registra o recorde e baixa a meta para `N - 1`.
//!
//! É a mesma abordagem dos melhores solucionadores de covering design, e a
//! razão é que ela transforma um problema de otimização difuso em uma sequência
//! de problemas de viabilidade bem definidos, cada um com um gradiente claro
//! para seguir.
//!
//! O mesmo mecanismo atende o objetivo de cobertura máxima sob orçamento: a
//! meta simplesmente fica parada no orçamento, em vez de descer.

use std::time::Duration;

// `std::time::Instant` entra em pânico no navegador: em `wasm32-unknown-unknown`
// não existe relógio do sistema. `web-time` oferece a mesma interface apoiada em
// `performance.now()`, então o laço do motor não precisa saber onde está
// rodando.
#[cfg(target_arch = "wasm32")]
use web_time::Instant;

#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

use motor_core::{
    limite_inferior, referencia, semente_algebrica, Avaliacao, Cartela, ChaveCusto, Consulta,
    LimiteInferior, MotorCobertura, Objetivo, Problema, Solucao,
};
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64Mcg;

use crate::adaptativo::{Recompensas, SeletorAdaptativo};
use crate::aceitacao::AceitacaoTardia;
use crate::arquivo::{ArquivoElites, Elite};
use crate::construcao::{construir_do_zero, podar, reparar};
use crate::controle::{
    CondicoesDeParada, Controle, Estatisticas, Evento, MotivoEncerramento, Observador,
};
use crate::oficina::Oficina;
use crate::operadores::{destruir, Operador};

/// A cada quantas iterações o relógio é consultado.
///
/// Quantas iterações no máximo entre duas leituras do relógio.
///
/// O passo é **adaptado ao custo medido**, e este é apenas o teto. O motivo
/// está numa medição: um pool de 25 com jogos de 20 faz meia iteração por
/// segundo — cada uma varre 3,2 milhões de alvos. Com um passo fixo de 16, o
/// relógio só era consultado a cada 32 segundos, e um lote pedido para durar
/// 220 ms durava minutos. No navegador isso aparecia como aplicativo travado:
/// tela parada em zero iterações, Pausar e Encerrar sem efeito.
///
/// Ler `Instant::now` custa dezenas de nanossegundos. Adaptando o passo à
/// velocidade observada, a leitura fica rara onde as iterações são baratas e
/// vira uma por iteração onde são caras — que é exatamente onde ela precisa
/// acontecer.
const MAXIMO_ENTRE_LEITURAS_DO_RELOGIO: u64 = 1024;

/// A cada quantas iterações aceitas uma solução é oferecida ao arquivo.
///
/// Arquivar toda iteração encheria o arquivo de vizinhos quase idênticos e
/// gastaria tempo em comparações de distância; amostrar preserva a diversidade
/// que interessa a um custo desprezível.
const ACEITAS_ENTRE_ARQUIVAMENTOS: u64 = 64;

/// Teto de trocas de ponto numa única iteração.
///
/// Sem ele, o orçamento de trabalho sozinho daria centenas de milhares de
/// trocas numa iteração de configuração pequena, e a busca deixaria de ser
/// interativa — o recorde só apareceria de minuto em minuto.
const TETO_DE_TROCAS: u64 = 5_000;

/// Como a meta de cardinalidade desce depois de cada recorde.
///
/// A meta é um **teto**: `reparar` não acrescenta cartelas além dela, e
/// `encolher_ate` corta a solução atual até ela. Descer a meta é, portanto,
/// apertar a busca, e não afrouxá-la — é por isso que mirar direto no limite
/// inferior não é "dar liberdade ao motor", e sim exigir de uma vez o que ele
/// ainda não sabe fazer.
///
/// ## O que foi medido, para não se medir de novo
///
/// As três alternativas ao passo de uma foram testadas nos fechamentos da
/// Lotinha, com seis sementes por caso e placar contado par a par:
///
/// | política                  | resultado |
/// |---------------------------|-----------|
/// | meta no piso              | **zero recordes** em `(21,17)`, `(22,17)`, `(23,18)` e `(25,20)` |
/// | passo dobrando por limiar fixo | perde 3×1 em `(22,17)` e 4×0 em `(23,18)`, e perde o melhor-de-seis nos dois |
/// | passo auto-calibrado      | idêntico ao unitário em `(21,17)`; perde 5×1 em `(22,17)` |
///
/// O padrão do passo dobrando é sempre o mesmo: um salto que fecha, e depois a
/// busca trava numa meta que não alcança. Em `(22,17)` ela para em exatamente
/// 3.489 nas seis sementes, enquanto o passo de uma faz 39 quedas de uma
/// cartela e chega a 3.483. O limiar de recuo é escrito em iterações, e numa
/// configuração onde cada iteração varre milhões de alvos ele nunca dispara —
/// mas ajustá-lo só muda a escala em que o mesmo travamento acontece.
///
/// O passo de uma mantém a solução sempre perto de viável, que é a condição
/// para a busca por cardinalidade fixa funcionar. As outras políticas ficam
/// disponíveis para quem quiser medir de novo, e não como padrão.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassoDaMeta {
    /// Uma cartela por vez. Mantém a solução sempre perto de viável.
    Unitario,
    /// Dobra o passo enquanto os recordes vêm rápido e volta a um quando a meta
    /// resiste. É o que dá quedas de várias cartelas quando há oportunidade, sem
    /// pagar o preço de um corte grande onde não há.
    Adaptativo {
        /// Teto do passo, para o dobro não virar um salto ao piso.
        maximo: usize,
        /// Até quantas iterações depois de fixar a meta um recorde conta como
        /// "veio fácil" e autoriza dobrar o passo.
        iteracoes_para_dobrar: u64,
        /// Quantas iterações sem recorde antes de desistir de uma meta ambiciosa
        /// e afrouxá-la. Sem isto o salto vira compromisso: a meta que não fecha
        /// trava a busca, porque o passo só é reavaliado no recorde seguinte —
        /// que é justamente o que deixou de vir.
        iteracoes_para_recuar: u64,
    },
    /// Mira direto no limite inferior conhecido.
    AteOPiso,
}

#[derive(Debug, Clone)]
pub struct Configuracao {
    pub semente: u64,
    /// `L` da aceitação tardia: quantas iterações de tolerância a pioras.
    pub memoria_aceitacao: usize,
    /// Iterações sem recorde antes de forçar diversificação (§35).
    pub iteracoes_ate_diversificar: u64,
    /// Ruído da reconstrução gulosa, em `0.0..=1.0`.
    pub ruido_reconstrucao: f64,
    /// Teto de operações sobre alvos gasto para construir uma cartela.
    ///
    /// Impede que configurações de garantia parcial, onde cada avaliação
    /// percorre milhares de alvos, derrubem a taxa de iteração em duas ordens
    /// de grandeza. Veja [`crate::construcao::candidatos_por_posicao`].
    pub orcamento_por_cartela: u64,
    pub capacidade_por_faixa: usize,
    pub maximo_de_faixas: usize,
    pub distancia_minima_elites: f64,
    pub segmento_adaptativo: u64,
    pub fator_reacao: f64,
    pub recompensas: Recompensas,
    /// Teto de operações sobre alvos gasto na descida por troca de ponto.
    ///
    /// Cada troca mexe em duas cartelas, então custa `2 · C(k,t)` operações. O
    /// teto vira um número de trocas em [`MotorBusca::novo`], e é o que impede
    /// uma configuração de jogos grandes — onde uma cartela sozinha atende
    /// 170.544 sorteios — de gastar minutos numa única iteração.
    pub orcamento_de_troca: u64,
    /// Iterações entre dois eventos de progresso.
    pub intervalo_progresso: u64,
    /// Como a meta de cardinalidade desce depois de cada recorde.
    pub passo_da_meta: PassoDaMeta,
}

impl Default for Configuracao {
    fn default() -> Self {
        Self {
            semente: 0x5150_1A55,
            memoria_aceitacao: 500,
            iteracoes_ate_diversificar: 50_000,
            ruido_reconstrucao: 0.25,
            orcamento_por_cartela: 30_000,
            orcamento_de_troca: 4_000_000,
            capacidade_por_faixa: 12,
            maximo_de_faixas: 8,
            distancia_minima_elites: 0.30,
            segmento_adaptativo: 500,
            fator_reacao: 0.20,
            recompensas: Recompensas::default(),
            intervalo_progresso: 100_000,
            passo_da_meta: PassoDaMeta::Unitario,
        }
    }
}

/// O estado do motor que sobrevive a uma exportação.
///
/// ## O que carrega, e o que não
///
/// Carrega o que é **caro de reconquistar e barato de guardar**: os contadores,
/// a meta em curso, o passo da meta e os pesos que o seletor aprendeu sobre
/// quais operadores funcionam nesta configuração. Um trabalho de dez horas
/// aprendeu isso, e sem estes números quem retoma recomeça com todos os
/// operadores empatados.
///
/// **Não** carrega o arquivo de elites. É a decisão que mais pesa aqui, e é de
/// tamanho: o arquivo guarda até 96 soluções inteiras, e num fechamento de
/// 10.051 cartelas isso são quase um milhão de cartelas — dezessete megabytes
/// num arquivo que a pessoa vai mandar por mensagem. O que as dez horas
/// produziram é o **melhor fechamento**, e esse vai inteiro; o arquivo de elites
/// é andaime da busca, e o motor o reconstrói em minutos.
///
/// Também não carrega o estado do gerador de números aleatórios. Ele é semeado
/// de novo na retomada, o que muda quais caminhos a busca tenta a seguir — e não
/// há nada a preservar aí, porque nenhum caminho é melhor que outro antes de ser
/// tentado.
#[derive(Debug, Clone, PartialEq)]
pub struct RetratoDoMotor {
    pub iteracoes: u64,
    pub aceitas: u64,
    pub recordes: u64,
    pub diversificacoes: u64,
    pub duplicadas_evitadas: u64,
    /// Tempo já gasto na busca, em segundos.
    pub segundos: f64,
    /// A cardinalidade que a busca perseguia quando parou.
    pub alvo_cartelas: usize,
    /// Quantas cartelas a última meta desceu de uma vez.
    pub passo_atual: usize,
    /// Em que iteração a meta em curso foi fixada.
    pub iteracao_da_meta: u64,
    /// Em que iteração o recorde atual apareceu.
    pub melhor_iteracao: u64,
    /// Pesos do seletor, na ordem de [`Operador::TODOS`].
    pub pesos_dos_operadores: Vec<f64>,
}

pub struct MotorBusca {
    problema: Problema,
    cobertura: MotorCobertura,
    config: Configuracao,
    limite: LimiteInferior,

    /// Onde a busca está agora. Pode piorar livremente.
    atual: Solucao,

    /// O recorde. Guardado apenas como lista de cartelas: reconstruir o estado
    /// de cobertura completo custaria O(total_alvos) a cada melhoria, e ele só
    /// é necessário quando alguém pede a solução.
    melhor: Vec<Cartela>,
    melhor_avaliacao: Avaliacao,
    melhor_chave: ChaveCusto,
    melhor_assinatura: u64,
    melhor_iteracao: u64,

    /// Cardinalidade que a busca persegue no momento.
    alvo_cartelas: usize,
    /// Em que iteração a meta atual foi fixada. Mede se o recorde veio fácil.
    iteracao_da_meta: u64,
    /// Quantas cartelas a última meta desceu de uma vez.
    passo_atual: usize,

    /// Quantos candidatos avaliar por posição ao montar uma cartela. Derivado
    /// do orçamento e do custo real de avaliação desta configuração.
    max_candidatos: usize,
    /// Quantas trocas de ponto cabem no orçamento desta configuração.
    trocas_por_iteracao: u64,

    arquivo: ArquivoElites,
    seletor: SeletorAdaptativo,
    aceitacao: AceitacaoTardia,

    rng: Pcg64Mcg,
    oficina: Oficina,
    /// Cartelas da elite escolhida para recombinação nesta iteração.
    elite_atual: Vec<Cartela>,

    /// O que a tabela mundial tem a dizer sobre esta configuração — o número
    /// exato quando é uma cobertura completa, um teto válido quando é garantia
    /// parcial. `None` só fora da faixa catalogada.
    referencia: Option<Consulta>,

    /// Como o ponto de partida foi obtido — "construção gulosa", "plano
    /// projetivo PG(2,4)", "fechamento importado". Aparece na tela.
    origem_do_inicio: String,

    /// Quantas cartelas o usuário trouxe, quando trouxe alguma.
    ///
    /// Guardado à parte do ponto de partida escolhido, porque a tela precisa
    /// poder dizer as duas coisas: "você trouxe 26, parti de 21". Sem esse
    /// número, um fechamento importado que perde para a construção interna
    /// desapareceria sem explicação.
    cartelas_trazidas: usize,

    /// O sinal de parada da execução em curso, quando há uma.
    ///
    /// Existe porque as construções sem teto — a partida e a diversificação —
    /// podem levar dezenas de segundos num pool grande, e durante elas o
    /// `executar` não chega a reavaliar nada. Sem esta alça, quem tocasse em
    /// Pausar ou Encerrar esperaria a construção inteira terminar.
    parada_em_curso: Option<Controle>,

    estatisticas: Estatisticas,
    duracao_acumulada: Duration,
    iteracoes_sem_recorde: u64,
    comecou: bool,
}

impl MotorBusca {
    pub fn novo(
        problema: Problema,
        config: Configuracao,
    ) -> Result<Self, motor_core::ErroViabilidade> {
        let cobertura = MotorCobertura::novo(&problema)?;
        let limite = limite_inferior(&cobertura);
        let atual = Solucao::vazia(&cobertura);
        let avaliacao_vazia = atual.avaliacao();

        let arquivo = ArquivoElites::novo(
            config.capacidade_por_faixa,
            config.maximo_de_faixas,
            config.distancia_minima_elites,
        );
        let seletor = SeletorAdaptativo::novo(
            Operador::TODOS.len(),
            config.fator_reacao,
            config.segmento_adaptativo,
        );
        let aceitacao = AceitacaoTardia::nova(config.memoria_aceitacao, ChaveCusto::PIOR);
        let rng = Pcg64Mcg::seed_from_u64(config.semente);
        let max_candidatos =
            crate::construcao::candidatos_por_posicao(&cobertura, config.orcamento_por_cartela);
        let custo_de_uma_troca = 2 * cobertura.viabilidade().alvos_por_cartela.max(1);
        let trocas_por_iteracao =
            (config.orcamento_de_troca / custo_de_uma_troca).clamp(1, TETO_DE_TROCAS);

        let (tamanho_pool, tamanho_cartela) =
            (problema.tamanho_pool(), problema.tamanho_cartela());
        let (alvo, intersecao) = (problema.regra().alvo, problema.regra().intersecao);

        Ok(Self {
            problema,
            cobertura,
            config,
            limite,
            atual,
            melhor: Vec::new(),
            melhor_avaliacao: avaliacao_vazia,
            melhor_chave: ChaveCusto::PIOR,
            melhor_assinatura: 0,
            melhor_iteracao: 0,
            alvo_cartelas: usize::MAX,
            iteracao_da_meta: 0,
            passo_atual: 1,
            max_candidatos,
            trocas_por_iteracao,
            arquivo,
            seletor,
            aceitacao,
            rng,
            oficina: Oficina::nova(),
            elite_atual: Vec::new(),
            referencia: referencia::consultar_problema(
                tamanho_pool,
                tamanho_cartela,
                alvo,
                intersecao,
            ),
            origem_do_inicio: String::new(),
            cartelas_trazidas: 0,
            parada_em_curso: None,
            estatisticas: Estatisticas::default(),
            duracao_acumulada: Duration::ZERO,
            iteracoes_sem_recorde: 0,
            comecou: false,
        })
    }

    /// Parte de um fechamento já existente (Modo A do §6).
    ///
    /// As cartelas fornecidas são o ponto de partida, não uma restrição: o
    /// motor pode remover, substituir e criar outras livremente (§32).
    pub fn semear(&mut self, cartelas: &[Cartela]) {
        self.semear_como(cartelas, "fechamento importado");
    }

    /// Como [`Self::semear`], dizendo de onde as cartelas vieram.
    ///
    /// O rótulo aparece na tela, e a diferença importa: "partiu do seu
    /// fechamento" e "partiu de um fechamento pronto" contam histórias
    /// diferentes para quem está olhando.
    pub fn semear_como(&mut self, cartelas: &[Cartela], origem: &str) {
        // Semear de novo não descarta o que já foi escolhido: a solução atual
        // entra como mais um candidato. É o que permite oferecer duas fontes em
        // sequência — um fechamento pronto e outro que o usuário trouxe — sem
        // que a segunda apague a primeira.
        let ja_havia_partida = self.comecou;
        self.comecou = true;
        self.cartelas_trazidas += cartelas.len();
        self.escolher_partida(cartelas, ja_havia_partida, origem);
        self.consolidar_inicio();
    }

    /// **Estágio 0** — constrói o melhor ponto de partida que conseguir.
    ///
    /// Roda antes de qualquer iteração da busca, e é o oposto dela: em vez de
    /// partir de uma solução qualquer e ir tirando cartelas, procura construir
    /// direto uma solução pequena. O que sai daqui é o que a busca recebe.
    ///
    /// Quanto isso vale, medido com vinte segundos de orçamento e comparado com
    /// a partida que o motor montava antes:
    ///
    /// | pool, jogo | antes | estágio 0 |
    /// |---|---:|---:|
    /// | 20, 17 |   362 |   **300** |
    /// | 21, 17 | 1.290 | **1.050** |
    /// | 22, 17 | 4.142 | **3.432** |
    ///
    /// O resultado **concorre**, não se impõe: passa pela mesma comparação de
    /// [`Self::escolher_partida`], então um fechamento já trazido que seja menor
    /// continua vencendo. Acrescentar este estágio não pode piorar nenhum caso.
    ///
    /// `ao_melhorar` é chamado a cada construção que bate a anterior — é o que
    /// permite à tela mostrar o estágio andando em vez de um tempo parado.
    pub fn construir_partida(
        &mut self,
        orcamento: Duration,
        ao_melhorar: &mut dyn FnMut(&crate::construtor::Achado),
    ) {
        let parada = self.parada_em_curso.clone();
        let achado = crate::construtor::construir_o_menor(
            &self.cobertura,
            &self.problema,
            orcamento,
            self.config.semente,
            &mut self.oficina,
            ao_melhorar,
            parada.as_ref(),
        );
        let Some(achado) = achado else { return };

        let ja_havia_partida = self.comecou;
        self.comecou = true;
        self.escolher_partida(&achado.cartelas, ja_havia_partida, &achado.origem);
        self.consolidar_inicio();
    }

    /// Retoma de um estado salvo anteriormente (o CONTINUAR do §16).
    ///
    /// Diferente de [`Self::semear`], aqui as cartelas já são reconhecidas como
    /// recorde: a busca continua de onde parou em vez de recomeçar.
    pub fn retomar_de(&mut self, melhor: &[Cartela], iteracoes_anteriores: u64) {
        self.semear(melhor);
        self.cartelas_trazidas = 0;
        self.estatisticas.iteracoes = iteracoes_anteriores;
        // `semear` marca "fechamento importado", que é verdade para quem colou
        // cartelas de fora — mas não para quem só voltou ao próprio trabalho.
        self.origem_do_inicio = "trabalho retomado".to_string();
    }

    /// Escolhe o ponto de partida da busca — a "primeira etapa" do processo em
    /// duas fases.
    ///
    /// Duas construções competem, e ambas custam milissegundos:
    ///
    /// - **Guloso com ruído** ([`construir_do_zero`]), que funciona em qualquer
    ///   configuração e é o que o motor sempre usou.
    /// - **Construção algébrica** ([`semente_algebrica`]), que só existe para
    ///   alguns formatos, mas quando existe entrega a solução ótima pronta.
    ///
    /// Quem vence é decidido pelo número de cartelas, não por preferência. Isso
    /// importa: em pools bem menores que o plano de onde a construção veio, a
    /// truncagem sobra e o guloso ganha. Comparar custa quase nada e garante que
    /// acrescentar as construções nunca piore nenhum caso.
    /// Escolhe o ponto de partida da busca — a "primeira etapa" do processo em
    /// duas fases.
    ///
    /// Três candidatos concorrem, e todos custam milissegundos:
    ///
    /// 1. **O fechamento trazido pelo usuário**, quando há um. É o resultado que
    ///    algum outro motor já produziu, e não faz sentido refazer esse trabalho.
    /// 2. **Construção algébrica** ([`semente_algebrica`]), que só existe para
    ///    alguns formatos, mas quando existe entrega a solução ótima pronta.
    /// 3. **Guloso com ruído** ([`construir_do_zero`]), que funciona em qualquer
    ///    configuração.
    ///
    /// Todos passam por [`podar`] antes de serem julgados, e vence o de menor
    /// custo pela mesma régua que a busca usa.
    ///
    /// ## Por que comparar, em vez de simplesmente obedecer
    ///
    /// A primeira versão obedecia: importar um fechamento o instalava direto,
    /// sem podar e sem comparar. Duas consequências medidas em `C(21,5,2)`:
    ///
    /// - Um fechamento com as 21 cartelas ótimas mais 5 duplicatas entrava como
    ///   26. A poda tira as 5 de graça, e sem ela o motor nem percebia que já
    ///   estava com o ótimo na mão — `optimalidade_provada` dava falso.
    /// - Pior: para essa configuração a construção algébrica dá as 21 ótimas em
    ///   milissegundos, mas semear pulava `garantir_inicio` e desligava isso.
    ///   Trazer uma solução deixava o resultado **pior** do que não trazer nada.
    ///
    /// Aproveitar o trabalho já feito é o objetivo; jogar fora um trabalho
    /// melhor que já estava disponível seria o contrário dele.
    fn escolher_partida(&mut self, trazidas: &[Cartela], manter_atual: bool, origem: &str) {
        let objetivo = self.problema.objetivo();
        let mut vencedor: Option<(Vec<Cartela>, ChaveCusto, String)> = None;

        // `map_or(true, …)` e não `is_none_or`: este projeto compila a partir do
        // Rust 1.80, e `is_none_or` só estabilizou no 1.82.
        let considerar =
            |motor: &mut Self, origem: String, vencedor: &mut Option<(Vec<Cartela>, ChaveCusto, String)>| {
                podar(&motor.cobertura, &mut motor.atual, &mut motor.oficina);
                let chave = motor.atual.avaliacao().chave(objetivo);
                let vence = vencedor.as_ref().map_or(true, |(_, c, _)| chave.melhor_que(c));
                if vence {
                    *vencedor = Some((motor.atual.cartelas().to_vec(), chave, origem));
                }
            };

        if manter_atual && self.atual.quantidade() > 0 {
            let origem = std::mem::take(&mut self.origem_do_inicio);
            considerar(self, origem, &mut vencedor);
        }

        if !trazidas.is_empty() {
            self.atual.reiniciar();
            for &cartela in trazidas {
                self.atual.adicionar(&self.cobertura, cartela, &mut self.oficina.rascunho);
            }
            considerar(self, origem.to_string(), &mut vencedor);
        }

        if let Some(semente) = semente_algebrica(&self.problema) {
            self.atual.reiniciar();
            for &cartela in &semente.cartelas {
                self.atual.adicionar(&self.cobertura, cartela, &mut self.oficina.rascunho);
            }
            considerar(self, semente.origem, &mut vencedor);
        }

        let parada = self.parada_em_curso.clone();

        construir_do_zero(
            &self.cobertura,
            &mut self.atual,
            self.config.ruido_reconstrucao,
            self.max_candidatos,
            &mut self.rng,
            &mut self.oficina,
            parada.as_ref(),
        );
        considerar(self, "construção gulosa".to_string(), &mut vencedor);

        let (cartelas, _, origem) = vencedor.expect("o guloso sempre produz um candidato");
        self.atual.reiniciar();
        for cartela in cartelas {
            self.atual.adicionar(&self.cobertura, cartela, &mut self.oficina.rascunho);
        }
        self.origem_do_inicio = origem;
    }

    fn garantir_inicio(&mut self, observador: &mut dyn Observador) {
        if self.comecou {
            return;
        }
        self.comecou = true;
        self.escolher_partida(&[], false, "");
        self.consolidar_inicio();

        observador.ao_evento(&Evento::Iniciado {
            avaliacao: self.melhor_avaliacao,
            limite: self.limite,
        });
    }

    /// Registra a solução inicial como recorde e define a primeira meta.
    fn consolidar_inicio(&mut self) {
        let avaliacao = self.atual.avaliacao();
        let chave = avaliacao.chave(self.problema.objetivo());

        if avaliacao.viavel(self.problema.objetivo()) && chave.melhor_que(&self.melhor_chave) {
            self.gravar_recorde(avaliacao, chave);
        }
        self.definir_meta();
        self.aceitacao.reiniciar(chave_local(&self.atual.avaliacao()));
    }

    /// Roda o laço até alguma condição de parada.
    ///
    /// Pode ser chamada de novo depois de parar: o estado interno permanece
    /// intacto, e a busca simplesmente continua.
    pub fn executar(
        &mut self,
        controle: &Controle,
        condicoes: &CondicoesDeParada,
        observador: &mut dyn Observador,
    ) -> MotivoEncerramento {
        let inicio = Instant::now();
        // A alça fica guardada durante toda a execução: é ela que permite às
        // construções sem teto — a partida logo abaixo e a diversificação —
        // largarem o trabalho quando alguém pede parada.
        self.parada_em_curso = Some(controle.clone());
        self.garantir_inicio(observador);

        let iteracoes_no_inicio = self.estatisticas.iteracoes;
        // Primeira leitura já na primeira volta: sem uma medição, não há como
        // saber se as iterações desta configuração custam microssegundos ou
        // segundos.
        let mut proxima_leitura = iteracoes_no_inicio;
        let mut passo: u64 = 1;
        let mut ultima_leitura_em_it = iteracoes_no_inicio;
        let mut ultima_leitura_em_tempo = Duration::ZERO;
        let mut pior_iteracao = Duration::ZERO;

        let motivo = loop {
            if controle.foi_solicitada_parada() {
                break MotivoEncerramento::Solicitado;
            }
            if condicoes.parar_em_optimalidade && self.optimalidade_provada() {
                break MotivoEncerramento::OptimalidadeProvada;
            }
            if let Some(teto) = condicoes.max_iteracoes {
                if self.estatisticas.iteracoes >= teto {
                    break MotivoEncerramento::LimiteDeIteracoes;
                }
            }
            if let Some(limite) = condicoes.max_duracao {
                if self.estatisticas.iteracoes >= proxima_leitura {
                    let decorrido = inicio.elapsed();
                    if decorrido >= limite {
                        break MotivoEncerramento::LimiteDeTempo;
                    }

                    // Quantas iterações cabem no tempo que resta, na velocidade
                    // observada — **e nunca mais que o dobro do passo anterior**.
                    //
                    // O teto de crescimento não é zelo: sem ele esta conta erra
                    // feio, e foi medido. Num pool de 25 com jogos de 20 a
                    // primeira iteração levou 1,3 ms e a segunda levou 1,44
                    // **segundos** — mil vezes mais, porque só a segunda pagou a
                    // poda sobre 1.450 cartelas. Extrapolando da primeira, o
                    // laço concluiu que cabiam 162 iterações no tempo restante e
                    // ficou 22 segundos sem olhar o relógio.
                    //
                    // Dobrando a cada acerto, o passo chega ao teto em dez
                    // leituras onde as iterações são baratas, e uma iteração
                    // lenta é notada na volta seguinte.
                    // A estimativa usa a iteração mais **cara** já vista nesta
                    // execução, e não a média: com custos que variam mil vezes,
                    // a média promete uma velocidade que a próxima iteração não
                    // vai cumprir.
                    let feitas = self.estatisticas.iteracoes.saturating_sub(ultima_leitura_em_it);
                    if feitas > 0 {
                        let janela = decorrido.saturating_sub(ultima_leitura_em_tempo);
                        pior_iteracao = pior_iteracao.max(janela / feitas as u32);
                    }
                    ultima_leitura_em_it = self.estatisticas.iteracoes;
                    ultima_leitura_em_tempo = decorrido;

                    let extrapolado = if pior_iteracao.is_zero() {
                        MAXIMO_ENTRE_LEITURAS_DO_RELOGIO
                    } else {
                        let restante = limite.saturating_sub(decorrido);
                        (restante.as_nanos() / pior_iteracao.as_nanos().max(1)) as u64
                    };
                    passo = extrapolado
                        .min(passo.saturating_mul(2))
                        .clamp(1, MAXIMO_ENTRE_LEITURAS_DO_RELOGIO);
                    proxima_leitura = self.estatisticas.iteracoes.saturating_add(passo);
                }
            }

            self.uma_iteracao(inicio, observador);
        };

        self.parada_em_curso = None;
        self.duracao_acumulada += inicio.elapsed();
        observador.ao_evento(&Evento::Encerrado {
            motivo,
            estatisticas: self.estatisticas,
            melhor: self.melhor_avaliacao,
            decorrido: self.duracao_acumulada,
        });
        motivo
    }

    fn uma_iteracao(&mut self, inicio: Instant, observador: &mut dyn Observador) {
        self.estatisticas.iteracoes += 1;

        // Instantâneo para poder desfazer. São dezenas de cartelas de 16 bytes:
        // muito mais barato que clonar o estado de cobertura.
        self.oficina.instantaneo.clear();
        self.oficina.instantaneo.extend_from_slice(self.atual.cartelas());
        let antes = chave_local(&self.atual.avaliacao());

        let indice_operador = self.seletor.escolher(&mut self.rng);
        let operador = Operador::TODOS[indice_operador];

        self.elite_atual.clear();
        if operador == Operador::RecombinarComElite {
            if let Some(elite) = self.arquivo.sortear_entre_as_melhores(&mut self.rng) {
                self.elite_atual.extend_from_slice(&elite.cartelas);
            }
        }

        destruir(
            operador,
            &self.cobertura,
            &mut self.atual,
            Some(&self.elite_atual),
            &mut self.rng,
            &mut self.oficina,
        );
        reparar(
            &self.cobertura,
            &mut self.atual,
            self.alvo_cartelas,
            self.config.ruido_reconstrucao,
            self.max_candidatos,
            &mut self.rng,
            &mut self.oficina,
        );

        // Chegou ao teto de cartelas e ainda falta cobrir: é aqui que a
        // reconstrução por cartelas inteiras não tem mais o que fazer, porque
        // qualquer cartela nova ultrapassaria a meta. O passo que resta é
        // pequeno — mover uma dezena de uma cartela — e é o que a descida por
        // troca faz.
        //
        // Sem isto, a iteração terminava sempre revertendo, e o recorde só caía
        // por sorte da reconstrução. Medido a partir do banco publicado, dez
        // minutos em `(24,17)` tiravam quinze cartelas de trinta e duas mil.
        if !self.atual.cobertura_total() && self.atual.quantidade() >= self.alvo_cartelas {
            // O orçamento acompanha o tamanho do buraco: fechar `d` sorteios
            // descobertos precisa da ordem de `d` trocas certeiras, e gastar
            // muito mais que isso é insistir onde não fecha. Sem essa
            // proporção, um problema pequeno consumia milhares de trocas por
            // iteração e a busca deixava de contar iterações — o teste de
            // cobertura múltipla saiu de 2,7 s para mais de cinco minutos.
            let buraco = self.atual.total_descobertos() as u64;
            let orcamento = self.trocas_por_iteracao.min(buraco.saturating_mul(8).max(1));
            crate::troca::descida_por_troca(
                &self.cobertura,
                &mut self.atual,
                orcamento,
                &mut self.rng,
                &mut self.oficina,
            );
        }

        // Podar custa uma varredura de contribuição sobre todas as cartelas —
        // em configurações grandes, mais caro que o resto da iteração inteira.
        // E só rende quando a cobertura está fechada: aí uma cartela supérflua
        // vira redução direta do recorde. Com alvos ainda descobertos, remover
        // uma cartela apenas abre um espaço que a reconstrução vai repreencher.
        if self.atual.cobertura_total() {
            podar(&self.cobertura, &mut self.atual, &mut self.oficina);
        }

        let avaliacao = self.atual.avaliacao();
        let depois = chave_local(&avaliacao);
        let chave_global = avaliacao.chave(self.problema.objetivo());

        let e_recorde = avaliacao.viavel(self.problema.objetivo())
            && chave_global.melhor_que(&self.melhor_chave);

        if e_recorde {
            self.gravar_recorde(avaliacao, chave_global);
            self.arquivar(operador, avaliacao);
            observador.ao_evento(&Evento::NovoRecorde {
                avaliacao,
                cartelas: self.melhor.clone(),
                iteracao: self.estatisticas.iteracoes,
                decorrido: self.duracao_acumulada + inicio.elapsed(),
                operador: operador.nome(),
            });
            self.definir_meta();
        }

        let aceita = self.aceitacao.decidir(depois, antes);
        if aceita {
            self.estatisticas.aceitas += 1;
            if self.estatisticas.aceitas % ACEITAS_ENTRE_ARQUIVAMENTOS == 0 {
                self.arquivar(operador, avaliacao);
            }
        } else {
            self.atual.restaurar_de(
                &self.cobertura,
                &self.oficina.instantaneo,
                &mut self.oficina.restaurador,
                &mut self.oficina.rascunho,
            );
        }

        let pontos = if e_recorde {
            self.config.recompensas.recorde
        } else if depois.melhor_que(&antes) {
            self.config.recompensas.melhorou
        } else if aceita {
            self.config.recompensas.aceita
        } else {
            self.config.recompensas.recusada
        };
        self.seletor.registrar(indice_operador, pontos);

        if e_recorde {
            self.iteracoes_sem_recorde = 0;
        } else {
            self.iteracoes_sem_recorde += 1;
            if let PassoDaMeta::Adaptativo { iteracoes_para_recuar, .. } = self.config.passo_da_meta
            {
                if iteracoes_para_recuar > 0
                    && self.iteracoes_sem_recorde % iteracoes_para_recuar == 0
                {
                    self.recuar_a_meta();
                }
            }
            if self.iteracoes_sem_recorde >= self.config.iteracoes_ate_diversificar {
                self.diversificar(observador);
            }
        }

        if self.config.intervalo_progresso > 0
            && self.estatisticas.iteracoes % self.config.intervalo_progresso == 0
        {
            observador.ao_evento(&Evento::Progresso {
                iteracao: self.estatisticas.iteracoes,
                decorrido: self.duracao_acumulada + inicio.elapsed(),
                atual: self.atual.avaliacao(),
                melhor: self.melhor_avaliacao,
                alvo_cartelas: self.alvo_cartelas,
                elites: self.arquivo.quantidade(),
                operador: operador.nome(),
            });
        }
    }

    fn gravar_recorde(&mut self, avaliacao: Avaliacao, chave: ChaveCusto) {
        self.melhor.clear();
        self.melhor.extend_from_slice(self.atual.cartelas());
        self.melhor_avaliacao = avaliacao;
        self.melhor_chave = chave;
        self.melhor_assinatura = self.atual.assinatura();
        self.melhor_iteracao = self.estatisticas.iteracoes;
        self.estatisticas.recordes += 1;
    }

    fn arquivar(&mut self, operador: Operador, avaliacao: Avaliacao) {
        let assinatura = self.atual.assinatura();
        if self.arquivo.ja_visitada(assinatura) {
            self.estatisticas.duplicadas_evitadas += 1;
            return;
        }

        let entrou = self.arquivo.registrar(Elite {
            cartelas: self.atual.cartelas().to_vec(),
            avaliacao,
            assinatura,
            iteracao: self.estatisticas.iteracoes,
            ancestral: Some(self.melhor_assinatura),
            operador: operador.nome(),
        });
        if !entrou {
            self.estatisticas.duplicadas_evitadas += 1;
        }
    }

    /// Define a cardinalidade a perseguir a partir do recorde atual.
    ///
    /// ## Por que a meta não vai direto ao piso
    ///
    /// A meta é um **teto**: `reparar` para de acrescentar cartelas ao chegar
    /// nela, e `encolher_ate` corta a solução atual até ela. Baixar a meta
    /// aperta a busca; não a solta. Mirar direto no limite inferior foi medido e
    /// piorou: os empates com a tabela mundial caíram de 41,7% para 48,4% de
    /// distância, e `C(26,6,3)` saiu de 246 para 288 cartelas — cortar 116
    /// cartelas de uma vez deixa um destroço que a busca não repara.
    ///
    /// ## Por que continua sendo um passo de uma
    ///
    /// A queixa contra ele é justa de olhar: com folga de sobra na solução,
    /// gastar uma rodada inteira de destruir-reconstruir-podar para tirar uma
    /// cartela parece desperdício. Duas políticas foram escritas para aproveitar
    /// essa folga e as duas mediram pior — veja a tabela em [`PassoDaMeta`]. O
    /// motivo é que o desperdício aparente é o que mantém a solução perto de
    /// viável, e é dessa proximidade que a busca por cardinalidade fixa vive.
    ///
    /// Vale separar duas coisas que se confundem: o **teto** desce de uma em
    /// uma, mas o **recorde** cai do tamanho que a poda conseguir. Uma iteração
    /// que fecha a cobertura e descobre cinco cartelas supérfluas registra as
    /// cinco de uma vez. O motor nunca esteve proibido de cortar em bloco.
    fn definir_meta(&mut self) {
        let nova_meta = match self.problema.objetivo() {
            Objetivo::MinimizarCartelas => {
                let melhor = self.melhor_avaliacao.cartelas;
                if melhor == 0 {
                    usize::MAX
                } else {
                    let passo = self.proximo_passo();
                    melhor.saturating_sub(passo).max(self.limite.valor as usize).max(1)
                }
            }
            // A meta é o orçamento e não se move; o que melhora é a cobertura.
            Objetivo::MaximizarCobertura { orcamento } => orcamento,
        };

        if nova_meta == self.alvo_cartelas {
            return;
        }
        self.alvo_cartelas = nova_meta;
        self.iteracao_da_meta = self.estatisticas.iteracoes;

        self.encolher_ate(nova_meta);
        self.aceitacao.reiniciar(chave_local(&self.atual.avaliacao()));
    }

    /// Desiste de uma meta ambiciosa que não fecha, e volta a apertar devagar.
    ///
    /// Um salto de várias cartelas é uma **tentativa**, não um compromisso.
    /// Medido: com o passo dobrando e nada que o desfizesse, `(21,17)` caía de
    /// quatro recordes em um minuto para um só — o segundo salto não fechava, e
    /// como o passo só é reavaliado no recorde seguinte, a busca ficava presa
    /// atrás de uma meta que ela não alcançava.
    ///
    /// Afrouxar a meta não corta nada: `encolher_ate` só age quando a solução
    /// está acima do teto, e aqui o teto sobe. O que a solução ganha é espaço
    /// para `reparar` fechar a cobertura de novo.
    fn recuar_a_meta(&mut self) {
        if !matches!(self.config.passo_da_meta, PassoDaMeta::Adaptativo { .. }) {
            return;
        }
        if !matches!(self.problema.objetivo(), Objetivo::MinimizarCartelas) {
            return;
        }
        if self.passo_atual <= 1 || self.melhor_avaliacao.cartelas == 0 {
            return;
        }

        self.passo_atual = (self.passo_atual / 2).max(1);
        let nova_meta = self
            .melhor_avaliacao
            .cartelas
            .saturating_sub(self.passo_atual)
            .max(self.limite.valor as usize)
            .max(1);
        if nova_meta == self.alvo_cartelas {
            return;
        }
        self.alvo_cartelas = nova_meta;
        self.iteracao_da_meta = self.estatisticas.iteracoes;
        self.aceitacao.reiniciar(chave_local(&self.atual.avaliacao()));
    }

    /// Quantas cartelas descer nesta meta, segundo a política configurada.
    ///
    /// O sinal de "veio fácil" é o número de iterações desde que a meta atual foi
    /// fixada: um recorde que chega logo depois significa que ainda havia folga,
    /// e a próxima meta pode ser mais ambiciosa. Um que demora significa que a
    /// cardinalidade está apertando, e o passo volta a um — que é o regime em que
    /// a busca por cardinalidade fixa funciona.
    fn proximo_passo(&mut self) -> usize {
        match self.config.passo_da_meta {
            PassoDaMeta::Unitario => 1,
            PassoDaMeta::AteOPiso => {
                self.melhor_avaliacao.cartelas.saturating_sub(self.limite.valor as usize).max(1)
            }
            PassoDaMeta::Adaptativo { maximo, iteracoes_para_dobrar, .. } => {
                let desde_a_meta = self.estatisticas.iteracoes.saturating_sub(self.iteracao_da_meta);
                self.passo_atual = if desde_a_meta <= iteracoes_para_dobrar {
                    (self.passo_atual.saturating_mul(2)).min(maximo.max(1))
                } else {
                    1
                };
                self.passo_atual.max(1)
            }
        }
    }

    /// Reduz a solução atual até `teto` cartelas, sacrificando primeiro as que
    /// menos contribuem de forma exclusiva.
    ///
    /// Ordena uma vez e remove o excedente de uma vez. Reavaliar a cada remoção
    /// daria uma escolha marginalmente melhor ao custo de uma varredura completa
    /// por cartela removida — inaceitável quando a solução tem centenas delas.
    fn encolher_ate(&mut self, teto: usize) {
        let excedente = self.atual.quantidade().saturating_sub(teto);
        if excedente == 0 {
            return;
        }

        self.oficina.notas.clear();
        for indice in 0..self.atual.quantidade() {
            let contribuicao =
                self.atual.contribuicao_unica(&self.cobertura, indice, &mut self.oficina.rascunho);
            self.oficina.notas.push(contribuicao as i64);
        }

        self.oficina.ordem.clear();
        self.oficina.ordem.extend(0..self.atual.quantidade());
        let notas = &self.oficina.notas;
        self.oficina.ordem.sort_unstable_by_key(|&i| notas[i]);

        self.oficina.remocoes.clear();
        for &indice in self.oficina.ordem.iter().take(excedente) {
            self.oficina.remocoes.push(self.atual.cartelas()[indice]);
        }

        for posicao_na_lista in 0..self.oficina.remocoes.len() {
            let alvo = self.oficina.remocoes[posicao_na_lista];
            if let Some(indice) = self.atual.cartelas().iter().position(|&c| c == alvo) {
                self.atual.remover(&self.cobertura, indice, &mut self.oficina.rascunho);
            }
        }
    }

    /// Sai da região atual quando a busca estaciona (§35).
    fn diversificar(&mut self, observador: &mut dyn Observador) {
        self.estatisticas.diversificacoes += 1;
        self.iteracoes_sem_recorde = 0;

        // Metade das vezes reaproveita material já descoberto, metade recomeça
        // do zero. Reiniciar de uma elite explora a vizinhança de algo que já
        // funcionou; recomeçar abre uma região que talvez nunca fosse visitada.
        let usar_elite = self.rng.gen_bool(0.5) && self.arquivo.quantidade() > 0;

        let estrategia = if usar_elite {
            self.elite_atual.clear();
            if let Some(elite) = self.arquivo.sortear(&mut self.rng) {
                self.elite_atual.extend_from_slice(&elite.cartelas);
            }
            self.atual.restaurar_de(
                &self.cobertura,
                &self.elite_atual,
                &mut self.oficina.restaurador,
                &mut self.oficina.rascunho,
            );
            "reinício a partir de elite do arquivo"
        } else {
            let parada = self.parada_em_curso.clone();
            construir_do_zero(
                &self.cobertura,
                &mut self.atual,
                // Ruído bem alto: o objetivo aqui é ir para longe, não ser bom.
                self.config.ruido_reconstrucao.max(0.6),
                self.max_candidatos,
                &mut self.rng,
                &mut self.oficina,
                parada.as_ref(),
            );
            "reconstrução completa do zero"
        };

        podar(&self.cobertura, &mut self.atual, &mut self.oficina);
        self.encolher_ate(self.alvo_cartelas);
        self.aceitacao.reiniciar(chave_local(&self.atual.avaliacao()));

        observador.ao_evento(&Evento::Diversificacao {
            iteracao: self.estatisticas.iteracoes,
            estrategia,
        });
    }

    /// Verdadeiro quando o recorde alcançou o limite inferior — não existe
    /// solução melhor, e isso é demonstrável.
    pub fn optimalidade_provada(&self) -> bool {
        matches!(self.problema.objetivo(), Objetivo::MinimizarCartelas)
            && !self.melhor.is_empty()
            && motor_core::optimalidade_provada(
                self.melhor_avaliacao.cartelas as u64,
                self.limite,
            )
    }

    pub fn melhor_cartelas(&self) -> &[Cartela] {
        &self.melhor
    }

    /// Reconstrói a solução completa do recorde, com todo o estado de cobertura.
    ///
    /// Custa O(total_alvos); use para exportar ou auditar, não em laço.
    pub fn melhor_solucao(&self) -> Solucao {
        let mut rascunho = motor_core::Rascunho::novo();
        Solucao::de_cartelas(&self.cobertura, &self.melhor, &mut rascunho)
    }

    pub fn melhor_avaliacao(&self) -> Avaliacao {
        self.melhor_avaliacao
    }

    /// Onde a busca está *agora* — pode estar bem pior que o recorde, e é
    /// justamente isso que o painel do §27 precisa mostrar para que o usuário
    /// entenda que exploração não é regressão.
    pub fn avaliacao_atual(&self) -> Avaliacao {
        self.atual.avaliacao()
    }

    pub fn melhor_assinatura(&self) -> u64 {
        self.melhor_assinatura
    }

    pub fn melhor_iteracao(&self) -> u64 {
        self.melhor_iteracao
    }

    pub fn estatisticas(&self) -> Estatisticas {
        self.estatisticas
    }

    pub fn duracao(&self) -> Duration {
        self.duracao_acumulada
    }

    pub fn limite_inferior(&self) -> LimiteInferior {
        self.limite
    }

    pub fn gap(&self) -> Option<f64> {
        motor_core::gap(self.melhor_avaliacao.cartelas as u64, self.limite.valor)
    }

    pub fn arquivo(&self) -> &ArquivoElites {
        &self.arquivo
    }

    pub fn problema(&self) -> &Problema {
        &self.problema
    }

    pub fn cobertura(&self) -> &MotorCobertura {
        &self.cobertura
    }

    pub fn alvo_cartelas(&self) -> usize {
        self.alvo_cartelas
    }

    /// O que a tabela mundial diz sobre esta configuração.
    ///
    /// Sempre um **limite superior** — o melhor resultado conhecido quando o
    /// problema é a cobertura completa catalogada, e um teto válido quando é
    /// garantia parcial. Nunca serve de limite inferior: para isso existe
    /// [`Self::limite_inferior`], que só aceita a tabela onde ela de fato se
    /// aplica.
    pub fn referencia(&self) -> Option<Consulta> {
        self.referencia
    }

    /// Como o ponto de partida desta busca foi obtido.
    pub fn origem_do_inicio(&self) -> &str {
        &self.origem_do_inicio
    }

    /// Quantas cartelas o usuário trouxe, ou zero se a busca começou sem
    /// fechamento de partida.
    pub fn cartelas_trazidas(&self) -> usize {
        self.cartelas_trazidas
    }

    pub fn pesos_dos_operadores(&self) -> Vec<(&'static str, f64)> {
        Operador::TODOS
            .iter()
            .zip(self.seletor.pesos())
            .map(|(op, &peso)| (op.nome(), peso))
            .collect()
    }

    /// As cartelas da solução em curso — a que a busca está mexendo agora.
    ///
    /// Diferente do recorde: esta pode estar pior, e pode nem cobrir tudo. É
    /// deliberado, e é o que faz a busca funcionar (§35). Quem exporta uma
    /// sessão leva as duas, para retomar do ponto exato em vez de voltar ao
    /// último recorde.
    pub fn cartelas_atuais(&self) -> &[Cartela] {
        self.atual.cartelas()
    }

    /// O retrato do estado interno, para gravar num arquivo.
    pub fn retrato(&self) -> RetratoDoMotor {
        RetratoDoMotor {
            iteracoes: self.estatisticas.iteracoes,
            aceitas: self.estatisticas.aceitas,
            recordes: self.estatisticas.recordes,
            diversificacoes: self.estatisticas.diversificacoes,
            duplicadas_evitadas: self.estatisticas.duplicadas_evitadas,
            segundos: self.duracao_acumulada.as_secs_f64(),
            alvo_cartelas: self.alvo_cartelas,
            passo_atual: self.passo_atual,
            iteracao_da_meta: self.iteracao_da_meta,
            melhor_iteracao: self.melhor_iteracao,
            pesos_dos_operadores: self.seletor.pesos().to_vec(),
        }
    }

    /// Retoma uma sessão inteira: o recorde, a solução em curso e o retrato.
    ///
    /// A ordem importa. O recorde entra primeiro, por `retomar_de`, que é o
    /// caminho já existente e que faz a comparação de partida. Só então a
    /// solução em curso é restaurada por cima — se ela vier — e por último os
    /// contadores, porque `retomar_de` mexe neles.
    ///
    /// Uma solução em curso vazia, ou que não caiba nesta configuração, é
    /// ignorada em silêncio: a busca continua do recorde, que é o que importa.
    /// Não é caso de erro — é um arquivo de uma versão que não guardava isso.
    pub fn retomar_sessao(
        &mut self,
        melhor: &[Cartela],
        atual: &[Cartela],
        retrato: &RetratoDoMotor,
    ) {
        self.retomar_de(melhor, retrato.iteracoes);

        if !atual.is_empty() {
            self.atual.restaurar_de(
                &self.cobertura,
                atual,
                &mut self.oficina.restaurador,
                &mut self.oficina.rascunho,
            );
        }

        self.estatisticas.iteracoes = retrato.iteracoes;
        self.estatisticas.aceitas = retrato.aceitas;
        self.estatisticas.recordes = retrato.recordes;
        self.estatisticas.diversificacoes = retrato.diversificacoes;
        self.estatisticas.duplicadas_evitadas = retrato.duplicadas_evitadas;
        if retrato.segundos.is_finite() && retrato.segundos >= 0.0 {
            self.duracao_acumulada = Duration::from_secs_f64(retrato.segundos);
        }
        self.melhor_iteracao = retrato.melhor_iteracao;
        self.iteracao_da_meta = retrato.iteracao_da_meta;
        // A meta é recalculada por `definir_meta` no arranque, e chegaria ao
        // mesmo número. Restaurá-la mesmo assim é o que faz o arquivo descrever
        // a sessão inteira: quem o lê vê a meta que estava sendo perseguida, e
        // não uma que se deduz.
        if retrato.alvo_cartelas > 0 {
            self.alvo_cartelas = retrato.alvo_cartelas;
        }
        if retrato.passo_atual > 0 {
            self.passo_atual = retrato.passo_atual;
        }
        self.seletor.restaurar_pesos(&retrato.pesos_dos_operadores);
        self.origem_do_inicio = "sessão importada".to_string();
    }
}

/// Custo usado pela busca local, dentro da cardinalidade perseguida.
///
/// Diferente da chave global: aqui o que importa é fechar a cobertura com a
/// quantidade de cartelas disponível. Menos descobertos vem sempre primeiro;
/// entre empates, menos cartelas; por último, menos redundância — que costuma
/// indicar uma estrutura mais bem distribuída e portanto mais fácil de fechar.
fn chave_local(avaliacao: &Avaliacao) -> ChaveCusto {
    ChaveCusto {
        primario: avaliacao.descobertos as u64,
        secundario: avaliacao.cartelas as u64,
        terciario: avaliacao.redundancia,
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::controle::{Coletor, Silencioso};
    use motor_core::{RegraCobertura, Solucao};

    fn problema(p: u32, k: usize, t: usize) -> Problema {
        Problema::com_pool_inicial(
            p,
            p as usize,
            k,
            RegraCobertura::cobrir_subconjuntos(t),
            Objetivo::MinimizarCartelas,
        )
        .unwrap()
    }

    /// Uma configuração em que a busca tem trabalho de verdade.
    ///
    /// As antigas favoritas destes testes — C(13,4,2), C(16,4,2), C(21,5,2) —
    /// passaram a sair prontas da construção algébrica, com optimalidade provada
    /// antes da primeira iteração. Testar o laço de busca sobre elas deixou de
    /// observar laço nenhum: nenhum recorde, nenhuma diversificação, nenhuma
    /// elite. Não é regressão, é a construção funcionando — mas os testes do
    /// laço precisam de um caso sem fórmula fechada.
    ///
    /// `C(12,5,3)` serve duas vezes: `t = 3` não tem construção fechada neste
    /// projeto, e o melhor conhecido no mundo (29) ainda está acima do limite
    /// provado (27) — ninguém sabe se 27 existe. Logo a busca nunca prova
    /// optimalidade e nunca para sozinha, que é o que estes testes precisam
    /// observar.
    fn problema_para_buscar() -> Problema {
        problema(12, 5, 3)
    }

    fn config_rapida(semente: u64) -> Configuracao {
        Configuracao {
            semente,
            memoria_aceitacao: 100,
            iteracoes_ate_diversificar: 2_000,
            intervalo_progresso: 0,
            ..Default::default()
        }
    }

    /// Como [`problema`], exigindo `r` cartelas premiadas por alvo.
    fn problema_multiplo(p: u32, k: usize, alvo: usize, t: usize, r: usize) -> Problema {
        Problema::com_pool_inicial(
            p,
            p as usize,
            k,
            RegraCobertura::garantia_multipla(alvo, t, r),
            Objetivo::MinimizarCartelas,
        )
        .unwrap()
    }

    #[test]
    fn a_busca_entrega_uma_cobertura_multipla_valida() {
        // O que precisa ficar provado: a solução final não apenas cobre tudo,
        // mas cobre tudo **r vezes** — e isso é conferido pelo oráculo de força
        // bruta, que não compartilha caminho de código com o incremental.
        for r in 2..=3 {
            let mut motor =
                MotorBusca::novo(problema_multiplo(9, 4, 3, 3, r), config_rapida(7)).unwrap();
            motor.executar(
                &Controle::novo(),
                &CondicoesDeParada {
                    max_iteracoes: Some(20_000),
                    max_duracao: None,
                    parar_em_optimalidade: false,
                },
                &mut Silencioso,
            );

            let solucao = motor.melhor_solucao();
            assert!(solucao.cobertura_total(), "r={r}: a melhor solução não fechou");
            assert_eq!(solucao.conferir_invariantes(motor.cobertura()), Ok(()));

            let contagens = motor.cobertura().contagens_por_forca_bruta(solucao.cartelas());
            let minimo = contagens.iter().copied().min().unwrap_or(0);
            assert!(
                minimo >= r as u32,
                "r={r}: algum alvo ficou com {minimo} cartelas, e devia ter ao menos {r}"
            );
        }
    }

    #[test]
    fn exigir_mais_premiadas_nunca_sai_mais_barato() {
        // Monotonicidade: o mínimo para `r+1` não pode ser menor que para `r`,
        // porque toda solução de `r+1` também serve para `r`. Se a busca
        // devolvesse algo menor, haveria erro no limiar — e seria um erro que
        // entrega ao usuário um fechamento que não cumpre o que promete.
        let mut anterior = 0;
        for r in 1..=3 {
            let mut motor =
                MotorBusca::novo(problema_multiplo(9, 4, 3, 3, r), config_rapida(11)).unwrap();
            motor.executar(
                &Controle::novo(),
                &CondicoesDeParada {
                    max_iteracoes: Some(20_000),
                    max_duracao: None,
                    parar_em_optimalidade: false,
                },
                &mut Silencioso,
            );
            let quantas = motor.melhor_avaliacao().cartelas;
            assert!(
                quantas >= anterior,
                "exigir {r} premiadas saiu com {quantas} cartelas, menos que as {anterior} de {}",
                r - 1
            );
            anterior = quantas;
        }
    }

    #[test]
    fn o_piso_cresce_com_as_premiadas_sem_inventar_teorema() {
        // Duas fontes independentes, e nenhuma delas é "multiplicar o piso de
        // r=1 por r" — isso não tem teorema que sustente.
        //
        // Em C(9,4,3) a cota de contagem dá 21 e a de Schönheim dá 25, então o
        // piso simples é 25. Com r=3 a contagem vira 63, e é ela que manda; o
        // piso do catálogo continua valendo inteiro, mas fica para trás.
        let simples = MotorBusca::novo(problema_multiplo(9, 4, 3, 3, 1), config_rapida(1)).unwrap();
        let triplo = MotorBusca::novo(problema_multiplo(9, 4, 3, 3, 3), config_rapida(1)).unwrap();

        assert_eq!(simples.limite_inferior().valor, 25, "Schönheim manda em C(9,4,3)");
        assert_eq!(triplo.limite_inferior().valor, 63, "com r=3 a contagem passa à frente");

        // E o piso nunca pode cair abaixo do de uma cobertura simples: toda
        // solução que atende cada alvo três vezes atende cada um ao menos uma.
        assert!(triplo.limite_inferior().valor >= simples.limite_inferior().valor);
    }

    /// Importar um fechamento redundante não pode carregar a redundância adiante.
    #[test]
    fn um_fechamento_importado_e_podado_de_graca() {
        use motor_core::planos::plano_projetivo;

        let mut motor = MotorBusca::novo(problema(21, 5, 2), config_rapida(1)).unwrap();

        // As 21 cartelas ótimas de PG(2,4), com 5 duplicatas puras coladas
        // junto — o que acontece quando alguém junta duas fontes.
        let retas = plano_projetivo(4).unwrap();
        let mut cartelas: Vec<Cartela> = retas.iter().map(|r| Cartela::dos_indices(r)).collect();
        for i in 0..5 {
            cartelas.push(cartelas[i]);
        }

        motor.semear(&cartelas);

        assert_eq!(motor.cartelas_trazidas(), 26);
        assert_eq!(
            motor.melhor_avaliacao().cartelas,
            21,
            "as 5 duplicatas tinham de sair de graça"
        );
        assert!(
            motor.optimalidade_provada(),
            "o ótimo estava dentro do que foi trazido e o motor precisa reconhecê-lo"
        );
        assert!(motor.melhor_solucao().cobertura_total());
    }

    /// Importar nunca pode piorar o resultado em relação a não importar nada.
    #[test]
    fn um_fechamento_ruim_nao_apaga_uma_construcao_melhor() {
        // O defeito medido: semear pulava a escolha de partida, então trazer um
        // fechamento medíocre desligava a construção algébrica. Em C(21,5,2) o
        // motor tem as 21 ótimas por fórmula; um fechamento de 40 cartelas não
        // pode fazê-lo partir de 40.
        let mut motor = MotorBusca::novo(problema(21, 5, 2), config_rapida(2)).unwrap();

        // Um fechamento válido porém ruim: cada cartela cobre uma fatia, e há
        // muitas sobras. Construído para cobrir tudo com folga.
        let mut ruim = Vec::new();
        for a in 0..21 {
            for b in (a + 1)..21 {
                if ruim.len() >= 60 {
                    break;
                }
                let outros: Vec<usize> = (0..21).filter(|&x| x != a && x != b).take(3).collect();
                let mut indices = vec![a, b];
                indices.extend(outros);
                ruim.push(Cartela::dos_indices(&indices));
            }
        }

        motor.semear(&ruim);

        assert!(
            motor.melhor_avaliacao().cartelas <= 21,
            "importar deixou o motor em {} cartelas, pior que as 21 que ele constrói sozinho",
            motor.melhor_avaliacao().cartelas
        );
        assert!(
            motor.origem_do_inicio().contains("PG(2,4)"),
            "a construção melhor deveria ter vencido; origem foi \"{}\"",
            motor.origem_do_inicio()
        );
    }

    /// E um fechamento bom precisa ser respeitado onde não há construção melhor.
    #[test]
    fn um_fechamento_bom_e_aproveitado_onde_nada_o_supera() {
        // C(12,5,3) não tem construção fechada neste projeto, e o guloso fica
        // bem acima do melhor conhecido (29). Um fechamento de 29 cartelas tem
        // de ser aproveitado, não descartado.
        let problema = problema(12, 5, 3);
        let mut referencia = MotorBusca::novo(problema.clone(), config_rapida(3)).unwrap();
        referencia.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(60_000),
            &mut Silencioso,
        );
        let bom = referencia.melhor_cartelas().to_vec();
        let quantas = bom.len();

        let mut motor = MotorBusca::novo(problema, config_rapida(4)).unwrap();
        motor.semear(&bom);

        assert_eq!(
            motor.melhor_avaliacao().cartelas,
            quantas,
            "o fechamento trazido era o melhor disponível e tinha de ser mantido"
        );
        assert_eq!(motor.origem_do_inicio(), "fechamento importado");
        assert!(motor.melhor_solucao().cobertura_total());
    }

    /// Semear duas vezes não pode descartar a primeira semente.
    ///
    /// É o caso da biblioteca do mundo somada a um fechamento colado: a
    /// cobertura guardada no aparelho entra primeiro, o texto do usuário em
    /// seguida, e o motor tem de ficar com a melhor das duas — não com a última.
    #[test]
    fn semear_de_novo_nunca_perde_a_semente_anterior() {
        use motor_core::planos::plano_projetivo;

        let boa: Vec<Cartela> =
            plano_projetivo(4).unwrap().iter().map(|r| Cartela::dos_indices(r)).collect();

        // Um fechamento válido e pior: cada elemento com os quatro seguintes.
        let ruim: Vec<Cartela> = (0..21)
            .map(|i| Cartela::dos_indices(&[i, (i + 1) % 21, (i + 2) % 21, (i + 3) % 21, (i + 5) % 21]))
            .collect();

        // Boa primeiro, ruim depois: a ruim não pode apagar a boa.
        let mut motor = MotorBusca::novo(problema(21, 5, 2), config_rapida(11)).unwrap();
        motor.semear(&boa);
        let depois_da_boa = motor.melhor_avaliacao().cartelas;
        motor.semear(&ruim);
        assert!(
            motor.melhor_avaliacao().cartelas <= depois_da_boa,
            "a segunda semeadura piorou o recorde: {depois_da_boa} → {}",
            motor.melhor_avaliacao().cartelas
        );
        assert_eq!(motor.avaliacao_atual().cartelas, 21, "a atual devia seguir na melhor");

        // E na ordem inversa, a boa precisa vencer.
        let mut motor = MotorBusca::novo(problema(21, 5, 2), config_rapida(12)).unwrap();
        motor.semear(&ruim);
        motor.semear(&boa);
        assert_eq!(motor.melhor_avaliacao().cartelas, 21);
        assert_eq!(motor.cartelas_trazidas(), boa.len() + ruim.len());
    }

    #[test]
    fn a_melhor_solucao_encontrada_e_sempre_valida() {
        // A garantia mais importante do sistema: o que o motor apresenta como
        // resposta precisa realmente satisfazer a regra de cobertura.
        for (p, k, t) in [(9, 3, 2), (13, 4, 2), (12, 5, 2), (10, 4, 3)] {
            let mut motor = MotorBusca::novo(problema(p, k, t), config_rapida(1)).unwrap();
            motor.executar(
                &Controle::novo(),
                &CondicoesDeParada::por_iteracoes(3_000),
                &mut Silencioso,
            );

            let solucao = motor.melhor_solucao();
            assert!(
                solucao.cobertura_total(),
                "C({p},{k},{t}): a melhor solução deixou {} alvos descobertos",
                solucao.total_descobertos()
            );
            assert_eq!(solucao.conferir_invariantes(motor.cobertura()), Ok(()));
            assert_eq!(solucao.quantidade(), motor.melhor_avaliacao().cartelas);
        }
    }

    #[test]
    fn o_recorde_nunca_piora_ao_longo_da_busca() {
        // §8: explorar pode piorar a solução atual, jamais o recorde.
        let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(7)).unwrap();
        let mut coletor = Coletor::default();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(5_000),
            &mut coletor,
        );

        let mut anterior = usize::MAX;
        let mut recordes = 0;
        for evento in &coletor.eventos {
            if let Evento::NovoRecorde { avaliacao, .. } = evento {
                assert!(
                    avaliacao.cartelas < anterior,
                    "recorde subiu de {anterior} para {}",
                    avaliacao.cartelas
                );
                anterior = avaliacao.cartelas;
                recordes += 1;
            }
        }
        assert!(recordes > 0, "a busca não registrou nenhum recorde");
    }

    #[test]
    fn a_solucao_atual_pode_piorar_livremente() {
        // O outro lado do §8: se a atual nunca piorasse, seria só uma subida
        // gulosa e o motor ficaria preso no primeiro ótimo local.
        let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(3)).unwrap();
        let mut coletor = Coletor::default();
        let mut config_com_progresso = config_rapida(3);
        config_com_progresso.intervalo_progresso = 100;
        motor.config = config_com_progresso;

        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(4_000),
            &mut coletor,
        );

        let houve_atual_pior_que_melhor = coletor.eventos.iter().any(|e| {
            matches!(e, Evento::Progresso { atual, melhor, .. }
                if atual.descobertos > 0 || atual.cartelas > melhor.cartelas)
        });
        assert!(
            houve_atual_pior_que_melhor,
            "a solução atual acompanhou o recorde o tempo todo: não houve exploração"
        );
    }

    #[test]
    fn a_politica_adaptativa_desce_mais_de_uma_cartela_por_vez() {
        // A política existe e faz o que promete — descer a meta de várias em
        // várias. O que a medição mostrou é que fazer isso não ajuda (veja a
        // tabela em `PassoDaMeta`), e por isso ela não é o padrão. O teste
        // guarda o comportamento para quem for medir de novo.
        let config = Configuracao {
            passo_da_meta: PassoDaMeta::Adaptativo {
                maximo: 64,
                iteracoes_para_dobrar: u64::MAX,
                iteracoes_para_recuar: 0,
            },
            ..config_rapida(5)
        };
        // C(14,5,3) sai da construção com 65 cartelas e tem piso 37: folga de
        // sobra para a meta descer mais de uma por vez sem esbarrar no piso.
        let mut motor = MotorBusca::novo(problema(14, 5, 3), config).unwrap();
        motor.executar(&Controle::novo(), &CondicoesDeParada::por_iteracoes(1), &mut Silencioso);

        let primeiro = motor.melhor_avaliacao().cartelas;
        // Simula três recordes fáceis seguidos e observa o passo.
        let mut passos = Vec::new();
        for _ in 0..3 {
            let antes = motor.alvo_cartelas;
            motor.definir_meta();
            passos.push(antes.saturating_sub(motor.alvo_cartelas));
            // O próximo recorde precisa existir para a meta seguinte ter de onde
            // sair; aqui basta fingir que a solução atual virou recorde.
            motor.melhor_avaliacao.cartelas = motor.alvo_cartelas;
        }

        assert!(
            passos.iter().any(|&p| p > 1),
            "com recordes fáceis a meta deveria descer mais de uma cartela por vez \
             (partida {primeiro}, passos {passos:?})"
        );
    }

    #[test]
    fn a_meta_ambiciosa_afrouxa_quando_nao_fecha() {
        // Um salto é tentativa, não compromisso. Sem este recuo, a meta que não
        // fecha trava a busca: o passo só é reavaliado no recorde seguinte, que
        // é justamente o que deixou de vir. Medido, `(21,17)` caía de quatro
        // recordes por minuto para um.
        let config = Configuracao {
            passo_da_meta: PassoDaMeta::Adaptativo {
                maximo: 64,
                iteracoes_para_dobrar: u64::MAX,
                iteracoes_para_recuar: 1,
            },
            ..config_rapida(5)
        };
        let mut motor = MotorBusca::novo(problema(14, 5, 3), config).unwrap();
        motor.executar(&Controle::novo(), &CondicoesDeParada::por_iteracoes(1), &mut Silencioso);

        // Uma meta deliberadamente ambiciosa, como a que sai de vários recordes
        // fáceis seguidos.
        motor.passo_atual = 8;
        motor.alvo_cartelas = motor.melhor_avaliacao().cartelas.saturating_sub(8).max(1);
        let ambiciosa = motor.alvo_cartelas;

        motor.recuar_a_meta();

        assert!(
            motor.alvo_cartelas > ambiciosa,
            "a meta que não fecha deveria afrouxar, e ficou em {}",
            motor.alvo_cartelas
        );
        assert_eq!(motor.passo_atual, 4, "o passo deveria cair pela metade");
        assert!(
            motor.alvo_cartelas < motor.melhor_avaliacao().cartelas,
            "afrouxar não é desistir: a meta continua abaixo do recorde"
        );
    }

    #[test]
    fn uma_sessao_retomada_continua_de_onde_parou() {
        // O que este teste protege é a promessa inteira do arquivo de sessão: se
        // alguém trabalhou dez horas e mudou de aparelho, as dez horas seguem
        // junto. Provar isso é mostrar que o motor retomado **não recomeça** —
        // que os contadores partem de onde estavam, que o recorde é o mesmo, e
        // que a próxima iteração soma em cima em vez de somar do zero.
        let mut original = MotorBusca::novo(problema(14, 5, 3), config_rapida(5)).unwrap();
        original.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(30_000),
            &mut Silencioso,
        );

        let melhor: Vec<Cartela> = original.melhor_cartelas().to_vec();
        let atuais: Vec<Cartela> = original.cartelas_atuais().to_vec();
        let retrato = original.retrato();
        assert!(retrato.iteracoes >= 30_000, "a busca precisa ter trabalhado antes de exportar");
        assert!(
            retrato.pesos_dos_operadores.iter().any(|&p| (p - 1.0).abs() > 1e-9),
            "os pesos precisam ter aprendido algo, senão não há o que transportar"
        );

        // Um motor novo, como o do outro aparelho: nada em comum além do arquivo.
        let mut retomado = MotorBusca::novo(problema(14, 5, 3), config_rapida(99)).unwrap();
        retomado.retomar_sessao(&melhor, &atuais, &retrato);

        assert_eq!(
            retomado.melhor_avaliacao().cartelas,
            original.melhor_avaliacao().cartelas,
            "o recorde precisa atravessar a exportação intacto"
        );
        assert_eq!(retomado.estatisticas().iteracoes, retrato.iteracoes);
        assert_eq!(retomado.estatisticas().recordes, retrato.recordes);
        assert_eq!(retomado.alvo_cartelas(), retrato.alvo_cartelas);
        assert_eq!(
            retomado.pesos_dos_operadores(),
            original.pesos_dos_operadores(),
            "o que o seletor aprendeu é parte do trabalho, e vai junto"
        );

        // E o teste que separa "retomou" de "recomeçou": mais trabalho soma em
        // cima do que já havia.
        retomado.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(retrato.iteracoes + 5_000),
            &mut Silencioso,
        );
        assert!(
            retomado.estatisticas().iteracoes > retrato.iteracoes,
            "as iterações precisam somar às antigas, não recomeçar"
        );
        assert!(
            retomado.melhor_avaliacao().cartelas <= original.melhor_avaliacao().cartelas,
            "continuar não pode piorar o recorde"
        );
    }

    #[test]
    fn uma_sessao_sem_solucao_em_curso_ainda_retoma_pelo_recorde() {
        // Arquivo de uma versão que não guardava a solução em curso. Perder o
        // ponto de exploração é aceitável; perder o recorde não seria.
        let mut original = MotorBusca::novo(problema(14, 5, 3), config_rapida(5)).unwrap();
        original.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(20_000),
            &mut Silencioso,
        );
        let melhor: Vec<Cartela> = original.melhor_cartelas().to_vec();
        let retrato = original.retrato();

        let mut retomado = MotorBusca::novo(problema(14, 5, 3), config_rapida(99)).unwrap();
        retomado.retomar_sessao(&melhor, &[], &retrato);

        assert_eq!(retomado.melhor_avaliacao().cartelas, original.melhor_avaliacao().cartelas);
        assert_eq!(retomado.estatisticas().iteracoes, retrato.iteracoes);
    }

    #[test]
    fn pesos_de_outro_tamanho_sao_recusados_inteiros() {
        // Um arquivo de uma versão com outro conjunto de operadores. Aplicar
        // parcialmente daria pesos trocados — pior que pesos zerados.
        let mut motor = MotorBusca::novo(problema(14, 5, 3), config_rapida(5)).unwrap();
        motor.executar(&Controle::novo(), &CondicoesDeParada::por_iteracoes(5_000), &mut Silencioso);
        let antes = motor.pesos_dos_operadores();

        let mut retrato = motor.retrato();
        retrato.pesos_dos_operadores = vec![1.0, 2.0];
        let melhor: Vec<Cartela> = motor.melhor_cartelas().to_vec();
        motor.retomar_sessao(&melhor, &[], &retrato);

        assert_eq!(motor.pesos_dos_operadores(), antes, "pesos de tamanho errado não entram");
    }

    #[test]
    fn o_padrao_e_o_passo_de_uma_cartela() {
        // Três políticas foram medidas contra ela e as três perderam. Este teste
        // é o que impede uma delas de voltar a ser padrão sem nova medição.
        assert_eq!(Configuracao::default().passo_da_meta, PassoDaMeta::Unitario);
    }

    #[test]
    fn o_recorde_cai_do_tamanho_que_a_poda_conseguir_ainda_que_a_meta_desca_de_uma() {
        // A confusão que a meta de uma em uma provoca: parece que o motor está
        // proibido de cortar em bloco. Não está. O teto desce de uma em uma; o
        // recorde cai do tamanho que a poda encontrar de supérfluo.
        let mut motor = MotorBusca::novo(problema(14, 5, 3), config_rapida(5)).unwrap();
        let mut coletor = Coletor::default();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(60_000),
            &mut coletor,
        );

        let tamanhos: Vec<usize> = coletor
            .eventos
            .iter()
            .filter_map(|e| match e {
                Evento::NovoRecorde { avaliacao, .. } => Some(avaliacao.cartelas),
                _ => None,
            })
            .collect();
        let maior_queda = tamanhos
            .windows(2)
            .filter(|p| p[0] > p[1])
            .map(|p| p[0] - p[1])
            .max()
            .unwrap_or(0);

        assert!(
            maior_queda > 1,
            "nenhuma queda de mais de uma cartela em {} recordes: {tamanhos:?}",
            tamanhos.len()
        );
    }

    #[test]
    fn o_passo_unitario_continua_disponivel_e_desce_de_um_em_um() {
        let config = Configuracao { passo_da_meta: PassoDaMeta::Unitario, ..config_rapida(5) };
        let mut motor = MotorBusca::novo(problema(14, 5, 3), config).unwrap();
        motor.executar(&Controle::novo(), &CondicoesDeParada::por_iteracoes(1), &mut Silencioso);

        let recorde = motor.melhor_avaliacao().cartelas;
        motor.definir_meta();
        assert_eq!(motor.alvo_cartelas, recorde - 1);
    }

    #[test]
    fn a_meta_nunca_desce_abaixo_do_limite_inferior() {
        // Perseguir menos que o piso provado é perseguir o impossível: a busca
        // gastaria o tempo inteiro numa cardinalidade que nenhuma solução tem.
        let config = Configuracao {
            passo_da_meta: PassoDaMeta::AteOPiso,
            ..config_rapida(5)
        };
        let mut motor = MotorBusca::novo(problema(9, 3, 2), config).unwrap();
        motor.executar(&Controle::novo(), &CondicoesDeParada::por_iteracoes(1), &mut Silencioso);
        motor.definir_meta();

        assert!(
            motor.alvo_cartelas >= motor.limite.valor as usize,
            "meta {} abaixo do piso {}",
            motor.alvo_cartelas,
            motor.limite.valor
        );
    }

    #[test]
    fn encontra_o_otimo_conhecido_de_um_caso_pequeno() {
        // C(9,3,2) = 12, valor provado. O motor precisa chegar lá.
        let mut motor = MotorBusca::novo(problema(9, 3, 2), config_rapida(5)).unwrap();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(50_000),
            &mut Silencioso,
        );

        assert_eq!(
            motor.melhor_avaliacao().cartelas,
            12,
            "C(9,3,2) = 12 e o motor deveria alcançar esse valor"
        );
        assert!(motor.optimalidade_provada(), "alcançando 12, a optimalidade é demonstrável");
    }

    #[test]
    fn para_sozinho_quando_a_optimalidade_e_provada() {
        let mut motor = MotorBusca::novo(problema(9, 3, 2), config_rapida(5)).unwrap();
        let motivo = motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(10_000_000),
            &mut Silencioso,
        );

        assert_eq!(motivo, MotivoEncerramento::OptimalidadeProvada);
        assert!(
            motor.estatisticas().iteracoes < 10_000_000,
            "deveria ter parado muito antes do limite"
        );
        assert_eq!(motor.gap(), Some(0.0));
    }

    #[test]
    fn a_construcao_inicial_larga_o_trabalho_quando_pedem_parada() {
        // O defeito medido: num pool de 25 com jogos de 20 a construção inicial
        // leva onze segundos em código nativo e o dobro em WebAssembly. Durante
        // ela o worker está dentro de uma chamada síncrona e não lê mensagem
        // nenhuma — quem tocasse em Pausar ou Encerrar não via efeito até o fim.
        //
        // Aqui a parada é pedida ANTES de executar, então a construção precisa
        // desistir na primeira cartela e devolver o controle de imediato.
        let controle = Controle::novo();
        controle.parar();

        let mut motor =
            MotorBusca::novo(problema_para_buscar(), config_rapida(3)).unwrap();

        let inicio = std::time::Instant::now();
        let motivo = motor.executar(
            &controle,
            &CondicoesDeParada::indefinida(),
            &mut Silencioso,
        );
        let decorrido = inicio.elapsed();

        assert_eq!(motivo, MotivoEncerramento::Solicitado);
        assert!(
            decorrido < std::time::Duration::from_secs(2),
            "a construção ignorou o pedido de parada e levou {decorrido:?}"
        );

        // E o que ficou pela metade não vira resultado: uma solução incompleta
        // não é viável, então não é gravada como recorde.
        assert!(
            motor.melhor_cartelas().is_empty() || motor.melhor_avaliacao().cobertura_total(),
            "uma construção interrompida não pode virar recorde"
        );
    }

    #[test]
    fn respeita_o_pedido_de_parada() {
        let mut motor = MotorBusca::novo(problema(20, 5, 3), config_rapida(2)).unwrap();
        let controle = Controle::novo();
        controle.parar();

        let motivo =
            motor.executar(&controle, &CondicoesDeParada::indefinida(), &mut Silencioso);

        assert_eq!(motivo, MotivoEncerramento::Solicitado);
        assert_eq!(motor.estatisticas().iteracoes, 0, "nem uma iteração deveria ter rodado");
    }

    #[test]
    fn continuar_retoma_de_onde_parou_sem_perder_o_recorde() {
        // §15 e §16: parar não pode custar nada.
        //
        // Usa uma instância que o motor não resolve à optimalidade em segundos.
        // Num caso fácil ele provaria o ótimo e encerraria por conta própria, e
        // a segunda chamada não teria mais o que fazer — o teste passaria a
        // medir outra coisa.
        let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(9)).unwrap();
        let condicoes = CondicoesDeParada::por_iteracoes(1_500);
        motor.executar(&Controle::novo(), &condicoes, &mut Silencioso);

        let recorde_parcial = motor.melhor_avaliacao().cartelas;
        let iteracoes_parciais = motor.estatisticas().iteracoes;
        assert!(recorde_parcial > 0);

        let mais_longe = CondicoesDeParada::por_iteracoes(6_000);
        motor.executar(&Controle::novo(), &mais_longe, &mut Silencioso);

        assert!(motor.estatisticas().iteracoes > iteracoes_parciais);
        assert!(
            motor.melhor_avaliacao().cartelas <= recorde_parcial,
            "o recorde piorou depois de continuar"
        );
        assert!(motor.melhor_solucao().cobertura_total());
    }

    #[test]
    fn semear_com_fechamento_existente_nunca_piora_o_ponto_de_partida() {
        // Modo A do §6: o usuário traz 100 cartelas e o motor só pode melhorar.
        let problema = problema(13, 4, 2);
        let cobertura = MotorCobertura::novo(&problema).unwrap();

        // Fechamento inicial deliberadamente inchado: todas as cartelas de um
        // guloso ingênuo, mais duplicatas.
        let mut inicial = Solucao::vazia(&cobertura);
        let mut oficina = Oficina::nova();
        let mut rng = Pcg64Mcg::seed_from_u64(4);
        construir_do_zero(&cobertura, &mut inicial, 0.5, usize::MAX, &mut rng, &mut oficina, None);
        let mut cartelas = inicial.cartelas().to_vec();
        cartelas.extend_from_slice(&cartelas.clone());
        let quantidade_inicial = cartelas.len();

        let mut motor = MotorBusca::novo(problema, config_rapida(4)).unwrap();
        motor.semear(&cartelas);
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(4_000),
            &mut Silencioso,
        );

        assert!(
            motor.melhor_avaliacao().cartelas < quantidade_inicial,
            "partiu de {quantidade_inicial} e não melhorou"
        );
        let solucao = motor.melhor_solucao();
        assert!(solucao.cobertura_total());
        assert_eq!(solucao.conferir_invariantes(&cobertura), Ok(()));
    }

    #[test]
    fn objetivo_de_cobertura_maxima_respeita_o_orcamento() {
        let problema = Problema::com_pool_inicial(
            20,
            20,
            5,
            RegraCobertura::cobrir_subconjuntos(2),
            Objetivo::MaximizarCobertura { orcamento: 8 },
        )
        .unwrap();

        let mut motor = MotorBusca::novo(problema, config_rapida(6)).unwrap();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(5_000),
            &mut Silencioso,
        );

        let avaliacao = motor.melhor_avaliacao();
        assert!(avaliacao.cartelas <= 8, "estourou o orçamento: {} cartelas", avaliacao.cartelas);
        assert!(avaliacao.cobertura() > 0.0);
        assert_eq!(motor.alvo_cartelas(), 8, "a meta deveria ficar parada no orçamento");
    }

    #[test]
    fn a_mesma_semente_produz_o_mesmo_resultado() {
        // Reprodutibilidade: sem isso, investigar um resultado estranho seria
        // impossível.
        let resultado = |semente: u64| {
            let mut motor = MotorBusca::novo(problema(13, 4, 2), config_rapida(semente)).unwrap();
            motor.executar(
                &Controle::novo(),
                &CondicoesDeParada::por_iteracoes(2_000),
                &mut Silencioso,
            );
            (motor.melhor_avaliacao().cartelas, motor.melhor_assinatura())
        };

        assert_eq!(resultado(123), resultado(123));
    }

    #[test]
    fn sementes_diferentes_exploram_caminhos_diferentes() {
        let assinatura = |semente: u64| {
            let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(semente)).unwrap();
            motor.executar(
                &Controle::novo(),
                &CondicoesDeParada::por_iteracoes(1_000),
                &mut Silencioso,
            );
            motor.melhor_assinatura()
        };

        let assinaturas: std::collections::HashSet<u64> = (0..6).map(assinatura).collect();
        assert!(assinaturas.len() > 1, "todas as sementes convergiram para a mesma solução");
    }

    #[test]
    fn o_arquivo_acumula_solucoes_diversas() {
        let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(8)).unwrap();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(20_000),
            &mut Silencioso,
        );

        assert!(motor.arquivo().quantidade() > 1, "o arquivo ficou praticamente vazio");
        for elite in motor.arquivo().ranking() {
            assert_eq!(elite.cartelas.len(), elite.avaliacao.cartelas);
        }
    }

    #[test]
    fn os_pesos_dos_operadores_se_diferenciam_com_o_tempo() {
        // §36: se todos continuassem iguais, não haveria aprendizado nenhum.
        let mut motor = MotorBusca::novo(problema_para_buscar(), config_rapida(10)).unwrap();
        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(20_000),
            &mut Silencioso,
        );

        let pesos: Vec<f64> = motor.pesos_dos_operadores().iter().map(|(_, p)| *p).collect();
        let maximo = pesos.iter().cloned().fold(f64::MIN, f64::max);
        let minimo = pesos.iter().cloned().fold(f64::MAX, f64::min);
        assert!(
            maximo - minimo > 0.01,
            "os pesos não se diferenciaram: {pesos:?}"
        );
    }

    #[test]
    fn diversificacao_dispara_quando_a_busca_estaciona() {
        let mut config = config_rapida(11);
        config.iteracoes_ate_diversificar = 200;
        let mut motor = MotorBusca::novo(problema_para_buscar(), config).unwrap();
        let mut coletor = Coletor::default();

        motor.executar(
            &Controle::novo(),
            &CondicoesDeParada::por_iteracoes(5_000),
            &mut coletor,
        );

        let diversificacoes = coletor
            .eventos
            .iter()
            .filter(|e| matches!(e, Evento::Diversificacao { .. }))
            .count();
        assert!(diversificacoes > 0, "a busca estacionou e ninguém a tirou de lá");
        assert_eq!(motor.estatisticas().diversificacoes as usize, diversificacoes);
    }
}
