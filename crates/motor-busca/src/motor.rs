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
/// Precisa ser pequeno. O custo de uma iteração varia por ordens de grandeza
/// entre configurações — um covering design pequeno faz centenas de milhares
/// por segundo, uma garantia parcial faz algumas centenas. Com um passo grande,
/// a mesma constante que é imperceptível no primeiro caso faz o segundo estourar
/// o limite de tempo em muitos segundos.
///
/// Ler `Instant::now` custa dezenas de nanossegundos; a cada 16 iterações isso
/// é ruído mesmo no caso mais rápido, e mantém a parada pontual no mais lento.
const ITERACOES_ENTRE_LEITURAS_DO_RELOGIO: u64 = 16;

/// A cada quantas iterações aceitas uma solução é oferecida ao arquivo.
///
/// Arquivar toda iteração encheria o arquivo de vizinhos quase idênticos e
/// gastaria tempo em comparações de distância; amostrar preserva a diversidade
/// que interessa a um custo desprezível.
const ACEITAS_ENTRE_ARQUIVAMENTOS: u64 = 64;

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
    /// Iterações entre dois eventos de progresso.
    pub intervalo_progresso: u64,
}

impl Default for Configuracao {
    fn default() -> Self {
        Self {
            semente: 0x5150_1A55,
            memoria_aceitacao: 500,
            iteracoes_ate_diversificar: 50_000,
            ruido_reconstrucao: 0.25,
            orcamento_por_cartela: 30_000,
            capacidade_por_faixa: 12,
            maximo_de_faixas: 8,
            distancia_minima_elites: 0.30,
            segmento_adaptativo: 500,
            fator_reacao: 0.20,
            recompensas: Recompensas::default(),
            intervalo_progresso: 100_000,
        }
    }
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

    /// Quantos candidatos avaliar por posição ao montar uma cartela. Derivado
    /// do orçamento e do custo real de avaliação desta configuração.
    max_candidatos: usize,

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
            max_candidatos,
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
        self.comecou = true;
        self.cartelas_trazidas = cartelas.len();
        self.escolher_partida(cartelas);
        self.consolidar_inicio();
    }

    /// Retoma de um estado salvo anteriormente (o CONTINUAR do §16).
    ///
    /// Diferente de [`Self::semear`], aqui as cartelas já são reconhecidas como
    /// recorde: a busca continua de onde parou em vez de recomeçar.
    pub fn retomar_de(&mut self, melhor: &[Cartela], iteracoes_anteriores: u64) {
        self.semear(melhor);
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
    fn escolher_partida(&mut self, trazidas: &[Cartela]) {
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

        if !trazidas.is_empty() {
            self.atual.reiniciar();
            for &cartela in trazidas {
                self.atual.adicionar(&self.cobertura, cartela, &mut self.oficina.rascunho);
            }
            considerar(self, "fechamento importado".to_string(), &mut vencedor);
        }

        if let Some(semente) = semente_algebrica(&self.problema) {
            self.atual.reiniciar();
            for &cartela in &semente.cartelas {
                self.atual.adicionar(&self.cobertura, cartela, &mut self.oficina.rascunho);
            }
            considerar(self, semente.origem, &mut vencedor);
        }

        construir_do_zero(
            &self.cobertura,
            &mut self.atual,
            self.config.ruido_reconstrucao,
            self.max_candidatos,
            &mut self.rng,
            &mut self.oficina,
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
        self.escolher_partida(&[]);
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
        self.garantir_inicio(observador);

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
                if self.estatisticas.iteracoes % ITERACOES_ENTRE_LEITURAS_DO_RELOGIO == 0
                    && inicio.elapsed() >= limite
                {
                    break MotivoEncerramento::LimiteDeTempo;
                }
            }

            self.uma_iteracao(inicio, observador);
        };

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
    fn definir_meta(&mut self) {
        let nova_meta = match self.problema.objetivo() {
            // Já resolvemos com N; agora a pergunta é se dá com N − 1.
            Objetivo::MinimizarCartelas => {
                let melhor = self.melhor_avaliacao.cartelas;
                if melhor == 0 {
                    usize::MAX
                } else {
                    // Um passo por vez, e não um salto direto para o recorde
                    // mundial.
                    //
                    // O salto foi tentado e medido: mirar a meta direto no
                    // melhor conhecido levou os empates com o mundo de 41,7%
                    // para 48,4% — e os casos com mais de 20% de distância de
                    // 31,4% para 49,3%, com os piores piorando muito
                    // (C(26,6,3) saiu de 246 para 288 cartelas).
                    //
                    // A razão é estrutural: `encolher_ate` corta a solução atual
                    // até a meta, e cortar 116 cartelas de uma vez deixa um
                    // destroço que a busca não consegue reparar. O passo único
                    // mantém a solução sempre perto de viável, que é justamente
                    // o que faz a busca por cardinalidade fixa funcionar. Quem
                    // ganha com o salto é o caso fácil, que já ia bem; quem
                    // perde é o difícil, que é o que o usuário sente.
                    (melhor - 1).max(1)
                }
            }
            // A meta é o orçamento e não se move; o que melhora é a cobertura.
            Objetivo::MaximizarCobertura { orcamento } => orcamento,
        };

        if nova_meta == self.alvo_cartelas {
            return;
        }
        self.alvo_cartelas = nova_meta;

        self.encolher_ate(nova_meta);
        self.aceitacao.reiniciar(chave_local(&self.atual.avaliacao()));
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
            construir_do_zero(
                &self.cobertura,
                &mut self.atual,
                // Ruído bem alto: o objetivo aqui é ir para longe, não ser bom.
                self.config.ruido_reconstrucao.max(0.6),
                self.max_candidatos,
                &mut self.rng,
                &mut self.oficina,
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
        construir_do_zero(&cobertura, &mut inicial, 0.5, usize::MAX, &mut rng, &mut oficina);
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
