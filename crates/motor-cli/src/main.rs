//! `sonho-lucido` — a linha de comando do motor.
//!
//! Seis comandos cobrem o ciclo descrito no documento conceitual:
//!
//! | Comando    | Documento | O que faz                                   |
//! |------------|-----------|---------------------------------------------|
//! | `criar`    | §6 Modo B | monta um fechamento do zero e o otimiza     |
//! | `otimizar` | §6 Modo A | parte de um fechamento que você já tem      |
//! | `retomar`  | §16       | continua uma busca interrompida             |
//! | `listar`   | §29       | mostra as buscas gravadas                   |
//! | `ranking`  | §18       | mostra as melhores soluções de uma busca    |
//! | `exportar` | §28       | escreve a melhor solução em texto           |

mod entrada;
mod formato;
mod painel;

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use motor_busca::{CondicoesDeParada, Configuracao, Controle, MotorBusca};
use motor_core::{limite_inferior, MotorCobertura, Objetivo, Problema, RegraCobertura};
use motor_persistencia::{Banco, RegistroExecucao};

use painel::Painel;

#[derive(Parser)]
#[command(
    name = "sonho-lucido",
    version,
    about = "Motor universal de otimização combinatória persistente",
    long_about = "Encontra o menor conjunto de cartelas que satisfaz uma regra de cobertura.\n\
                  Não conhece nenhuma modalidade específica de jogo — apenas parâmetros\n\
                  matemáticos. A busca continua enquanto você quiser, e nunca perde o\n\
                  melhor resultado já encontrado."
)]
struct Cli {
    /// Arquivo do banco de soluções
    #[arg(long, short, default_value = "sonho-lucido.db", global = true)]
    banco: PathBuf,

    #[command(subcommand)]
    comando: Comando,
}

#[derive(Subcommand)]
enum Comando {
    /// Monta um fechamento do zero e começa a otimizá-lo
    Criar {
        #[command(flatten)]
        problema: ArgsProblema,
        #[command(flatten)]
        parada: ArgsParada,
    },

    /// Parte de um fechamento existente e tenta reduzi-lo
    ///
    /// Universo, pool e tamanho da cartela são deduzidos do arquivo quando não
    /// informados.
    Otimizar {
        /// Arquivo com uma cartela por linha
        #[arg(long, short)]
        arquivo: PathBuf,
        #[command(flatten)]
        problema: ArgsProblema,
        #[command(flatten)]
        parada: ArgsParada,
    },

    /// Continua uma busca já iniciada, sem perder nada do que foi encontrado
    Retomar {
        /// Identificador da execução; sem isso, usa a mais recente
        #[arg(long)]
        execucao: Option<i64>,
        #[command(flatten)]
        parada: ArgsParada,
    },

    /// Lista as buscas gravadas no banco
    Listar,

    /// Mostra as melhores soluções de uma busca
    Ranking {
        #[arg(long)]
        execucao: Option<i64>,
        #[arg(long, default_value_t = 10)]
        limite: usize,
    },

    /// Escreve a melhor solução encontrada
    Exportar {
        #[arg(long)]
        execucao: Option<i64>,
        /// Arquivo de destino; sem isso, escreve na tela
        #[arg(long, short)]
        saida: Option<PathBuf>,
    },
}

#[derive(Args, Clone)]
struct ArgsProblema {
    /// Total de elementos do universo, por exemplo 60
    #[arg(long, short = 'u')]
    universo: Option<u32>,

    /// Tamanho do pool; usa os elementos de 1 até este número
    #[arg(long, short = 'p', conflicts_with = "elementos")]
    pool: Option<usize>,

    /// Elementos do pool, separados por vírgula, por exemplo 3,9,14,27
    #[arg(long, short = 'e')]
    elementos: Option<String>,

    /// Quantidade de elementos em cada cartela
    #[arg(long, short = 'k')]
    cartela: Option<usize>,

    /// Cobrir todo subconjunto deste tamanho (covering design)
    #[arg(long, short = 'c', conflicts_with = "garantir")]
    cobrir: Option<usize>,

    /// Garantia parcial no formato ALVO:INTERSECAO — "6:4" significa
    /// "se saírem 6 do pool, garanto 4 em alguma cartela"
    #[arg(long, short = 'g')]
    garantir: Option<String>,

