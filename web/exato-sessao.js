/*
 * O arquivo de fechamento do Construtor Exato: o trabalho, fora do aparelho.
 *
 * ## O que este arquivo precisa ser
 *
 * Não uma lista de cartelas. Quem deixou a escalada montando mil cartelas e
 * quer continuar noutro aparelho precisa que as mil horas vão junto — o teto, o
 * conjunto em curso, o melhor, a fase, os contadores, a semente e a curva. O
 * miolo disso vem do motor, que sabe se retratar (`Escalada::guardar`). Aqui é
 * o envelope: quem gerou, quando, de que versão, e o que a tela precisa para
 * descrever o arquivo a quem o recebeu **antes** de abri-lo.
 *
 * ## A conferência que este módulo existe para fazer
 *
 * O pedido é explícito: abrir um fechamento salvo tem de devolver **exatamente**
 * a mesma quantidade de cartelas que estava registrada. Isso só é verificável
 * comparando duas coisas que vieram de lugares diferentes — a ficha que a tela
 * escreveu e o estado que o motor produziu — e recusando o arquivo quando elas
 * discordam. Um arquivo que abre e devolve outro número de cartelas é pior do
 * que um arquivo que não abre: o primeiro mente em silêncio.
 *
 * ## Sem DOM
 *
 * Nada aqui toca a página, e é o que permite testar a validação fora do
 * navegador, com arquivos estragados de propósito.
 */

/** A marca que diz que o arquivo é deste aplicativo, e deste aplicativo. */
export const MARCA = 'sonho-lucido/exato';

/**
 * A versão do envelope.
 *
 * Sobe quando o formato mudar de um jeito que a leitura antiga não aguente. Não
 * sobe por campo acrescentado: campo novo que falta assume o neutro, e campo
 * desconhecido é ignorado — é assim que o arquivo de hoje abre amanhã e o de
 * amanhã abre hoje.
 */
export const FORMATO = 1;

const CAMPOS_DO_PEDIDO = ['v', 'k', 'j', 't', 'r'];

/** Monta o arquivo a partir de uma sessão do histórico. */
export function empacotar(sessao, contexto = {}) {
  return {
    aplicativo: MARCA,
    formato: FORMATO,
    criadoEm: new Date().toISOString(),
    versao: contexto.versao ?? '',
    fechamento: {
      pedido: sessao.pedido,
      numeros: sessao.numeros,
      universo: sessao.universo,
      esforco: sessao.esforco,
      piso: sessao.piso,
      origem: sessao.origem,
      fechado: sessao.fechado,
      cartelas: sessao.cartelas,
      escalada: sessao.escalada,
      curva: sessao.curva,
      cobertura: sessao.cobertura,
      fase: sessao.fase,
      verificado: sessao.verificado,
      descobertos: sessao.descobertos,
      criadaEm: sessao.criadaEm,
    },
  };
}

/** Nome de arquivo que diz o que tem dentro sem precisar abrir. */
export function nomeDoArquivo(pacote) {
  const p = pacote?.fechamento?.pedido ?? {};
  const dia = (pacote?.criadoEm ?? '').slice(0, 10) || 'fechamento';
  const forma = p.v ? `${p.v}-${p.k}-${p.t}` : 'fechamento';
  return `sonho-lucido-exato-${forma}-${dia}.json`;
}

/**
 * Lê e confere um arquivo, devolvendo `{ ok, erro, pacote, resumo }`.
 *
 * Nunca estoura: um arquivo estragado é um caso previsto, não um acidente. O
 * que ela devolve em `erro` vai direto para a tela, então cada mensagem diz o
 * que foi encontrado — "o estado traz 90 cartelas onde a ficha registra 100"
 * ajuda; "erro ao importar" não ajuda ninguém.
 */
