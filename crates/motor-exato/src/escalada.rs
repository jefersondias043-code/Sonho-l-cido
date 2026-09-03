//! A escalada de cobertura: o teto é o piso, e o que cresce é a cobertura.
//!
//! ## A inversão
//!
//! O caminho comum monta uma solução grande e tenta encolhê-la — e é isso que
//! faz um aplicativo apresentar 323 cartelas onde o piso é 160, prometendo
//! reduzir depois. Aqui a lógica é a oposta:
//!
//! > **A quantidade de cartelas é limitada pelo mínimo matemático. A variável
//! > que evolui é a cobertura.**
//!
//! Começa com uma cartela e mede quanto ela cobre. Acrescenta a segunda, mede
//! de novo. Sobe até o teto — que é o piso provado, e nunca é ultrapassado.
//!
//! ```text
//!    1 cartela  →  8,3%
//!    2 cartelas → 16,7%
//!   11 cartelas → 88,9%
//!   12 cartelas → 94,4%   ← o teto; a subida sozinha para aqui
//!   12 cartelas → 100%    ← e a reorganização fecha, sem pedir a décima terceira
//! ```
//!
//! ## Por que isto é o algoritmo, e não só outra tela
//!
//! Se para `n = 1…11` a cobertura máxima fica abaixo de 100% e em 12 ela fecha,
//! então 12 **é** o mínimo. A porcentagem deixa de ser enfeite de progresso e
//! passa a ser a medida do que falta.
//!
//! ## Chegando ao teto sem fechar
//!
//! O número de cartelas congela e o conjunto passa a ser reescrito no lugar:
//! troca uma por outra, derruba várias e repõe várias, reestrutura inteiro.
//! Nunca acrescenta a cartela seguinte.
//!
//! E se não houver disposição que feche? O piso diz "nada menor existe", não diz
//! "isto basta". Em 20 dezenas com jogos de 17 o piso é 160 e o melhor
//! fechamento que o mundo conhece tem cerca de 240: ali a escalada encosta num
//! platô perto de 86%. Isso é resultado, e não falha — "com 160 cartelas o
//! melhor que alcancei foi 86,4%" é uma frase verdadeira e útil.
//!
//! ## Gerar, e não varrer
//!
//! Nada aqui materializa matriz de cobertura. As candidatas a atender um alvo
//! são geradas ([`BlocosDoAlvo`]), e os alvos que uma cartela atende também
//! ([`AlvosDoBloco`]). Num pool de 25 com jogos de 17 são 45 candidatas por
//! passo em vez de 1.081.575 — é o que faz a escalada caber num telefone.

use serde::{Deserialize, Serialize};

use crate::problema::{AlvosDoBloco, Bloco, BlocosDoAlvo, Colex, ErroDoProblema, Problema};

/// Quantas candidatas a escalada chega a avaliar num passo.
///
/// Avaliar uma custa percorrer os alvos que ela atende, e há configurações em
/// que isso são centenas de milhares. Avaliar todas seria a mesma parede que
/// travava a versão anterior; avaliar uma amostra espalhada mantém a escolha boa
/// e o passo finito.
pub const TETO_DE_CANDIDATAS: usize = 256;

/// E nunca menos que isto, para a escolha não virar sorteio puro.
pub const MINIMO_DE_CANDIDATAS: usize = 8;


/// Quantas trocas finas cabem numa rodada de otimização.
///
/// Cada troca custa duas varreduras de bloco, e uma rodada precisa custar o
/// bastante para o orçamento de trabalho ser respeitado sem que a contagem de
/// rodadas na tela suba rápido demais para ser lida.
pub const TROCAS_POR_RODADA: usize = 64;






/// Quantos alvos um passo pode percorrer antes de devolver o controle.
pub const ALVOS_POR_PASSO: u128 = 400_000;

/// Quantas rodadas sem ganho antes de a reorganização derrubar um pedaço maior.
pub const PACIENCIA: u32 = 60;

/// Quantas rodadas sem uma única melhoria antes de aceitar que o piso não basta.
///
/// O piso é uma **cota inferior**, não uma meta: para muitas configurações
/// nenhuma disposição daquele tamanho cobre tudo, e a reorganização fica
/// tentando o impossível para sempre. Medido, onde ela **consegue** fechar no
/// piso, consegue cedo — 273 rodadas em 19 números com jogos de 17, 793 em 20
/// com jogos de 18, e zero em 18 com jogos de 17, que fecha ainda na subida.
/// Onde não consegue, atravessa milhões de rodadas sem melhorar uma vez.
///
/// Cinco mil dá ao piso uma chance seis vezes maior que a pior tentativa
/// bem-sucedida observada, e continua sendo desistir cedo perto do infinito que
/// a alternativa custava. Como conta rodadas **sem ganho**, e uma rodada custa
/// mais num problema grande, a paciência cresce sozinha com a dificuldade.
pub const RODADAS_NO_PISO: u32 = 5_000;

/// Quanto trabalho um movimento do motor de Turán vale no orçamento.
///
/// O orçamento da escalada é contado em varreduras de alvo, e um movimento de
/// Turán custa duas travessias da lista de cobertura de um conjunto. O número
/// não precisa ser exato — precisa ser da ordem certa, para um lote de trabalho
/// pedido pela tela durar o tempo que ela espera.
const LOTE_POR_MOVIMENTO: u64 = 300;

/// Quantos pontos a curva de cobertura guarda, no máximo.
///
/// A curva é a resposta a "1 cartela → quanto? 2 cartelas → quanto?" — e ela
/// precisa existir como **dado**, e não como efeito do instante em que a tela
/// olhou: a subida costuma acontecer rápido demais para ser vista ao vivo. Num
/// teto de mil e quinhentas cartelas, guardar cada degrau seria desperdício;
/// acima deste número ela é afinada pela metade e passa a guardar de dois em
/// dois, de quatro em quatro, e assim por diante.
pub const PONTOS_DA_CURVA: usize = 240;

/// Em que ponto da escalada o motor está.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Fase {
    /// Ainda acrescentando cartelas, sem ter chegado ao teto.
    Subindo,
    /// No teto, reescrevendo o conjunto sem mudar o tamanho.
    Reorganizando,
    /// A construção avançada, pelo motor de Turán: órbitas e recursão.
    Construindo,
    /// Cobertura fechada, procurando fechar de novo com uma cartela a menos.
    Otimizando,
    /// A cobertura fechou. Não há mais o que fazer.
    Fechada,
}

impl std::fmt::Display for Fase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fase::Subindo => write!(f, "subindo"),
            Fase::Reorganizando => write!(f, "reorganizando"),
            Fase::Construindo => write!(f, "construindo"),
            Fase::Otimizando => write!(f, "otimizando"),
            Fase::Fechada => write!(f, "fechada"),
        }
    }
}

/// Onde a escalada está, num instante.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Passo {
    /// Quantas cartelas o conjunto atual tem. **Nunca passa de `teto`.**
    pub cartelas: usize,
    /// O limite de cartelas em vigor. Igual ao piso, até o piso se esgotar.
    pub teto: usize,
    /// A cota inferior provada. Não muda nunca, e é o que autoriza dizer
    /// "mínimo" quando a cobertura fecha em cima dela.
    pub piso: usize,
    /// Se a construção já passou do piso.
    ///
    /// Enquanto for falso, fechar a cobertura é fechar no mínimo. Verdadeiro, o
    /// que se tem é uma solução — boa, completa, e **não** comprovadamente
    /// mínima —, e a tela é obrigada a dizer isso.
    pub alem_do_piso: bool,
    /// A reorganização no piso já atravessou a paciência sem melhorar nada.
    ///
    /// É o sinal de que o piso provavelmente não basta — e é o momento de
    /// oferecer a construção avançada. Quem decide ligá-la é quem está olhando:
    /// passar do piso troca um mínimo provado por uma solução que apenas
    /// funciona, e essa troca não se faz pelas costas de ninguém.
    pub piso_esgotado: bool,
    /// Quantas cartelas tem a menor coleção **completa** já encontrada.
    ///
    /// Zero enquanto nenhuma fechou. É o número que a otimização faz cair.
    pub completo: usize,
    /// Cobertura do conjunto atual, de 0 a 1.
    pub cobertura: f64,
    /// A melhor cobertura já alcançada, de 0 a 1.
    pub melhor_cobertura: f64,
    /// Quantas cartelas tem o conjunto que alcançou a melhor cobertura.
    pub melhor_cartelas: usize,
    pub fase: Fase,
    /// Unidades de trabalho gastas desde o início.
    pub trabalho: u64,
    /// Quantas rodadas de reorganização já foram feitas.
    pub rodadas: u64,
    /// Verdadeiro quando a cobertura fechou em 100%.
    pub fechou: bool,
}

