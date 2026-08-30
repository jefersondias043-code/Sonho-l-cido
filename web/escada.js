/*
 * A escada: a metodologia do Construtor, sem tela e sem motor.
 *
 * ## A inversão
 *
 * O caminho comum pergunta "quais cartelas posso tirar?". Este pergunta "qual é
 * a menor estrutura que satisfaz estas regras?" — e ataca a pergunta pelos dois
 * lados ao mesmo tempo:
 *
 *     construção  ──→  o menor que consegui montar        (limite superior)
 *     matemática  ──→  o menor que poderia existir        (limite inferior)
 *
 * A busca vive no vão entre os dois. Cada degrau vencido baixa o teto; o piso
 * não se move, porque ele é teorema. Quando os dois se encontram, acabou — e
 * acabou **provado**, não por cansaço.
 *
 * ## Por que isto é um módulo à parte
 *
 * Aqui não há DOM nem WebAssembly: só números entrando e decisões saindo. É o
 * que permite provar a metodologia sem abrir navegador, e o que impede que ela
 * se dilua em callbacks de tela — a regra de quando parar é a parte do
 * aplicativo que mais barato sai testar e mais caro sai errar.
 */

/** O que a escada está fazendo, em uma palavra. */
export const PROVADO = 'provado';
export const PROCURANDO = 'procurando';
export const IMPOSSIVEL = 'impossivel';
export const INDEFINIDO = 'indefinido';

/**
 * O próximo degrau a tentar, ou `null` quando não há o que tentar.
 *
 * Devolve `null` em dois casos, e eles são diferentes:
 *
 * - `melhor <= limite` — os dois lados se encontraram. Não existe solução menor,
 *   e tentar seria procurar o que a matemática já disse que não há.
 * - números sem sentido — sem melhor ainda, ou limite maior que o melhor, que
 *   indicaria um limite inferior errado e é melhor não agir sobre.
 */
export function proximoDegrau(melhor, limite) {
  if (!Number.isFinite(melhor) || melhor <= 1) return null;
  const piso = Number.isFinite(limite) && limite > 0 ? limite : 1;
  if (melhor <= piso) return null;
  return melhor - 1;
}

/**
 * Onde a busca está.
 *
 * `impossivel` é o caso que não deveria acontecer: uma solução **abaixo** do
 * limite inferior significa que o limite está errado, e o aplicativo prefere
 * dizer isso a exibir um "provado" que mentiria. Já aconteceu de um piso mal
 * calculado passar por cima de uma solução que existia; a tela precisa
 * conseguir gritar.
 */
export function veredito(melhor, limite) {
  if (!Number.isFinite(melhor) || melhor <= 0) return INDEFINIDO;
  if (!Number.isFinite(limite) || limite <= 0) return PROCURANDO;
  if (melhor < limite) return IMPOSSIVEL;
  if (melhor === limite) return PROVADO;
  return PROCURANDO;
}

/**
 * Quanto do vão já foi vencido, em `0..=1`.
 *
 * Mede contra o ponto de partida, e não contra zero: o que interessa a quem
 * olha é quanto daquilo que **havia para ganhar** já foi ganho. Sem partida, ou
 * sem folga nenhuma desde o início, devolve 1 — não há vão, e a régua deve
 * aparecer cheia em vez de vazia.
 */
export function progresso(melhor, limite, partida) {
  if (![melhor, limite, partida].every(Number.isFinite)) return 0;
  const vao = partida - limite;
  if (vao <= 0) return 1;
  const vencido = partida - melhor;
  return Math.min(1, Math.max(0, vencido / vao));
}

/**
 * Quantas cartelas ainda podem cair, no melhor dos mundos.
 *
 * É o número que decide se vale deixar o aparelho trabalhando, e é honesto de
 * um jeito que "faltam 12" não é: pode ser que nenhuma delas caia, porque o
 * limite inferior é um piso, não uma promessa.
 */
export function folga(melhor, limite) {
  if (!Number.isFinite(melhor) || !Number.isFinite(limite)) return 0;
  return Math.max(0, melhor - limite);
}

/**
 * A escada como estado, para a tela não precisar guardar nada.
 *
 * Recebe o que aconteceu e devolve o que fazer — e é aqui que mora a única
 * regra de comportamento que o aplicativo promete: **ela nunca desiste
 * sozinha**. Um degrau que resiste continua sendo tentado, com o relógio à
 * vista, porque quem decide parar é quem está pagando a bateria.
 */
export class Escada {
  constructor({ partida, limite }) {
    this.partida = partida;
    this.limite = limite;
    this.melhor = partida;
    this.degrau = proximoDegrau(partida, limite);
    /** Tentativas no degrau atual, para a tela mostrar a insistência. */
    this.tentativas = 0;
    /** Cada degrau vencido, na ordem — é o histórico que a tela desenha. */
    this.vencidos = [];
  }

  /** O degrau fechou: `quantas` cartelas bastaram. */
  venceu(quantas) {
    if (!Number.isFinite(quantas) || quantas >= this.melhor) return false;
    this.melhor = quantas;
    this.vencidos.push(quantas);
    this.degrau = proximoDegrau(this.melhor, this.limite);
    this.tentativas = 0;
    return true;
  }

  /** O degrau resistiu a mais uma tentativa. Não desiste — só conta. */
  resistiu() {
    this.tentativas += 1;
  }

  get veredito() {
    return veredito(this.melhor, this.limite);
  }

  get acabou() {
    return this.degrau === null;
  }

  get progresso() {
    return progresso(this.melhor, this.limite, this.partida);
  }

  get folga() {
    return folga(this.melhor, this.limite);
  }
}