export function interpretar(texto) {
  let pacote;
  try {
    pacote = JSON.parse(texto);
  } catch {
    return recusar('Este arquivo não é um JSON válido. Ele pode ter sido cortado no meio.');
  }
  if (!pacote || typeof pacote !== 'object' || Array.isArray(pacote)) {
    return recusar('O arquivo não tem a forma de um fechamento.');
  }
  if (pacote.aplicativo !== MARCA) {
    return recusar(
      pacote.aplicativo === 'sonho-lucido/sessao'
        ? 'Este arquivo é uma sessão da Lotinha, e não um fechamento do Construtor Exato.'
        : 'Este arquivo não foi gerado pelo Construtor Exato — ou é de outra ferramenta, ou está corrompido.'
    );
  }
  if (Number(pacote.formato) > FORMATO) {
    return recusar(
      `O fechamento foi gravado por uma versão mais nova (formato ${pacote.formato}). ` +
        'Atualize o aplicativo neste aparelho antes de importar.'
    );
  }

  const f = pacote.fechamento;
  if (!f || typeof f !== 'object') {
    return recusar('O arquivo não traz nenhum fechamento dentro.');
  }

  const erroDoPedido = conferirPedido(f.pedido);
  if (erroDoPedido) return recusar(erroDoPedido);

  const erroDosNumeros = conferirNumeros(f.numeros, f.pedido);
  if (erroDosNumeros) return recusar(erroDosNumeros);

  const erroDasCartelas = conferirCartelas(f.cartelas, f.pedido);
  if (erroDasCartelas) return recusar(erroDasCartelas);

  const lido = lerOEstado(f.escalada);
  if (lido.erro) return recusar(lido.erro);

  const erroDeAcordo = conferirOAcordo(lido.estado, f);
  if (erroDeAcordo) return recusar(erroDeAcordo);

  return {
    ok: true,
    erro: null,
    pacote,
    resumo: {
      pedido: f.pedido,
      cartelas: f.cartelas.length,
      teto: lido.estado.teto,
      cobertura: numeroSeguro(f.cobertura),
      fase: typeof f.fase === 'string' ? f.fase : 'subindo',
      verificado: f.verificado === true,
      trabalho: numeroSeguro(lido.estado.trabalho),
      rodadas: numeroSeguro(lido.estado.rodadas),
      pontosDaCurva: Array.isArray(f.curva) ? f.curva.length : 0,
      criadoEm: typeof pacote.criadoEm === 'string' ? pacote.criadoEm : '',
      versao: typeof pacote.versao === 'string' ? pacote.versao : '',
    },
  };
}

/** A sessão que o histórico guarda, a partir de um pacote já conferido. */
export function paraSessao(pacote) {
  const f = pacote.fechamento;
  return {
    pedido: f.pedido,
    numeros: f.numeros,
    universo: f.universo ?? Math.max(...f.numeros),
    esforco: f.esforco ?? 1,
    piso: f.piso ?? 0,
    origem: f.origem ?? '',
    fechado: f.fechado ?? false,
    cartelas: f.cartelas,
    escalada: f.escalada,
    curva: Array.isArray(f.curva) ? f.curva : [],
    cobertura: numeroSeguro(f.cobertura),
    fase: f.fase ?? 'subindo',
    verificado: f.verificado === true,
    descobertos: numeroSeguro(f.descobertos),
    // Um fechamento que chega de fora nunca está em curso: o motor que o estava
    // trabalhando é de outro aparelho, ou de outra sessão que já acabou.
    emCurso: false,
  };
}

function recusar(erro) {
  return { ok: false, erro, pacote: null, resumo: null };
}

function numeroSeguro(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
}

function conferirPedido(p) {
  if (!p || typeof p !== 'object') return 'O fechamento não diz com que regras foi feito.';
  for (const campo of CAMPOS_DO_PEDIDO) {
    if (!Number.isInteger(p[campo]) || p[campo] < 1) {
      return `O fechamento traz um valor inválido em "${campo}".`;
    }
  }
  if (p.k > p.v) return `O fechamento pede cartelas de ${p.k} números entre ${p.v}.`;
  if (p.j > p.v) return `O fechamento diz que saem ${p.j} números de um conjunto de ${p.v}.`;
  if (p.t > Math.min(p.k, p.j)) {
    return `O fechamento garante ${p.t} acertos, mais do que jogo e sorteio permitem.`;
  }
  return null;
}