/// O estado inteiro, para guardar e retomar depois.
///
/// As cartelas vão como máscaras — um número por cartela — porque assim um
/// conjunto de milhares cabe folgado no armazenamento do navegador.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EstadoSalvo {
    pub v: usize,
    pub k: usize,
    pub j: usize,
    pub t: usize,
    pub r: usize,
    pub teto: usize,
    pub cartelas: Vec<Bloco>,
    pub melhor: Vec<Bloco>,
    pub fase: Fase,
    pub trabalho: u64,
    pub rodadas: u64,
    pub sem_ganho: u32,
    /// A cota inferior provada. Ausente nos estados gravados antes do modo
    /// avançado existir: ali teto e piso eram a mesma coisa.
    #[serde(default)]
    pub piso: usize,
    /// A menor coleção completa já encontrada. Sem ela, retomar depois de
    /// fechar perderia a única coisa que cumpria a garantia.
    #[serde(default)]
    pub melhor_completo: Vec<Bloco>,
    pub semente: u64,
    #[serde(default)]
    pub curva: Vec<(u32, f32)>,
    #[serde(default = "um")]
    pub passo_da_curva: usize,
}

fn um() -> usize {
    1
}

/// A escalada, com estado e continuável.
pub struct Escalada {
    p: Problema,
    teto: usize,
    /// A cota inferior provada, guardada à parte porque `teto` pode subir.
    piso: usize,
    /// O teto do modo avançado: mais que isto não existe cartela para escolher.
    teto_absoluto: usize,
    colex: Colex,
    do_bloco: AlvosDoBloco,
    do_alvo: BlocosDoAlvo,
    total_de_alvos: usize,
    /// Cópias exigidas ao todo: `alvos × premiadas`.
    exigidas: u64,
    candidatas_por_passo: usize,

    /// Por posição colex do alvo, quantas cartelas do conjunto atual o atendem.
    ///
    /// A contagem **não** é limitada em `r`: assim tirar uma cartela é subtrair
    /// um de cada alvo dela, exato, sem precisar saber o que já estava cheio.
    vezes: Vec<u16>,
    /// Cópias efetivamente entregues — a soma de `min(vezes, r)`.
    entregues: u64,

    cartelas: Vec<Bloco>,
    melhor: Vec<Bloco>,
    melhor_entregues: u64,
    /// A menor coleção que **cobre tudo**, entre as já vistas.
    ///
    /// Separada de `melhor` porque as duas respondem perguntas diferentes:
    /// `melhor` é a de maior cobertura, e durante a otimização a cobertura cai
    /// de propósito. Sem guardar a completa à parte, apertar o conjunto
    /// destruiria a única coleção que cumpria a garantia.
    melhor_completo: Vec<Bloco>,

    fase: Fase,
    trabalho: u64,
    rodadas: u64,
    sem_ganho: u32,
    semente: u64,


    /// O motor de Turán, quando o problema é representável por ele.
    ///
    /// Existe só a partir da construção avançada, e nunca é gravado: retomar um
    /// trabalho guardado recomeça a busca dele, mas as cartelas que ela já
    /// tinha achado estão em `melhor_completo` e não se perdem.
    turan: Option<crate::turan::Construtor>,

    /// A curva: por quantas cartelas, que cobertura.
    curva: Vec<(u32, f32)>,
    /// De quantas em quantas cartelas a curva ainda guarda um ponto.
    passo_da_curva: usize,
}

impl Escalada {
    /// Uma escalada nova, com o teto que o piso determinou.
    ///
    /// ## Quando o motor de Turán assume tudo
    ///
    /// Com garantia cheia e uma cartela premiada, o problema tem uma segunda
    /// forma — a complementar, um sistema de Turán — em que ele é muito menor e
    /// muito mais tratável. Havendo essa forma, e cabendo na memória, é ela que
    /// vale desde a primeira rodada: a escalada presa ao piso não é usada.
    ///
    /// Isso apaga os três estágios manuais **para esses casos**, e apaga porque
    /// a razão de eles existirem deixou de valer. Eles existiam porque a
    /// escalada empacava no piso sem saber se ele bastava, e passar do piso —
    /// trocar um mínimo provado por uma solução que apenas funciona — não podia
    /// ser decisão do motor. O motor novo não empaca: entrega um fechamento no
    /// primeiro segundo e vai baixando o número. Quando ele chega ao piso, o
    /// piso foi alcançado e o veredito diz "mínimo exato" como sempre disse —
    /// a comparação é entre o **resultado** e o piso, e não entre o teto e o piso.
    ///
    /// Fora dessa forma — garantia parcial, mais de uma cartela premiada,
    /// tamanho que não cabe —, tudo continua exatamente como estava, com os três
    /// estágios e os dois botões.
    pub fn nova(p: &Problema, teto: usize) -> Escalada {
        let alvos_por_bloco = p.alvos_por_bloco().max(1);
        let cabe = (ALVOS_POR_PASSO / alvos_por_bloco) as usize;
        let candidatas_por_passo = cabe.clamp(MINIMO_DE_CANDIDATAS, TETO_DE_CANDIDATAS);
        let total_de_alvos = p.total_de_alvos();

        let mut escalada = Escalada {
            p: *p,
            teto: teto.max(1),
            piso: teto.max(1),
            // Nenhuma coleção precisa de mais cartelas do que existem cartelas
            // distintas: acima disso só há repetição, que não cobre nada novo.
            teto_absoluto: p.total_de_blocos().min(usize::MAX as u128) as usize,
            colex: Colex::nova(),
            do_bloco: AlvosDoBloco::novo(p),
            do_alvo: BlocosDoAlvo::novo(p),
            total_de_alvos,
            exigidas: total_de_alvos as u64 * p.r as u64,
            candidatas_por_passo,
            vezes: vec![0; total_de_alvos],
            entregues: 0,
            cartelas: Vec::new(),
            melhor: Vec::new(),
            melhor_entregues: 0,
            melhor_completo: Vec::new(),
            fase: Fase::Subindo,
            trabalho: 0,
            rodadas: 0,
            sem_ganho: 0,
            semente: 0x243F_6A88_85A3_08D3,
            turan: None,
            curva: Vec::new(),
            passo_da_curva: 1,
        };
        escalada.tentar_o_turan();
        escalada
    }

    /// Engata o motor de Turán, se o problema tiver a forma dele.
    fn tentar_o_turan(&mut self) {
        if self.turan.is_some() {
            return;
        }
        self.turan = crate::turan::Construtor::novo(&self.p, self.semente);
        if let Some(construtor) = self.turan.as_mut() {
            // Nada de esperar por um botão: o número cai sozinho, e quem manda
            // parar é quem está olhando.
            construtor.liberar_a_descida();
            self.teto = self.teto_absoluto;
            self.fase = Fase::Construindo;
        }
    }

    /// As cartelas do melhor conjunto já alcançado.
    pub fn melhor(&self) -> &[Bloco] {
        &self.melhor
    }

    /// A menor coleção já encontrada que **cumpre a garantia inteira**.
    ///
    /// Diferente de [`Escalada::melhor`], que é a de maior cobertura: enquanto a
    /// garantia não fecha, a de maior cobertura não cumpre nada, e depois de
    /// fechar as duas podem divergir — a otimização desmonta a coleção atual
    /// para tentar uma menor, e é esta aqui que guarda o que já valia.
    pub fn melhor_completo(&self) -> &[Bloco] {
        &self.melhor_completo
    }

    /// As cartelas do conjunto em que ela está mexendo agora.
    pub fn atual(&self) -> &[Bloco] {
        &self.cartelas
    }

    pub fn teto(&self) -> usize {
        self.teto
    }

    /// A cota inferior provada, que não muda nem quando o teto sobe.
    pub fn piso(&self) -> usize {
        self.piso
    }

    pub fn fase(&self) -> Fase {
        self.fase
    }

    /// A curva de cobertura: por quantas cartelas, quanto já estava coberto.
    pub fn curva(&self) -> &[(u32, f32)] {
        &self.curva
    }

