/*
 * O motor roda aqui dentro, num Web Worker — nunca na thread da interface.
 *
 * O motivo é direto: uma iteração da busca é rápida, mas milhões delas não são.
 * Se isso rodasse na thread principal, a página congelaria — o botão Pausar não
 * responderia, a rolagem travaria, e o iOS acabaria matando a aba por
 * "não responder".
 *
 * Mesmo aqui o trabalho é fatiado em lotes. Um worker só recebe mensagens
 * quando a pilha de execução esvazia, então um laço infinito dentro dele também
 * ficaria surdo ao pedido de pausa. Entre um lote e outro o worker devolve o
 * controle com `setTimeout(0)`, e é nessa fresta que as mensagens chegam.
 */

import init, { MotorWeb } from './wasm/motor_web.js';

/** Quanto tempo cada lote deve durar. */
const ALVO_MS_POR_LOTE = 220;

/** Limites do tamanho do lote, para a calibragem não sair da realidade. */
const LOTE_MINIMO = 20;
const LOTE_MAXIMO = 2_000_000;

let motor = null;
let rodando = false;
let lote = 2_000;
let iniciadoEm = 0;
let iteracoesNoInicio = 0;

/*
 * O ouvinte é registrado ANTES de carregar o WebAssembly, e o que chegar nesse
 * intervalo vai para uma fila.
 *
 * Carregar o WebAssembly leva algumas centenas de milissegundos, e a interface
 * manda a configuração assim que cria o worker. Sem esta fila, essa primeira
 * mensagem — justamente a que dá a partida — chega antes de existir alguém para
 * ouvi-la, e some sem deixar rastro: a tela simplesmente não reage ao botão, e
 * nenhum erro aparece em lugar nenhum.
 */
let carregado = false;
const fila = [];

self.onmessage = (evento) => {
  if (!carregado) {
    fila.push(evento.data);
    return;
  }
  tratar(evento.data);
};

try {
  await init();
  carregado = true;
  postMessage({ tipo: 'pronto' });
  for (const pendente of fila.splice(0)) tratar(pendente);
} catch (erro) {
  postMessage({
    tipo: 'erro',
    mensagem: `não consegui carregar o motor: ${String(erro?.message ?? erro)}`,
  });
}

function tratar(mensagem) {
  try {
    switch (mensagem.tipo) {
      case 'criar':
        criar(mensagem);
        break;

      case 'rodar':
        if (motor && !rodando) {
          rodando = true;
          iniciadoEm = performance.now();
          iteracoesNoInicio = lerEstado().iteracoes;
          laco();
        }
        break;

      case 'pausar':
        rodando = false;
        postMessage({ tipo: 'pausado', estado: lerEstado() });
        break;

      case 'exportar':
        postMessage({ tipo: 'exportado', estado: motor ? motor.exportar() : null });
        break;

      default:
        break;
    }
  } catch (erro) {
    rodando = false;
    postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
  }
}

function criar({ configuracao, fechamento, salvo }) {
  // Libera a memória do motor anterior. Sem isto, recomeçar várias vezes num
  // celular acumula heaps de WebAssembly até o navegador derrubar a aba.
  if (motor) {
    motor.free();
    motor = null;
  }

  motor = new MotorWeb(JSON.stringify(configuracao));

  if (salvo) {
    motor.retomar(salvo);
  } else if (fechamento && fechamento.length > 0) {
    motor.semear(JSON.stringify(fechamento));
  }

  lote = 2_000;
  postMessage({ tipo: 'criado', estado: lerEstado(), totalAlvos: motor.total_alvos() });
}

function lerEstado() {
  return JSON.parse(motor.estado());
}

function laco() {
  if (!rodando || !motor) return;

  // O laço tem o próprio tratamento de erro: as voltas seguintes são agendadas
  // por `setTimeout`, fora de qualquer `try` que as tenha originado. Sem isto,
  // uma falha depois da primeira volta ficaria invisível — a busca pararia em
  // silêncio, sem nada na tela.
  let estado;
  let decorrido;
  try {
    const antes = performance.now();
    estado = JSON.parse(motor.avancar(lote));
    decorrido = performance.now() - antes;
  } catch (erro) {
    rodando = false;
    postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
    return;
  }

  calibrar(decorrido);

  const segundos = (performance.now() - iniciadoEm) / 1000;
  estado.velocidade =
    segundos > 0 ? (estado.iteracoes - iteracoesNoInicio) / segundos : 0;

  postMessage({ tipo: 'estado', estado });

  if (estado.encerrado) {
    rodando = false;
    postMessage({ tipo: 'encerrado', estado });
    return;
  }

  // A fresta por onde as mensagens da interface entram.
  setTimeout(laco, 0);
}

/**
 * Ajusta o tamanho do lote para que cada um dure perto do alvo.
 *
 * O custo de uma iteração varia por ordens de grandeza entre configurações — um
 * covering design pequeno faz centenas de milhares por segundo, uma garantia
 * parcial faz algumas centenas. Um lote fixo serviria a um caso e arruinaria o
 * outro: ou a interface trava, ou o tempo se esvai atravessando a fronteira
 * entre JavaScript e WebAssembly.
 *
 * O ajuste é gradual (no máximo dobra ou cai pela metade) para não oscilar
 * quando um lote sai fora da curva.
 */
function calibrar(decorridoMs) {
  if (decorridoMs < 1) {
    lote = Math.min(lote * 2, LOTE_MAXIMO);
    return;
  }

  const fator = ALVO_MS_POR_LOTE / decorridoMs;
  const suavizado = Math.max(0.5, Math.min(2, fator));
  lote = Math.round(Math.max(LOTE_MINIMO, Math.min(LOTE_MAXIMO, lote * suavizado)));
}