function conferirNumeros(numeros, p) {
  if (!Array.isArray(numeros) || numeros.length === 0) {
    return 'O fechamento não traz os números escolhidos.';
  }
  if (numeros.length !== p.v) {
    return `O fechamento traz ${numeros.length} números escolhidos, e as regras pedem ${p.v}.`;
  }
  if (numeros.some((n) => !Number.isInteger(n) || n < 1)) {
    return 'Os números escolhidos no fechamento não são todos válidos.';
  }
  if (new Set(numeros).size !== numeros.length) {
    return 'O fechamento traz números repetidos entre os escolhidos.';
  }
  return null;
}

function conferirCartelas(cartelas, p) {
  if (!Array.isArray(cartelas)) return 'O fechamento não traz as cartelas.';
  for (let i = 0; i < cartelas.length; i += 1) {
    const cartela = cartelas[i];
    if (!Array.isArray(cartela)) {
      return `O fechamento tem uma entrada que não é uma cartela (posição ${i + 1}).`;
    }
    if (cartela.length !== p.k) {
      return (
        `O fechamento tem uma cartela de ${cartela.length} números onde as regras ` +
        `pedem ${p.k} (posição ${i + 1}).`
      );
    }
    if (new Set(cartela).size !== cartela.length) {
      return `O fechamento tem uma cartela com números repetidos (posição ${i + 1}).`;
    }
    if (cartela.some((n) => !Number.isInteger(n) || n < 1 || n > p.v)) {
      return `O fechamento tem uma cartela que aponta para fora dos números escolhidos (posição ${i + 1}).`;
    }
  }
  return null;
}

function lerOEstado(bruto) {
  if (typeof bruto !== 'string' || !bruto) {
    return { erro: 'O fechamento não traz o estado do motor, e sem ele não há o que retomar.' };
  }
  let estado;
  try {
    estado = JSON.parse(bruto);
  } catch {
    return { erro: 'O estado do motor dentro do arquivo está corrompido.' };
  }
  if (!estado || typeof estado !== 'object') {
    return { erro: 'O estado do motor dentro do arquivo não tem a forma esperada.' };
  }
  if (!Number.isInteger(estado.teto) || estado.teto < 1) {
    return { erro: 'O estado do motor não diz qual era o teto de cartelas.' };
  }
  if (!Array.isArray(estado.melhor) || !Array.isArray(estado.cartelas)) {
    return { erro: 'O estado do motor não traz as coleções que a escalada montou.' };
  }
  return { estado };
}

/**
 * A ficha e o estado têm de contar a mesma história.
 *
 * São dois lugares diferentes: a ficha foi escrita pela tela, o estado veio do
 * motor. Um arquivo montado à mão, cortado no meio ou remendado pode ter as
 * duas metades falando de fechamentos distintos — e abri-lo devolveria uma
 * quantidade de cartelas diferente da que está registrada, que é precisamente o
 * que o pedido diz que não pode acontecer.
 */
function conferirOAcordo(estado, f) {
  for (const campo of CAMPOS_DO_PEDIDO) {
    if (estado[campo] !== undefined && estado[campo] !== f.pedido[campo]) {
      return (
        `O estado do motor foi gravado com ${campo}=${estado[campo]}, e a ficha do ` +
        `arquivo diz ${campo}=${f.pedido[campo]}. O arquivo descreve dois fechamentos diferentes.`
      );
    }
  }
  if (estado.melhor.length !== f.cartelas.length) {
    return (
      `O estado do motor traz ${estado.melhor.length} cartelas e a ficha registra ` +
      `${f.cartelas.length}. Abrir este arquivo devolveria um fechamento de outro tamanho.`
    );
  }
  if (estado.cartelas.length > estado.teto || estado.melhor.length > estado.teto) {
    return (
      `O estado do motor traz mais cartelas que o próprio teto (${estado.teto}). ` +
      'Um fechamento assim não poderia ter sido produzido por este aplicativo.'
    );
  }
  return null;
}
