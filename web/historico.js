/*
 * O histórico de trabalhos.
 *
 * Antes disto existia uma única busca salva, sobrescrita a cada nova rodada:
 * começar um trabalho novo apagava o anterior sem aviso. Aqui cada rodada vira
 * uma sessão própria, que nasce quando a primeira solução aparece e é
 * atualizada a cada melhoria — inclusive quando o usuário volta para continuá-la
 * dias depois.
 *
 * ## Onde os dados ficam
 *
 * No `localStorage` do próprio aparelho. Nada sai daqui.
 *
 * A escolha frente ao IndexedDB é deliberada: o armazenamento é síncrono, o que
 * elimina a classe de defeito que já custou caro neste projeto — gravar e ler
 * em momentos diferentes, com a leitura chegando antes da gravação. Uma sessão
 * típica ocupa poucos quilobytes, e o limite do navegador comporta centenas
 * delas. Se um dia deixar de comportar, [`podar`] abre espaço descartando as
 * mais antigas em vez de falhar.
 *
 * ## O que este módulo não promete
 *
 * Armazenamento de navegador não é cofre. O iOS pode limpar dados de sites
 * pouco visitados, e apagar os dados do navegador leva o histórico junto. Por
 * isso a tela oferece exportar as cartelas: é o que sobrevive a qualquer coisa.
 */

const CHAVE = 'sonho-lucido:historico';

/** Teto de sessões guardadas. Além disso, as mais antigas saem. */
export const LIMITE_DE_SESSOES = 60;

/** Chave da versão antiga, com uma única busca. Migrada e removida. */
const CHAVE_ANTIGA = 'sonho-lucido:busca';

/**
 * Lê o histórico inteiro.
 *
 * Um armazenamento corrompido devolve lista vazia em vez de derrubar o
 * aplicativo: perder o histórico é ruim, mas não abrir é pior.
 */
function ler() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados.filter(ehSessaoValida) : [];
  } catch {
    return [];
  }
}

/**
 * Se esta sessão pode ser usada — e não apenas se tem a forma de uma.
 *
 * A versão anterior conferia que `melhor` era uma lista, e parava aí. Uma lista
 * de números em vez de lista de cartelas passava, e só quebrava lá adiante: ao
 * pintar as cartelas (`cartela.map` num número), ao exportar, e sobretudo ao
 * retomar — onde ia parar dentro do motor em WebAssembly, que rejeita com uma
 * mensagem sobre JSON e não sobre o histórico.
 *
 * Conferir aqui é conferir uma vez, no único ponto por onde tudo entra.
 * A configuração também é conferida: sem `pool` e `cartela` não há problema a
 * montar, e uma sessão assim é ruído que só atrapalha quem procura um trabalho.
 */
function ehSessaoValida(sessao) {
  if (!sessao || typeof sessao.id !== 'string' || !sessao.id) return false;

  const c = sessao.configuracao;
  if (!c || !Array.isArray(c.pool) || c.pool.length === 0) return false;
  if (!Number.isFinite(c.cartela) || c.cartela <= 0) return false;

  if (!Array.isArray(sessao.melhor)) return false;
  return sessao.melhor.every(
    (cartela) =>
      Array.isArray(cartela) &&
      cartela.length > 0 &&
      cartela.every((n) => Number.isInteger(n) && n > 0)
  );
}

/**
 * Quem é avisado quando o aparelho fica sem espaço.
 *
 * Este módulo não sabe desenhar nada, e nem deve: ele conta o que aconteceu e
 * quem tem tela decide o que dizer.
 */
const ouvintesDeEspaco = new Set();

/**
 * Registra quem quer saber que faltou espaço no aparelho.
 *
 * O ouvinte recebe `{ descartadas, guardou }`: quantos trabalhos antigos
 * precisaram sair, e se o trabalho novo acabou guardado. Devolve a função que
 * desfaz este registro — e só este. Um conjunto, e não um lugar só, porque quem
 * chega depois não pode desligar em silêncio o aviso de quem chegou antes; foi
 * exatamente o que aconteceu quando o teste registrou o seu.
 */
export function quandoFaltarEspaco(ouvinte) {
  if (typeof ouvinte !== 'function') return () => {};
  ouvintesDeEspaco.add(ouvinte);
  return () => ouvintesDeEspaco.delete(ouvinte);
}

