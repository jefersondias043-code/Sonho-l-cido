/*
 * O histórico do Construtor Exato.
 *
 * Antes disto o aplicativo guardava **um** trabalho, na chave
 * `sonho-lucido:exato:escalada`, preso aos cinco números que estavam na tela.
 * Resolver outro problema sobrescrevia o anterior sem aviso — o mesmo defeito
 * que `historico.js` foi escrito para curar na Lotinha, e pelo mesmo motivo:
 * quem passou horas montando um fechamento não pode perdê-lo por ter tocado em
 * Resolver com outros números.
 *
 * ## O que uma sessão precisa carregar
 *
 * Não é a lista de cartelas. Retomar do zero uma escalada de mil cartelas custa
 * o mesmo que tê-la feito, e o pedido é explícito: abrir um fechamento salvo
 * tem de devolver **exatamente** a mesma quantidade de cartelas e continuar
 * daquele ponto, sem recriar nada.
 *
 * Quem sabe se retratar é o motor: `Escalada::guardar` devolve o `EstadoSalvo`
 * com tudo — o teto, o conjunto em curso, o melhor, a fase, os contadores, a
 * semente e a curva —, e `Escalada::retomar` reconstrói a partir dele usando o
 * **teto salvo**, e não um teto recalculado. Aqui a sessão guarda esse estado
 * inteiro, mais o que só a tela sabe: quais números foram marcados na grade e
 * de onde veio o piso.
 *
 * ## Onde os dados ficam
 *
 * No `localStorage` do próprio aparelho. Nada sai daqui. A escolha frente ao
 * IndexedDB é a mesma de `historico.js`, e pelo mesmo motivo: armazenamento
 * síncrono elimina a classe de defeito de ler antes de ter gravado.
 *
 * ## O que este módulo não promete
 *
 * Armazenamento de navegador não é cofre. O iOS pode limpar dados de sites
 * pouco visitados, e apagar os dados do navegador leva o histórico junto. Por
 * isso a tela oferece exportar: o arquivo é o que sobrevive a qualquer coisa.
 */

import { quando } from './historico.js';

// Reexportado para a tela não precisar saber de dois módulos só por causa de
// uma data. A função é um formatador puro — não tem nada da Lotinha dentro —, e
// tê-la em dois lugares seria criar duas cópias para divergirem.
export { quando };

const CHAVE = 'sonho-lucido:exato:historico';

/** A chave da versão de um trabalho só. Migrada e removida. */
const CHAVE_ANTIGA = 'sonho-lucido:exato:escalada';

/**
 * Teto de sessões guardadas.
 *
 * Menor que os 60 da Lotinha de propósito: cada sessão do Exato carrega o
 * estado da escalada, com o conjunto em curso e o melhor como máscaras. Um
 * fechamento de 1.537 cartelas ocupa perto de 35 KB, e quarenta deles já
 * encostam no que o navegador costuma dar.
 */
export const LIMITE_DE_SESSOES = 40;

/** Os cinco números que descrevem um problema. */
const CAMPOS_DO_PEDIDO = ['v', 'k', 'j', 't', 'r'];

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
 * Se esta sessão pode ser **usada**, e não apenas se tem a forma de uma.
 *
 * Conferir aqui é conferir uma vez, no único ponto por onde tudo entra. Uma
 * sessão sem os cinco números não descreve problema nenhum; uma sem `numeros`
 * tem cartelas que não voltam a ser números; e uma sem `escalada` é uma lista
 * de cartelas disfarçada de trabalho retomável — abriria, e o motor recomeçaria
 * do zero sem ninguém entender por quê.
 */