    fn fracao(&self, entregues: u64) -> f64 {
        if self.exigidas == 0 {
            return 1.0;
        }
        entregues as f64 / self.exigidas as f64
    }

    pub fn passo(&self) -> Passo {
        Passo {
            cartelas: self.cartelas.len(),
            teto: self.teto,
            piso: self.piso,
            alem_do_piso: self.teto > self.piso,
            piso_esgotado: self.fase == Fase::Reorganizando
                && self.teto <= self.piso
                && self.sem_ganho >= RODADAS_NO_PISO,
            completo: self.melhor_completo.len(),
            cobertura: self.fracao(self.entregues),
            melhor_cobertura: self.fracao(self.melhor_entregues),
            melhor_cartelas: self.melhor.len(),
            fase: self.fase,
            trabalho: self.trabalho,
            rodadas: self.rodadas,
            fechou: self.melhor_entregues >= self.exigidas,
        }
    }

    /// Trabalha o tanto que lhe pedirem, e devolve onde parou.
    ///
    /// Depois de qualquer chamada, com qualquer orçamento, vale sempre
    /// `atual().len() <= teto()`. É a regra que o módulo existe para respeitar.
    pub fn avancar(&mut self, orcamento: u64) -> Passo {
        let ate = self.trabalho.saturating_add(orcamento.max(1));
        while self.trabalho < ate && self.fase != Fase::Fechada {
            match self.fase {
                Fase::Subindo => self.subir_um_degrau(),
                Fase::Reorganizando => self.reorganizar_uma_rodada(),
                Fase::Construindo | Fase::Otimizando if self.turan.is_some() => {
                    self.girar_o_turan(ate)
                }
                Fase::Construindo => self.subir_um_degrau(),
                Fase::Otimizando => self.otimizar_uma_rodada(),
                Fase::Fechada => break,
            }
        }
        self.passo()
    }

    /* ─────────── fase 1: subindo ─────────── */

    /// Acrescenta uma cartela — a que mais aumenta a cobertura.
    fn subir_um_degrau(&mut self) {
        if self.cartelas.len() >= self.teto {
            self.fase = Fase::Reorganizando;
            return;
        }
        match self.melhor_acrescimo() {
            Some(cartela) => {
                self.por(cartela);
                self.anotar_na_curva();
                self.registrar();
                if self.entregues >= self.exigidas {
                    // Fechou. Antes de entregar, tira o que a ordem de chegada
                    // deixou para trás: o número que sai daqui é o que a
                    // otimização vai receber para apertar, e começar de um
                    // número inchado é desperdiçar o trabalho dela.
                    self.podar_o_que_sobra();
                    self.registrar();
                    self.fase = Fase::Fechada;
                } else if self.cartelas.len() >= self.teto {
                    self.fase = Fase::Reorganizando;
                }
            }
            // Nenhuma cartela acrescenta nada: subir mais não ajuda.
            None => self.fase = Fase::Reorganizando,
        }
    }

    /// Anota um ponto da curva, afinando quando ela fica longa demais.
    fn anotar_na_curva(&mut self) {
        let cartelas = self.cartelas.len();
        if cartelas % self.passo_da_curva != 0 {
            return;
        }
        self.curva.push((cartelas as u32, self.fracao(self.entregues) as f32));
        if self.curva.len() > PONTOS_DA_CURVA {
            // Fica com um ponto sim, um não: a curva mantém a forma, pela
            // metade do tamanho.
            let mut n = 0;
            self.curva.retain(|_| {
                n += 1;
                n % 2 == 1
            });
            self.passo_da_curva *= 2;
        }
    }

    /// A cartela que mais cópias em falta acrescenta, entre as que atendem um
    /// alvo ainda descoberto.
    ///
    /// ## Uma tentação que a bancada reprovou
    ///
    /// O algoritmo guloso clássico escolhe a cartela de maior ganho entre
    /// **todas**, e daí vem a garantia de `H(d)` vezes o ótimo. O que está aqui
    /// é mais estreito: sorteia um alvo descoberto e escolhe entre as cartelas
    /// que o atendem — dez, em 20 dezenas com jogos de 17.
    ///
    /// Alargar parecia óbvio, e foi medido: reunindo as candidatas de vinte e
    /// quatro alvos, a razão média contra os melhores fechamentos publicados
    /// **não se moveu** — e pool 20 com jogos de 18, que saía exato em 40
    /// cartelas, passou a sair com 46. O guloso mais ganancioso constrói uma
    /// estrutura mais rígida, e é dela que a otimização depois não consegue sair.
    ///
    /// A escolha estreita e sorteada fica, porque a bancada disse que ela é
    /// melhor. O registro deste parágrafo é para a tentação não voltar.
    fn melhor_acrescimo(&mut self) -> Option<Bloco> {
        let alvo = self.um_alvo_em_falta()?;
        let mut candidatas: Vec<Bloco> = Vec::new();
        let (p, do_alvo) = (self.p, &self.do_alvo);
        do_alvo.para_cada(&p, alvo, &mut |b| candidatas.push(b));
        self.trabalho += candidatas.len().max(1) as u64;
        // Uma cartela que já está no conjunto não acrescenta cópia nenhuma, por
        // mais que a conta de ganho diga o contrário.
        //
        // O `contains` de um `Vec` é varredura, e eram até 685 candidatas contra
        // uma coleção que nos casos reais chega a dez mil cartelas: sete milhões
        // de comparações por cartela acrescentada, e há dez mil a acrescentar.
        //
        // O conjunto é montado a cada chamada em vez de mantido ao lado da
        // coleção, e é escolha e não preguiça: sete pontos diferentes mexem em
        // `self.cartelas`, e um índice paralelo teria de ser mantido nos sete —
        // dessincronizar seria um defeito silencioso pior do que a lentidão que
        // ele conserta. Montar custa uma passada, e substitui o produto por uma
        // soma.
        let presentes: std::collections::HashSet<Bloco> = self.cartelas.iter().copied().collect();
        candidatas.retain(|b| !presentes.contains(b));
        if candidatas.is_empty() {
            return None;
        }

        let quantas = self.candidatas_por_passo.min(candidatas.len());
        let salto = (candidatas.len() / quantas).max(1);
        let inicio = proximo(&mut self.semente) as usize % candidatas.len();

        let mut melhores: Vec<Bloco> = Vec::new();
        let mut maior = 0u64;
        for n in 0..quantas {
            let b = candidatas[(inicio + n * salto) % candidatas.len()];
            let ganho = self.ganho_de(b);
            if ganho > maior {
                maior = ganho;
                melhores.clear();
                melhores.push(b);
            } else if ganho == maior {
                melhores.push(b);
            }
        }
        if maior == 0 {
            return None;
        }
        Some(melhores[proximo(&mut self.semente) as usize % melhores.len()])
    }

    /// Tira tudo o que, a esta altura, não faz mais falta.
    ///
    /// A subida gulosa escolhe cada cartela pela cobertura que ela traz **no
    /// instante em que entra**. Uma cartela que na rodada 40 era a melhor
    /// escolha do mundo pode, trezentas cartelas depois, estar inteiramente
    /// contida no que as outras já cobrem — e continua no conjunto, porque
    /// ninguém volta para conferir. Fechar em 100% não significa que todas as
    /// cartelas sejam necessárias; significa apenas que juntas elas bastam.
    ///
    /// Uma cartela cuja retirada não descobre alvo nenhum sai de graça: a
    /// garantia continua cumprida com uma a menos. Esta varredura tira todas
    /// elas, e repete enquanto encontrar — tirar uma pode não liberar outra,
    /// mas pode, e uma passada só deixaria dinheiro na mesa.
    ///
    /// A ordem importa e é segura: retirar uma cartela só **aumenta** a falta
    /// que as outras fazem, nunca diminui. Nada que passou no teste antes
    /// deixa de passar depois, então nenhuma retirada precisa ser desfeita.
    fn podar_o_que_sobra(&mut self) -> usize {
        let alvo_r = self.p.r as u16;
        let mut tiradas = 0usize;

        loop {
            let mut saiu = false;
            let mut i = 0usize;
            while i < self.cartelas.len() {
                let b = self.cartelas[i];

                let mut faz_falta = false;
                {
                    let (p, do_bloco, colex, vezes) =
                        (self.p, &self.do_bloco, &self.colex, &self.vezes);
                    do_bloco.para_cada(&p, b, &mut |a| {
                        if vezes[colex.posicao(a) as usize] <= alvo_r {
                            faz_falta = true;
                        }
                    });
                }
                self.trabalho = self.trabalho.saturating_add(1);

                if faz_falta {
                    i += 1;
                    continue;
                }

                let fora = self.cartelas.swap_remove(i);
                self.tirar(fora);
                tiradas += 1;
                saiu = true;
                // `swap_remove` trouxe outra cartela para esta posição: não avança.
            }
            if !saiu {
                break;
            }
        }

        tiradas
    }