    /// Quantas cartelas precisam atender cada resultado, e não apenas uma
    #[arg(long, default_value_t = 1)]
    premiadas: usize,

    /// Teto de cartelas: em vez de minimizar a quantidade, maximiza a cobertura
    #[arg(long)]
    orcamento: Option<usize>,

    /// Semente do gerador aleatório; a mesma semente reproduz a mesma busca
    #[arg(long, default_value_t = 0x5150_1A55)]
    semente: u64,
}

#[derive(Args, Clone)]
struct ArgsParada {
    /// Por quanto tempo buscar: 90, 90s, 15m, 4h, 2d
    #[arg(long, short = 't', value_parser = interpretar_duracao)]
    tempo: Option<Duration>,

    /// Quantas iterações no máximo
    #[arg(long, short = 'i')]
    iteracoes: Option<u64>,

    /// Continua mesmo depois de provar a optimalidade
    #[arg(long)]
    sem_parar_no_otimo: bool,
}

impl ArgsParada {
    fn condicoes(&self) -> CondicoesDeParada {
        CondicoesDeParada {
            max_iteracoes: self.iteracoes,
            max_duracao: self.tempo,
            parar_em_optimalidade: !self.sem_parar_no_otimo,
        }
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let banco = Banco::abrir(&cli.banco)
        .with_context(|| format!("não consegui abrir o banco {}", cli.banco.display()))?;

    match cli.comando {
        Comando::Criar { problema, parada } => {
            let semente = problema.semente;
            let montado = montar_problema(&problema, None)?;
            buscar(&banco, montado, None, &parada, semente)
        }

        Comando::Otimizar { ref arquivo, ref problema, ref parada } => {
            let fechamento = entrada::ler_fechamento(arquivo)?;
            println!("  lidas {} cartelas de {}", fechamento.len(), arquivo.display());

            let montado = montar_problema(problema, Some(&fechamento))?;
            let cartelas = entrada::converter_para_cartelas(&fechamento, &montado)?;
            buscar(&banco, montado, Some(cartelas), parada, problema.semente)
        }

        Comando::Retomar { execucao, parada } => retomar(&banco, execucao, &parada),

        Comando::Listar => listar(&banco),

        Comando::Ranking { execucao, limite } => mostrar_ranking(&banco, execucao, limite),

        Comando::Exportar { execucao, saida } => exportar(&banco, execucao, saida),
    }
}

/// Monta o problema a partir dos argumentos, completando o que faltar com o que
/// o fechamento informado revela.
fn montar_problema(args: &ArgsProblema, fechamento: Option<&[Vec<u32>]>) -> Result<Problema> {
    // Pool: explícito por lista, explícito por tamanho, ou deduzido do arquivo.
    let pool: Vec<u32> = if let Some(lista) = &args.elementos {
        let mut elementos = Vec::new();
        for campo in lista.split(',').map(str::trim).filter(|c| !c.is_empty()) {
            elementos.push(
                campo
                    .parse::<u32>()
                    .with_context(|| format!("\"{campo}\" não é um número válido no pool"))?,
            );
        }
        elementos
    } else if let Some(tamanho) = args.pool {
        (1..=tamanho as u32).collect()
    } else if let Some(cartelas) = fechamento {
        let deduzido = entrada::pool_do_fechamento(cartelas);
        println!("  pool deduzido do arquivo: {} elementos", deduzido.len());
        deduzido
    } else {
        bail!("informe o pool com --pool N ou --elementos 1,2,3");
    };

    let universo = match args.universo {
        Some(u) => u,
        None => {
            let maximo = pool.iter().copied().max().unwrap_or(1);
            println!("  universo deduzido: {maximo}");
            maximo
        }
    };

    let tamanho_cartela = match args.cartela {
        Some(k) => k,
        None => match fechamento.and_then(|c| c.first()) {
            Some(primeira) => {
                println!("  tamanho da cartela deduzido do arquivo: {}", primeira.len());
                primeira.len()
            }
            None => bail!("informe o tamanho da cartela com --cartela K"),
        },
    };

    let mut regra = match (&args.cobrir, &args.garantir) {
        (Some(t), None) => RegraCobertura::cobrir_subconjuntos(*t),
        (None, Some(texto)) => interpretar_garantia(texto)?,
        (None, None) => bail!(
            "informe a regra de cobertura: --cobrir T (cobrir todo subconjunto de T \
             elementos) ou --garantir ALVO:INTERSECAO"
        ),
        (Some(_), Some(_)) => bail!("--cobrir e --garantir são mutuamente exclusivos"),
    };

    if args.premiadas == 0 {
        bail!("--premiadas precisa ser ao menos 1");
    }
    regra.premiadas = args.premiadas;

    let objetivo = match args.orcamento {
        Some(orcamento) => Objetivo::MaximizarCobertura { orcamento },
        None => Objetivo::MinimizarCartelas,
    };

    Problema::novo(universo, pool, tamanho_cartela, regra, objetivo)
        .context("configuração inválida")
}

fn interpretar_garantia(texto: &str) -> Result<RegraCobertura> {
    let (alvo, intersecao) = texto
        .split_once(':')
        .with_context(|| format!("--garantir espera ALVO:INTERSECAO, recebi \"{texto}\""))?;

    Ok(RegraCobertura::garantia(
        alvo.trim().parse().context("o alvo da garantia precisa ser um número")?,
        intersecao.trim().parse().context("a interseção da garantia precisa ser um número")?,
    ))
}

/// Aceita `90`, `90s`, `15m`, `4h`, `2d`.
fn interpretar_duracao(texto: &str) -> Result<Duration, String> {
    let limpo = texto.trim();
    if limpo.is_empty() {
        return Err("duração vazia".to_string());
    }

    let (numero, multiplicador) = match limpo.chars().last() {
        Some('s') => (&limpo[..limpo.len() - 1], 1),
        Some('m') => (&limpo[..limpo.len() - 1], 60),
        Some('h') => (&limpo[..limpo.len() - 1], 3600),
        Some('d') => (&limpo[..limpo.len() - 1], 86400),
        _ => (limpo, 1),
    };

    let valor: u64 = numero
        .trim()
        .parse()
        .map_err(|_| format!("\"{texto}\" não é uma duração válida (use 90s, 15m, 4h, 2d)"))?;

    Ok(Duration::from_secs(valor * multiplicador))
}

fn buscar(
    banco: &Banco,
    problema: Problema,
    fechamento: Option<Vec<motor_core::Cartela>>,
    parada: &ArgsParada,
    semente: u64,
) -> Result<()> {
    let cobertura = MotorCobertura::novo(&problema).map_err(|e| anyhow::anyhow!("{e}"))?;
    let limite = limite_inferior(&cobertura);
    let viabilidade = cobertura.viabilidade();

    descrever_problema(&problema);
    println!(
        "  limite inferior: ≥ {} cartelas ({})",
        limite.valor, limite.metodo
    );
    println!(
        "  espaço do problema: {} alvos, {} atendidos por cartela",
        formato::milhares(viabilidade.total_alvos),
        formato::milhares(viabilidade.alvos_por_cartela)
    );
    println!();

    let execucao_id = banco
        .abrir_execucao(&problema, semente, limite)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    let config = Configuracao { semente, ..Default::default() };
    let mut motor = MotorBusca::novo(problema.clone(), config)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    if let Some(cartelas) = fechamento {
        motor.semear(&cartelas);
        println!("  partindo de {} cartelas fornecidas", cartelas.len());
    }

    executar_com_controle(banco, &mut motor, execucao_id, problema, limite, parada)
}

fn retomar(banco: &Banco, execucao: Option<i64>, parada: &ArgsParada) -> Result<()> {
    let registro = escolher_execucao(banco, execucao)?;
    let problema = registro.problema.clone();
    // Confere que a configuração gravada ainda cabe na memória desta máquina
    // antes de prometer ao usuário que a busca vai continuar.
    MotorCobertura::novo(&problema).map_err(|e| anyhow::anyhow!("{e}"))?;

    println!("  retomando execução #{}", registro.id);
    descrever_problema(&problema);
    println!(
        "  já executadas: {} iterações em {}",
        formato::milhares(registro.iteracoes),
        formato::duracao(Duration::from_secs_f64(registro.segundos))
    );

    let melhor = banco
        .melhor_solucao(registro.id)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    let config = Configuracao { semente: registro.semente, ..Default::default() };
    let mut motor =
        MotorBusca::novo(problema.clone(), config).map_err(|e| anyhow::anyhow!("{e}"))?;

    match &melhor {
        Some(registro_solucao) => {
            let cartelas = registro_solucao.para_cartelas(&problema).context(
                "a solução gravada não corresponde a este problema — banco inconsistente",
            )?;
            println!(
                "  melhor solução salva: {} cartelas | cobertura {}",
                registro_solucao.avaliacao.cartelas,
                formato::percentual(registro_solucao.cobertura())
            );
            motor.retomar_de(&cartelas, registro.iteracoes);
        }
        None => println!("  nenhuma solução salva ainda; começando do zero"),
    }
    println!();

    executar_com_controle(banco, &mut motor, registro.id, problema, registro.limite, parada)
}

fn executar_com_controle(
    banco: &Banco,
    motor: &mut MotorBusca,
    execucao_id: i64,
    problema: Problema,
    limite: motor_core::LimiteInferior,
    parada: &ArgsParada,
) -> Result<()> {
    let controle = Controle::novo();
    let alca = controle.clone();
    if ctrlc::set_handler(move || {
        eprintln!("\n  parada solicitada — encerrando ao fim da iteração atual...");
        alca.parar();
    })
    .is_err()
    {
        eprintln!("  aviso: não foi possível instalar o tratador de Ctrl+C");
    }

    let mut painel = Painel::novo(banco, execucao_id, problema.clone(), limite);
    motor.executar(&controle, &parada.condicoes(), &mut painel);

    if motor.optimalidade_provada() {
        println!(
            "  ÓTIMO PROVADO: {} cartelas é o mínimo matematicamente possível.",
            motor.melhor_avaliacao().cartelas
        );
    } else if let Some(distancia) = motor.gap() {
        println!(
            "  melhor solução conhecida: {} cartelas | limite inferior {} | gap {}",
            motor.melhor_avaliacao().cartelas,
            limite.valor,
            formato::percentual(distancia)
        );
        println!("  (pode existir solução melhor — continue com `retomar`)");
    }

    if painel.falhas_de_gravacao > 0 {
        eprintln!(
            "  atenção: {} recordes não puderam ser gravados no banco",
            painel.falhas_de_gravacao
        );
    }

    Ok(())
}

fn listar(banco: &Banco) -> Result<()> {
    let execucoes = banco.listar_execucoes().map_err(|e| anyhow::anyhow!("{e}"))?;
    if execucoes.is_empty() {
        println!("  nenhuma busca gravada ainda.");
        return Ok(());
    }

    println!(
        "{:>4}  {:<34} {:>10} {:>12} {:>10}  atualizada",
        "id", "configuração", "melhor", "iterações", "tempo"
    );
    println!("{}", "-".repeat(96));

    for execucao in execucoes {
        let melhor = banco
            .melhor_solucao(execucao.id)
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .map(|s| format!("{} cart.", s.avaliacao.cartelas))
            .unwrap_or_else(|| "—".to_string());

        println!(
            "{:>4}  {:<34} {:>10} {:>12} {:>10}  {}",
            execucao.id,
            resumo_do_problema(&execucao.problema),
            melhor,
            formato::milhares(execucao.iteracoes),
            formato::duracao(Duration::from_secs_f64(execucao.segundos)),
            execucao.atualizada_em,
        );
    }
    Ok(())
}

fn mostrar_ranking(banco: &Banco, execucao: Option<i64>, limite: usize) -> Result<()> {
    let registro = escolher_execucao(banco, execucao)?;
    let solucoes = banco
        .ranking(registro.id, limite)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    if solucoes.is_empty() {
        println!("  a execução #{} ainda não tem soluções gravadas.", registro.id);
        return Ok(());
    }

    println!("  execução #{} — {}", registro.id, resumo_do_problema(&registro.problema));
    println!(
        "  limite inferior: ≥ {} cartelas ({})",
        registro.limite.valor, registro.limite.metodo
    );
    println!();
    println!(
        "{:>4}  {:>9} {:>11} {:>13} {:>12} {:>10}  origem",
        "#", "cartelas", "cobertura", "redundância", "iteração", "tempo"
    );
    println!("{}", "-".repeat(88));

    for (posicao, solucao) in solucoes.iter().enumerate() {
        println!(
            "{:>4}  {:>9} {:>11} {:>13} {:>12} {:>10}  {}",
            posicao + 1,
            solucao.avaliacao.cartelas,
            formato::percentual(solucao.cobertura()),
            formato::milhares(solucao.avaliacao.redundancia),
            formato::milhares(solucao.iteracao),
            formato::duracao(Duration::from_secs_f64(solucao.segundos)),
            solucao.operador.as_deref().unwrap_or("—"),
        );
    }
    Ok(())
}

fn exportar(banco: &Banco, execucao: Option<i64>, saida: Option<PathBuf>) -> Result<()> {
    let registro = escolher_execucao(banco, execucao)?;
    let melhor = banco
        .melhor_solucao(registro.id)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .with_context(|| format!("a execução #{} não tem nenhuma solução gravada", registro.id))?;

    let texto = entrada::escrever_fechamento(&melhor.cartelas);

    match saida {
        Some(caminho) => {
            std::fs::write(&caminho, &texto)
                .with_context(|| format!("não consegui escrever em {}", caminho.display()))?;
            println!(
                "  {} cartelas gravadas em {}",
                melhor.avaliacao.cartelas,
                caminho.display()
            );
        }
        None => {
            println!(
                "# execução #{} | {} cartelas | cobertura {}",
                registro.id,
                melhor.avaliacao.cartelas,
                formato::percentual(melhor.cobertura())
            );
            print!("{texto}");
        }
    }
    Ok(())
}

fn escolher_execucao(banco: &Banco, execucao: Option<i64>) -> Result<RegistroExecucao> {
    match execucao {
        Some(id) => banco
            .execucao_por_id(id)
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .with_context(|| format!("não existe execução #{id} neste banco")),
        None => {
            let mut execucoes = banco.listar_execucoes().map_err(|e| anyhow::anyhow!("{e}"))?;
            if execucoes.is_empty() {
                bail!("nenhuma busca gravada neste banco — comece com `criar`");
            }
            Ok(execucoes.remove(0))
        }
    }
}

fn descrever_problema(problema: &Problema) {
    let regra = problema.regra();
    println!("  universo {} | pool {} | cartela {}",
        problema.universo(),
        problema.tamanho_pool(),
        problema.tamanho_cartela()
    );

    if regra.alvo == regra.intersecao {
        println!(
            "  regra: cobrir todo subconjunto de {} elementos do pool",
            regra.alvo
        );
    } else {
        println!(
            "  regra: se saírem {} elementos do pool, garantir {} em alguma cartela",
            regra.alvo, regra.intersecao
        );
    }
    if regra.premiadas > 1 {
        println!("  exigência: {} cartelas atendendo cada resultado, não apenas uma", regra.premiadas);
    }

    match problema.objetivo() {
        Objetivo::MinimizarCartelas => println!("  objetivo: usar o menor número de cartelas"),
        Objetivo::MaximizarCobertura { orcamento } => {
            println!("  objetivo: cobrir o máximo possível com até {orcamento} cartelas")
        }
    }
}

fn resumo_do_problema(problema: &Problema) -> String {
    let regra = problema.regra();
    let sufixo = if regra.alvo == regra.intersecao {
        format!("cobrir {}", regra.alvo)
    } else {
        format!("garantir {} em {}", regra.intersecao, regra.alvo)
    };
    let sufixo = if regra.premiadas > 1 {
        format!("{sufixo} ×{}", regra.premiadas)
    } else {
        sufixo
    };
    format!(
        "u{} p{} k{} — {sufixo}",
        problema.universo(),
        problema.tamanho_pool(),
        problema.tamanho_cartela()
    )
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn duracao_aceita_as_unidades_usuais() {
        assert_eq!(interpretar_duracao("90").unwrap(), Duration::from_secs(90));
        assert_eq!(interpretar_duracao("90s").unwrap(), Duration::from_secs(90));
        assert_eq!(interpretar_duracao("15m").unwrap(), Duration::from_secs(900));
        assert_eq!(interpretar_duracao("4h").unwrap(), Duration::from_secs(14400));
        assert_eq!(interpretar_duracao("2d").unwrap(), Duration::from_secs(172800));
    }

    #[test]
    fn duracao_invalida_explica_o_formato() {
        let erro = interpretar_duracao("amanhã").unwrap_err();
        assert!(erro.contains("90s"), "a mensagem precisa ensinar o formato: {erro}");
        assert!(interpretar_duracao("").is_err());
    }

    #[test]
    fn garantia_e_interpretada_no_formato_alvo_intersecao() {
        let regra = interpretar_garantia("6:4").unwrap();
        assert_eq!(regra.alvo, 6);
        assert_eq!(regra.intersecao, 4);
        assert!(!regra.e_covering_design());

        let regra = interpretar_garantia(" 3 : 3 ").unwrap();
        assert!(regra.e_covering_design());
    }

    #[test]
    fn garantia_mal_formada_e_recusada() {
        assert!(interpretar_garantia("6").is_err());
        assert!(interpretar_garantia("seis:quatro").is_err());
    }

    fn args_vazios() -> ArgsProblema {
        ArgsProblema {
            universo: None,
            pool: None,
            elementos: None,
            cartela: None,
            cobrir: None,
            premiadas: 1,
            garantir: None,
            orcamento: None,
            semente: 1,
        }
    }

    #[test]
    fn pool_por_tamanho_usa_os_primeiros_elementos() {
        let args = ArgsProblema {
            universo: Some(60),
            pool: Some(5),
            cartela: Some(3),
            cobrir: Some(2),
            premiadas: 1,
            ..args_vazios()
        };
        let problema = montar_problema(&args, None).unwrap();
        assert_eq!(problema.pool(), &[1, 2, 3, 4, 5]);
    }

    #[test]
    fn pool_explicito_aceita_elementos_espalhados() {
        let args = ArgsProblema {
            universo: Some(60),
            elementos: Some("7, 13,42".to_string()),
            cartela: Some(2),
            cobrir: Some(2),
            premiadas: 1,
            ..args_vazios()
        };
        let problema = montar_problema(&args, None).unwrap();
        assert_eq!(problema.pool(), &[7, 13, 42]);
    }

    #[test]
    fn tudo_pode_ser_deduzido_de_um_fechamento() {
        // É o que torna `otimizar --arquivo x.txt --cobrir 2` suficiente.
        let fechamento = vec![vec![3u32, 9, 14], vec![9, 14, 27], vec![3, 27, 41]];
        let args = ArgsProblema { cobrir: Some(2), ..args_vazios() };

        let problema = montar_problema(&args, Some(&fechamento)).unwrap();
        assert_eq!(problema.pool(), &[3, 9, 14, 27, 41]);
        assert_eq!(problema.universo(), 41);
        assert_eq!(problema.tamanho_cartela(), 3);
    }

    #[test]
    fn sem_regra_de_cobertura_o_comando_e_recusado() {
        let args = ArgsProblema {
            universo: Some(60),
            pool: Some(10),
            cartela: Some(3),
            ..args_vazios()
        };
        let erro = montar_problema(&args, None).unwrap_err();
        assert!(erro.to_string().contains("--cobrir"), "mensagem foi: {erro}");
    }

    #[test]
    fn sem_pool_e_sem_arquivo_o_comando_e_recusado() {
        let args = ArgsProblema { universo: Some(60), cartela: Some(3), cobrir: Some(2), ..args_vazios() };
        let erro = montar_problema(&args, None).unwrap_err();
        assert!(erro.to_string().contains("--pool"), "mensagem foi: {erro}");
    }

    #[test]
    fn orcamento_troca_o_objetivo() {
        let args = ArgsProblema {
            universo: Some(60),
            pool: Some(10),
            cartela: Some(3),
            cobrir: Some(2),
            premiadas: 1,
            orcamento: Some(8),
            ..args_vazios()
        };
        let problema = montar_problema(&args, None).unwrap();
        assert_eq!(problema.objetivo(), Objetivo::MaximizarCobertura { orcamento: 8 });
    }

    #[test]
    fn configuracao_impossivel_e_recusada_com_mensagem_util() {
        let args = ArgsProblema {
            universo: Some(10),
            pool: Some(5),
            cartela: Some(9), // maior que o pool
            cobrir: Some(2),
            premiadas: 1,
            ..args_vazios()
        };
        assert!(montar_problema(&args, None).is_err());
    }

    #[test]
    fn a_linha_de_comando_esta_bem_formada() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