function avisarQueFaltouEspaco(descartadas, guardou) {
  if (descartadas <= 0) return;
  for (const ouvinte of ouvintesDeEspaco) {
    try {
      ouvinte({ descartadas, guardou });
    } catch {
      /* quem escuta responde por si; a gravação não cai por causa disso */
    }
  }
}

/**
 * Grava, abrindo espaço se o navegador recusar por falta dele.
 *
 * O limite do `localStorage` é rígido e a exceção é a única forma de descobrir
 * que se chegou nele. Descartar as sessões mais antigas e tentar de novo é
 * preferível a perder a que o usuário está trabalhando agora — mas fazer isso
 * calado é apagar trabalho guardado pelas costas de quem guardou. Um fechamento
 * de 23 dezenas com jogos de 17 ocupa meio megabyte, e bastam oito deles para o
 * nono começar a comer os primeiros: sem aviso, a pessoa só descobre quando vai
 * procurar e não acha.
 *
 * O corte em `LIMITE_DE_SESSOES` não conta como falta de espaço: aquele é o teto
 * anunciado, e sair dele é o combinado.
 */
function gravar(sessoes) {
  const pedidas = Math.min(sessoes.length, LIMITE_DE_SESSOES);
  let paraGravar = sessoes.slice(0, LIMITE_DE_SESSOES);

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(paraGravar));
      avisarQueFaltouEspaco(pedidas - paraGravar.length, true);
      return true;
    } catch {
      if (paraGravar.length <= 1) {
        avisarQueFaltouEspaco(pedidas, false);
        return false;
      }
      // Descarta o quarto mais antigo e tenta de novo.
      paraGravar = paraGravar.slice(0, Math.max(1, Math.floor(paraGravar.length * 0.75)));
    }
  }
  avisarQueFaltouEspaco(pedidas, false);
  return false;
}

function agora() {
  return Date.now();
}