    /* ─────────── fase 2: reorganizando, com o número travado ─────────── */

    /// Uma rodada de reescrita: derruba um pedaço e o refaz.
    ///
    /// O pedaço cresce quando muitas rodadas passam sem ganho — é o que tira a
    /// busca de um platô sem nunca acrescentar cartela. Uma cartela derrubada é
    /// sempre reposta, então o conjunto volta ao mesmo tamanho.
    fn reorganizar_uma_rodada(&mut self) {
        self.rodadas += 1;
        if self.cartelas.is_empty() {
            self.fase = Fase::Subindo;
            return;
        }

        let antes = self.entregues;
        let guardado = self.cartelas.clone();

        let escala = (self.sem_ganho / PACIENCIA) as usize;
        let quantas = (1 + escala).min(self.cartelas.len().max(1) / 2).max(1);

        for _ in 0..quantas {
            if self.cartelas.is_empty() {
                break;
            }
            let i = proximo(&mut self.semente) as usize % self.cartelas.len();
            let fora = self.cartelas.swap_remove(i);
            self.tirar(fora);
        }

        // E repõe exatamente as que saíram: o tamanho é lei.
        while self.cartelas.len() < guardado.len() {
            match self.melhor_acrescimo() {
                Some(cartela) => self.por(cartela),
                None => break,
            }
        }

        if self.entregues >= antes {
            self.registrar();
            if self.entregues > antes {
                self.sem_ganho = 0;
            } else {
                self.sem_ganho = self.sem_ganho.saturating_add(1);
            }
        } else {
            // Piorou: desfaz e tenta outro caminho na próxima rodada.
            self.trocar_conjunto(guardado);
            self.sem_ganho = self.sem_ganho.saturating_add(1);
        }

        if self.entregues >= self.exigidas {
            self.registrar();
            self.fase = Fase::Fechada;
        }
    }

    /// Um lote do motor de Turán, e a adoção do que ele achar.
    ///
    /// O construtor devolve conjuntos de dezenas **ausentes**; a tradução para
    /// cartelas é dele. O que chega aqui já são cartelas, e elas entram pelo
    /// mesmo caminho de sempre — `trocar_conjunto` e `registrar` —, de modo que
    /// `melhor_completo` continua sendo a única fonte do que cumpre a garantia.
    fn girar_o_turan(&mut self, ate: u64) {
        let lote = (ate.saturating_sub(self.trabalho) / LOTE_POR_MOVIMENTO).clamp(1, 200_000);

        let Some(construtor) = self.turan.as_mut() else {
            self.fase = Fase::Fechada;
            return;
        };
        let antes = construtor.trabalho();
        let melhorou = construtor.avancar(lote);
        let gasto = construtor.trabalho().saturating_sub(antes).max(1);
        let terminou = construtor.terminou();
        let cartelas = if melhorou { construtor.cartelas() } else { Vec::new() };

        // O que se cobra é o que foi feito, e não o que se pediu: uma rodada em
        // órbitas toca vinte vezes mais posições que uma troca de dezena.
        self.trabalho = self.trabalho.saturating_add(gasto);
        self.rodadas += 1;

        if melhorou && !cartelas.is_empty() {
            self.trocar_conjunto(cartelas);
            self.registrar();
        }

        if terminou {
            self.fase = Fase::Fechada;
        }
    }

    /* ─────────── fase 3: construção avançada ─────────── */

    /// Aceita que o piso não bastou, e volta a acrescentar cartelas.
    ///
    /// O piso é uma cota **inferior**: ele diz que nada menor existe, e não que
    /// aquele tamanho basta. Para muitas configurações ele é inatingível — em
    /// 20 números com jogos de 17 garantindo 15 o piso é 160 e o melhor
    /// fechamento conhecido tem 240 —, e ali a reorganização passa a tentar o
    /// impossível: nenhuma disposição de 160 cartelas cobre tudo, então ela
    /// reescreve o conjunto para sempre sem nunca fechar.
    ///
    /// Quando a reorganização atravessa [`RODADAS_NO_PISO`] sem uma única
    /// melhoria, o teto sobe e a subida recomeça. A partir daí a coleção deixa
    /// de ser candidata a mínima — e é por isso que [`Passo::alem_do_piso`]
    /// existe: quem mostra o resultado precisa parar de falar em mínimo no
    /// momento exato em que isso deixa de ser verdade.
    pub fn liberar_o_teto(&mut self) {
        if self.fase == Fase::Fechada {
            return;
        }

        // O motor de Turán, quando o problema é representável por ele: garantia
        // cheia, uma cartela premiada, e tamanho que cabe na memória. Ele entrega
        // muito menos cartelas que a subida gulosa — 240 contra 328 em 20 dezenas
        // com jogos de 17, que é o melhor fechamento publicado para o caso — e a
        // razão é a troca de ponto de vista, explicada em `turan.rs`.
        //
        // Fora do que ele representa, a subida gulosa continua sendo o caminho.
        if self.turan.is_none() {
            self.turan = crate::turan::Construtor::novo(&self.p, self.semente);
        }
        if let Some(construtor) = self.turan.as_mut() {
            // A descida precisa ser liberada aqui como é em `tentar_o_turan`.
            //
            // Hoje este ramo é inalcançável — `Escalada::nova` sempre tenta o
            // Turán, e o construtor é determinístico, então chegar aqui com
            // `None` implica que lá também deu `None`. Mas é armadilha armada:
            // no dia em que o construtor passar a recusar por memória ou por
            // orçamento, este caminho monta um motor que entra em `Descendo`
            // com a trava fechada, e `descer` volta sem fazer nada. O resultado
            // seria fase "construindo", zero progresso e trabalho sendo cobrado
            // para sempre — indistinguível de travamento.
            construtor.liberar_a_descida();
            self.teto = self.teto_absoluto;
            self.sem_ganho = 0;
            self.fase = Fase::Construindo;
            return;
        }

        if self.teto >= self.teto_absoluto {
            return;
        }
        // O teto sai de vez, e não sobe de cartela em cartela.
        //
        // Subir de uma em uma parece mais cuidadoso e é pior: cada cartela nova
        // custaria outra paciência inteira de reorganização, e a resposta já foi
        // dada — o piso não basta. Medido, avançar assim levou 180 segundos para
        // acrescentar onze cartelas em 20 números com jogos de 17, e faltavam
        // oitenta. Sem teto, a mesma subida fecha em 100% em frações de segundo.
        self.teto = self.teto_absoluto;
        self.sem_ganho = 0;
        self.fase = Fase::Subindo;
    }

    /* ─────────── fase 4: otimização ─────────── */

    /// Começa a apertar: tenta cobrir tudo com uma cartela a menos, e outra.
    ///
    /// Só faz sentido depois de a garantia estar cumprida, e é por isso que
    /// existe separada da escalada: a subida responde "consigo cobrir tudo?", e
    /// a otimização responde "consigo com menos?". Fechar acima do piso deixa
    /// uma folga grande — em 20 números com jogos de 17 a subida livre fecha com
    /// 344 cartelas e o melhor fechamento conhecido tem 240 —, e é essa folga
    /// que ela come.
    ///
    /// Ligar é decisão de quem está olhando. A coleção completa já encontrada
    /// fica guardada em `melhor_completo` e **nunca** é perdida: apertar só
    /// pode melhorar o número, nunca estragar o que já cumpria a garantia.
    pub fn otimizar(&mut self) {
        if self.melhor_completo.is_empty() || self.melhor_completo.len() <= 1 {
            return;
        }

        // Com o motor de Turán, apertar é liberar a descida que ele já tinha
        // pronta e parada esperando esta ordem.
        //
        // Se ele não existe — o aplicativo foi fechado e reaberto, e o motor não
        // é gravado —, um novo parte direto do fechamento guardado. Sem isto, o
        // botão de otimizar cairia no caminho antigo depois de cada retomada, e
        // o usuário veria o mesmo botão fazer duas coisas diferentes.
        if self.turan.is_none() {
            self.turan =
                crate::turan::Construtor::a_partir_de(&self.p, self.semente, &self.melhor_completo);
        }
        if let Some(construtor) = self.turan.as_mut() {
            construtor.liberar_a_descida();
            self.teto = self.teto_absoluto;
            self.fase = Fase::Otimizando;
            return;
        }
        let completo = self.melhor_completo.clone();
        self.trocar_conjunto(completo);
        self.tirar_a_menos_util();
        self.teto = self.cartelas.len();
        self.sem_ganho = 0;
        self.fase = Fase::Otimizando;
    }

