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
 * o primeiro é um chute — e um chute grande custa caro.
 *
 * Vinte e cinco, e não duzentos e cinquenta, por uma medição: num pool de 25
 * dezenas com jogos de 20, **uma** iteração leva quase dois segundos, porque
 * varre 3,2 milhões de alvos. O lote de abertura antigo daria um quarto de hora
 * dentro de uma única chamada ao WebAssembly, com a tela parada em zero e os
 * botões sem efeito — o worker só lê mensagens entre chamadas.
 *
 * O teto de tempo passado a `avancar` é a defesa de verdade contra isso; este
 * número menor é a segunda camada, e custa poucos milissegundos no caso rápido.
 */
const LOTE_INICIAL = 25;

/**
 * Quanto tempo o estágio 0 tem para construir, quando a tela não diz outro.
 *
 * Vinte segundos foi o que separou, na medição, uma partida de 4.142 cartelas de
 * uma de 3.432 em `(22,17)`. Mais tempo continua rendendo — quem tem um
 * computador na frente pode dar mais, pelo campo em Avançado.
 */
const SEGUNDOS_DO_CONSTRUTOR = 20;
let segundosDoConstrutor = SEGUNDOS_DO_CONSTRUTOR;

let motor = null;
let rodando = false;

/*
 * O ciclo de trabalho e descanso mora aqui, e não na interface.
 *
 * Estava do outro lado, num `setInterval` da página. Funcionava, e era o lugar
 * errado: quem decide quando o motor trabalha é o motor. Do lado da página o
 * temporizador é estrangulado quando a aba vai ao fundo, e um ciclo de quinze
 * minutos vira um disparo que chega tarde — ou não chega.
 *
 * O prazo é um instante do relógio de parede, não uma contagem. Enquanto
 * trabalha, o próprio laço confere o prazo entre um lote e outro, sem
 * temporizador nenhum. Enquanto descansa, um tique por segundo confere o mesmo
 * instante — e é por ser instante, e não contagem, que uma suspensão do sistema
 * não desregula o ciclo: ao voltar, o prazo já venceu e a troca acontece na hora.
 */
let ciclo = null;
let relogioDoDescanso = null;

/** De quanto em quanto tempo o estado é oferecido à interface para gravar. */
const SEGUNDOS_ENTRE_SALVAMENTOS = 30;
let salvoEm = 0;
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
        // Um `rodar` vindo do botão desfaz a pausa manual e devolve o ciclo ao
        // trabalho: quem tocou em Continuar quer o motor andando agora, não
        // esperando o fim de um descanso que começou enquanto estava parado.
        if (ciclo) {
          ciclo.suspenso = false;
          comecarEtapa('trabalho');
        }
        ligarLaco();
        break;

      case 'pausar':
        // Pausa manual suspende o ciclo. Quem tocou em Pausar quer o motor
        // parado, e não parado por quinze minutos e religado sozinho.
        if (ciclo) ciclo.suspenso = true;
        pararDescanso();
        rodando = false;
        postMessage({ tipo: 'pausado', estado: lerEstado(), cartelas: JSON.parse(motor.melhor()) });
        break;

      // Liga e desliga o ciclo automático. Quem manda é a interface; quem
      // executa, daqui em diante, é o motor.
      case 'automatico':
        configurarCiclo(mensagem);
        break;

      // A sessão inteira, para gravar num arquivo e continuar noutro aparelho.
      //
      // Sai de dentro do WebAssembly, que é o único lugar onde o estado do motor
      // existe por completo — a tela conhece o recorde e os contadores, mas não
      // a meta em curso nem o que o seletor aprendeu.
      //
      // Não pausa a busca para responder. O motor só lê mensagens entre lotes,
      // então o que ele devolve aqui é o estado no fim do último lote: um
      // instante consistente, e o mais recente que existe.
      case 'exportar':
        postMessage({
          tipo: 'exportado',
          id: mensagem.id,
          sessao: motor ? JSON.parse(motor.exportar()) : null,
        });
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

