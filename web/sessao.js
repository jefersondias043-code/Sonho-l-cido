/*
 * O arquivo de sessão: o trabalho do motor, fora do aparelho.
 *
 * ## O que este arquivo precisa ser
 *
 * Não uma lista de cartelas. Se alguém deixou o motor trabalhando dez horas e
 * quer continuar noutro aparelho, as dez horas têm de ir junto — o recorde, a
 * solução que a busca estava mexendo, a meta perseguida, os contadores e o que o
 * seletor aprendeu sobre quais operadores funcionam naquela configuração.
 *
 * O miolo disso vem do motor, que sabe se retratar. Aqui é o envelope: quem
 * gerou, quando, de que versão, e o que a tela precisa para descrever o arquivo
 * a quem o recebeu **antes** de abri-lo.
 *
 * ## Por que validar aqui, e não só no motor
 *
 * O motor valida o que vai usar. A tela precisa validar antes disso, para poder
 * dizer o que há de errado em vez de mostrar uma falha do WebAssembly — e para
 * não desmontar a busca em curso por causa de um arquivo que nunca ia servir.
 *
 * ## Sem DOM
 *
 * Nada aqui toca a página, e é o que permite testar a validação fora do
 * navegador, com arquivos estragados de propósito.
 */

/** A marca que diz que o arquivo é deste aplicativo. */
export const MARCA = 'sonho-lucido/sessao';

/**
 * A versão do envelope.
 *
 * Sobe quando o formato mudar de um jeito que a leitura antiga não aguente. Não
 * sobe por campo acrescentado: campo novo que falta assume o neutro, e campo
 * desconhecido é ignorado — é assim que o arquivo de hoje abre amanhã e o de
 * amanhã abre hoje.
 */
export const FORMATO = 1;

/**
 * Monta o arquivo a partir do que o motor exportou.
 *
 * `doMotor` é o JSON que o worker devolveu, já interpretado. `contexto` traz o
 * que só a tela sabe: a versão publicada e um rótulo legível.
 */
export function empacotar(doMotor, contexto = {}) {
  return {
    aplicativo: MARCA,
    formato: FORMATO,
    criadoEm: new Date().toISOString(),
    versao: contexto.versao ?? '',
    rotulo: contexto.rotulo ?? '',
    sessao: doMotor,
  };
}

/** Nome de arquivo que diz o que tem dentro sem precisar abrir. */
export function nomeDoArquivo(pacote) {
  const c = pacote?.sessao?.configuracao ?? {};
  const pool = Array.isArray(c.pool) ? c.pool.length : c.pool;
  const dia = (pacote?.criadoEm ?? '').slice(0, 10) || 'sessao';
  const partes = ['sonho-lucido', pool ? `${pool}-${c.cartela}` : 'sessao', dia];
  return `${partes.join('-')}.json`;
}

/**
 * Lê e confere um arquivo, devolvendo `{ ok, erro, pacote, resumo }`.
 *
 * Nunca estoura: um arquivo estragado é um caso previsto, não um acidente. O que
 * ela devolve em `erro` vai direto para a tela, então cada mensagem diz o que foi
 * encontrado — "cartelas de 16 dezenas onde a configuração pede 17" ajuda; "erro
 * ao importar" não ajuda ninguém.
 */