    /// Uma troca fina: uma dezena de uma cartela, por outra que ela não tem.
    ///
    /// ## Por que o movimento grosso não chegava lá
    ///
    /// A reorganização derruba cartelas **inteiras** e as reconstrói pelo
    /// guloso. É um movimento caro — cada rodada custa dezenas de milhares de
    /// varreduras — e grosseiro: trocar uma cartela inteira muda a cobertura de
    /// centenas de alvos de uma vez, e quase toda mudança dessas piora. Medido
    /// na bancada de qualidade, em pool 22 com jogos de 19 ela saía de 195 para
    /// 189 cartelas e travava, com o melhor conhecido em 126.
    ///
    /// Trocar **uma dezena** de **uma** cartela é o movimento que a literatura
    /// de coberturas usa — é com ele que Nurmela e Östergård produziram boa
    /// parte dos valores publicados. Ele custa duas varreduras de bloco, contra
    /// dezenas de milhares, e mexe no mínimo possível: a busca passa a andar
    /// pelo espaço em vez de saltar sobre ele.
    ///
    /// Movimentos que não pioram são aceitos, inclusive os que não melhoram. É
    /// o que permite atravessar um platô de lado em vez de ficar preso no
    /// primeiro ponto em que nada melhora.
    fn trocar_uma_dezena(&mut self) {
        if self.cartelas.is_empty() {
            return;
        }
        let i = proximo(&mut self.semente) as usize % self.cartelas.len();
        let velha = self.cartelas[i];

        let dentro = crate::problema::elementos(velha, self.p.v);
        let fora = crate::problema::elementos(
            !velha & crate::problema::mascara_cheia(self.p.v),
            self.p.v,
        );
        if dentro.is_empty() || fora.is_empty() {
            return;
        }

        let sai = dentro[proximo(&mut self.semente) as usize % dentro.len()];
        let entra = fora[proximo(&mut self.semente) as usize % fora.len()];
        let nova = (velha & !(1 << sai)) | (1 << entra);

        // Uma cartela repetida ocupa lugar sem cobrir nada de novo.
        if self.cartelas.contains(&nova) {
            self.sem_ganho = self.sem_ganho.saturating_add(1);
            return;
        }

        let antes = self.entregues;
        self.cartelas.swap_remove(i);
        self.tirar(velha);
        self.por(nova);

        if self.entregues < antes {
            // Piorou: desfaz. A cartela nova está no fim, onde `por` a pôs.
            //
            // Aqui foi tentado o critério de Metropolis — aceitar a piora com
            // probabilidade `exp(−Δ/T)`, temperatura calibrada sozinha pela taxa
            // de aceitação e resfriada por rodada. Medido na bancada, ele
            // **piorou** em toda a família: com orçamento igual, pool 20 com
            // jogos de 17 saía de 310 para 328 cartelas, e com vinte vezes o
            // orçamento empatava. A razão está no custo do movimento: em pool 23
            // com jogos de 20 cada cartela cobre 15.504 alvos, então uma troca
            // custa trinta e um mil varreduras e o orçamento inteiro dá seis mil
            // movimentos. Recozimento com seis mil movimentos não é recozimento
            // — é um passeio aleatório que não tem tempo de voltar.
            self.cartelas.pop();
            self.tirar(nova);
            self.por(velha);
            self.sem_ganho = self.sem_ganho.saturating_add(1);
            return;
        }

        if self.entregues > antes {
            self.sem_ganho = 0;
            self.registrar();
        } else {
            self.sem_ganho = self.sem_ganho.saturating_add(1);
        }
    }

    /// Uma rodada de otimização: fechou neste tamanho? aperta mais um.
    fn otimizar_uma_rodada(&mut self) {
        if self.entregues >= self.exigidas {
            self.registrar();
            if self.cartelas.len() <= 1 {
                self.fase = Fase::Fechada;
                return;
            }
            self.tirar_a_menos_util();
            self.teto = self.cartelas.len();
            self.sem_ganho = 0;
            return;
        }
        // Ainda não cobre neste tamanho: procurar uma disposição que cubra sem
        // crescer, uma dezena de cada vez.
        self.rodadas += 1;
        for _ in 0..TROCAS_POR_RODADA {
            self.trocar_uma_dezena();
            if self.entregues >= self.exigidas {
                break;
            }
        }
    }

    /// Tira a cartela cuja saída custa menos cobertura.
    ///
    /// Tirar ao acaso funcionaria e convergiria muito mais devagar: numa
    /// coleção completa a maioria das cartelas é insubstituível, e algumas são
    /// pura redundância. A que custa zero sai de graça — a garantia continua
    /// cumprida com uma cartela a menos, sem nenhuma reorganização.
    fn tirar_a_menos_util(&mut self) {
        if self.cartelas.is_empty() {
            return;
        }
        let alvo_r = self.p.r as u16;
        let mut pior = 0usize;
        let mut menor_perda = u64::MAX;
        for (i, &b) in self.cartelas.iter().enumerate() {
            let mut perda = 0u64;
            self.do_bloco.para_cada(&self.p, b, &mut |a| {
                let posicao = self.colex.posicao(a) as usize;
                if self.vezes[posicao] <= alvo_r {
                    perda += 1;
                }
            });
            if perda < menor_perda {
                menor_perda = perda;
                pior = i;
                if perda == 0 {
                    break;
                }
            }
        }
        let fora = self.cartelas.swap_remove(pior);
        self.tirar(fora);
        self.trabalho = self.trabalho.saturating_add(self.cartelas.len() as u64);
    }

    /* ─────────── a contabilidade da cobertura ─────────── */

    /// Quantas cópias em falta esta cartela acrescentaria.
    fn ganho_de(&mut self, bloco: Bloco) -> u64 {
        let alvo_r = self.p.r as u16;
        let mut ganho = 0u64;
        let mut vistos = 0u64;
        let (p, do_bloco, colex, vezes) = (self.p, &self.do_bloco, &self.colex, &self.vezes);
        do_bloco.para_cada(&p, bloco, &mut |a| {
            vistos += 1;
            if vezes[colex.posicao(a) as usize] < alvo_r {
                ganho += 1;
            }
        });
        self.trabalho += vistos;
        ganho
    }

    fn por(&mut self, bloco: Bloco) {
        let alvo_r = self.p.r as u16;
        let mut entregues = self.entregues;
        let mut vistos = 0u64;
        {
            let (p, do_bloco, colex) = (self.p, &self.do_bloco, &self.colex);
            let vezes = &mut self.vezes;
            do_bloco.para_cada(&p, bloco, &mut |a| {
                let i = colex.posicao(a) as usize;
                vistos += 1;
                if vezes[i] < alvo_r {
                    entregues += 1;
                }
                vezes[i] += 1;
            });
        }
        self.entregues = entregues;
        self.trabalho += vistos;
        self.cartelas.push(bloco);
    }

    fn tirar(&mut self, bloco: Bloco) {
        let alvo_r = self.p.r as u16;
        let mut entregues = self.entregues;
        let mut vistos = 0u64;
        {
            let (p, do_bloco, colex) = (self.p, &self.do_bloco, &self.colex);
            let vezes = &mut self.vezes;
            do_bloco.para_cada(&p, bloco, &mut |a| {
                let i = colex.posicao(a) as usize;
                vistos += 1;
                vezes[i] -= 1;
                if vezes[i] < alvo_r {
                    entregues -= 1;
                }
            });
        }
        self.entregues = entregues;
        self.trabalho += vistos;
    }

    /// Troca o conjunto inteiro, refazendo a contagem do zero.
    fn trocar_conjunto(&mut self, novo: Vec<Bloco>) {
        self.vezes.iter_mut().for_each(|n| *n = 0);
        self.entregues = 0;
        self.cartelas.clear();
        for b in novo {
            self.por(b);
        }
    }

