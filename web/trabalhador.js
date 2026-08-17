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

/**
 * Tamanho do primeiro lote, antes de haver qualquer medição.
 *
 * Deliberadamente pequeno. A calibragem só age a partir do segundo lote, então
 * o primeiro é um chute — e um chute grande custa caro: numa configuração
 * pesada, onde o motor faz algumas centenas de iterações por segundo, duas mil
 * iterações são mais de dez segundos de tela parada, sem número nenhum
 * mudando. Do lado do usuário isso é indistinguível de um travamento.
 *
 * Começar pequeno atrasa em milissegundos o caso rápido e evita o silêncio
 * longo no caso lento.
 */
const LOTE_INICIAL = 250;

let motor = null;
let rodando = false;
let lote = LOTE_INICIAL;
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
        postMessage({ tipo: 'pausado', estado: lerEstado(), cartelas: JSON.parse(motor.melhor()) });
        break;

      case 'encerrar':
        // Devolve o estado antes de liberar: é a última chance de guardar o
        // resultado, e o usuário acabou de pedir para parar de vez.
        postMessage({
          tipo: 'encerrado',
          estado: motor ? lerEstado() : null,
          cartelas: motor ? JSON.parse(motor.melhor()) : null,
        });
        descartarMotor();
        break;

      default:
        break;
    }
  } catch (erro) {
    rodando = false;
    postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
  }
}

function criar({ configuracao, fechamento, doMundo, salvo }) {
  descartarMotor();

  motor = new MotorWeb(JSON.stringify(configuracao));

  if (salvo) {
    motor.retomar(salvo);
  } else if (Array.isArray(doMundo) && doMundo.length > 0) {
    // A cobertura do mundo, vinda da biblioteca guardada no aparelho, entra
    // pelo mesmo caminho de qualquer fechamento: vira candidata a ponto de
    // partida e concorre com a construção interna.
    motor.semear_do_mundo(JSON.stringify(doMundo));

    // E se o usuário também colou algo, oferece as duas. Semear de novo não
    // descarta a primeira: do lado do Rust, a solução já escolhida entra como
    // mais um candidato, todas são podadas, e vence a menor.
    if (typeof fechamento === 'string' && fechamento.trim().length > 0) {
      motor.semear_texto(fechamento);
    }
  } else if (typeof fechamento === 'string' && fechamento.trim().length > 0) {
    // Texto cru, interpretado do lado do Rust. É o mesmo interpretador da linha
    // de comando, então o formato aceito é um só. O erro que ele devolve cita a
    // linha, e sobe daqui até a caixa de texto onde o usuário colou.
    motor.semear_texto(fechamento);
  } else if (Array.isArray(fechamento) && fechamento.length > 0) {
    motor.semear(JSON.stringify(fechamento));
  }

  lote = LOTE_INICIAL;
  postMessage({ tipo: 'criado', totalAlvos: motor.total_alvos() });

  // A construção inicial fica para o próximo tique. Ela pode levar segundos
  // num problema grande, e assim a interface consegue anunciar "montando a
  // primeira solução" antes de o trabalho começar, em vez de depois.
  setTimeout(() => {
    if (!motor) return;
    try {
      const estado = JSON.parse(motor.preparar());
      postMessage({ tipo: 'preparado', estado, cartelas: JSON.parse(motor.melhor()) });
    } catch (erro) {
      postMessage({ tipo: 'erro', mensagem: String(erro?.message ?? erro) });
    }
  }, 0);
}

/**
 * Libera a memória do motor.
 *
 * Cada motor carrega o vetor de cobertura inteiro, que em problemas grandes são
 * centenas de megabytes. O coletor de lixo do JavaScript não enxerga a memória
 * do WebAssembly, então sem esta chamada explícita começar buscas em sequência
 * acumula heaps até o navegador derrubar a aba — e num celular isso acontece
 * rápido.
 */
function descartarMotor() {
  rodando = false;
  if (motor) {
    motor.free();
    motor = null;
  }
}

function lerEstado() {
  return JSON.parse(motor.estado());
}

/**
 * As cartelas do recorde, quando este lote produziu um.
 *
 * Elas viajam **junto** com o estado que as anunciou, e não por um caminho
 * paralelo. A primeira versão pedia a solução ao `localStorage`, gravado por
 * uma mensagem separada de exportação — e essa mensagem esperava na fila
 * atrás da leva de iterações em curso, enquanto a tela já tentava ler. O
 * resultado era a aba Resultado vazia durante toda a busca: o motor achava as
 * cartelas, a tela lia antes de elas serem gravadas, e ninguém voltava a
 * olhar.
 *
 * Mandando as duas coisas na mesma mensagem, não existe intervalo em que uma
 * chegou e a outra não.
 *
 * Só são incluídas quando há recorde novo: fora disso as cartelas são as
 * mesmas do lote anterior, e serializá-las a cada 220 ms seria puro
 * desperdício.
 */
function cartelasSeMudaram(estado) {
  if (!estado.novos_recordes?.length) return null;
  return JSON.parse(motor.melhor());
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

  postMessage({ tipo: 'estado', estado, cartelas: cartelasSeMudaram(estado) });

  // Não existe condição aqui que encerre o laço sozinha, e é de propósito.
  //
  // Havia: ao provar a optimalidade, o worker parava e avisava a tela. A
  // intenção era poupar bateria, e o efeito era decidir por quem está usando.
  // As três formas de isto parar — `pausar`, `encerrar` e um erro — chegam
  // todas de fora, e as duas primeiras são o dedo do usuário no botão.
  //
  // A fresta por onde essas mensagens entram é o `setTimeout` abaixo: um
  // worker só as recebe quando a pilha de execução esvazia.
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
