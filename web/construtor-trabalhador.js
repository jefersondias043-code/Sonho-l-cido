/*
 * O trabalhador do Construtor.
 *
 * Ele executa as duas fases do aplicativo, e mantém a linha principal livre
 * para a tela responder ao toque enquanto isso — num universo de 25 números com
 * cartelas de 17 são 3.268.760 alvos, e uma única iteração pode levar segundos.
 *
 *   1. CONSTRUIR   monta a primeira solução e mede o limite inferior
 *   2. DEGRAU      fixa N cartelas e tenta fechar a cobertura com exatamente N
 *
 * A fase 2 é a inversão que dá nome ao aplicativo. Em vez de tirar cartelas de
 * uma solução e ver se ela sobrevive, ela **impõe o tamanho** e pergunta se a
 * cobertura fecha — `orcamento` troca o objetivo do motor para "cobrir o máximo
 * com no máximo N", e cobertura cheia quer dizer que N é viável.
 */

import init, { MotorWeb } from './wasm/motor_web.js';

/** Milissegundos por lote. Curto o bastante para a parada ser sentida na hora. */
const FATIA = 250;

let pronto = null;
let motor = null;
let rodando = false;
let paradaPedida = false;

async function garantirWasm() {
  pronto = pronto ?? init();
  await pronto;
}

function descartar() {
  if (motor) {
    motor.free?.();
    motor = null;
  }
}

/**
 * Mede o problema sem procurar nada.
 *
 * O limite inferior custa microssegundos e não depende de busca nenhuma — é a
 * metade do diagrama que está pronta antes de a outra começar. Mostrá-lo
 * primeiro é o que permite a alguém decidir se vale ligar o motor.
 */
async function medir(configuracao) {
  await garantirWasm();
  descartar();
  motor = new MotorWeb(JSON.stringify(configuracao));
  const estado = JSON.parse(motor.estado());
  postMessage({
    tipo: 'medida',
    totalAlvos: estado.total_alvos,
    limite: estado.limite_inferior,
    metodo: estado.metodo_limite,
    melhorConhecido: estado.melhor_conhecido,
  });
}

/**
 * A construção: os estágios do motor, e o número com que cada um chega.
 *
 * `preparar` roda a construção inteira numa chamada e devolve o melhor dela.
 * O nome do estágio vencedor vem em `origem_do_inicio` — é o que a tela mostra,
 * para a estrutura aparecer nascendo em vez de um relógio parado.
 */
async function construir(configuracao) {
  await garantirWasm();
  descartar();
  motor = new MotorWeb(JSON.stringify(configuracao));
  postMessage({ tipo: 'construindo' });

  const estado = JSON.parse(motor.preparar());
  postMessage({
    tipo: 'construido',
    cartelas: estado.melhor_cartelas,
    origem: estado.origem_do_inicio,
    limite: estado.limite_inferior,
    metodo: estado.metodo_limite,
    totalAlvos: estado.total_alvos,
    provado: estado.optimalidade_provada,
    solucao: JSON.parse(motor.melhor()),
  });
}

/**
 * Um degrau: fecha a cobertura com exatamente `quantas` cartelas, ou insiste.
 *
 * A semente é a solução que já temos. Com o orçamento em `quantas`, o motor
 * apara o excedente sozinho e passa a trabalhar para recuperar a cobertura que
 * a aparada custou — que é precisamente a pergunta "dá para fazer com N?".
 *
 * Não há desistência aqui dentro. O laço roda até fechar, até a parada ser
 * pedida, ou até o teto de tempo daquele lote — e quem decide continuar é a
 * tela, que recebe o andamento e insiste ou não.
 */
async function degrau({ configuracao, quantas, semente, segundos }) {
  await garantirWasm();
  descartar();
  paradaPedida = false;

  motor = new MotorWeb(JSON.stringify({ ...configuracao, orcamento: quantas }));
  if (Array.isArray(semente) && semente.length > 0) {
    motor.semear(JSON.stringify(semente));
  }
  motor.preparar();

  rodando = true;
  const ate = Date.now() + Math.max(1, segundos) * 1000;
  let estado = null;

  while (rodando && !paradaPedida && Date.now() < ate) {
    estado = JSON.parse(motor.avancar(200, FATIA));
    if (estado.melhor_cobertura >= 1 && estado.melhor_cartelas <= quantas) {
      postMessage({
        tipo: 'venceu',
        quantas: estado.melhor_cartelas,
        iteracoes: estado.iteracoes,
        solucao: JSON.parse(motor.melhor()),
      });
      rodando = false;
      return;
    }
    postMessage({
      tipo: 'andamento',
      quantas,
      cobertura: estado.melhor_cobertura,
      descobertos: estado.atual_descobertos,
      iteracoes: estado.iteracoes,
    });
  }

  rodando = false;
  postMessage({
    tipo: 'resistiu',
    quantas,
    cobertura: estado?.melhor_cobertura ?? 0,
    iteracoes: estado?.iteracoes ?? 0,
    parado: paradaPedida,
  });
}

self.onmessage = async ({ data }) => {
  try {
    switch (data?.tipo) {
      case 'medir':
        await medir(data.configuracao);
        break;
      case 'construir':
        await construir(data.configuracao);
        break;
      case 'degrau':
        await degrau(data);
        break;
      case 'parar':
        // O laço confere a bandeira entre lotes; parar é sentido em um lote,
        // que é o teto de 250 ms — e não em uma iteração, que num problema
        // grande pode levar segundos.
        paradaPedida = true;
        rodando = false;
        break;
      case 'descartar':
        descartar();
        break;
    }
  } catch (erro) {
    rodando = false;
    postMessage({ tipo: 'erro', erro: String(erro?.message ?? erro) });
  }
};