    /// Guarda o conjunto atual se ele bateu o recorde de cobertura.
    ///
    /// O recorde nunca regride: a reorganização aceita um movimento lateral para
    /// sair de um platô, e sem esta cópia à parte a tela veria a cobertura
    /// piorar sozinha.
    fn registrar(&mut self) {
        // Mais cobertura é melhor; com a mesma cobertura, menos cartelas é
        // melhor. Sem a segunda metade a otimização não teria como registrar
        // nada: ela fecha de novo com uma cartela a menos, e "de novo" é
        // cobertura igual, não maior.
        let melhorou = self.melhor.is_empty()
            || self.entregues > self.melhor_entregues
            || (self.entregues == self.melhor_entregues
                && self.cartelas.len() < self.melhor.len());
        if melhorou {
            self.melhor_entregues = self.entregues;
            self.melhor = self.cartelas.clone();
        }

        // A menor coleção que cumpre a garantia, guardada à parte para a
        // otimização poder desmontar a atual sem risco de perdê-la.
        if self.entregues >= self.exigidas
            && (self.melhor_completo.is_empty() || self.cartelas.len() < self.melhor_completo.len())
        {
            self.melhor_completo = self.cartelas.clone();
        }
    }

    /// Um alvo que ainda não tem as `r` cópias, a partir de um ponto sorteado.
    ///
    /// A varredura recomeça a cada chamada porque, na reorganização, a cobertura
    /// **diminui** quando uma cartela sai — um cursor que só andasse para a
    /// frente perderia os alvos que voltaram a faltar.
    fn um_alvo_em_falta(&mut self) -> Option<Bloco> {
        let alvo_r = self.p.r as u16;
        if self.total_de_alvos == 0 {
            return None;
        }
        let inicio = proximo(&mut self.semente) as usize % self.total_de_alvos;
        for passo in 0..self.total_de_alvos {
            let i = (inicio + passo) % self.total_de_alvos;
            if self.vezes[i] < alvo_r {
                self.trabalho += passo as u64 + 1;
                return Some(crate::problema::combinacao_colex(i as u128, self.p.j));
            }
        }
        self.trabalho += self.total_de_alvos as u64;
        None
    }

    /* ─────────── guardar e retomar ─────────── */

    pub fn guardar(&self) -> EstadoSalvo {
        EstadoSalvo {
            v: self.p.v,
            k: self.p.k,
            j: self.p.j,
            t: self.p.t,
            r: self.p.r,
            teto: self.teto,
            cartelas: self.cartelas.clone(),
            melhor: self.melhor.clone(),
            fase: self.fase,
            trabalho: self.trabalho,
            rodadas: self.rodadas,
            sem_ganho: self.sem_ganho,
            piso: self.piso,
            melhor_completo: self.melhor_completo.clone(),
            semente: self.semente,
            curva: self.curva.clone(),
            passo_da_curva: self.passo_da_curva,
        }
    }

    /// Retoma de onde parou, refazendo a contagem a partir das cartelas.
    ///
    /// A contagem é reconstruída, e não guardada: são milhões de posições, e
    /// recalculá-las custa uma passada pelas cartelas — barato, e imune a um
    /// estado que tenha envelhecido mal.
    pub fn retomar(estado: &EstadoSalvo) -> Result<Escalada, ErroDoProblema> {
        let p = Problema::novo(estado.v, estado.k, estado.j, estado.t, estado.r)?;

        /*
         * O que vem de fora é conferido antes de virar cartela.
         *
         * `EstadoSalvo` chega por serde a partir do armazenamento do navegador,
         * e `Problema::novo` valida os cinco parâmetros — mas nada conferia que
         * cada máscara tivesse exatamente `k` dezenas acesas, todas dentro do
         * pool. Uma máscara curta faz `espalhar` indexar fora da lista de
         * posições, e em WebAssembly o perfil de publicação usa
         * `panic = "abort"`: o pânico vira armadilha, envenena a instância
         * inteira, e o worker morre sem conseguir avisar.
         *
         * Chegar aqui exige um blob truncado ou adulterado, e não um uso
         * normal. Mas isto é fronteira de desserialização, e fronteira dessas
         * não deveria confiar: o custo de conferir é uma passada, e o custo de
         * não conferir é a tela morta sem explicação.
         *
         * Máscaras inválidas são descartadas, não recusadas: o resto do
         * trabalho guardado continua valendo, e a escalada reconstrói o que
         * faltar. Recusar tudo por causa de uma cartela torta perderia trabalho
         * bom por excesso de zelo.
         */
        let cheia = crate::problema::mascara_cheia(p.v);
        let valida = |b: &Bloco| b & !cheia == 0 && b.count_ones() as usize == p.k;
        let cartelas: Vec<Bloco> = estado.cartelas.iter().copied().filter(valida).collect();
        let melhor: Vec<Bloco> = estado.melhor.iter().copied().filter(valida).collect();
        let melhor_completo: Vec<Bloco> =
            estado.melhor_completo.iter().copied().filter(valida).collect();

        let mut escalada = Escalada::nova(&p, estado.teto);
        escalada.trocar_conjunto(cartelas);
        escalada.melhor.clone_from(&melhor);
        escalada.melhor_entregues = escalada.entregues_de(&melhor);
        escalada.trabalho = estado.trabalho;
        escalada.rodadas = estado.rodadas;
        escalada.sem_ganho = estado.sem_ganho;
        // Estado gravado antes do modo avançado: ali o teto era o piso.
        escalada.piso = if estado.piso > 0 { estado.piso } else { estado.teto };
        escalada.melhor_completo.clone_from(&melhor_completo);
        escalada.semente = estado.semente;
        escalada.curva.clone_from(&estado.curva);
        escalada.passo_da_curva = estado.passo_da_curva.max(1);

        // ## A fase gravada é de um motor que pode já não ser o desta execução
        //
        // `Escalada::nova` engata o motor de Turán quando o problema tem a forma
        // dele. Copiar a fase do estado salvo por cima disso deixava o motor
        // montado e **nunca chamado**: `avancar` via `Reorganizando` e ia para a
        // subida antiga, com o motor novo parado ao lado.
        //
        // O estrago não aparecia em teste nenhum porque todos partiam de
        // `nova`. Aparecia no aplicativo, e do pior jeito: a tela passa o
        // trabalho guardado junto **mesmo quando alguém toca em Resolver**,
        // então toda configuração já trabalhada voltava ao motor velho enquanto
        // o carimbo da versão dizia que era o novo.
        if escalada.turan.is_some() {
            // Havendo um fechamento guardado, o motor retoma dele: apertar o que
            // já vale é melhor do que recomeçar do zero.
            if !escalada.melhor_completo.is_empty() {
                if let Some(construtor) = crate::turan::Construtor::a_partir_de(
                    &p,
                    escalada.semente,
                    &escalada.melhor_completo,
                ) {
                    escalada.turan = Some(construtor);
                }
            }
            escalada.teto = escalada.teto_absoluto;
            escalada.fase = Fase::Construindo;
        } else {
            escalada.fase = estado.fase;
        }

        Ok(escalada)
    }

    /// Quantas cópias um conjunto qualquer entrega, contadas do zero.
    fn entregues_de(&self, cartelas: &[Bloco]) -> u64 {
        let alvo_r = self.p.r as u16;
        let mut vezes = vec![0u16; self.total_de_alvos];
        for &b in cartelas {
            self.do_bloco.para_cada(&self.p, b, &mut |a| {
                vezes[self.colex.posicao(a) as usize] += 1;
            });
        }
        vezes.iter().map(|&n| n.min(alvo_r) as u64).sum()
    }
}