function novoIdentificador() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${agora().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Traz a busca única da versão anterior para dentro do histórico.
 *
 * Sem isto, quem já usava o aplicativo veria o trabalho em andamento sumir na
 * atualização — exatamente o oposto do que este módulo existe para garantir.
 * Roda uma vez: a chave antiga é removida ao final.
 */
export function migrarDaVersaoAntiga() {
  let bruto;
  try {
    bruto = localStorage.getItem(CHAVE_ANTIGA);
  } catch {
    return null;
  }
  if (!bruto) return null;

  try {
    const antiga = JSON.parse(bruto);
    if (antiga?.configuracao && Array.isArray(antiga.melhor) && antiga.melhor.length) {
      const sessao = criar(antiga.configuracao, {
        melhor: antiga.melhor,
        iteracoes: antiga.iteracoes ?? 0,
        avaliacao: { cartelas: antiga.melhor.length },
      });
      localStorage.removeItem(CHAVE_ANTIGA);
      return sessao;
    }
    localStorage.removeItem(CHAVE_ANTIGA);
  } catch {
    try {
      localStorage.removeItem(CHAVE_ANTIGA);
    } catch {
      /* nada a fazer */
    }
  }
  return null;
}

/** Todas as sessões, da mais recentemente trabalhada para a mais antiga. */
export function listar() {
  return ler().sort((a, b) => (b.atualizadaEm ?? 0) - (a.atualizadaEm ?? 0));
}

export function obter(id) {
  return ler().find((s) => s.id === id) ?? null;
}

export function quantidade() {
  return ler().length;
}

/**
 * Abre uma sessão nova.
 *
 * Chamada quando a primeira solução existe, não quando o usuário toca em
 * iniciar: uma busca abandonada antes de produzir qualquer coisa não é um
 * trabalho, e encheria o histórico de linhas vazias.
 */
export function criar(configuracao, dados = {}) {
  const sessao = {
    id: novoIdentificador(),
    criadaEm: agora(),
    atualizadaEm: agora(),
    configuracao,
    melhor: dados.melhor ?? [],
    avaliacao: dados.avaliacao ?? {},
    iteracoes: dados.iteracoes ?? 0,
    segundos: dados.segundos ?? 0,
    atual: dados.atual ?? [],
    motor: dados.motor ?? {},
  };

  gravar([sessao, ...ler()]);
  return sessao;
}

/**
 * Atualiza uma sessão existente.
 *
 * Devolve a sessão atualizada, ou `null` se ela já não existir — o usuário pode
 * tê-la excluído em outra aba enquanto a busca corria.
 */
export function atualizar(id, dados) {
  const sessoes = ler();
  const posicao = sessoes.findIndex((s) => s.id === id);
  if (posicao === -1) return null;

  const atualizada = {
    ...sessoes[posicao],
    ...dados,
    id: sessoes[posicao].id,
    criadaEm: sessoes[posicao].criadaEm,
    atualizadaEm: agora(),
  };

  sessoes[posicao] = atualizada;
  gravar(sessoes);
  return atualizada;
}

export function remover(id) {
  const sessoes = ler();
  const restantes = sessoes.filter((s) => s.id !== id);
  if (restantes.length === sessoes.length) return false;
  gravar(restantes);
  return true;
}

export function limpar() {
  try {
    localStorage.removeItem(CHAVE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte uma sessão no formato que o motor entende para retomar.
 *
 * É o contrato de `MotorWeb::retomar`: configuração, melhor solução em rótulos,
 * e a contagem de iterações já gastas — para o número na tela continuar de onde
 * parou em vez de zerar.
 */
export function paraRetomada(sessao) {
  return JSON.stringify({
    configuracao: sessao.configuracao,
    melhor: sessao.melhor,
    iteracoes: sessao.iteracoes ?? 0,
    // O que o motor guardou de si: a meta em curso, os contadores e os pesos que
    // o seletor aprendeu. Continuar um trabalho sem isso devolve as cartelas e
    // joga fora o rastro — o motor recomeça com todos os operadores empatados,
    // e leva milhares de iterações para reaprender o que já sabia.
    atual: sessao.atual ?? [],
    motor: sessao.motor ?? {},
  });
}

/** Descrição curta da configuração, para a lista. */
export function descrever(configuracao) {
  const { universo, pool, cartela, alvo, intersecao, orcamento } = configuracao;
  const tamanhoPool = Array.isArray(pool) ? pool.length : pool;

  // Na linguagem da modalidade, quando é dela que se trata. "18 dezenas ·
  // jogos de 17" diz a mesma coisa que "universo 25 · pool 18 · cartela 17 ·
  // cobrir grupos de 15" e não exige tradução de quem está lendo.
  //
  // A forma geral continua para os trabalhos gravados pelas versões antigas do
  // aplicativo, que resolviam qualquer cobertura: eles estão no histórico de
  // quem já usava, e descrevê-los errado seria pior do que descrevê-los em
  // jargão.
  const ehLotinha = universo === 25 && alvo === 15 && intersecao === 15 && !orcamento;
  if (ehLotinha) {
    return cartela === tamanhoPool
      ? `${tamanhoPool} dezenas · aposta única`
      : `${tamanhoPool} dezenas · jogos de ${cartela}`;
  }

  const regra =
    alvo === intersecao
      ? `cobrir grupos de ${alvo}`
      : `garantir ${intersecao} em ${alvo}`;

  const teto = orcamento ? ` · teto ${orcamento}` : '';
  return `universo ${universo} · pool ${tamanhoPool} · cartela ${cartela} · ${regra}${teto}`;
}

/**
 * Data em linguagem de gente: "hoje 14:32", "ontem 09:05", "17/08 14:32".
 *
 * O horário absoluto sozinho obriga a fazer conta de cabeça para saber se um
 * trabalho é de agora ou da semana passada.
 */
export function quando(instante, referencia = Date.now()) {
  if (!instante) return '';

  const data = new Date(instante);
  const hora = `${String(data.getHours()).padStart(2, '0')}:${String(
    data.getMinutes()
  ).padStart(2, '0')}`;

  const meiaNoite = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diasAtras = Math.round(
    (meiaNoite(new Date(referencia)) - meiaNoite(data)) / 86400000
  );

  if (diasAtras === 0) return `hoje ${hora}`;
  if (diasAtras === 1) return `ontem ${hora}`;

  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes} ${hora}`;
}