export function ehSessaoValida(sessao) {
  if (!sessao || typeof sessao.id !== 'string' || !sessao.id) return false;

  const p = sessao.pedido;
  if (!p || typeof p !== 'object') return false;
  if (!CAMPOS_DO_PEDIDO.every((campo) => Number.isInteger(p[campo]) && p[campo] > 0)) return false;
  if (p.k > p.v || p.j > p.v || p.t > Math.min(p.k, p.j)) return false;

  if (!Array.isArray(sessao.numeros) || sessao.numeros.length !== p.v) return false;
  if (!sessao.numeros.every((n) => Number.isInteger(n) && n > 0)) return false;

  if (typeof sessao.escalada !== 'string' || !sessao.escalada) return false;

  if (!Array.isArray(sessao.cartelas)) return false;
  return sessao.cartelas.every(
    (cartela) =>
      Array.isArray(cartela) &&
      cartela.length === p.k &&
      cartela.every((posicao) => Number.isInteger(posicao) && posicao >= 1 && posicao <= p.v)
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
 * Registra quem quer saber que faltou espaço.
 *
 * O ouvinte recebe `{ descartadas, guardou }`. Devolve a função que desfaz este
 * registro — e só este.
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
 * preferível a perder a que está sendo trabalhada agora — mas fazer isso calado
 * é apagar trabalho pelas costas de quem o guardou.
 *
 * O corte em `LIMITE_DE_SESSOES` não conta como falta de espaço: aquele é o
 * teto anunciado, e sair dele é o combinado.
 */
function gravar(sessoes) {
  const pedidas = Math.min(sessoes.length, LIMITE_DE_SESSOES);
  let paraGravar = sessoes.slice(0, LIMITE_DE_SESSOES);

  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(paraGravar));
      avisarQueFaltouEspaco(pedidas - paraGravar.length, true);
      return true;
    } catch {
      if (paraGravar.length <= 1) {
        avisarQueFaltouEspaco(pedidas, false);
        return false;
      }
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
  return `e-${agora().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

/** Os cinco números são os mesmos? */
export function mesmoPedido(a, b) {
  if (!a || !b) return false;
  return CAMPOS_DO_PEDIDO.every((campo) => a[campo] === b[campo]);
}

/**
 * A sessão mais recente para exatamente estes cinco números, se houver.
 *
 * É o que sustenta a oferta "continuar de onde parou" na tela dos parâmetros:
 * retomar sobre outra configuração seria continuar o problema errado.
 */
export function paraOPedido(pedido) {
  return listar().find((s) => mesmoPedido(s.pedido, pedido)) ?? null;
}

/**
 * Abre uma sessão nova.
 *
 * Chamada quando existe trabalho a guardar — o primeiro estado que o motor
 * devolve —, e não quando alguém toca em Resolver: uma escalada abandonada
 * antes de produzir qualquer coisa não é um fechamento, e encheria o histórico
 * de linhas vazias.
 */
export function criar(dados) {
  const sessao = {
    id: novoIdentificador(),
    criadaEm: agora(),
    atualizadaEm: agora(),
    ...camposDaSessao(dados),
  };
  gravar([sessao, ...ler()]);
  return sessao;
}

/**
 * Atualiza uma sessão existente.
 *
 * Devolve a sessão atualizada, ou `null` se ela já não existir — pode ter sido
 * excluída noutra aba enquanto a escalada corria.
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

/** Guarda uma sessão que veio de fora, com identidade nova. */
export function importar(dados) {
  return criar(dados);
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

/** O trabalho que ficou em andamento quando o aplicativo fechou, se houver. */
export function interrompida() {
  return listar().find((s) => s.emCurso === true) ?? null;
}

/** Anota que um trabalho não está mais em andamento, sem tocar no resto dele. */
export function encerrar(id) {
  const sessoes = ler();
  const alvo = sessoes.find((s) => s.id === id);
  if (!alvo || !alvo.emCurso) return false;
  alvo.emCurso = false;
  gravar(sessoes);
  return true;
}

/** Os campos de uma sessão, com o neutro de cada um que faltar. */
function camposDaSessao(dados) {
  return {
    pedido: dados.pedido,
    numeros: dados.numeros ?? [],
    universo: dados.universo ?? 0,
    esforco: dados.esforco ?? 1,
    // De onde veio o piso, e qual é. Guardados para "continuar" poder pular os
    // estágios 3 e 4: no esforço fundo aquela etapa leva minutos, e refazê-la
    // para chegar ao mesmo número é recomeçar o trabalho que se mandou não
    // recomeçar.
    piso: dados.piso ?? 0,
    origem: dados.origem ?? '',
    fechado: dados.fechado ?? false,
    cartelas: dados.cartelas ?? [],
    escalada: dados.escalada ?? '',
    curva: dados.curva ?? [],
    cobertura: dados.cobertura ?? 0,
    fase: dados.fase ?? 'subindo',
    verificado: dados.verificado ?? false,
    descobertos: dados.descobertos ?? 0,
    // Se o motor estava rodando quando esta linha foi gravada. Fica gravado, e
    // não só na memória da página, porque é o que permite descobrir na abertura
    // seguinte que uma escalada foi interrompida sem ninguém mandar parar — o
    // sistema encerrou a página, a bateria acabou, o navegador foi fechado.
    emCurso: dados.emCurso ?? false,
  };
}

/**
 * Traz o trabalho único da versão anterior para dentro do histórico.
 *
 * Sem isto, quem tem uma escalada guardada agora a veria sumir na atualização —
 * exatamente o oposto do que este módulo existe para garantir. Roda uma vez: a
 * chave antiga é removida ao final.
 */
export function migrarDoSlotUnico() {
  let bruto;
  try {
    bruto = localStorage.getItem(CHAVE_ANTIGA);
  } catch {
    return null;
  }
  if (!bruto) return null;

  const apagar = () => {
    try {
      localStorage.removeItem(CHAVE_ANTIGA);
    } catch {
      /* nada a fazer */
    }
  };

  try {
    const antigo = JSON.parse(bruto);
    const estado = antigo?.escalada ? JSON.parse(antigo.escalada) : null;
    if (!antigo?.pedido || !estado) {
      apagar();
      return null;
    }

    const p = antigo.pedido;
    const cartelas = Array.isArray(estado.melhor) ? estado.melhor : [];
    const sessao = criar({
      pedido: p,
      // A versão do slot único não guardava quais números foram marcados na
      // grade. Sem eles não há como traduzir posição em número, e o mais
      // próximo da verdade é assumir os `v` primeiros — que é o que a tela
      // oferece por padrão.
      numeros: Array.from({ length: p.v }, (_, i) => i + 1),
      universo: p.v,
      piso: estado.teto ?? 0,
      origem: 'trabalho guardado pela versão anterior',
      cartelas: [],
      escalada: antigo.escalada,
      cobertura: 0,
      fase: estado.fase ?? 'subindo',
    });
    apagar();
    return { sessao, cartelas: cartelas.length };
  } catch {
    apagar();
    return null;
  }
}

/**
 * Descrição curta de um fechamento, para a lista.
 *
 * Na linguagem da tela que o produziu: "18 dezenas · jogos de 17 · garante 15"
 * diz a mesma coisa que "v=18 k=17 j=15 t=15" e não exige tradução de quem está
 * lendo. O sorteio só aparece quando difere da garantia, porque é aí que ele
 * significa alguma coisa.
 */
export function descrever(pedido) {
  if (!pedido) return '';
  const { v, k, j, t, r } = pedido;
  const partes = [`${v} ${v === 1 ? 'número' : 'números'}`, `jogos de ${k}`];
  if (j !== t) partes.push(`saem ${j}`);
  partes.push(`garante ${t}`);
  if (r > 1) partes.push(`${r} premiadas`);
  return partes.join(' · ');
}