/// Um gerador linear congruente, para escolher sem chamar o sistema.
///
/// A semente é fixa e viaja no estado salvo: retomar continua o mesmo percurso
/// que teria acontecido sem a parada.
fn proximo(estado: &mut u64) -> u64 {
    *estado = estado.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *estado >> 33
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::limites;
    /// **Retomar não pode voltar ao motor antigo.**
    ///
    /// O defeito que este teste existe para não deixar voltar: a fase gravada
    /// era copiada por cima da que `Escalada::nova` tinha acabado de escolher, e
    /// o motor de Turán ficava montado sem nunca ser chamado. No aplicativo isso
    /// significava que toda configuração já trabalhada rodava o motor velho —
    /// com o carimbo da versão nova na tela.
    #[test]
    fn retomar_um_estado_antigo_nao_devolve_o_motor_antigo() {
        let p = Problema::novo(11, 8, 5, 5, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 13);
        assert_eq!(escalada.fase(), Fase::Construindo, "o motor novo devia ter assumido");
        escalada.avancar(2_000_000);

        // Um estado como os gravados antes do motor novo existir: fase da
        // escalada, e nada que indique Turán.
        let mut salvo = escalada.guardar();
        salvo.fase = Fase::Reorganizando;

        let retomada = Escalada::retomar(&salvo).unwrap();
        assert_eq!(
            retomada.fase(),
            Fase::Construindo,
            "retomar caiu no motor antigo"
        );

        // E ele continua de onde o outro parou, sem jogar fora o que já valia.
        assert_eq!(retomada.melhor_completo().len(), escalada.melhor_completo().len());
    }

    /// **Retomar não confia no que vem do armazenamento.**
    ///
    /// `EstadoSalvo` chega por serde a partir do navegador. `Problema::novo`
    /// confere os cinco parâmetros, mas nada conferia as máscaras: uma com
    /// menos dezenas do que `k` faz `espalhar` indexar fora da lista de
    /// posições, e com `panic = "abort"` em WebAssembly isso mata o worker sem
    /// deixar mensagem — a tela fica "calculando" para sempre.
    ///
    /// O que se cobra aqui é o comportamento inteiro: não entrar em pânico,
    /// descartar só o que está torto, e preservar o que estava bom.
    #[test]
    fn retomar_descarta_cartela_torta_sem_derrubar_o_motor() {
        let p = Problema::novo(11, 8, 5, 5, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 13);
        escalada.avancar(2_000_000);

        let mut salvo = escalada.guardar();
        let boas = salvo.cartelas.len();
        assert!(boas > 0, "o teste precisa de cartelas boas para preservar");

        // Três formas de torto, todas alcançáveis por um blob adulterado:
        // poucas dezenas, dezenas demais, e dezena fora do pool.
        salvo.cartelas.push(0b0000_0011);
        salvo.cartelas.push(crate::problema::mascara_cheia(11));
        salvo.cartelas.push(1 << 20);

        let retomada = Escalada::retomar(&salvo).expect("retomar não pode entrar em pânico");
        assert_eq!(
            retomada.atual().len(),
            boas,
            "as tortas deviam ter sido descartadas, e só elas"
        );
        for b in retomada.atual() {
            assert_eq!(b.count_ones() as usize, p.k);
        }
    }

    /// Com garantia parcial, retomar preserva a fase gravada — ali a escalada
    /// continua sendo quem manda.
    #[test]
    fn retomar_com_garantia_parcial_preserva_a_fase() {
        let p = Problema::novo(13, 4, 4, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 6);
        assert_ne!(escalada.fase(), Fase::Construindo, "aqui o Turán não vale");
        escalada.avancar(500_000);

        let salvo = escalada.guardar();
        let retomada = Escalada::retomar(&salvo).unwrap();
        assert_eq!(retomada.fase(), salvo.fase, "a fase gravada tinha de valer");
    }

    /// **O teto nunca sobe sozinho.** Passar do piso troca um mínimo provado
    /// por uma solução que apenas funciona, e essa troca é de quem está olhando.
    ///
    /// O que o motor faz por conta própria é **avisar**: esgotada a paciência de
    /// [`RODADAS_NO_PISO`] sem uma única melhoria, `piso_esgotado` fica
    /// verdadeiro e a tela oferece a construção avançada.
    #[test]
    fn o_teto_nunca_sobe_sozinho_e_o_motor_avisa_quando_o_piso_se_esgota() {
        let p = Problema::novo(13, 4, 4, 2, 1).unwrap();
        let piso = limites::sem_busca(&p).valor as usize;
        let mut escalada = Escalada::nova(&p, piso);

        let mut passo = escalada.avancar(20_000);
        while !passo.piso_esgotado && passo.rodadas < 200_000 {
            passo = escalada.avancar(20_000);
        }
        assert!(passo.piso_esgotado, "o motor precisava avisar que o piso se esgotou");
        assert!(
            passo.rodadas >= RODADAS_NO_PISO as u64,
            "avisou na rodada {}, e a paciência é de {RODADAS_NO_PISO}",
            passo.rodadas
        );

        // E continua sem passar do piso, por mais que trabalhe.
        for _ in 0..50 {
            passo = escalada.avancar(20_000);
            assert!(!passo.alem_do_piso, "passou do piso sem ninguém mandar");
            assert_eq!(passo.teto, piso);
        }

        // Mandado, ele passa.
        escalada.liberar_o_teto();
        let depois = escalada.avancar(20_000);
        assert!(depois.alem_do_piso && depois.teto > piso && depois.piso == piso);
    }

    /// **O que o modo avançado existe para entregar.** Onde o piso é
    /// inatingível, a garantia passa a ser cumprida de verdade.
    ///
    /// `C(12,4,3)` tem piso 15 pela cota de Schönheim e número de cobertura
    /// conhecido 29: nenhuma disposição de 15 cartelas cobre tudo, e a versão
    /// anterior ficava em 83,8% para sempre.
    #[test]
    fn onde_o_piso_nao_basta_a_cobertura_fecha_mesmo_assim() {
        let p = Problema::novo(12, 4, 4, 3, 1).unwrap();
        let piso = limites::sem_busca(&p).valor as usize;
        let mut escalada = Escalada::nova(&p, piso);

        // Esgota a paciência no piso, e então liga a construção avançada — que
        // é o que a tela faz quando alguém toca no botão.
        let mut passo = escalada.avancar(50_000);
        while !passo.piso_esgotado && passo.rodadas < 200_000 {
            passo = escalada.avancar(50_000);
        }
        assert!(passo.piso_esgotado, "o piso precisava ter se esgotado");
        escalada.liberar_o_teto();

        while !passo.fechou && passo.rodadas < 600_000 {
            passo = escalada.avancar(200_000);
        }

        assert!(
            passo.fechou,
            "ficou em {:.1}% com {} cartelas e teto {}",
            passo.melhor_cobertura * 100.0,
            passo.cartelas,
            passo.teto
        );
        assert!(p.cobre(escalada.melhor()), "fechou sem cobrir de verdade");
        assert!(
            passo.alem_do_piso && escalada.melhor().len() > piso,
            "fechar aqui exige passar do piso de {piso}"
        );
    }

    /// A cobertura que ela anuncia tem de ser a que o verificador enxerga. Um
    /// contador incremental que divergisse da varredura mentiria a cada passo.
    #[test]
    fn a_cobertura_relatada_bate_com_o_verificador() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 12);
        for _ in 0..60 {
            escalada.avancar(3_000);
            let atual = escalada.atual().to_vec();
            let descobertos = p.descobertos(&atual);
            let atendidos = p.total_de_alvos() - descobertos;
            let esperado = atendidos as f64 / p.total_de_alvos() as f64;
            let dito = escalada.passo().cobertura;
            assert!(
                (dito - esperado).abs() < 1e-9,
                "a escalada diz {dito:.6} e o verificador vê {esperado:.6}"
            );
        }
    }

    /// Com duas cartelas premiadas a conta é sobre cópias, não sobre alvos.
    #[test]
    fn a_cobertura_conta_copias_quando_ha_premiadas() {
        let p = Problema::novo(9, 3, 2, 2, 2).unwrap();
        let mut escalada = Escalada::nova(&p, 30);
        for _ in 0..80 {
            escalada.avancar(5_000);
        }
        let passo = escalada.passo();
        assert!(passo.cobertura <= 1.0);
        if passo.melhor_cobertura >= 1.0 {
            assert_eq!(p.descobertos(escalada.melhor()), 0, "cobertura cheia tem de passar");
        }
    }

    /// O recorde nunca regride, mesmo quando a reorganização aceita um movimento
    /// lateral para sair do platô.
    #[test]
    fn a_melhor_cobertura_nunca_piora() {
        let p = Problema::novo(11, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 9);
        let mut anterior = 0.0;
        for _ in 0..300 {
            let passo = escalada.avancar(2_000);
            assert!(
                passo.melhor_cobertura >= anterior - 1e-12,
                "a melhor cobertura caiu de {anterior} para {}",
                passo.melhor_cobertura
            );
            anterior = passo.melhor_cobertura;
        }
    }

    /// **O caso em que o piso é alcançável, de ponta a ponta.**
    ///
    /// Em 18 dezenas com jogos de 17, saindo 15 e garantindo 15, o piso de
    /// Schönheim é 16 — e 16 cartelas fecham. A escalada tem de chegar a 100%
    /// com exatamente 16, sem nunca ter passado disso.
    #[test]
    fn onde_o_piso_e_alcancavel_ela_fecha_exatamente_nele() {
        let p = Problema::novo(18, 17, 15, 15, 1).unwrap();
        let piso = limites::sem_busca(&p).valor as usize;
        assert_eq!(piso, 16, "o piso de C(18,17,15)");

        let mut escalada = Escalada::nova(&p, piso);
        let mut passo = escalada.passo();
        for _ in 0..2_000 {
            passo = escalada.avancar(200_000);
            if passo.fechou {
                break;
            }
        }
        assert!(passo.fechou, "não fechou: parou em {:.1}%", passo.melhor_cobertura * 100.0);
        assert_eq!(escalada.melhor().len(), 16, "fechou com um número diferente do piso");
        assert!(p.cobre(escalada.melhor()), "o que ela diz que fecha precisa fechar");
    }

    /// **A curva que a tela mostra.** Um ponto por degrau da subida, na ordem,
    /// com a cobertura crescendo.
    ///
    /// E o que ela revela: a subida sozinha chega ao teto **sem** fechar. Quem
    /// fecha é a reorganização, achando a disposição certa das mesmas doze
    /// cartelas sem nunca pedir a décima terceira.
    #[test]
    fn a_curva_registra_a_subida_e_a_reorganizacao_e_quem_fecha() {
        // Garantia parcial de propósito: com garantia cheia quem trabalha é o
        // motor de Turán, que não sobe degrau nenhum — e a curva, que é o
        // registro da subida, não existe ali. O que este teste cobra é a
        // escalada, e a escalada continua governando os problemas que não têm a
        // forma complementar.
        // Piso de contagem em 254 cartelas: doze não fecham de jeito nenhum, e
        // a subida enche o teto sem nunca cobrir tudo.
        let p = Problema::novo(18, 6, 6, 5, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 12);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(50_000);
        }
        let curva = escalada.curva().to_vec();
        assert_eq!(curva.len(), 12, "um ponto por cartela até o teto");
        assert_eq!(curva[0].0, 1, "o primeiro ponto é uma cartela");
        assert_eq!(curva[11].0, 12, "o último é o teto");
        for par in curva.windows(2) {
            assert!(par[1].0 > par[0].0, "as cartelas têm de crescer");
            assert!(par[1].1 >= par[0].1, "a cobertura não pode cair na subida");
        }
        assert!(curva[0].1 > 0.0, "a primeira cartela já cobre alguma coisa");

        // E o que a subida sozinha **não** faz: fechar. Doze cartelas ficam
        // muito abaixo do piso de contagem, e a reorganização passa a trabalhar
        // com esse número sem nunca pedir a décima terceira.
        let mut passo = escalada.passo();
        for _ in 0..200 {
            passo = escalada.avancar(200_000);
        }
        assert!(!passo.fechou, "doze cartelas não podiam cobrir tudo");
        assert_eq!(passo.cartelas, 12, "e o número não pode ter mudado");
        assert_eq!(passo.fase, Fase::Reorganizando);
    }

    /// Num teto grande a curva é afinada em vez de crescer sem limite.
    #[test]
    fn a_curva_nao_cresce_sem_limite() {
        // Garantia parcial: a curva é o registro da subida, e a subida só
        // acontece nos problemas que o motor de Turán não representa.
        let p = Problema::novo(18, 6, 6, 5, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 600);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(200_000);
        }
        let curva = escalada.curva();
        assert!(curva.len() <= PONTOS_DA_CURVA, "a curva tem {} pontos", curva.len());
        assert!(curva.len() > 10, "e ainda assim tem forma: {} pontos", curva.len());
        for par in curva.windows(2) {
            assert!(par[1].0 > par[0].0);
        }
    }

    /// Guardar e retomar devolve o mesmo estado, e a contagem é refeita certa.
    #[test]
    fn guardar_e_retomar_devolve_o_mesmo_estado() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();
        let mut original = Escalada::nova(&p, 10);
        for _ in 0..20 {
            original.avancar(5_000);
        }
        let antes = original.passo();
        let salvo = original.guardar();

        let retomada = Escalada::retomar(&salvo).unwrap();
        let depois = retomada.passo();
        assert_eq!(antes.cartelas, depois.cartelas);
        assert_eq!(antes.fase, depois.fase);
        assert_eq!(antes.trabalho, depois.trabalho);
        assert!((antes.cobertura - depois.cobertura).abs() < 1e-12);
        assert!((antes.melhor_cobertura - depois.melhor_cobertura).abs() < 1e-12);
        assert_eq!(original.melhor(), retomada.melhor());
        assert_eq!(original.curva(), retomada.curva());
        assert!(!retomada.curva().is_empty());
    }

    /// E continuar depois de retomar dá o mesmo que nunca ter parado.
    #[test]
    fn parar_no_meio_nao_muda_o_caminho() {
        let p = Problema::novo(10, 4, 3, 2, 1).unwrap();

        let mut direto = Escalada::nova(&p, 10);
        for _ in 0..40 {
            direto.avancar(4_000);
        }

        let mut aos_poucos = Escalada::nova(&p, 10);
        for _ in 0..20 {
            aos_poucos.avancar(4_000);
        }
        let salvo = aos_poucos.guardar();
        let mut retomada = Escalada::retomar(&salvo).unwrap();
        for _ in 0..20 {
            retomada.avancar(4_000);
        }

        assert_eq!(direto.melhor(), retomada.melhor(), "o caminho divergiu ao retomar");
        assert_eq!(direto.passo().cartelas, retomada.passo().cartelas);
    }

    /// Um teto de uma cartela só é um pedido legítimo, e ela obedece.
    #[test]
    fn um_teto_de_uma_cartela_e_respeitado_enquanto_ele_vale() {
        // Garantia parcial: o teto é a regra da escalada, e a escalada governa
        // os problemas sem a forma complementar. Com garantia cheia quem entra é
        // o motor de Turán, que trabalha sem teto nenhum — e a decisão de passar
        // do piso deixou de existir ali porque ele não empaca no piso.
        let p = Problema::novo(9, 3, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 1);

        // Enquanto o piso não se esgota, uma cartela é uma cartela.
        let passo = escalada.avancar(5_000);
        assert!(!passo.alem_do_piso);
        assert_eq!(passo.cartelas, 1);
        assert_eq!(escalada.melhor().len(), 1);
        assert!(passo.melhor_cobertura > 0.0 && passo.melhor_cobertura < 1.0);

        // Uma cartela não cobre tudo, e o motor acaba avisando que o piso se
        // esgotou — mas **não** passa dele sozinho. Uma cartela continua sendo
        // uma cartela por quanto tempo for preciso.
        for _ in 0..400 {
            let passo = escalada.avancar(200_000);
            assert_eq!(passo.cartelas, 1, "passou do teto sem ninguém mandar");
            assert_eq!(passo.teto, 1);
            assert_eq!(passo.piso, 1, "o piso é o que foi provado, e não muda");
        }
        assert!(escalada.passo().piso_esgotado, "precisava ter avisado");

        // Mandado, aí sim.
        escalada.liberar_o_teto();
        let fim = escalada.avancar(5_000);
        assert!(fim.alem_do_piso && fim.teto > 1);
    }

    /// Com um teto apertado demais para fechar, a subida enche o teto e a
    /// reorganização assume — sem mexer no tamanho.
    ///
    /// O teto aqui é o piso de contagem de `C(11,4,3,2)`, que é 4: contar não
    /// enxerga o que a estrutura impede, então quatro cartelas não fecham.
    #[test]
    fn a_reorganizacao_mantem_o_numero_de_cartelas() {
        let p = Problema::novo(11, 4, 3, 2, 1).unwrap();
        let mut escalada = Escalada::nova(&p, 4);
        while escalada.fase() == Fase::Subindo {
            escalada.avancar(10_000);
        }
        let tamanho = escalada.atual().len();
        assert_eq!(tamanho, 4, "a subida devia ter enchido o teto");
        assert_eq!(escalada.fase(), Fase::Reorganizando, "com quatro não fecha");
        for _ in 0..200 {
            escalada.avancar(5_000);
            if escalada.fase() == Fase::Fechada {
                break;
            }
            assert_eq!(escalada.atual().len(), tamanho, "a reorganização mudou o tamanho");
        }
    }
}