function criar({ configuracao, fechamento, doBanco, salvo, segundosDoConstrutor: pedido }) {
  segundosDoConstrutor = Math.max(1, Number(pedido) || SEGUNDOS_DO_CONSTRUTOR);
  descartarMotor();

  motor = new MotorWeb(JSON.stringify(configuracao));

  if (salvo) {
    motor.retomar(salvo);
  } else if (Array.isArray(doBanco) && doBanco.length > 0) {
    // O fechamento pronto do aplicativo entra pelo mesmo caminho de qualquer
    // outro: vira candidato a ponto de partida e concorre com a construção
    // interna. Ele costuma vencer — foi produzido com minutos de busca, não
    // com os milissegundos que a construção tem — mas quem decide é a poda.
    motor.semear_do_banco(JSON.stringify(doBanco));

    // Semear de novo não descarta a primeira semente: do lado do Rust, a
    // solução já escolhida entra como mais um candidato, todas são podadas, e
    // vence a menor.
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
      // Primeiro a partida que já existe, para a tela ter um número em
      // seguida ao toque. Vinte segundos de "montando…" sem número nenhum é
      // indistinguível de um travamento, e o número existe desde já.
      const estado = JSON.parse(motor.preparar());
      const retomada = motor.sessao_retomada();
      postMessage({
        tipo: 'preparado',
        estado,
        cartelas: JSON.parse(motor.melhor()),
        retomada,
      });

      // Caminho 1 — sessão retomada. O estágio 0 não roda, e a busca começa
      // direto do fechamento que veio no arquivo.
      //
      // A pergunta é feita ao motor, e não à variável `salvo` que está logo
      // acima, de propósito: quem garante a regra é o Rust, e perguntar a ele é
      // o que impede os dois lados de discordarem se um dia algum caminho novo
      // aparecer aqui.
      if (retomada) {
        postMessage({
          tipo: 'construido',
          passos: [],
          retomada: true,
          estado: lerEstado(),
          cartelas: JSON.parse(motor.melhor()),
        });
        return;
      }

      // Caminho 2 — otimização nova. Estágio 0: o Motor Construtor. Procura
      // construir direto a menor solução que conseguir, em vez de deixar a
      // busca reduzir uma qualquer. O que ele encontra **concorre** com a
      // partida que já estava — um fechamento trazido que seja menor continua
      // vencendo.
      //
      // Medido, com vinte segundos: em (22,17) a partida sai de 4.142 cartelas
      // para 3.432. São setecentas que a busca não precisa mais tirar uma a uma,
      // e cada uma custava uma rodada de destruir-reconstruir.
      const passos = JSON.parse(motor.construir_partida(segundosDoConstrutor));
      postMessage({
        tipo: 'construido',
        passos,
        estado: lerEstado(),
        cartelas: JSON.parse(motor.melhor()),
      });
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

/**
 * Liga, desliga ou reconfigura o ciclo automático.
 *
 * Ligar com o motor parado o põe a trabalhar: quem marca a opção espera que ela
 * valha desde já, e não a partir do próximo toque em Continuar.
 */
function configurarCiclo({ ligado, segundosTrabalho, segundosDescanso }) {
  if (!ligado) {
    const estavaDescansando = ciclo?.etapa === 'descanso';
    ciclo = null;
    pararDescanso();
    // Desligar durante o descanso devolve o motor ao trabalho: ninguém desliga o
    // modo automático querendo ficar parado.
    if (estavaDescansando) ligarLaco();
    postMessage({ tipo: 'ciclo', etapa: null, venceEm: 0 });
    return;
  }

  ciclo = {
    trabalho: Math.max(1, Number(segundosTrabalho) || 900),
    descanso: Math.max(1, Number(segundosDescanso) || 600),
    etapa: 'trabalho',
    venceEm: 0,
    suspenso: false,
  };
  comecarEtapa('trabalho');
}

/** Começa uma etapa e anuncia quando ela vence. */
function comecarEtapa(etapa) {
  if (!ciclo) return;
  const segundos = etapa === 'trabalho' ? ciclo.trabalho : ciclo.descanso;
  ciclo.etapa = etapa;
  ciclo.venceEm = Date.now() + segundos * 1000;

  if (etapa === 'trabalho') {
    pararDescanso();
    ligarLaco();
  } else {
    rodando = false;
    // Um tique por segundo custa nada e é o que traz o motor de volta. O laço
    // pesado não roda: é aqui que o aparelho esfria.
    pararDescanso();
    relogioDoDescanso = setInterval(conferirCiclo, 1000);
    postMessage({ tipo: 'pausado', estado: lerEstado(), cartelas: JSON.parse(motor.melhor()) });
  }
  postMessage({ tipo: 'ciclo', etapa: ciclo.etapa, venceEm: ciclo.venceEm });
}

function pararDescanso() {
  clearInterval(relogioDoDescanso);
  relogioDoDescanso = null;
}

/**
 * Confere se a etapa venceu.
 *
 * Chamado entre os lotes enquanto o motor trabalha, e de segundo em segundo
 * enquanto descansa. Nos dois casos a decisão é sobre o **instante**, e não
 * sobre quantos tiques passaram — é o que faz um prazo vencido há minutos, por
 * conta de uma suspensão do sistema, resolver-se de uma vez na volta.
 */
function conferirCiclo() {
  if (!ciclo || ciclo.suspenso || !motor) return;
  if (Date.now() < ciclo.venceEm) return;
  comecarEtapa(ciclo.etapa === 'trabalho' ? 'descanso' : 'trabalho');
}

/** Liga o laço, se já não estiver ligado. */
function ligarLaco() {
  if (!motor || rodando) return;
  rodando = true;
  iniciadoEm = performance.now();
  iteracoesNoInicio = lerEstado().iteracoes;
  laco();
}

/**
 * Oferece o estado à interface para gravar, de tempos em tempos.
 *
 * O sistema pode encerrar a página a qualquer momento — bateria, memória, ou só
 * porque o usuário ficou tempo demais noutro aplicativo. O que estiver gravado
 * até ali sobrevive; o resto não. Trinta segundos é o tamanho da pior perda
 * possível, e custa uma mensagem com alguns números.
 *
 * As cartelas não vão junto: só o retrato do motor. As cartelas a interface já
 * tem, porque viajam com cada recorde.
 */
function talvezSalvar(estado) {
  const agora = Date.now();
  if (agora - salvoEm < SEGUNDOS_ENTRE_SALVAMENTOS * 1000) return;
  salvoEm = agora;
  postMessage({ tipo: 'salvar', estado });
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
    estado = JSON.parse(motor.avancar(lote, ALVO_MS_POR_LOTE));
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
  talvezSalvar(estado);

  // O fim do período de trabalho é conferido aqui, entre um lote e outro. É a
  // fresta natural: sem temporizador, sem interromper cálculo pela metade, e
  // com o motor num estado consistente.
  conferirCiclo();
  if (!rodando) return;

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