export function interpretar(texto) {
  let pacote;
  try {
    pacote = JSON.parse(texto);
  } catch {
    return recusar('Este arquivo não é um JSON válido. Ele pode ter sido cortado no meio.');
  }
  if (!pacote || typeof pacote !== 'object' || Array.isArray(pacote)) {
    return recusar('O arquivo não tem a forma de uma sessão.');
  }
  if (pacote.aplicativo !== MARCA) {
    return recusar(
      'Este arquivo não foi gerado pelo Sonho Lúcido — ou é de outra ferramenta, ou está corrompido.'
    );
  }
  if (Number(pacote.formato) > FORMATO) {
    return recusar(
      `A sessão foi gravada por uma versão mais nova (formato ${pacote.formato}). ` +
        'Atualize o aplicativo neste aparelho antes de importar.'
    );
  }

  const sessao = pacote.sessao;
  if (!sessao || typeof sessao !== 'object') {
    return recusar('O arquivo não traz nenhuma sessão dentro.');
  }

  const erroDaConfiguracao = conferirConfiguracao(sessao.configuracao);
  if (erroDaConfiguracao) return recusar(erroDaConfiguracao);

  const erroDasCartelas = conferirCartelas(sessao.melhor, sessao.configuracao, 'melhor fechamento');
  if (erroDasCartelas) return recusar(erroDasCartelas);

  // A solução em curso é opcional, e um problema nela não derruba o arquivo: a
  // busca continua pelo recorde, que é o que carrega o trabalho. Some em
  // silêncio, e o resumo conta que sumiu.
  const emCurso = Array.isArray(sessao.atual)
    ? conferirCartelas(sessao.atual, sessao.configuracao, 'solução em curso')
      ? []
      : sessao.atual
    : [];

  const motor = sessao.motor ?? {};
  const iteracoes = numeroSeguro(motor.iteracoes) || numeroSeguro(sessao.iteracoes);

  return {
    ok: true,
    erro: null,
    pacote: { ...pacote, sessao: { ...sessao, atual: emCurso } },
    resumo: {
      cartelas: sessao.melhor.length,
      tamanho: sessao.configuracao.cartela,
      pool: Array.isArray(sessao.configuracao.pool)
        ? sessao.configuracao.pool.length
        : sessao.configuracao.pool,
      iteracoes,
      segundos: numeroSeguro(motor.segundos),
      recordes: numeroSeguro(motor.recordes),
      meta: numeroSeguro(motor.alvo_cartelas),
      temSolucaoEmCurso: emCurso.length > 0,
      temPesosAprendidos: Array.isArray(motor.pesos_dos_operadores)
        ? motor.pesos_dos_operadores.length > 0
        : false,
      criadoEm: typeof pacote.criadoEm === 'string' ? pacote.criadoEm : '',
      versao: typeof pacote.versao === 'string' ? pacote.versao : '',
    },
  };
}

function recusar(erro) {
  return { ok: false, erro, pacote: null, resumo: null };
}

function numeroSeguro(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
}

function conferirConfiguracao(c) {
  if (!c || typeof c !== 'object') return 'A sessão não diz com que configuração foi feita.';
  if (!Array.isArray(c.pool) || c.pool.length === 0) {
    return 'A sessão não traz as dezenas escolhidas.';
  }
  if (c.pool.some((d) => !Number.isInteger(d) || d < 1)) {
    return 'As dezenas escolhidas na sessão não são números válidos.';
  }
  if (new Set(c.pool).size !== c.pool.length) {
    return 'A sessão traz dezenas repetidas entre as escolhidas.';
  }
  if (!Number.isInteger(c.cartela) || c.cartela < 1) {
    return 'A sessão não diz quantas dezenas cada cartela tem.';
  }
  if (c.cartela > c.pool.length) {
    return `A sessão pede cartelas de ${c.cartela} dezenas, e só escolheu ${c.pool.length}.`;
  }
  if (!Number.isInteger(c.alvo) || !Number.isInteger(c.intersecao)) {
    return 'A sessão não traz a regra de cobertura.';
  }
  if (c.premiadas !== undefined && (!Number.isInteger(c.premiadas) || c.premiadas < 1)) {
    return 'A sessão traz um número inválido de cartelas premiadas.';
  }
  return null;
}

function conferirCartelas(cartelas, c, oQue) {
  if (!Array.isArray(cartelas) || cartelas.length === 0) {
    return `A sessão não traz o ${oQue}.`;
  }
  const permitidas = new Set(c.pool);
  for (let i = 0; i < cartelas.length; i++) {
    const cartela = cartelas[i];
    if (!Array.isArray(cartela)) {
      return `O ${oQue} tem uma entrada que não é uma cartela (posição ${i + 1}).`;
    }
    if (cartela.length !== c.cartela) {
      return (
        `O ${oQue} tem uma cartela de ${cartela.length} dezenas onde a configuração ` +
        `pede ${c.cartela} (posição ${i + 1}).`
      );
    }
    if (new Set(cartela).size !== cartela.length) {
      return `O ${oQue} tem uma cartela com dezenas repetidas (posição ${i + 1}).`;
    }
    for (const d of cartela) {
      if (!permitidas.has(d)) {
        return `O ${oQue} usa a dezena ${d}, que não está entre as escolhidas (posição ${i + 1}).`;
      }
    }
  }
  return null;
}
