/*
 * A interface.
 *
 * Não faz conta nenhuma: toda a matemática está no WebAssembly, dentro do
 * worker. Aqui só existe o que é de interface — trocar de aba, formatar
 * número, guardar o progresso e conversar com o worker.
 *
 * ## O ciclo de vida da busca
 *
 * A tela sempre diz em qual destes pontos ela está. Isso não é enfeite: entre
 * tocar em "Iniciar" e o primeiro número aparecer há dois trabalhos demorados
 * — baixar e instanciar o WebAssembly, e construir a solução inicial. Sem
 * anunciar cada um, o usuário fica olhando para uma tela parada sem saber se o
 * aparelho está trabalhando ou se travou.
 *
 *   ocioso → carregando → preparando → buscando ⇄ pausado
 *
 * Repare que não há estado final. A busca não termina sozinha — nem ao provar
 * que encontrou o melhor possível. Quem a encerra é o usuário, em `pausar` ou
 * em `encerrar`; até lá o motor continua procurando.
 */

import * as historico from './historico.js';
import * as lotinha from './lotinha.js';
import * as checagem from './checagem.js';

const $ = (id) => document.getElementById(id);

/* ─────────── as peças precisam ser da mesma construção ─────────── */

/**
 * Confere se a página, os módulos e o script vieram todos da mesma publicação.
 *
 * ## O acidente que isto evita
 *
 * O `app.js` de uma construção carregou com o `lotinha.js` da anterior — cache
 * meio atualizado, que acontece — e a primeira coisa que ele chamou foi uma
 * função que ainda não existia lá. O `TypeError` subiu no meio do corpo do
 * módulo, e **tudo o que vinha depois nunca foi executado**: quarenta
 * `addEventListener` de topo, um atrás do outro, nenhum registrado.
 *
 * O estrago não foi proporcional à causa. Para o usuário, a primeira tela da
 * Lotinha respondia — os botões dela são pendurados antes — e o aplicativo
 * inteiro depois disso estava morto, sem uma mensagem sequer. Um arquivo velho
 * no cache parecia um aplicativo quebrado.
 *
 * ## A saída
 *
 * Peças que não combinam não são recuperáveis por remendo: falta código. O que
 * dá para fazer é **perceber antes de usar** e buscar as peças certas — apagar
 * os caches, dispensar o service worker e recarregar uma vez.
 *
 * A trava de sessão é o que impede o laço: se depois de recarregar as peças
 * ainda não combinarem, o problema é da publicação e não do cache, e aí é
 * melhor seguir com o que der e mostrar o aviso do que recarregar para sempre.
 */
function pecasQueFaltam() {
  const daLotinha = [
    'melhorConfiguracao',
    'tetoDoRetorno',
    'garantiaQuePaga',
    'previsao',
    'minimo',
    'construir',
    'conferirCobertura',
    'economia',
    'veredito',
  ].filter((nome) => typeof lotinha[nome] !== 'function');

  const daPagina = ['lot-orcamento', 'lot-bolso', 'lot-pool', 'lot-matriz', 'chk-conferir']
    .filter((id) => !$(id))
    .map((id) => `#${id}`);

  return [...daLotinha, ...daPagina];
}

async function buscarPecasNovas(faltando) {
  console.error('peças de construções diferentes; faltando:', faltando.join(', '));
  const CHAVE = 'sonho-lucido:recarregou-por-pecas';
  if (sessionStorage.getItem(CHAVE)) {
    const aviso = $('aviso');
    if (aviso) {
      aviso.textContent =
        'Esta versão chegou incompleta ao aparelho. Feche e abra o aplicativo; ' +
        'se continuar, desinstale e instale de novo.';
      aviso.hidden = false;
    }
    return;
  }
  sessionStorage.setItem(CHAVE, '1');
  try {
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((c) => caches.delete(c)));
    }
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((r) => r.unregister()));
    }
  } catch {
    /* sem cache para limpar: recarregar já é o suficiente */
  }
  location.reload();
}

const PECAS_FALTANDO = pecasQueFaltam();
if (PECAS_FALTANDO.length) buscarPecasNovas(PECAS_FALTANDO);

/**
 * Executa um passo de inicialização sem deixar que ele derrube os seguintes.
 *
 * Cada bloco de topo deste arquivo pendura os botões de uma tela. Sem este
 * isolamento, um erro em qualquer um deles deixa todas as telas seguintes sem
 * botão nenhum — e foi exatamente assim que uma falha na tela da Lotinha
 * apagou as abas Buscar, Resultado, Checar e Histórico de uma vez.
 */
function aoIniciar(nome, passo) {
  try {
    passo();
  } catch (erro) {
    console.error(`falhou ao montar ${nome}:`, erro);
    const aviso = $('aviso');
    if (aviso && aviso.hidden) {
      aviso.textContent = `Algo falhou ao montar ${nome}. O resto do aplicativo continua funcionando.`;
      aviso.hidden = false;
    }
  }
}

/**
 * Pendura um ouvinte, e não derruba o arquivo se o elemento não estiver lá.
 *
 * O `$('x').addEventListener(...)` de sempre é uma linha só, e é por isso que
 * ele é perigoso: com o elemento ausente ela lança, e as vinte registradas
 * depois dela nunca acontecem. Um `index.html` de outra construção no cache
 * bastava para apagar os botões de metade do aplicativo.
 *
 * Aqui a falha fica do tamanho dela: aquele botão não responde, e o resto sim.
 */
function ligar(id, evento, acao) {
  const elemento = $(id);
  if (!elemento) {
    console.error(`sem elemento #${id} para ouvir "${evento}"`);
    return;
  }
  elemento.addEventListener(evento, acao);
}

/* ─────────── estado da página ─────────── */

let trabalhador = null;
let fase = 'ocioso';
let recordes = [];
let melhorCartelas = [];
let travaDeTela = null;

/*
 * A sessão do histórico que esta busca está escrevendo.
 *
 * Ao iniciar do zero, nasce quando a primeira solução existe. Ao continuar um
 * trabalho salvo, é a sessão daquele trabalho — de modo que continuar melhora o
 * registro em vez de criar um segundo, quase igual, ao lado.
 */
let sessaoAtual = null;

/* A configuração da busca em curso, guardada porque a tela pode ser editada
   enquanto o motor trabalha e o registro precisa refletir o que está rodando. */
let configuracaoDaBusca = null;

/*
 * O que se sabe sobre o mínimo deste problema, quando o motor não sabe.
 *
 * O motor conhece a tabela mundial de coberturas, que vai até grupos de 8
 * números. A Lotinha trabalha com grupos de 15, muito fora dela — então ali o
 * motor não tem referência publicada nenhuma. Sem isto a tela dizia "sem
 * referência publicada" e deixava o usuário sem saber se ainda havia o que
 * procurar — a pergunta mais importante agora que a busca não termina sozinha.
 *
 * O que o motor tem é a cota de Schönheim, e ela é boa: nas 15 combinações
 * desta modalidade em que o mínimo verdadeiro é conhecido, acerta as 15 na
 * mosca. `lotinha.minimo()` usa a mesma cota, pelo mesmo motivo — antes disso
 * as duas telas do aplicativo mostravam pisos diferentes para o mesmo
 * problema, e a desta aqui era a mais fraca.
 *
 * Vem de `lotinha.minimo()`: `{ jogos, exato, piso }`.
 */
let referenciaDaBusca = null;

/* O relógio é da interface, não do motor: mede o que o usuário esperou. */
let inicioDoTrecho = 0;
let tempoAcumulado = 0;
let cronometro = null;


/* ─────────── formatação ─────────── */

const milhares = (n) => Math.round(n).toLocaleString('pt-BR');
const porcento = (f) => `${(f * 100).toFixed(1).replace('.', ',')}%`;

/**
 * Tempo decorrido, na precisão que faz sentido para a escala.
 *
 * Um relógio fixo em `HH:MM:SS` mostra `00:00:00` numa busca que termina em
 * setecentos milissegundos — e um zero parado é exatamente o que faz o usuário
 * achar que nada aconteceu. Abaixo de um minuto, décimos de segundo mostram
 * que o tempo correu de verdade.
 */
function duracao(ms) {
  const segundos = ms / 1000;
  if (segundos < 60) {
    return `${segundos.toFixed(1).replace('.', ',')} s`;
  }

  const total = Math.floor(segundos);
  const doisDigitos = (n) => String(Math.floor(n)).padStart(2, '0');
  const partes = [(total % 3600) / 60, total % 60];
  if (total >= 3600) partes.unshift(total / 3600);
  return partes.map(doisDigitos).join(':');
}

/* ─────────── situação e relógio ─────────── */

const SITUACOES = {
  ocioso: { classe: '', texto: 'parado' },
  carregando: { classe: 'trabalhando', texto: 'carregando o motor…' },
  preparando: { classe: 'trabalhando', texto: 'montando a primeira solução…' },
  buscando: { classe: 'trabalhando', texto: 'procurando soluções melhores' },
  pausado: { classe: 'pausada', texto: 'pausado' },
  falhou: { classe: 'falhou', texto: 'algo deu errado' },
};

/*
 * Não existe uma situação "concluída", e a ausência é a mudança.
 *
 * Havia: ao alcançar o limite inferior provado, a tela anunciava "ótimo
 * provado — não há melhor" e desabilitava o Pausar. Do lado de quem usa, o
 * aplicativo simplesmente parava — sem ter sido mandado parar.
 *
 * A optimalidade provada continua sendo anunciada, no selo e no texto da
 * situação. O que ela não faz mais é decidir. Enquanto o motor estiver vivo,
 * ele está em `buscando`, e o botão de parar é do usuário.
 */

function definirFase(nova, textoExtra = null) {
  fase = nova;
  const { classe, texto } = SITUACOES[nova] ?? SITUACOES.ocioso;

  const faixa = $('situacao');
  faixa.className = `situacao ${classe}`;
  $('texto-situacao').textContent = textoExtra ?? texto;

  // O relógio corre enquanto há trabalho acontecendo — inclusive durante o
  // carregamento e a construção inicial, que é justamente quando o usuário
  // mais precisa ver que algo se move.
  const trabalhando = ['carregando', 'preparando', 'buscando'].includes(nova);
  if (trabalhando) iniciarCronometro();
  else pararCronometro();

  $('pausar').textContent = nova === 'pausado' ? 'Continuar' : 'Pausar';
  $('pausar').disabled = ['ocioso', 'carregando', 'preparando', 'falhou'].includes(nova);
}

/**
 * Verdadeiro quando não existe fechamento menor que o já encontrado.
 *
 * Duas fontes, e a ordem entre elas importa.
 *
 * O motor prova a optimalidade comparando o recorde com o limite inferior que
 * ele calcula. Nos dezoito fechamentos da Lotinha de mínimo comprovado isso
 * basta — medindo, a cota de Schönheim coincide exatamente com o mínimo de
 * Turán: 16 para C(18,17,15), 51 para C(19,17,15), 40 para C(20,18,15). Mas
 * é coincidência, e a tela não deve depender de coincidência: quando o mínimo
 * é conhecido pelo teorema, é o teorema que responde.
 *
 * Nos dez casos em aberto não há mínimo conhecido, e aí só resta o motor. Se
 * ele um dia alcançar o próprio limite inferior ali, terá provado algo que
 * ninguém provou — e o selo acende com razão.
 */
function noMinimoComprovado(estado) {
  const nossas = estado.melhor_cartelas;
  if (referenciaDaBusca?.exato) return nossas > 0 && nossas <= referenciaDaBusca.jogos;
  return Boolean(estado.optimalidade_provada);
}

/**
 * O que a faixa de situação diz enquanto o motor trabalha.
 *
 * Quando o mínimo já foi alcançado, a frase muda mas o motor não para. Dizer
 * "procurando algo menor que 16" num fechamento em que 16 é comprovadamente o
 * menor seria mentir sobre o que está acontecendo — e é justamente a
 * informação de que o usuário precisa para decidir quando desligar.
 */
function textoDaProcura(estado) {
  const n = estado.melhor_cartelas;
  return noMinimoComprovado(estado)
    ? `${n} é o mínimo comprovado — o motor segue até você mandar parar`
    : `procurando algo menor que ${n}`;
}

function iniciarCronometro() {
  if (cronometro) return;
  inicioDoTrecho = performance.now();
  const tique = () => {
    $('relogio').textContent = duracao(tempoAcumulado + (performance.now() - inicioDoTrecho));
  };
  tique();
  // Cinco vezes por segundo: barato (é uma atribuição de texto) e suficiente
  // para os décimos se moverem visivelmente numa busca curta.
  cronometro = setInterval(tique, 200);
}

function pararCronometro() {
  if (!cronometro) return;
  clearInterval(cronometro);
  cronometro = null;
  tempoAcumulado += performance.now() - inicioDoTrecho;
  $('relogio').textContent = duracao(tempoAcumulado);
}

function zerarCronometro() {
  pararCronometro();
  tempoAcumulado = 0;
  $('relogio').textContent = duracao(0);
}

/* ─────────── abas ─────────── */

document.querySelectorAll('.aba').forEach((aba) => {
  aba.addEventListener('click', () => mostrarPainel(aba.dataset.painel));
});

function mostrarPainel(nome) {
  document.querySelectorAll('.aba').forEach((a) => {
    const ativa = a.dataset.painel === nome;
    a.classList.toggle('ativa', ativa);
    // A classe diz ao olho qual aba está aberta; `aria-selected` diz ao leitor
    // de tela. Sem ela, quem navega por áudio ouve quatro botões iguais e não
    // sabe em qual está.
    a.setAttribute('aria-selected', String(ativa));
  });
  document.querySelectorAll('.painel').forEach((p) => {
    p.classList.toggle('ativo', p.id === nome);
  });
  // A lista de fechamentos disponíveis muda enquanto o usuário usa o
  // aplicativo — carregar um fechamento novo, terminar uma busca, salvar no
  // histórico. Atualizar ao abrir a aba é o único momento em que isso importa,
  // e evita espalhar chamadas por toda parte.
  if (nome === 'checar') chkAtualizarFontes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─────────── conversa com o worker ─────────── */

function garantirTrabalhador() {
  if (trabalhador) return trabalhador;

  trabalhador = new Worker('./trabalhador.js', { type: 'module' });

  trabalhador.onmessage = ({ data }) => {
    switch (data.tipo) {
      // O WebAssembly terminou de carregar. Ainda não há solução nenhuma.
      case 'pronto':
        definirFase('preparando');
        break;

      // A configuração foi aceita; a construção inicial vem a seguir.
      case 'criado':
        definirFase('preparando');
        break;

      // Existe uma primeira solução. É o momento em que a tela deixa de estar
      // vazia — e a partir daqui o número só pode cair.
      case 'preparado':
        aplicarMensagem(data);
        // Sem ramo alternativo: existe primeira solução, então há busca a
        // fazer. Mesmo quando essa primeira solução já é comprovadamente a
        // melhor possível, quem decide encerrar é o usuário.
        trabalhador.postMessage({ tipo: 'rodar' });
        definirFase('buscando');
        break;

      case 'estado':
        aplicarMensagem(data);
        if (fase === 'buscando') $('texto-situacao').textContent = textoDaProcura(data.estado);
        break;

      case 'pausado':
        aplicarMensagem(data);
        definirFase('pausado');
        break;

      // O usuário mandou encerrar. O worker já devolveu tudo e liberou a
      // memória; aqui só resta desmontá-lo e voltar à Lotinha.
      case 'encerrado':
        aplicarMensagem(data);
        desmontarTrabalhador();
        definirFase('ocioso');
        zerarCronometro();
        soltarTelaLigada();
        atualizarAtalhoDoHistorico();
        mostrarPainel('lotinha');
        avisar('Busca encerrada. O resultado ficou salvo.', true);
        break;

      case 'erro':
        definirFase('falhou', data.mensagem);
        soltarTelaLigada();
        avisar(data.mensagem);
        break;

      default:
        break;
    }
  };

  trabalhador.onerror = (erro) => {
    definirFase('falhou');
    avisar(`Falha no motor: ${erro.message || 'erro desconhecido'}`);
  };

  return trabalhador;
}

function desmontarTrabalhador() {
  if (!trabalhador) return;
  trabalhador.terminate();
  trabalhador = null;
}

/* ─────────── pintar a tela ─────────── */

/**
 * Registra o progresso desta busca no histórico.
 *
 * A sessão nasce quando existe a primeira solução — não ao tocar em iniciar.
 * Uma busca abandonada antes de produzir qualquer coisa não é um trabalho, e
 * encheria a lista de linhas vazias.
 *
 * Daí em diante cada melhoria atualiza a mesma sessão. É isso que faz continuar
 * um trabalho aprimorar o registro existente, em vez de espalhar cópias quase
 * idênticas pelo histórico.
 */
function salvarNoHistorico(estado) {
  if (!melhorCartelas.length || !estado) return;

  const dados = {
    melhor: melhorCartelas,
    iteracoes: estado.iteracoes ?? 0,
    avaliacao: {
      cartelas: estado.melhor_cartelas,
      cobertura: estado.melhor_cobertura,
      redundancia: estado.melhor_redundancia,
      limiteInferior: estado.limite_inferior,
      otimo: Boolean(estado.optimalidade_provada),
    },
  };

  if (sessaoAtual) {
    // A sessão pode ter sido excluída pelo usuário enquanto a busca corria.
    // Nesse caso o trabalho continua, mas passa a registrar-se numa nova.
    const atualizada = historico.atualizar(sessaoAtual, dados);
    if (!atualizada) sessaoAtual = historico.criar(configuracaoDaBusca, dados).id;
  } else {
    sessaoAtual = historico.criar(configuracaoDaBusca, dados).id;
  }

  pintarHistorico();
}

/**
 * Atualiza a tela a partir de uma mensagem do worker.
 *
 * `cartelas` vem preenchido sempre que a solução mudou. Pintar a partir daqui
 * — e não de uma leitura posterior do armazenamento — é o que garante que a
 * aba Resultado mostre o que o painel de busca acabou de anunciar.
 */
function aplicarMensagem({ estado, cartelas }) {
  const mudou = Array.isArray(cartelas);
  if (mudou) {
    melhorCartelas = cartelas;
    pintarCartelas();
  }
  if (estado) aplicarEstado(estado);
  // Grava logo após pintar: o que está na tela e o que está no histórico saem
  // do mesmo dado, no mesmo instante.
  if (mudou) salvarNoHistorico(estado);
}

function aplicarEstado(estado) {
  pintarPartida(estado);
  $('melhor-cartelas').textContent = estado.melhor_cartelas || '—';
  $('limite-inferior').textContent = estado.limite_inferior || '—';
  $('gap').textContent = estado.gap === null ? '—' : porcento(estado.gap);
  $('cobertura').textContent = porcento(estado.melhor_cobertura);

  $('atual-cartelas').textContent = estado.atual_cartelas;
  $('atual-descobertos').textContent = milhares(estado.atual_descobertos);
  $('meta').textContent = estado.meta_cartelas > 1e9 ? '—' : estado.meta_cartelas;
  $('elites').textContent = estado.elites;
  $('iteracoes').textContent = milhares(estado.iteracoes);
  $('velocidade').textContent = estado.velocidade ? milhares(estado.velocidade) : '—';
  $('recordes').textContent = estado.recordes;

  const noMinimo = noMinimoComprovado(estado);
  $('selo-otimo').hidden = !noMinimo;
  $('res-selo-otimo').hidden = !noMinimo;

  pintarReferencia(estado);

  if (estado.novos_recordes?.length) {
    recordes = [...estado.novos_recordes.reverse(), ...recordes].slice(0, 40);
    pintarRecordes();
  }

  $('res-cartelas').textContent = estado.melhor_cartelas || '—';
  $('res-cobertura').textContent = porcento(estado.melhor_cobertura);
  $('res-redundancia').textContent = milhares(estado.melhor_redundancia);
}

/**
 * Diz de onde a busca partiu — e, quando o usuário trouxe um fechamento, o que
 * aconteceu com ele.
 *
 * Sem isto, o aproveitamento fica invisível. Quem cola 26 cartelas e vê o motor
 * começar em 21 não tem como saber se as suas foram usadas, podadas ou
 * ignoradas — e a diferença importa: as três coisas acontecem, cada uma por um
 * motivo diferente.
 */
function pintarPartida(estado) {
  const destino = $('partida');
  const origem = estado.origem_do_inicio || '';
  const trazidas = estado.cartelas_trazidas || 0;

  if (!origem) {
    destino.hidden = true;
    return;
  }

  let texto;
  if (trazidas === 0) {
    texto = `Partiu de: <b>${escapar(origem)}</b>`;
  } else if (origem === 'fechamento do aplicativo') {
    const podadas = trazidas - (estado.melhor_cartelas || trazidas);
    texto =
      `Partiu do <b>fechamento que já vem no aplicativo</b> ` +
      (podadas > 0
        ? `<em>— ${milhares(trazidas)} jogos, dos quais ${milhares(podadas)} eram dispensáveis.</em>`
        : `<em>— ${milhares(trazidas)} jogos prontos, sem reconstruir nada.</em>`);
  } else if (origem === 'fechamento importado') {
    const podadas = trazidas - (estado.melhor_cartelas || trazidas);
    texto =
      `Partiu do <b>seu fechamento</b> ` +
      (podadas > 0
        ? `<em>— das ${trazidas} cartelas que você trouxe, ${podadas} eram ` +
          `dispensáveis e saíram de graça.</em>`
        : `<em>— as ${trazidas} cartelas que você trouxe, aproveitadas ` +
          `inteiras.</em>`);
  } else {
    texto =
      `Partiu de: <b>${escapar(origem)}</b> <em>— melhor que as ${trazidas} ` +
      `cartelas que você trouxe, então o motor começou daqui. Seu fechamento ` +
      `não foi perdido: ele só não era o melhor ponto de partida disponível.</em>`;
  }

  destino.hidden = false;
  destino.innerHTML = texto;
}

/**
 * Situa o resultado do usuário diante do melhor que o mundo já obteve.
 *
 * O número sozinho não diz nada. "27 cartelas" é excelente numa configuração e
 * medíocre em outra, e sem referência o usuário não tem como saber em qual das
 * duas está — nem quando vale a pena continuar procurando.
 *
 * Os quatro estados possíveis dizem coisas diferentes, e a redação de cada um
 * importa:
 *
 * - **sem referência** — garantia parcial ou fora da faixa catalogada. Dizer
 *   isso é mais honesto que esconder a linha, que sugeriria que o resultado é
 *   bom por não ter comparação.
 * - **atrás** — quantas cartelas faltam. É a informação acionável.
 * - **empatado** — chegou ao melhor conhecido no mundo.
 * - **à frente** — superou o recorde mundial. Merece destaque próprio e a
 *   instrução do que fazer com isso.
 */
function pintarReferencia(estado) {
  const alvos = ['referencia-busca', 'referencia-resultado'];
  const nossas = estado.melhor_cartelas || 0;
  const mundo = estado.melhor_conhecido ?? null;

  // Quando a busca traz a própria referência, ela manda. É o caso da Lotinha:
  // a tabela mundial não alcança grupos de 15, e o que o motor diria ali é
  // "sem referência publicada" — verdadeiro e imprestável.
  if (referenciaDaBusca) {
    const texto = textoDaReferenciaDaBusca(estado);
    $('selo-recorde').hidden = true;
    $('res-selo-recorde').hidden = true;
    alvos.forEach((id) => {
      $(id).hidden = false;
      $(id).innerHTML = texto;
    });
    return;
  }

  // Só faz sentido comparar contagens de cartelas entre soluções que cobrem
  // tudo. Com teto de cartelas o objetivo é outro — cobrir o máximo possível
  // dentro do teto — e a solução tem cobertura parcial de propósito. Comparar
  // ali anunciaria "acima do melhor conhecido no mundo" para um fechamento
  // furado, que é a pior mentira que esta tela poderia contar.
  const completo = estado.melhor_cobertura >= 1;

  // `referencia_exata` separa dois números muito diferentes:
  //
  // - **exata** — o problema é a cobertura completa catalogada, e o número é o
  //   melhor que o mundo já obteve *nela*. Ficar abaixo é recorde mundial.
  // - **teto** — garantia parcial. Cobrir todas as t-uplas resolve o problema
  //   com folga, então o número é um teto válido e nada mais. Ficar bem abaixo
  //   é o esperado, não façanha — anunciar recorde ali seria falso.
  const exata = estado.referencia_exata === true;
  const superou = mundo !== null && exata && completo && nossas > 0 && nossas < mundo;

  $('selo-recorde').hidden = !superou;
  $('res-selo-recorde').hidden = !superou;

  const cabecalho = `Melhor conhecido no mundo: <b>${mundo}</b>`;

  let texto;
  if (mundo === null) {
    texto =
      'Sem referência publicada para esta configuração <em>— a tabela mundial ' +
      'vai até 99 números no pool, 25 por cartela e grupos de até 8.</em>';
  } else if (!exata) {
    // O caso do fechamento de loteria, que é o uso mais comum do aplicativo.
    const acertos = estado.melhor_cartelas > 0 && completo ? `Você está com <b>${nossas}</b>. ` : '';
    texto =
      `Cobrir <b>todos</b> os grupos garantiria seu resultado com ` +
      `<b>${mundo}</b> cartelas <em>— é o melhor conhecido no mundo para a ` +
      `cobertura completa, e serve de teto. ${acertos}Como sua garantia é ` +
      `parcial, dá para usar bem menos: é exatamente o que o motor procura.</em>`;
  } else if (nossas > 0 && !completo) {
    texto =
      `${cabecalho} <em>— com ${nossas} cartelas e cobertura completa. Esta ` +
      `busca está limitada pelo teto que você definiu, então os números não se ` +
      `comparam diretamente.</em>`;
  } else if (superou) {
    texto =
      `${cabecalho} <em>— você chegou a ${nossas}. Vale conferir e submeter à ` +
      `La Jolla Covering Repository: seria um recorde novo.</em>`;
  } else if (nossas === mundo) {
    texto = `${cabecalho} <em>— seu resultado empatou com ele.</em>`;
  } else if (nossas > 0) {
    const faltam = nossas - mundo;
    const quantas = faltam === 1 ? 'falta 1 cartela' : `faltam ${faltam} cartelas`;
    texto = `${cabecalho} <em>— ${quantas}.</em>`;
  } else {
    texto = cabecalho;
  }

  alvos.forEach((id) => {
    const destino = $(id);
    destino.hidden = false;
    destino.innerHTML = texto;
  });
}

/**
 * A referência quando ela não vem da tabela mundial.
 *
 * Os dois casos dizem coisas opostas, e a diferença é o que o usuário precisa
 * para decidir se vale deixar o aparelho trabalhando:
 *
 * - **mínimo comprovado** — o teorema de Turán fecha a questão. O motor pode
 *   rodar a noite inteira que não vai achar menos. Dizer isso é o oposto de
 *   desanimar: é devolver a decisão a quem paga a bateria.
 * - **em aberto** — ninguém no mundo sabe o mínimo, e a única certeza é o
 *   piso. Aqui o motor não está redescobrindo nada; está procurando de fato.
 */
function textoDaReferenciaDaBusca(estado) {
  const { jogos, exato, piso } = referenciaDaBusca;
  const nossas = estado.melhor_cartelas || 0;

  // Jogo do tamanho do pool: aposta única, e não há fechamento a fazer. Creditar
  // Turán por isso seria invocar um teorema para dizer que um é um.
  if (jogos === 1) {
    return (
      `<b>Aposta única.</b> <em>Jogar todas as dezenas escolhidas de uma vez é ` +
      `um jogo só: não há fechamento, e nada que o motor possa reduzir. Para ` +
      `fechar, o jogo precisa ser menor que o pool.</em>`
    );
  }

  if (exato) {
    return (
      `Mínimo comprovado: <b>${milhares(jogos)}</b> jogos <em>— sai do ` +
      `teorema de Turán, e não existe fechamento menor. O motor continua ` +
      `procurando enquanto você deixar: ele não vai achar menos, e não vai ` +
      `parar sozinho.</em>`
    );
  }

  // Quanto o motor já cortou do fechamento que veio no aplicativo. É o único
  // placar honesto aqui: não existe recorde mundial de que se aproximar, mas
  // existe o número com que esta busca começou, e superá-lo é resultado de
  // verdade — é o que paga a bateria gasta.
  const trazidas = estado.cartelas_trazidas || 0;
  const cortou = trazidas > 0 && nossas > 0 && nossas < trazidas ? trazidas - nossas : 0;

  const onde = nossas > 0 ? `Você está com <b>${milhares(nossas)}</b>` : '';
  const placar = cortou
    ? `${onde}, contra os ${milhares(trazidas)} que vieram no aplicativo — o ` +
      `motor já cortou ${milhares(cortou)}. `
    : onde
      ? `${onde}. `
      : '';

  return (
    `Ninguém no mundo sabe o mínimo aqui <em>— é problema em aberto. O que se ` +
    `sabe é que não dá com menos de <b>${milhares(piso)}</b>. ${placar}É onde o ` +
    `motor tem trabalho de verdade, e onde deixá-lo rodando faz diferença.</em>`
  );
}

function pintarRecordes() {
  if (!recordes.length) {
    $('lista-recordes').innerHTML =
      '<li class="ajuda">as melhorias vão aparecer aqui conforme forem encontradas</li>';
    return;
  }
  $('lista-recordes').innerHTML = recordes
    .map(
      (r) => `
      <li>
        <span class="quantia">${r.cartelas}</span>
        <span class="via">${r.operador}<br>iteração ${milhares(r.iteracao)}</span>
      </li>`
    )
    .join('');
}

function pintarCartelas() {
  const destino = $('lista-cartelas');
  if (!melhorCartelas.length) {
    destino.innerHTML = '<p class="ajuda">Nenhuma solução ainda. Inicie uma busca.</p>';
    return;
  }
  destino.innerHTML = melhorCartelas
    .map(
      (cartela, i) => `
      <div class="cartela">
        <span class="indice">${String(i + 1).padStart(2, '0')}</span>
        <span>${cartela.map((n) => String(n).padStart(2, '0')).join(' ')}</span>
      </div>`
    )
    .join('');
}

/* ─────────── Lotinha ─────────── */

/*
 * A modalidade inteira, numa tela só.
 *
 * Escolhem-se de 17 a 23 dezenas entre 25; ganha-se quando as 15 sorteadas caem
 * todas dentro do conjunto escolhido. São 45 combinações de (pool, tamanho do
 * jogo), e o fechamento de cada uma já vem pronto no aplicativo — conferido
 * sorteio a sorteio antes de ser gravado.
 *
 * A tela não recalcula nada ao abrir: consulta o banco, valida, mostra. O motor
 * entra depois, para tentar superar o que já existe. Nos dez casos em que o
 * mínimo é problema aberto na matemática, é aí que ele tem trabalho de verdade.
 */

let lotPool = 18;
let lotJogo = 17;
/* Quantos acertos garantir, e quantas cartelas precisam ganhar. Os padrões são
   a Lotinha como ela é jogada: as 15, numa cartela. */
let lotGarantia = lotinha.SORTEIO;
let lotPremiadas = 1;
let lotDezenas = new Set();
let lotFechamento = null;
/* A configuração da seleção atual, guardada para o botão que liga o motor
   depois — nos casos pesados ele deixou de partir sozinho. */
let lotConfiguracao = null;

/**
 * Esquece o fechamento carregado, porque ele deixou de ser o desta seleção.
 *
 * Sem isto, trocar a exigência depois de carregar mostrava números de duas
 * seleções diferentes ao mesmo tempo: a explicação dizia "17 jogos bastam" e a
 * economia continuava calculando em cima dos 16 que estavam na memória. Cada um
 * dos dois estava certo sobre uma pergunta diferente, e juntos mentiam.
 */
function lotEsquecerFechamento() {
  lotFechamento = null;
  lotConfiguracao = null;
  $('lot-conferir').hidden = true;
  $('lot-otimizar').hidden = true;
  $('lot-checar').hidden = true;
  $('lot-conferencia').innerHTML =
    '<em>Ao carregar, cada sorteio possível dentro do seu pool é conferido um a ' +
    'um — sem consultar o motor que produziu o fechamento.</em>';
}

/* A cotação em uso. Nasce com a tabela padrão e é editável campo a campo —
   quem joga em outra banca troca o número e a tela recalcula na hora. */
const lotCotacao = { ...lotinha.COTACAO_PADRAO };

/**
 * A régua ao lado de cada cotação: quanto seria neutro, e quanto a oferta paga
 * disso.
 *
 * ## Por que isto é a informação mais valiosa da tela
 *
 * É a **única** coisa que muda o retorno. Nem o tamanho do fechamento, nem o
 * pool, nem a garantia: o retorno por real é `multiplicador ÷ cotação justa`, e
 * o único termo que alguém pode negociar é o primeiro.
 *
 * E é a informação que a tabela da banca esconde. Um multiplicador de 7.000×
 * numa cartela de 17 dezenas parece generoso e paga 29% do neutro; 4× numa de
 * 23 parece miséria e paga 60%. Sem a régua, a intuição erra o sinal — escolhe
 * justamente a aposta em que a banca cobra mais caro.
 *
 * Com ela, avaliar uma tabela nova é ler uma linha, e não fazer conta.
 */
function lotTextoDaRegua(jogo, multiplicador) {
  const justo = lotinha.cotacaoJusta(jogo);

  // Uma casa decimal abaixo de cem, e é onde isso decide: em 23 dezenas o
  // neutro é 6,7×, e arredondar para 7 faria uma oferta de 7× — que está
  // **acima** do neutro — parecer exatamente neutra. É justamente a linha em
  // que vale procurar outra banca.
  const emVezes = (v) =>
    v < 100 ? v.toFixed(1).replace('.', ',') : milhares(v);
  const neutro = `neutro seria <b>${emVezes(justo)}×</b>`;

  if (!Number.isFinite(multiplicador) || multiplicador <= 0) {
    return `<span class="sem-oferta">${neutro}</span>`;
  }

  const fracao = multiplicador / justo;
  if (fracao >= 1) {
    return (
      `<span class="acima">${neutro} — esta paga ` +
      `<b>${porcento(fracao)}</b> disso, acima do neutro</span>`
    );
  }

  // Três faixas, e o corte não é arbitrário: metade do neutro é onde a banca
  // fica com mais do que devolve, e é a diferença entre uma aposta cara e uma
  // aposta muito cara.
  const faixa = fracao >= 0.55 ? 'boa' : fracao >= 0.4 ? 'media' : 'ruim';
  return (
    `<span class="${faixa}">${neutro} — esta paga <b>${porcento(fracao)}</b> ` +
    `disso; a banca fica com ${porcento(1 - fracao)}</span>`
  );
}

function lotMontar() {
  // Tamanho do pool.
  const alvoPool = $('lot-pool');
  alvoPool.innerHTML = '';
  for (let p = lotinha.MENOR_POOL; p <= lotinha.MAIOR_POOL; p++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(p);
    b.dataset.pool = String(p);
    b.addEventListener('click', () => {
      lotPool = p;
      // A seleção que sobra vira inválida se o pool encolheu.
      if (lotDezenas.size > p) lotDezenas = new Set([...lotDezenas].slice(0, p));
      if (lotJogo > p) lotJogo = p;
      lotEsquecerFechamento();
      lotPintarTudo();
    });
    alvoPool.appendChild(b);
  }

  // Grade das 25 dezenas.
  const grade = $('lot-grade');
  grade.innerHTML = '';
  for (let n = 1; n <= lotinha.UNIVERSO; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'numero';
    b.textContent = String(n).padStart(2, '0');
    b.dataset.n = String(n);
    b.addEventListener('click', () => lotAlternar(n));
    grade.appendChild(b);
  }

  // Cotação: um campo por tamanho de jogo, com a tabela de uma banca já posta.
  //
  // Vinha vazio antes, por escrúpulo — cotações variam e não são auditadas. O
  // escrúpulo continua certo e a consequência estava errada: sem número nenhum
  // a tela não dizia se o fechamento paga, que é a pergunta que decide a
  // compra. Preenchido e editável resolve as duas coisas.
  const cot = $('lot-cotacao');
  cot.innerHTML = '';
  for (let k = lotinha.MENOR_POOL; k <= lotinha.MAIOR_POOL; k++) {
    const rotulo = document.createElement('label');
    rotulo.className = 'campo linha';
    rotulo.innerHTML =
      `<span>${k} dezenas <em>— chance 1 em ` +
      `${milhares(1 / lotinha.chanceDe(k))}</em></span>`;
    const campo = document.createElement('input');
    campo.type = 'number';
    campo.min = '0';
    campo.step = '0.01';
    campo.inputMode = 'decimal';
    campo.placeholder = 'quanto paga';
    if (lotCotacao[k]) campo.value = String(lotCotacao[k]);

    // A régua: quanto seria neutro, e que fração disso a oferta paga.
    const regua = document.createElement('small');
    regua.className = 'regua-cotacao';
    const medir = () => {
      regua.innerHTML = lotTextoDaRegua(k, Number(campo.value));
    };
    medir();

    campo.addEventListener('input', () => {
      const v = Number(campo.value);
      if (v > 0) lotCotacao[k] = v;
      else delete lotCotacao[k];
      medir();
      lotMontarMatriz();
      lotPintarEconomia();
      lotPintarBolso();
    });
    rotulo.appendChild(campo);
    rotulo.appendChild(regua);
    cot.appendChild(rotulo);
  }

  lotMontarMatriz();
  lotPintarBolso();
  lotPintarTudo();
}

/**
 * Os botões de garantia e de cartelas premiadas.
 *
 * Refeitos a cada mudança de pool ou de tamanho de jogo porque o teto de
 * cartelas premiadas depende dos dois: num pool de 18 com jogos de 17, só três
 * jogos distintos podem conter um mesmo sorteio, e pedir a quarta obrigaria a
 * comprar jogo repetido.
 */
function lotMontarExigencias() {
  const alvoGarantia = $('lot-garantia');
  alvoGarantia.innerHTML = '';
  for (let g = lotinha.SORTEIO; g >= lotinha.MENOR_GARANTIA; g--) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(g);
    b.dataset.garantia = String(g);
    b.addEventListener('click', () => {
      lotGarantia = g;
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvoGarantia.appendChild(b);
  }

  // O limite dos botões é de tela, não de matemática: uma fileira de 252 botões
  // não serve a ninguém. A régua vai de 1 a 8 e sempre inclui o teto, e o campo
  // ao lado aceita qualquer valor entre eles — nenhuma garantia possível fica
  // fora de alcance.
  //
  // O teto é o número de jogos **distintos** que podem conter um mesmo sorteio.
  // Acima dele não há o que comprar: só repetir cartela, que soma prêmio e custo
  // na mesma proporção e não muda nada.
  const teto = Math.max(lotinha.maximoPremiadas(lotPool, lotJogo, lotGarantia), 1);
  if (lotPremiadas > teto) lotPremiadas = teto;

  const escala = [];
  for (let r = 1; r <= Math.min(teto, 8); r++) escala.push(r);
  if (!escala.includes(teto)) escala.push(teto);
  if (!escala.includes(lotPremiadas)) escala.splice(escala.length - 1, 0, lotPremiadas);

  const alvoPremiadas = $('lot-premiadas');
  alvoPremiadas.innerHTML = '';
  for (const r of escala) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(r);
    b.dataset.premiadas = String(r);
    b.addEventListener('click', () => {
      lotPremiadas = r;
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvoPremiadas.appendChild(b);
  }

  document.querySelectorAll('#lot-garantia .opcao').forEach((b) => {
    const ativa = Number(b.dataset.garantia) === lotGarantia;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  });
  document.querySelectorAll('#lot-premiadas .opcao').forEach((b) => {
    const ativa = Number(b.dataset.premiadas) === lotPremiadas;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  });

  const livre = $('lot-premiadas-livre');
  if (livre) {
    livre.max = String(teto);
    livre.value = String(lotPremiadas);
    livre.disabled = teto <= 1;
  }
  const nota = $('lot-premiadas-teto');
  if (nota) {
    nota.innerHTML =
      teto <= 1
        ? 'Aqui só uma cartela pode conter o sorteio, então a garantia é uma.'
        : `O teto é <b>${milhares(teto)}</b> — são ${milhares(teto)} jogos distintos ` +
          `de ${lotJogo} dezenas capazes de conter um mesmo sorteio dentro do seu pool. ` +
          'Acima disso só repetindo cartela, o que soma prêmio e custo junto e não muda nada.';
  }
}

/**
 * O que se sabe sobre o mínimo desta configuração, quando o motor não sabe.
 *
 * Derivada da configuração, e não passada à mão, para que continuar um trabalho
 * salvo do histórico recupere a mesma referência de quando ele começou — sem
 * isso, retomar uma busca a rebaixaria para "sem referência publicada".
 *
 * Devolve `null` fora da Lotinha, e aí a tela volta a usar a tabela mundial que
 * o motor carrega.
 */
function referenciaDe(configuracao) {
  const pool = configuracao?.pool?.length ?? 0;
  const garantia = configuracao?.intersecao ?? 0;
  const ehLotinha =
    configuracao?.universo === lotinha.UNIVERSO &&
    configuracao?.alvo === lotinha.SORTEIO &&
    garantia >= lotinha.MENOR_GARANTIA &&
    garantia <= lotinha.SORTEIO &&
    pool >= lotinha.MENOR_POOL &&
    pool <= lotinha.MAIOR_POOL &&
    configuracao.cartela >= lotinha.MENOR_POOL &&
    configuracao.cartela <= pool;

  return ehLotinha
    ? lotinha.minimo(pool, configuracao.cartela, garantia, configuracao.premiadas ?? 1)
    : null;
}

function lotAlternar(n) {
  lotEsquecerFechamento();
  if (lotDezenas.has(n)) lotDezenas.delete(n);
  else if (lotDezenas.size < lotPool) lotDezenas.add(n);
  else {
    avisar(`Já são ${lotPool} dezenas. Desmarque uma antes de trocar.`);
    return;
  }
  lotPintarTudo();
}

function lotPintarTudo() {
  document.querySelectorAll('#lot-pool .opcao').forEach((b) => {
    const ativa = Number(b.dataset.pool) === lotPool;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  });
  document.querySelectorAll('#lot-grade .numero').forEach((b) => {
    const escolhido = lotDezenas.has(Number(b.dataset.n));
    b.classList.toggle('escolhido', escolhido);
    // Estes botões são alternâncias, e a única pista de que estão marcados era
    // a cor. `aria-pressed` diz o mesmo a quem não a enxerga.
    b.setAttribute('aria-pressed', String(escolhido));
  });

  const faltam = lotPool - lotDezenas.size;
  $('lot-contagem').innerHTML =
    faltam === 0
      ? `<b>${lotPool} de ${lotPool} escolhidas</b> <em>— ` +
        `${milhares(lotinha.combinacoes(lotPool, 15))} sorteios possíveis dentro delas, ` +
        `e chance de 1 em ${milhares(1 / lotinha.chanceDe(lotPool))} de o sorteio cair aqui.</em>`
      : `<b>${lotDezenas.size} de ${lotPool} escolhidas</b> <em>— ${
          faltam === 1 ? 'falta 1 dezena' : `faltam ${faltam} dezenas`
        }.</em>`;

  lotMontarOpcoesDeJogo();
  // Um botão desabilitado que não diz o que falta parece quebrado: a pessoa
  // toca, nada acontece, e nada na tela explica. O rótulo passa a ser a
  // instrução enquanto a seleção não está completa.
  const botao = $('lot-iniciar');
  botao.disabled = faltam !== 0;
  botao.textContent =
    faltam === 0
      ? 'Carregar fechamento'
      : `Escolha ${faltam === lotPool ? lotPool : `mais ${faltam}`} dezena${
          faltam === 1 ? '' : 's'
        }`;
}

function lotMontarOpcoesDeJogo() {
  const alvo = $('lot-jogo');
  alvo.innerHTML = '';
  for (let k = lotinha.MENOR_POOL; k <= lotPool; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcao';
    b.textContent = String(k);
    b.dataset.jogo = String(k);
    b.addEventListener('click', () => {
      lotJogo = k;
      lotEsquecerFechamento();
      lotMontarExigencias();
      lotPintarExplicacao();
      lotPintarEconomia();
    });
    alvo.appendChild(b);
  }
  if (lotJogo > lotPool) lotJogo = lotPool;
  lotMontarExigencias();
  lotPintarExplicacao();
  lotPintarEconomia();
}

function lotPintarExplicacao() {
  document.querySelectorAll('#lot-jogo .opcao').forEach((b) => {
    const ativa = Number(b.dataset.jogo) === lotJogo;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  });

  const { jogos, exato } = lotinha.minimo(lotPool, lotJogo, lotGarantia, lotPremiadas);
  const destino = $('lot-explicacao');
  const teto = lotinha.maximoPremiadas(lotPool, lotJogo, lotGarantia);

  // O que se está pedindo, em uma frase — antes de dizer quanto custa.
  const pedido =
    `Cada resultado possível dentro das suas ${lotPool} dezenas vai cair em ` +
    (lotPremiadas === 1 ? 'uma cartela' : `<b>${lotPremiadas}</b> cartelas`) +
    ` com ao menos <b>${lotGarantia}</b> acerto${lotGarantia === 1 ? '' : 's'}.`;

  // O aviso que o usuário não tem como deduzir sozinho.
  const aviso =
    lotGarantia === lotinha.SORTEIO && lotPremiadas >= teto && teto > 1
      ? ` <em>Este é o máximo: só ${teto} jogos distintos podem conter um mesmo ` +
        `sorteio, então pedir mais obrigaria a comprar jogo repetido.</em>`
      : '';

  if (lotJogo === lotPool) {
    destino.innerHTML =
      `<b>Um jogo só.</b> <em>Jogar as ${lotPool} dezenas de uma vez é uma aposta ` +
      `única: ou as 15 caem dentro, ou não. Não há fechamento a fazer — para ` +
      `fechar, o jogo precisa ser menor que o pool.</em>`;
  } else if (exato) {
    const porque =
      lotPool - lotJogo === 1
        ? `São sempre ${lotinha.SORTEIO} + ${lotPremiadas} quando o jogo tem uma dezena a ` +
          `menos que o pool, seja qual for o pool.`
        : 'Vem do teorema de Turán.';
    destino.innerHTML =
      `${pedido} <b>${milhares(jogos)} jogos</b> bastam. <em>Este número é o ` +
      `mínimo comprovado — não existe fechamento menor. ${porque}</em>${aviso}`;
  } else {
    destino.innerHTML =
      `${pedido} <b>Mínimo desconhecido.</b> <em>${textoDaDistancia()}</em>${aviso}`;
  }
}

/**
 * Quanto o que você vai receber está acima do que a matemática prova.
 *
 * Dizer só "não dá com menos de 317" fazia o piso parecer uma promessa — o
 * usuário recebia 1.104 jogos e ficava sem saber se o aplicativo estava
 * falhando ou se o problema é que é assim. Nenhum dos dois: o mínimo verdadeiro
 * está entre os dois números, e ninguém no mundo sabe onde.
 *
 * A origem muda o que fazer com a informação, e por isso ela é dita:
 *
 * - **banco** — já passou pelo motor rodando horas antes de virar aplicativo.
 *   Deixar buscando de novo rende pouco.
 * - **fórmula** — a construção por grupos, calculada no instante do toque. É
 *   correta e é crua; aqui deixar o motor rodando é o que rende de verdade.
 * - **motor** — não há pronto nem fórmula que caiba, e o tamanho só se sabe
 *   depois de construir.
 */
function textoDaDistancia() {
  const { quantidade, origem, piso } = lotinha.previsao(
    lotPool,
    lotJogo,
    lotGarantia,
    lotPremiadas
  );

  const abertura =
    'Ninguém no mundo sabe quantos jogos bastam aqui — é problema em aberto. ';

  if (quantidade === null) {
    return (
      `${abertura}O aplicativo não tem fechamento pronto nem fórmula que caiba ` +
      `nesta combinação: o motor constrói do zero, e o tamanho só aparece ` +
      `depois. O que se sabe é que não dá com menos de <b>${milhares(piso)}</b>.`
    );
  }

  const razao = quantidade / piso;
  const folga =
    razao >= 1.15
      ? `${razao.toFixed(1).replace('.', ',')}× o piso conhecido`
      : 'quase encostado no piso';

  const conselho =
    origem === 'formula'
      ? ` Este número sai de fórmula, no instante do toque: é correto e é ` +
        `bruto. É aqui que deixar o motor rodando corta de verdade.`
      : origem === 'banco'
        ? ` Este já é o melhor que o motor achou, rodando horas antes de virar ` +
          `aplicativo — buscar mais rende pouco.`
        : '';

  return (
    `${abertura}O aplicativo entrega <b>${milhares(quantidade)}</b> jogos — ` +
    `${folga}. O mais que a matemática prova é que não dá com menos de ` +
    `<b>${milhares(piso)}</b>; o mínimo verdadeiro está entre os dois.${conselho}`
  );
}

/**
 * O selo que diz se o fechamento paga — e é sobre **o ramo em que se ganha**.
 *
 * Precisa dessa qualificação em toda frase, porque a outra pergunta já tem
 * resposta e ela é sempre a mesma: no longo prazo nenhuma combinação devolve o
 * que custa. O selo não contradiz isso e não pode parecer contradizer; ele
 * responde algo diferente e verificável — quando as 15 caírem dentro do seu
 * pool, o que você recebe cobre o que gastou?
 *
 * A distinção entre "ainda não" e "nunca" vem do piso: se o mínimo matemático
 * já custa mais que o prêmio, nenhum otimizador salva aquela combinação, e
 * dizer isso poupa o usuário de esperar uma melhora que não existe.
 */
function selaDoVeredito(v) {
  const vezes = (n) => `${milhares(n)}×`;

  if (v.classe === 'lucra') {
    return (
      `<div class="veredito paga"><b>Paga quando acerta o pool.</b> ` +
      `<em>O prêmio garantido é ${vezes(v.premio)} a aposta e o fechamento ` +
      `custa ${vezes(quantidadeDoVeredito(v))} — sobram ${vezes(v.folga)}.</em></div>`
    );
  }

  if (v.classe === 'possivel') {
    return (
      `<div class="veredito quase"><b>Ainda não paga.</b> ` +
      `<em>São ${vezes(quantidadeDoVeredito(v))} de custo para um prêmio ` +
      `garantido de ${vezes(v.premio)}. Faltam cortar ` +
      `<b>${milhares(v.faltamCortar)}</b> cartela${v.faltamCortar === 1 ? '' : 's'} — ` +
      `o mínimo matemático é ${milhares(v.piso)}, então dá.</em></div>`
    );
  }

  if (v.classe === 'impossivel') {
    return (
      `<div class="veredito nao-paga"><b>Nenhum fechamento paga aqui.</b> ` +
      `<em>Nem o mínimo matemático: ${milhares(v.piso)} cartelas custam ` +
      `${v.custoDoPiso.toFixed(1).replace('.', ',')}× o prêmio de ` +
      `${vezes(v.premio)}. Não é falta de otimização — é a conta.</em></div>`
    );
  }

  return '';
}

/* O custo em múltiplos da aposta, que é a unidade em que o prêmio é cotado. */
function quantidadeDoVeredito(v) {
  if (v.classe === 'lucra') return v.premio - v.folga;
  if (v.classe === 'possivel') return v.premio + v.faltamCortar - 1;
  return v.piso;
}

/**
 * Como descrever a quantidade de jogos, dizendo de onde ela veio.
 *
 * Chamar o piso de "custo" seria prometer um preço que não existe: em 25
 * dezenas com jogos de 20, o piso conhecido é 317 e o melhor fechamento que o
 * aplicativo entrega tem 1.104. O número continua útil — é o que a matemática
 * garante que ninguém vai bater — mas precisa vir rotulado.
 */
function textoDaQuantidade(quantidade, ehPiso) {
  const plural = quantidade === 1 ? 'jogo' : 'jogos';
  return ehPiso
    ? `no mínimo ${milhares(quantidade)} ${plural} — o piso conhecido`
    : `${milhares(quantidade)} ${plural}`;
}

/**
 * A economia do fechamento — com os dois ramos sempre juntos.
 *
 * O ramo vencedor é sedutor: dezesseis jogos de 17 dezenas custam R$16 e pagam
 * no mínimo alguns milhares. Mostrá-lo sozinho seria enganoso, porque o outro
 * ramo acontece em mais de 99% das vezes e devolve zero. Os dois aparecem lado
 * a lado, e o retorno esperado fecha a conta.
 */
function lotPintarEconomia() {
  const destino = $('lot-economia');
  const cartao = $('lot-economia-cartao');
  const prevista = lotinha.previsao(lotPool, lotJogo, lotGarantia, lotPremiadas);
  const quantidade = lotFechamento?.length ?? prevista.quantidade ?? prevista.piso;

  // De onde veio o número, porque a diferença muda o que a conta significa.
  // Com o fechamento na mão, com o mínimo comprovado ou com a previsão do que
  // o aplicativo vai montar, é o custo de verdade. Só quando nem isso existe
  // — os cinco casos em que o motor constrói do zero — sobra o piso, e aí ele
  // é o **mínimo concebível**: precificá-lo sem rótulo seria prometer barato.
  const ehPiso = !lotFechamento && prevista.quantidade === null;

  if (!quantidade) {
    cartao.hidden = true;
    return;
  }

  // `min="0.01"` no HTML não impede um valor negativo digitado, e um negativo
  // produzia "Custo do fechamento −R$ 16,00" — um preço negativo, que não
  // significa nada. Zero e vazio caem no mesmo lugar: um jogo custa alguma
  // coisa, e a conta só faz sentido acima de zero.
  const valorDigitado = Number($('lot-valor').value);
  const valor = Number.isFinite(valorDigitado) && valorDigitado > 0 ? valorDigitado : 1;
  const e = lotinha.economia({
    pool: lotPool,
    jogo: lotJogo,
    quantidade,
    cotacao: lotCotacao,
    valorDoJogo: valor,
    garantia: lotGarantia,
    premiadas: lotPremiadas,
  });

  cartao.hidden = false;

  const dinheiro = (v) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (e.multiplicador === null) {
    destino.innerHTML =
      `<div class="linha-economia"><span>Custo do fechamento</span>` +
      `<b>${dinheiro(e.custo)}</b> <em>${textoDaQuantidade(quantidade, ehPiso)}</em></div>` +
      `<div class="linha-economia"><span>Chance de o sorteio cair no seu pool</span>` +
      `<b>1 em ${milhares(1 / e.chanceDoPool)}</b></div>` +
      `<p class="ajuda">Informe a cotação da sua banca acima para ver quanto ` +
      `isso pagaria e qual o retorno esperado.</p>`;
    return;
  }

  // Garantir menos de 15 não compra prêmio nenhum nesta modalidade: a Lotinha
  // paga o jogo que contém as 15, e só ele. Prometer um piso de prêmio aqui
  // seria a mentira mais cara que esta tela poderia contar.
  if (!e.garantePremio) {
    destino.innerHTML =
      `<div class="linha-economia"><span>Custo do fechamento</span>` +
      `<b>${dinheiro(e.custo)}</b> <em>${textoDaQuantidade(quantidade, ehPiso)}</em></div>` +

      `<div class="linha-economia perde"><span>Prêmio garantido nesta modalidade</span>` +
      `<b>nenhum</b></div>` +

      `<div class="linha-economia total"><span>Retorno esperado</span>` +
      `<b>${dinheiro(e.retornoEsperado)}</b> <em>por real apostado</em></div>` +

      `<p class="ajuda">Você escolheu garantir <b>${lotGarantia} acertos</b>, e a ` +
      `Lotinha só paga quem acerta os <b>15</b>. Um fechamento para ${lotGarantia} ` +
      `não garante prêmio nenhum aqui — ele faz sentido na Lotofácil, que premia ` +
      `a partir de 11. O retorno esperado acima continua valendo, porque ele ` +
      `depende de cada jogo conter as 15, não da garantia escolhida.</p>`;
    return;
  }

  const v = lotinha.veredito({
    jogo: lotJogo,
    quantidade,
    piso: prevista.piso,
    garantia: lotGarantia,
    premiadas: lotPremiadas,
    cotacao: lotCotacao,
  });

  const lucro = e.premioMinimo - e.custo;
  const quantasGanham =
    e.premiadas === 1 ? 'uma cartela premiada' : `<b>${e.premiadas}</b> cartelas premiadas`;
  destino.innerHTML =
    `<div class="linha-economia"><span>Custo do fechamento</span>` +
    `<b>${dinheiro(e.custo)}</b> <em>${textoDaQuantidade(quantidade, ehPiso)}</em></div>` +

    selaDoVeredito(v) +

    `<div class="linha-economia ganha"><span>Se o sorteio cair no seu pool ` +
    `<em>(1 em ${milhares(1 / e.chanceDoPool)})</em></span>` +
    `<b>${dinheiro(e.premioMinimo)}</b> no mínimo <em>(${quantasGanham})</em>, ` +
    `<em>${dinheiro(e.premioMedioQuandoGanha)} em média — saldo ` +
    `${lucro >= 0 ? '+' : ''}${dinheiro(lucro)}</em></div>` +

    `<div class="linha-economia perde"><span>Se não cair ` +
    `<em>(${porcento(e.chanceDePerder)} das vezes)</em></span>` +
    `<b>−${dinheiro(e.perdaQuandoPerde)}</b> <em>nada volta</em></div>` +

    `<div class="linha-economia total"><span>Retorno esperado</span>` +
    `<b>${dinheiro(e.retornoEsperado)}</b> <em>por real apostado</em></div>` +

    `<p class="ajuda">O retorno esperado é fixo por jogo e apenas soma: ` +
    `<b>nenhum arranjo de fechamento o altera</b> — nem exigir mais cartelas ` +
    `premiadas. Fechar muda quando você ganha, com que frequência e quanto de ` +
    `cada vez; nunca a média.</p>`;
}

/*
 * A matriz das 45 combinações — agora com a coluna que decide a compra.
 *
 * Escolher aqui é escolher com quanto se vai gastar e o que se pode receber, e
 * até agora a tabela só falava do lado combinatório. A coluna "paga?" põe o
 * outro lado ao alcance do olho: em catorze das quarenta e cinco, o mínimo
 * matemático já custa mais que o prêmio — e essas ficam apagadas, porque
 * nenhuma quantidade de busca as salva.
 *
 * A quantidade mostrada passa a ser a que o aplicativo **entrega**, e não mais
 * o piso: era o piso que aparecia nas combinações em aberto, e comparar um piso
 * com um prêmio daria um veredito que a compra não cumpre.
 */
/** O valor de cada jogo, saneado — o mesmo que a economia usa. */
function lotValorDoJogo() {
  const digitado = Number($('lot-valor').value);
  return Number.isFinite(digitado) && digitado > 0 ? digitado : 1;
}

/**
 * O que o orçamento compra — e a garantia deixa de ser ajuste, vira resposta.
 *
 * ## Por que a fronteira inteira, agrupada por pool
 *
 * São duas trocas, e as duas são do usuário:
 *
 * - **entre pools** — muda a frequência com que o fechamento paga, de 0,004%
 *   num pool de 17 a 40% num de 24;
 * - **dentro do pool** — muda quantas cartelas premiadas se garante. Cada
 *   degrau custa mais e devolve mais: no pool 23 vai de 17 cartelas pagando
 *   1,18× até 23 cartelas pagando 3,48×.
 *
 * A segunda ficava escondida quando a tela mostrava só a melhor de cada pool, e
 * é justamente a que responde "quanto a mais eu ganho se gastar um pouco mais".
 *
 * O que **não** aparece é o que outra linha do mesmo pool faz melhor e mais
 * barato. Isso importa mais do que parece: garantias altas em cartelas pequenas
 * são sedutoras e péssimas. No pool 23, garantir 28 cartelas premiadas com
 * jogos de 21 custa 253 cartelas e devolve 3,32×; garantir 8 com jogos de 22
 * custa 23 e devolve 3,48× — onze vezes mais barato e melhor. Perseguir o
 * número de premiadas por ele mesmo leva para o lado errado, e a filtragem por
 * dominância é o que impede a tela de sugerir isso.
 *
 * ## O que a tabela não faz
 *
 * Não ordena por "melhor". A primeira linha é a que paga com mais frequência,
 * não a de maior retorno — ordenar por retorno coroaria um bilhete só de 17
 * dezenas, que devolve 7.000× e quase nunca ganha. E nenhuma linha tem retorno
 * esperado positivo, porque nenhuma pode ter.
 */
function lotPintarBolso() {
  const alvo = $('lot-bolso');
  const valor = lotValorDoJogo();
  const digitado = Number($('lot-orcamento').value);
  const reais = Number.isFinite(digitado) && digitado > 0 ? digitado : 0;
  const cartelas = Math.floor(reais / valor);

  if (cartelas < 1) {
    alvo.innerHTML =
      '<div class="referencia"><em>Informe quanto dá para gastar por concurso, ' +
      'e a tabela diz o que esse valor compra.</em></div>';
    return;
  }

  const { opcoes, semTeto } = lotinha.melhorConfiguracao({
    cotacao: lotCotacao,
    orcamento: cartelas,
    valorDoJogo: valor,
    minimoDeCartelas: 2,
  });

  const dinheiro = (v) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Retornos vão de 1,14× a mais de mil: casa decimal fixa deixaria "1167,00×".
  const vezes = (v) => `${v < 100 ? v.toFixed(2).replace('.', ',') : milhares(v)}×`;
  const chance = (f) => `${(f * 100).toFixed(2).replace('.', ',')}%`;

  if (opcoes.length === 0) {
    alvo.innerHTML =
      `<div class="referencia"><b>${dinheiro(reais)} não compra fechamento que pague.</b> ` +
      `<em>Com jogos de ${dinheiro(valor)} são ${milhares(cartelas)} cartelas, e nenhum ` +
      'fechamento desse tamanho devolve mais do que custa nem quando o sorteio cai ' +
      'dentro do pool. Aumente o teto, ou baixe o valor de cada jogo.</em></div>';
    return;
  }

  // Um cabeçalho por pool: a frequência é a mesma para todas as linhas dele, e
  // repeti-la em cada uma gastaria a coluna mais larga da tabela com o mesmo
  // número seguidas vezes.
  let poolAtual = null;
  const linhas = opcoes
    .map((o) => {
      const cabecalho =
        o.pool === poolAtual
          ? ''
          : `<tr class="grupo"><th scope="rowgroup" colspan="6">${o.pool} dezenas — ` +
            `paga em ${chance(o.chanceDoPool)} dos concursos</th></tr>`;
      poolAtual = o.pool;
      return (
        cabecalho +
        `<tr data-pool="${o.pool}" data-jogo="${o.jogo}" data-premiadas="${o.premiadas}" tabindex="0" role="button">` +
        `<th scope="row">${o.pool}/${o.jogo}</th>` +
        `<td>${milhares(o.premiadas)}</td>` +
        `<td>${milhares(o.quantidade)}</td>` +
        `<td>${dinheiro(o.custo)}</td>` +
        `<td>${dinheiro(o.premioGarantido)}</td>` +
        `<td class="paga">${vezes(o.retorno)}</td>` +
        '</tr>'
      );
    })
    .join('');

  const topo = opcoes[0];
  const raro = opcoes[opcoes.length - 1];

  alvo.innerHTML =
    `<div class="rolagem"><table class="matriz" id="lot-bolso-tabela">` +
    '<thead><tr><th>Fech.</th><th>Premiadas</th><th>Cartelas</th><th>Custo</th>' +
    '<th>Prêmio mín.</th><th>Retorno</th></tr></thead>' +
    `<tbody>${linhas}</tbody></table></div>` +
    `<div class="referencia"><b>A troca é essa.</b> <em>${topo.pool}/${topo.jogo} paga ` +
    `${vezes(topo.retorno)} e acerta o pool em ${chance(topo.chanceDoPool)} dos ` +
    `concursos; ${raro.pool}/${raro.jogo} paga ${vezes(raro.retorno)} e acerta em ` +
    `${chance(raro.chanceDoPool)}. Nas duas pontas o retorno esperado é o mesmo tipo de ` +
    `negócio: ${dinheiro(topo.retornoEsperado)} e ${dinheiro(raro.retornoEsperado)} por real ` +
    'apostado, porque a quantidade de cartelas cancela nessa conta. O que muda é ' +
    '<b>quando</b> se ganha e <b>quanto</b> de cada vez, nunca a média.</em></div>' +
    (semTeto.length
      ? '<div class="referencia"><em>Fora da tabela por matemática, não por preço: ' +
        semTeto
          .map((d) => `${d.pool}/${d.jogo} (teto ${vezes(d.teto)})`)
          .join(', ') +
        '. Nessas duplas o prêmio não cobre o mínimo de cartelas necessário, e ' +
        'nenhuma garantia conserta — o teto do retorno não depende de quantas ' +
        'cartelas se compra nem de quantas se exige premiadas.</em></div>'
      : '');

  // `[data-pool]` exclui os cabeçalhos de grupo, que são `tr` também e não têm
  // configuração para aplicar — sem isso o clique num deles pediria um pool
  // `NaN`.
  for (const linha of alvo.querySelectorAll('#lot-bolso-tabela tbody tr[data-pool]')) {
    const usar = () => {
      lotPool = Number(linha.dataset.pool);
      lotJogo = Number(linha.dataset.jogo);
      lotPremiadas = Number(linha.dataset.premiadas);
      lotGarantia = lotinha.SORTEIO;
      // A seleção de dezenas que sobrou pode não caber no pool novo.
      if (lotDezenas.size > lotPool) lotDezenas = new Set([...lotDezenas].slice(0, lotPool));
      lotEsquecerFechamento();
      lotPintarTudo();
      $('lot-grade').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    linha.addEventListener('click', usar);
    linha.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        usar();
      }
    });
  }
}

function lotMontarMatriz() {
  const linhas = lotinha
    .matriz()
    .map((l) => {
      const previsao = lotinha.previsao(l.pool, l.jogo);
      const entrega = previsao.quantidade;
      const quantos = entrega === null ? `≥ ${milhares(l.piso)}` : milhares(entrega);
      const situacao = l.jogo === l.pool ? 'aposta única' : l.exato ? 'exato' : 'em aberto';

      const v = lotinha.veredito({
        jogo: l.jogo,
        quantidade: entrega,
        piso: l.piso,
        cotacao: lotCotacao,
      });

      // A coluna respondia a pergunta errada. Ela dizia se a combinação paga
      // **com uma cartela premiada**, e rotulava de "não paga" o que só não
      // paga com uma — 23/22 vira lucro com duas, e todo o pool 24 com jogos de
      // 20 a 23 vira lucro pedindo mais. O que interessa é se existe alguma
      // garantia em que a dupla paga, e qual é a primeira delas.
      const quando =
        v.classe === 'sem-cotacao'
          ? null
          : lotinha.garantiaQuePaga(l.pool, l.jogo, lotCotacao);
      const semSalvacao = v.classe !== 'sem-cotacao' && quando === null;
      const paga =
        v.classe === 'sem-cotacao'
          ? '<td class="sem-cotacao">—</td>'
          : quando === null
            ? '<td class="nao-paga">não paga</td>'
            : quando.premiadas === 1
              ? '<td class="paga">paga</td>'
              : `<td class="quase">paga com ${milhares(quando.premiadas)}</td>`;

      return (
        `<tr class="${semSalvacao ? 'linha-apagada' : ''}">` +
        `<td>${l.pool}</td><td>${l.jogo}</td><td>${quantos}</td>` +
        `<td class="${l.exato ? '' : 'aberto'}">${situacao}</td>` +
        `<td>1 em ${milhares(1 / lotinha.chanceDe(l.jogo))}</td>${paga}</tr>`
      );
    })
    .join('');

  $('lot-matriz').innerHTML =
    '<thead><tr><th>pool</th><th>jogo</th><th>jogos</th><th>mínimo</th>' +
    '<th>chance de 1 jogo</th><th>paga?</th></tr></thead><tbody>' + linhas + '</tbody>';
}

ligar('lot-limpar', 'click', () => {
  lotDezenas.clear();
  lotEsquecerFechamento();
  lotPintarTudo();
});

ligar('lot-sortear', 'click', () => {
  const todas = Array.from({ length: lotinha.UNIVERSO }, (_, i) => i + 1);
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  lotDezenas = new Set(todas.slice(0, lotPool).sort((a, b) => a - b));
  lotEsquecerFechamento();
  lotPintarTudo();
});

ligar('lot-valor', 'input', () => {
  lotPintarEconomia();
  lotPintarBolso();
});
ligar('lot-orcamento', 'input', lotPintarBolso);

/*
 * O campo livre de cartelas premiadas.
 *
 * A régua de botões cobre 1 a 8 e o teto, que é o que a fronteira de fato usa.
 * Este campo cobre o resto: quem quiser experimentar vinte, trinta ou cento e
 * vinte premiadas digita aqui, sem limite artificial nenhum.
 *
 * `change` e não `input` de propósito: repintar a cada dígito faria o campo
 * saltar para o teto no meio da digitação de "12", porque "1" já é válido.
 */
ligar('lot-premiadas-livre', 'change', (evento) => {
  const teto = Math.max(lotinha.maximoPremiadas(lotPool, lotJogo, lotGarantia), 1);
  const pedido = Math.round(Number(evento.target.value));
  if (!Number.isFinite(pedido) || pedido < 1) {
    evento.target.value = String(lotPremiadas);
    return;
  }
  lotPremiadas = Math.min(pedido, teto);
  lotEsquecerFechamento();
  lotMontarExigencias();
  lotPintarExplicacao();
  lotPintarEconomia();
});

/**
 * Carrega o fechamento pronto, confere, mostra — e só então oferece o motor.
 *
 * A ordem importa. O banco entrega a solução na hora, sem cálculo; o validador
 * independente confirma a cobertura sem consultar quem a produziu; e a
 * otimização é um passo separado, que o usuário decide se quer.
 */
ligar('lot-iniciar', 'click', async () => {
  if (lotDezenas.size !== lotPool) return;

  const dezenas = [...lotDezenas].sort((a, b) => a - b);
  const cartao = $('lot-resultado-cartao');
  const destino = $('lot-conferencia');
  cartao.hidden = false;
  destino.textContent = 'carregando o fechamento…';

  try {
    // ── 1. o banco, que guarda o melhor já encontrado ──
    //
    // Só o caso padrão está lá: garantir as 15 numa cartela. As outras
    // exigências multiplicam o espaço muito além do que caberia num arquivo.
    const doBanco =
      lotGarantia === lotinha.SORTEIO && lotPremiadas === 1
        ? await lotinha.fechamentoPara(lotPool, lotJogo, dezenas)
        : null;

    // ── 2. a fórmula, quando o banco não tem ──
    //
    // Com o banco cobrindo 44 das 45 combinações, este ramo virou a rede de
    // segurança: é o que responde se o banco não puder ser lido. Continua
    // valendo a pena tê-lo — a construção sai em milissegundos e em 24 das 45
    // combinações ela **é** o mínimo comprovado.
    //
    // Medido em 25 dezenas com jogos de 22: a fórmula dá 78 jogos em menos de
    // um milissegundo; o guloso do motor gastava seis segundos e uma alocação
    // de 39 MB para chegar a 139, pior. Era processamento gasto para piorar a
    // resposta.
    const daFormula = doBanco
      ? null
      : lotinha.construir(lotPool, lotJogo, dezenas, lotGarantia, lotPremiadas);

    const pronto = doBanco ?? daFormula;
    lotFechamento = pronto;

    if (pronto) {
      destino.textContent = `conferindo ${milhares(
        lotinha.combinacoes(lotPool, lotinha.SORTEIO)
      )} sorteios, um a um…`;

      // Cede um quadro à tela antes da conferência, que pode levar segundos
      // nos pools grandes — sem isto a mensagem acima nunca apareceria.
      await new Promise((r) => setTimeout(r, 0));
      lotPintarConferencia(dezenas, pronto, daFormula ? 'fórmula' : 'banco');
    } else {
      destino.innerHTML =
        `<b>Sem fechamento pronto para esta combinação.</b> <em>Nem o banco a ` +
        `traz, nem há fórmula fechada que caiba aqui — o motor vai construir um ` +
        `do zero, e isso leva alguns segundos. Quando houver solução na tela, o ` +
        `botão abaixo confere sorteio a sorteio o que ele encontrou.</em>`;
    }
    $('lot-conferir').hidden = false;
    $('lot-checar').hidden = !pronto;

    lotPintarEconomia();

    lotConfiguracao = {
      universo: lotinha.UNIVERSO,
      pool: dezenas,
      cartela: lotJogo,
      alvo: lotinha.SORTEIO,
      intersecao: lotGarantia,
      premiadas: lotPremiadas,
      orcamento: null,
      semente: Number($('semente').value) || 1,
    };

    // ── 3. o motor, para tentar superar o que já está na mão ──
    //
    // Com fechamento pronto e problema pesado, ele deixa de partir sozinho.
    // Num pool de 25 o motor aloca 39 MB e cada iteração varre 3,2 milhões de
    // alvos — quase dois segundos por iteração. Ligar isso sem ser pedido, para
    // melhorar um fechamento que já está correto na tela, é gastar a bateria de
    // quem só queria os jogos.
    if (pronto && lotinha.combinacoes(lotPool, lotinha.SORTEIO) > ALVOS_PESADOS) {
      $('lot-otimizar').hidden = false;
      $('lot-otimizar').textContent =
        `Procurar um fechamento menor que ${milhares(pronto.length)}`;
      return;
    }

    // O fechamento vai duas vezes de propósito: como semente para o motor, e
    // como cartelas já na tela. Sem o segundo argumento, `comecar` zera a lista
    // exibida — e a aba Resultado ficaria vazia entre carregar e o motor
    // devolver o primeiro estado, que é justamente quando o usuário vai olhar.
    comecar({ configuracao: lotConfiguracao, doBanco: pronto }, pronto ?? []);
  } catch (erro) {
    destino.innerHTML = `<b>Falhou:</b> ${escapar(String(erro?.message ?? erro))}`;
  }
});

/**
 * Acima disto o motor não parte sozinho depois de entregar um fechamento.
 *
 * O número é a quantidade de sorteios a cobrir, que é o que decide tudo: a
 * memória do motor (doze bytes por sorteio) e o custo de cada iteração. Um
 * milhão deixa passar os pools de 17 a 23, onde a busca é leve e útil, e segura
 * os de 24 e 25, onde ela custa 16 e 39 MB e segundos por iteração.
 */
const ALVOS_PESADOS = 1_000_000;

ligar('lot-otimizar', 'click', () => {
  if (!lotConfiguracao || !lotFechamento) return;
  $('lot-otimizar').hidden = true;
  comecar({ configuracao: lotConfiguracao, doBanco: lotFechamento }, lotFechamento);
});

/**
 * A conferência independente, escrita na tela.
 *
 * Confere as duas exigências e não só a cobertura: cada sorteio precisa cair em
 * `lotPremiadas` jogos com ao menos `lotGarantia` acertos. Um fechamento que
 * prometa duas cartelas premiadas e entregue uma passaria batido numa
 * conferência que só perguntasse "alguém cobre?".
 */
function lotPintarConferencia(dezenas, jogos, origem = null, exaustivo = null) {
  const destino = $('lot-conferencia');
  const { total, cobertos, falha, minimoPremiadas, exaustivo: varreuTudo, possiveis } =
    lotinha.conferirCobertura(dezenas, jogos, lotGarantia, lotPremiadas, { exaustivo });

  const oQue =
    `${lotPremiadas === 1 ? 'uma cartela' : `${lotPremiadas} cartelas`} com ` +
    `${lotGarantia} acerto${lotGarantia === 1 ? '' : 's'}`;

  const veioDe =
    origem === 'fórmula'
      ? ' <em>Este fechamento saiu de fórmula, na hora: o pool é partido em ' +
        'grupos e a casa dos pombos garante o resto. Nenhuma busca foi ' +
        'necessária.</em>'
      : '';

  const aMais =
    minimoPremiadas > lotPremiadas && Number.isFinite(minimoPremiadas)
      ? ` <em>No pior caso são ${minimoPremiadas} cartelas, não ${lotPremiadas}.</em>`
      : '';

  if (cobertos === total) {
    // Uma amostra não prova cobertura, e não pode ser anunciada como se
    // provasse. A diferença entre as duas frases é a diferença entre uma
    // garantia e uma boa evidência.
    destino.innerHTML = varreuTudo
      ? `<b>Garantia comprovada: 100%</b> <em>— ${milhares(total)} sorteios ` +
        `conferidos um a um, e em todos você fica com ${oQue}, usando ` +
        `${milhares(jogos.length)} jogos. A conferência não consultou o motor que ` +
        `produziu o fechamento.</em>${veioDe}${aMais}`
      : `<b>${milhares(total)} sorteios conferidos ao acaso: todos cobertos.</b> ` +
        `<em>Em cada um deles você fica com ${oQue}, usando ` +
        `${milhares(jogos.length)} jogos. São ${milhares(possiveis)} sorteios ` +
        `possíveis — conferir todos aqui levaria minutos, e esta amostra é ` +
        `evidência forte, não prova.</em>${veioDe}${aMais}`;
    $('lot-conferir').textContent = varreuTudo
      ? 'Conferir o que está na tela agora'
      : 'Conferir os ' + milhares(possiveis) + ' sorteios, um a um';
    return;
  }

  destino.innerHTML =
    `<b>Garantia cumprida em ${porcento(cobertos / total)}</b> <em>— ${milhares(
      total - cobertos
    )} de ${milhares(total)} sorteios ficam abaixo de ${oQue}. Um deles: ` +
    `${falha.join(' ')}. Isto é o motor ainda trabalhando, não um fechamento ` +
    `pronto e furado.</em>`;
}

ligar('lot-conferir', 'click', async () => {
  if (lotDezenas.size !== lotPool) return;
  const dezenas = [...lotDezenas].sort((a, b) => a - b);
  const jogos = melhorCartelas;

  if (!jogos.length) {
    $('lot-conferencia').innerHTML = '<b>Ainda não há solução na tela para conferir.</b>';
    return;
  }

  $('lot-conferencia').textContent = `conferindo ${milhares(
    lotinha.combinacoes(lotPool, lotinha.SORTEIO)
  )} sorteios, um a um…`;
  await new Promise((r) => setTimeout(r, 0));
  lotFechamento = jogos;
  // Pelo botão a conferência é sempre completa: quem tocou aqui está pedindo a
  // varredura inteira e aceitando esperar por ela.
  lotPintarConferencia(dezenas, jogos, null, true);
  lotPintarEconomia();
});

ligar('lot-simular', 'click', () => {
  if (!lotFechamento) return;

  const numeros = ($('lot-resultado').value.match(/\d+/g) ?? []).map(Number);
  const destino = $('lot-simulacao');
  destino.hidden = false;

  if (numeros.length !== lotinha.SORTEIO) {
    destino.innerHTML = `<b>Digite exatamente 15 dezenas.</b> <em>Você digitou ${numeros.length}.</em>`;
    return;
  }

  // Um sorteio da Lotofácil são 15 dezenas **distintas** entre 1 e 25. Sem
  // estas duas checagens, digitar "1 1 1 …" simulava um sorteio de uma dezena
  // só, e digitar 99 simulava uma dezena que não existe — nos dois casos com
  // uma resposta de aparência normal, que é o pior jeito de errar.
  const foraDoUniverso = numeros.filter((n) => n < 1 || n > lotinha.UNIVERSO);
  if (foraDoUniverso.length) {
    destino.innerHTML =
      `<b>Dezena fora do intervalo.</b> <em>A Lotofácil vai de 1 a ${lotinha.UNIVERSO}, ` +
      `e você digitou ${foraDoUniverso.join(', ')}.</em>`;
    return;
  }

  const distintas = new Set(numeros);
  if (distintas.size !== numeros.length) {
    const repetidas = [...new Set(numeros.filter((n, i) => numeros.indexOf(n) !== i))];
    destino.innerHTML =
      `<b>Dezena repetida.</b> <em>Um sorteio não repete dezena, e ` +
      `${repetidas.join(', ')} apareceu mais de uma vez.</em>`;
    return;
  }

  const { distribuicao, comQuinze } = lotinha.simular(lotFechamento, numeros, lotGarantia);
  const faixas = [...distribuicao.entries()].sort((a, b) => b[0] - a[0]);

  destino.innerHTML =
    (comQuinze.length
      ? `<b>${comQuinze.length} jogo${comQuinze.length > 1 ? 's' : ''} com 15 acertos.</b> ` +
        `<em>Jogo ${comQuinze.map((p) => p.indice).join(', ')}.</em>`
      : `<b>Nenhum jogo com 15.</b> <em>Nesta modalidade só 15 paga — as faixas ` +
        `abaixo mostram o quão perto se chegou, não prêmio.</em>`) +
    '<div class="faixas">' +
    faixas
      .map(([acertos, quantos]) => `<span><b>${quantos}</b> com ${acertos}</span>`)
      .join('') +
    '</div>';
});

aoIniciar('a tela da Lotinha', lotMontar);

// O banco embutido, buscado assim que a tela existe.
//
// Não é para a busca — essa carrega o dela na hora do toque. É para a tela
// saber, antes de qualquer clique, que 22 dezenas com jogos de 17 saem com
// 3.712 jogos e não com os 26.334 que a fórmula pediria. Sem isto a
// explicação e o custo apareceriam com o número da fórmula e mudariam sozinhos
// segundos depois, o que é pior do que demorar um instante para aparecer.
//
// Falhar aqui não quebra nada: `previsao` cai na fórmula, que é sempre válida.
lotinha
  .carregarBanco()
  .then(() => {
    lotPintarExplicacao();
    lotPintarEconomia();
    // A matriz mostra a quantidade entregue, que só se conhece com o banco na
    // mão: sem esta repintura ela ficaria com os números da fórmula.
    lotMontarMatriz();
  })
  .catch(() => {});

ligar('ir-para-historico', 'click', () => mostrarPainel('historico'));

/**
 * Retoma um trabalho do histórico exatamente de onde parou.
 *
 * A sessão continua sendo a mesma: o motor recebe a solução já alcançada e a
 * contagem de iterações anterior, e cada melhoria daqui em diante atualiza
 * aquele mesmo registro. É o que diferencia continuar um trabalho de começar
 * outro parecido.
 */
function continuarSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) {
    avisar('Esse trabalho não está mais no histórico.');
    pintarHistorico();
    return;
  }

  comecar(
    {
      configuracao: sessao.configuracao,
      salvo: historico.paraRetomada(sessao),
      sessaoId: sessao.id,
    },
    sessao.melhor
  );
}

/**
 * Dá a partida, mostrando a tela de busca **antes** de qualquer trabalho
 * pesado.
 *
 * A ordem importa mais do que parece. Criar o worker e instanciar o
 * WebAssembly leva de centenas de milissegundos a alguns segundos num celular.
 * Trocar de tela só ao fim disso deixava o toque no botão sem resposta
 * nenhuma — o usuário tocava e nada acontecia, o que parece um aplicativo
 * quebrado. Trocando primeiro, o carregamento acontece com o relógio correndo
 * e o ponto pulsando à vista.
 */
function comecar(
  { configuracao, salvo, fechamento = null, doBanco = null, sessaoId = null },
  cartelasIniciais = []
) {
  // Um motor antigo ainda vivo continuaria consumindo processador e memória.
  desmontarTrabalhador();

  recordes = [];
  melhorCartelas = cartelasIniciais;
  configuracaoDaBusca = configuracao;
  referenciaDaBusca = referenciaDe(configuracao);
  // Continuar um trabalho escreve na sessão dele; começar do zero abre outra
  // quando a primeira solução aparecer.
  sessaoAtual = sessaoId;
  pintarRecordes();
  pintarCartelas();

  ['melhor-cartelas', 'limite-inferior', 'gap', 'cobertura'].forEach((id) => {
    $(id).textContent = '—';
  });
  ['atual-cartelas', 'atual-descobertos', 'meta', 'elites', 'iteracoes', 'velocidade', 'recordes']
    .forEach((id) => {
      $(id).textContent = '—';
    });
  $('selo-otimo').hidden = true;
  $('selo-recorde').hidden = true;
  $('res-selo-otimo').hidden = true;
  $('res-selo-recorde').hidden = true;
  $('referencia-busca').hidden = true;
  $('referencia-resultado').hidden = true;

  zerarCronometro();
  mostrarPainel('buscar');
  definirFase('carregando');

  garantirTrabalhador().postMessage({ tipo: 'criar', configuracao, salvo, fechamento, doBanco });
  segurarTelaLigada();
}

ligar('pausar', 'click', () => {
  if (!trabalhador) return;

  if (fase === 'buscando') {
    trabalhador.postMessage({ tipo: 'pausar' });
    soltarTelaLigada();
  } else if (fase === 'pausado') {
    trabalhador.postMessage({ tipo: 'rodar' });
    definirFase('buscando');
    segurarTelaLigada();
  }
});

ligar('encerrar', 'click', () => {
  if (!trabalhador) {
    definirFase('ocioso');
    mostrarPainel('lotinha');
    return;
  }
  // O worker devolve o estado final e libera a memória; a resposta 'encerrado'
  // é quem desmonta tudo e traz o usuário de volta à Lotinha.
  definirFase('ocioso', 'encerrando…');
  trabalhador.postMessage({ tipo: 'encerrar' });
});

ligar('copiar', 'click', async () => {
  if (!melhorCartelas.length) return avisar('Nenhuma solução para copiar ainda.');

  // Um fechamento grande demora a copiar: 11.546 jogos são 589 mil caracteres,
  // e a área de transferência leva quase três segundos para aceitá-los. Sem
  // aviso, o botão parece não ter funcionado — e a reação natural é tocar de
  // novo, o que só enfileira outra cópia.
  const botao = $('copiar');
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = `Copiando ${milhares(melhorCartelas.length)} jogos…`;

  try {
    await navigator.clipboard.writeText(textoDoFechamento());
    avisar(`${milhares(melhorCartelas.length)} jogos copiados.`, true);
  } catch {
    avisar('O navegador não deixou copiar. Segure o dedo sobre as cartelas para selecionar.');
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
});

ligar('compartilhar', 'click', async () => {
  if (!melhorCartelas.length) return avisar('Nenhuma solução para compartilhar ainda.');

  const texto = textoDoFechamento();
  // `navigator.share` abre a folha nativa do iOS — o caminho para mandar por
  // mensagem, salvar em Arquivos ou imprimir.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Fechamento — Sonho Lúcido', text: texto });
    } catch {
      /* o usuário cancelou */
    }
  } else {
    await navigator.clipboard.writeText(texto);
    avisar('Compartilhamento indisponível aqui; as cartelas foram copiadas.', true);
  }
});

function textoDoFechamento() {
  // O cabeçalho descreve o que produziu estas cartelas. Sem busca em curso —
  // ao ver um trabalho antigo pelo histórico, por exemplo — não há o que
  // afirmar, e é melhor exportar sem cabeçalho do que inventar um.
  const c = configuracaoDaBusca;
  const cabecalho = c
    ? `# Sonho Lúcido — ${melhorCartelas.length} jogos de ${c.cartela} dezenas\n` +
      `# fechamento de ${c.pool.length} dezenas escolhidas entre ${c.universo}\n`
    : `# Sonho Lúcido — ${melhorCartelas.length} jogos\n`;
  const corpo = melhorCartelas
    .map((cartela) => cartela.map((n) => String(n).padStart(2, '0')).join(' '))
    .join('\n');
  return `${cabecalho}${corpo}\n`;
}

/* ─────────── a tela do histórico ─────────── */

/**
 * Desenha a lista de trabalhos salvos.
 *
 * A quantidade de cartelas vem grande e primeiro porque é por ela que o usuário
 * reconhece o trabalho. A configuração e a data ficam logo abaixo, para separar
 * buscas parecidas — sem elas, dois trabalhos com o mesmo número de cartelas
 * ficariam indistinguíveis.
 */
function pintarHistorico() {
  const sessoes = historico.listar();
  const destino = $('lista-historico');
  $('limpar-historico').hidden = sessoes.length === 0;
  atualizarAtalhoDoHistorico(sessoes.length);

  if (!sessoes.length) {
    destino.innerHTML =
      '<p class="historico-vazio">Nenhum trabalho salvo ainda.<br>' +
      'Toda busca que você iniciar aparece aqui automaticamente.</p>';
    return;
  }

  destino.innerHTML = sessoes.map(cartaoDaSessao).join('');

  destino.querySelectorAll('[data-acao]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const { acao, id } = botao.dataset;
      if (acao === 'continuar') continuarSessao(id);
      else if (acao === 'ver') verSessao(id);
      else if (acao === 'checar') abrirChecagem(`historico:${id}`);
      else if (acao === 'excluir') excluirSessao(id);
    });
  });
}

function cartaoDaSessao(sessao) {
  const avaliacao = sessao.avaliacao ?? {};
  const emAndamento = sessao.id === sessaoAtual;

  // Tudo daqui vem do armazenamento do aparelho, e nada garante o formato:
  // o usuário pode editar, outra aba pode gravar meia sessão, uma versão futura
  // pode mudar o formato. Números entram como números — se não forem, viram
  // travessão em vez de marcação. E `sessao.id` é escapado porque vai dentro de
  // um atributo: um id com aspas fecharia o atributo e o resto viraria HTML.
  const inteiro = (v, alternativa = '—') =>
    Number.isFinite(Number(v)) ? milhares(Number(v)) : alternativa;

  const quantas = Number.isFinite(Number(avaliacao.cartelas))
    ? milhares(Number(avaliacao.cartelas))
    : inteiro(sessao.melhor.length);

  const marca = avaliacao.otimo
    ? '<span class="sessao-marca otima">★ ótimo provado</span>'
    : emAndamento
      ? '<span class="sessao-marca viva">em andamento</span>'
      : Number.isFinite(Number(avaliacao.limiteInferior)) && Number(avaliacao.limiteInferior) > 0
        ? `<span class="sessao-marca">mínimo ${inteiro(avaliacao.limiteInferior)}</span>`
        : '';

  const cobertura =
    typeof avaliacao.cobertura === 'number' ? ` · cobertura ${porcento(avaliacao.cobertura)}` : '';

  const id = escapar(sessao.id);

  return `
    <div class="sessao${emAndamento ? ' em-andamento' : ''}">
      <div class="sessao-topo">
        <span class="sessao-quantia">${quantas}</span>
        <span class="sessao-unidade">cartelas</span>
        ${marca}
      </div>
      <div class="sessao-config">
        ${escapar(historico.descrever(sessao.configuracao))}<br>
        ${escapar(historico.quando(sessao.atualizadaEm))} ·
        ${milhares(Number(sessao.iteracoes) || 0)} iterações${cobertura}
      </div>
      <div class="sessao-acoes">
        <button class="continuar" data-acao="continuar" data-id="${id}">Continuar</button>
        <button data-acao="ver" data-id="${id}">Ver cartelas</button>
        <button data-acao="checar" data-id="${id}">Checar</button>
        <button class="excluir" data-acao="excluir" data-id="${id}"
                aria-label="Excluir este trabalho">✕</button>
      </div>
    </div>`;
}

/** Impede que um valor gravado acabe interpretado como marcação. */
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function verSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;

  melhorCartelas = sessao.melhor;
  pintarCartelas();

  const avaliacao = sessao.avaliacao ?? {};
  $('res-cartelas').textContent = avaliacao.cartelas ?? sessao.melhor.length;
  $('res-cobertura').textContent =
    typeof avaliacao.cobertura === 'number' ? porcento(avaliacao.cobertura) : '—';
  $('res-redundancia').textContent =
    typeof avaliacao.redundancia === 'number' ? milhares(avaliacao.redundancia) : '—';

  mostrarPainel('resultado');
}

function excluirSessao(id) {
  const sessao = historico.obter(id);
  if (!sessao) return;

  const quantas = sessao.avaliacao?.cartelas ?? sessao.melhor.length;
  if (!confirm(`Excluir este trabalho de ${quantas} cartelas? Não dá para desfazer.`)) return;

  historico.remover(id);
  if (sessaoAtual === id) sessaoAtual = null;
  pintarHistorico();
  avisar('Trabalho excluído.', true);
}

ligar('limpar-historico', 'click', () => {
  const total = historico.quantidade();
  if (!total) return;
  if (!confirm(`Apagar todos os ${total} trabalhos do histórico? Não dá para desfazer.`)) return;

  historico.limpar();
  sessaoAtual = null;
  pintarHistorico();
  avisar('Histórico apagado.', true);
});

/** Mostra o atalho da tela inicial só quando há o que continuar. */
function atualizarAtalhoDoHistorico(total = historico.quantidade()) {
  $('ir-para-historico').hidden = total === 0;
}

/* ═════════════════ Checar fechamento ═════════════════ */

/*
 * Conferir um fechamento contra um resultado, real ou sorteado.
 *
 * ## A regra que não pode ser quebrada
 *
 * A ferramenta **não regenera cartelas**. Ela confere exatamente as que foram
 * produzidas — as que estão na tela agora, ou as que ficaram gravadas no
 * histórico. Regerar daria outro fechamento do mesmo tamanho, igualmente
 * válido e diferente, e a conferência deixaria de descrever o que a pessoa
 * tem na mão.
 *
 * ## Onde as contas moram
 *
 * Em `checagem.js`, sem DOM: é o que permite testá-las fora do navegador e
 * reusá-las dentro do worker das simulações longas. Aqui só há tela.
 */

/** Quantas cartelas mostrar de uma vez ao abrir uma faixa. */
const CARTELAS_POR_LEVA = 60;

/** A partir de quantas cartelas-sorteio a simulação vai para o worker. */
const TRABALHO_PARA_O_WORKER = 2_000_000;

let chkFonte = null;
let chkMascaras = null;
let chkUltima = null;
let chkFaixaAberta = null;
let chkMostradas = 0;
let chkQuantosSorteios = 100;
/* Qual fechamento a próxima abertura da aba deve escolher. */
let chkPreferida = null;
/* As chaves da última lista pintada, para não repintar sem necessidade.
   Começa em `null` — e não em string vazia — porque a lista vazia é um estado
   legítimo que precisa ser pintado uma vez. */
let chkChavesPintadas = null;
let chkTrabalhador = null;
let chkSimulando = false;

/**
 * Tudo que pode ser conferido, na ordem em que interessa.
 *
 * O fechamento carregado agora vem primeiro porque é o que a pessoa estava
 * olhando; depois o resultado da busca em curso; depois o histórico, do mais
 * recente para o mais antigo.
 */
function chkFontes() {
  const fontes = [];

  if (lotFechamento?.length) {
    fontes.push({
      chave: 'lotinha',
      rotulo: `Fechamento carregado · ${lotPool} dezenas · jogos de ${lotJogo}`,
      cartelas: lotFechamento,
      criadaEm: null,
      descricao: `${lotPool} dezenas · jogos de ${lotJogo}`,
    });
  }

  if (melhorCartelas?.length) {
    fontes.push({
      chave: 'busca',
      rotulo: `Resultado da busca · ${milhares(melhorCartelas.length)} cartelas`,
      cartelas: melhorCartelas,
      criadaEm: null,
      descricao: configuracaoDaBusca
        ? historico.descrever(configuracaoDaBusca)
        : 'resultado em tela',
    });
  }

  for (const sessao of historico.listar()) {
    if (!sessao.melhor?.length) continue;
    fontes.push({
      chave: `historico:${sessao.id}`,
      rotulo: `${historico.descrever(sessao.configuracao)} · ${milhares(
        sessao.melhor.length
      )} cartelas · ${historico.quando(sessao.criadaEm)}`,
      cartelas: sessao.melhor,
      criadaEm: sessao.criadaEm,
      descricao: historico.descrever(sessao.configuracao),
    });
  }

  return fontes;
}

function chkPintarSeletor(preferida = null) {
  const seletor = $('chk-fechamento');
  const fontes = chkFontes();

  if (!fontes.length) {
    seletor.innerHTML = '<option value="">nenhum fechamento disponível</option>';
    seletor.disabled = true;
    chkSelecionar(null);
    return;
  }

  seletor.disabled = false;
  const escolhida =
    fontes.find((f) => f.chave === preferida)?.chave ??
    fontes.find((f) => f.chave === chkFonte?.chave)?.chave ??
    fontes[0].chave;

  seletor.innerHTML = fontes
    .map(
      (f) =>
        `<option value="${escapar(f.chave)}"${f.chave === escolhida ? ' selected' : ''}>${escapar(
          f.rotulo
        )}</option>`
    )
    .join('');

  chkSelecionar(escolhida);
}

/** Carrega um fechamento para análise, e esquece a conferência anterior. */
function chkSelecionar(chave) {
  chkFonte = chave ? chkFontes().find((f) => f.chave === chave) ?? null : null;
  chkMascaras = chkFonte ? checagem.mascarasDo(chkFonte.cartelas) : null;
  chkUltima = null;
  chkFaixaAberta = null;
  chkMostradas = 0;

  $('chk-resumo-cartao').hidden = true;
  $('chk-cartelas-cartao').hidden = true;
  $('chk-erro').hidden = true;
  $('chk-estatistica-rolagem').hidden = true;
  $('chk-andamento').hidden = true;
  $('chk-conferir').disabled = !chkFonte;
  $('chk-sortear').disabled = !chkFonte;
  $('chk-sortear').textContent = 'Simular sorteio';
  $('chk-simular').disabled = !chkFonte;

  chkPintarFicha();
}

function chkPintarFicha() {
  const destino = $('chk-ficha');
  if (!chkFonte) {
    destino.innerHTML =
      '<b>Nenhum fechamento para conferir.</b> <em>Carregue um na tela da ' +
      'Lotinha, ou abra um trabalho do histórico.</em>';
    return;
  }

  const cartelas = chkFonte.cartelas;
  // O pool sai das próprias cartelas: é o que garante que a ficha descreva o
  // fechamento que está sendo conferido, e não a configuração que alguém
  // achou que ele tinha.
  const dezenas = new Set();
  let menorJogo = Infinity;
  let maiorJogo = 0;
  for (const c of cartelas) {
    for (const d of c) dezenas.add(d);
    if (c.length < menorJogo) menorJogo = c.length;
    if (c.length > maiorJogo) maiorJogo = c.length;
  }
  const tamanho =
    menorJogo === maiorJogo ? `${menorJogo}` : `${menorJogo} a ${maiorJogo}`;

  const quando = chkFonte.criadaEm
    ? `<div><span>Criado em</span><b>${escapar(historico.quando(chkFonte.criadaEm))}</b></div>`
    : '';

  destino.innerHTML =
    `<div class="ficha">` +
    `<div><span>Fechamento</span><b>${escapar(chkFonte.descricao)}</b></div>` +
    quando +
    `<div><span>Modalidade</span><b>Lotinha · 15 dezenas sorteadas</b></div>` +
    `<div><span>Dezenas usadas</span><b>${dezenas.size}</b></div>` +
    `<div><span>Cartelas</span><b>${milhares(cartelas.length)}</b></div>` +
    `<div><span>Dezenas por cartela</span><b>${tamanho}</b></div>` +
    `</div>`;
}

function chkMostrarErro(mensagem) {
  const destino = $('chk-erro');
  destino.hidden = false;
  destino.innerHTML = `<b>${escapar(mensagem)}</b>`;
}

/** Confere e pinta. `dezenas` já vem validada. */
function chkConferir(dezenas) {
  if (!chkFonte) return;

  $('chk-erro').hidden = true;
  chkUltima = checagem.conferir(chkFonte.cartelas, dezenas, chkMascaras);
  chkFaixaAberta = null;
  chkMostradas = 0;

  chkPintarResumo();
  chkPintarBotoesDeFaixa();
  $('chk-cartelas').innerHTML = '';
  $('chk-mais').hidden = true;
  $('chk-cartelas-cartao').hidden = chkUltima.melhor < 11;
}

function chkPintarResumo() {
  const r = chkUltima;
  $('chk-resumo-cartao').hidden = false;

  $('chk-sorteio').innerHTML = r.resultado
    .map((d) => `<span>${String(d).padStart(2, '0')}</span>`)
    .join('');

  // A premiação primeiro, e sozinha: é a única faixa que paga, e misturá-la
  // com as outras é o erro que esta tela existe para não cometer.
  $('chk-premiacao').innerHTML = r.premiadas
    ? `<div class="premio ganhou">🎯 <b>${milhares(r.premiadas)} cartela${
        r.premiadas > 1 ? 's' : ''
      } com 15 acertos</b><em>É a única faixa premiada nesta modalidade.</em></div>`
    : `<div class="premio"><b>Nenhuma cartela com 15 acertos</b>` +
      `<em>Melhor resultado: ${
        r.melhor >= 0 ? `${r.melhor} acerto${r.melhor === 1 ? '' : 's'}` : '—'
      }${
        r.melhor >= 0 && r.melhor <= 14
          ? ` em ${milhares(r.porFaixa[r.melhor])} cartela${
              r.porFaixa[r.melhor] > 1 ? 's' : ''
            }`
          : ''
      }.</em></div>`;

  const linhas = [];
  for (let a = 15; a >= 11; a--) {
    const quantas = r.porFaixa[a];
    linhas.push(
      `<tr class="${a === 15 ? 'faixa-premio' : ''}${
        quantas === 0 ? ' faixa-vazia' : ''
      }"><td>${a} acertos</td><td>${milhares(quantas)}</td></tr>`
    );
  }
  const abaixo = r.porFaixa.slice(0, 11).reduce((s, n) => s + n, 0);
  linhas.push(
    `<tr class="faixa-resto"><td>10 ou menos</td><td>${milhares(abaixo)}</td></tr>`
  );

  $('chk-faixas').innerHTML =
    '<thead><tr><th>Acertos</th><th>Cartelas</th></tr></thead><tbody>' +
    linhas.join('') +
    '</tbody>';

  $('chk-nota-premio').innerHTML =
    'Na Lotinha só <b>15 acertos</b> paga. As faixas de 11 a 14 estão aqui ' +
    'porque dizem o quanto o fechamento chegou perto — são medida de ' +
    'cobertura, não prêmio.';
}

function chkPintarBotoesDeFaixa() {
  const destino = $('chk-faixa-botoes');
  const r = chkUltima;
  const faixas = [];
  for (let a = 15; a >= 11; a--) {
    if (r.porFaixa[a] > 0) faixas.push(a);
  }

  destino.innerHTML = faixas
    .map(
      (a) =>
        `<button class="opcao" data-faixa="${a}">${a} acertos · ${milhares(
          r.porFaixa[a]
        )}</button>`
    )
    .join('');

  destino.querySelectorAll('[data-faixa]').forEach((botao) => {
    botao.addEventListener('click', () => chkAbrirFaixa(Number(botao.dataset.faixa)));
  });
}

function chkAbrirFaixa(faixa) {
  chkFaixaAberta = faixa;
  chkMostradas = 0;
  document.querySelectorAll('#chk-faixa-botoes .opcao').forEach((b) => {
    const ativa = Number(b.dataset.faixa) === faixa;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-pressed', String(ativa));
  });
  $('chk-cartelas').innerHTML = '';
  chkMostrarMaisCartelas();
}

/**
 * Mostra a próxima leva de cartelas da faixa aberta.
 *
 * De leva em leva porque uma faixa de 11 acertos pode ter dezenas de milhares
 * de cartelas: pintá-las todas de uma vez trava a tela por segundos e ninguém
 * as leria.
 */
function chkMostrarMaisCartelas() {
  if (chkFaixaAberta === null || !chkUltima) return;

  const indices = chkUltima.indices.get(chkFaixaAberta) ?? [];
  const sorteadas = new Set(chkUltima.resultado);
  const ate = Math.min(indices.length, chkMostradas + CARTELAS_POR_LEVA);

  const pedaco = [];
  for (let i = chkMostradas; i < ate; i++) {
    const posicao = indices[i];
    const cartela = chkFonte.cartelas[posicao];
    const dezenas = cartela
      .map(
        (d) =>
          `<span class="${sorteadas.has(d) ? 'acertou' : ''}">${String(d).padStart(
            2,
            '0'
          )}</span>`
      )
      .join('');
    pedaco.push(
      `<div class="cartela conferida">
         <span class="indice">#${milhares(posicao + 1)}</span>
         <span class="dezenas">${dezenas}</span>
         <span class="acertos">${chkFaixaAberta}</span>
       </div>`
    );
  }

  $('chk-cartelas').insertAdjacentHTML('beforeend', pedaco.join(''));
  chkMostradas = ate;

  const faltam = indices.length - chkMostradas;
  const botao = $('chk-mais');
  botao.hidden = faltam <= 0;
  if (faltam > 0) botao.textContent = `Mostrar mais ${milhares(Math.min(faltam, CARTELAS_POR_LEVA))}`;
}

/* ─────────── simulação de muitos sorteios ─────────── */

function chkPintarQuantos() {
  const destino = $('chk-quantos');
  destino.innerHTML = [10, 100, 1000, 10000]
    .map(
      (n) =>
        `<button class="opcao${n === chkQuantosSorteios ? ' ativa' : ''}" data-quantos="${n}"
                 aria-pressed="${n === chkQuantosSorteios}">${milhares(n)}</button>`
    )
    .join('');

  destino.querySelectorAll('[data-quantos]').forEach((botao) => {
    botao.addEventListener('click', () => {
      chkQuantosSorteios = Number(botao.dataset.quantos);
      chkPintarQuantos();
    });
  });
}

function chkGarantirTrabalhador() {
  if (chkTrabalhador) return chkTrabalhador;
  chkTrabalhador = new Worker('./checador.js', { type: 'module' });
  return chkTrabalhador;
}

function chkPintarAndamento(feitos, total) {
  const destino = $('chk-andamento');
  destino.hidden = false;
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;
  destino.innerHTML =
    `<b>Simulando…</b> <em>${milhares(feitos)} de ${milhares(total)} sorteios.</em>` +
    `<div class="barra-progresso"><div style="width:${pct}%"></div></div>`;
}

function chkPintarEstatistica(resumo) {
  $('chk-andamento').hidden = true;
  $('chk-estatistica-rolagem').hidden = false;

  const linhas = resumo.faixas
    .slice()
    .reverse()
    .map((f) => {
      const pct = (f.proporcao * 100).toFixed(f.proporcao < 0.01 ? 2 : 1);
      return `<tr class="${f.acertos === 15 ? 'faixa-premio' : ''}">
        <td>${f.acertos}</td>
        <td>${milhares(f.sorteiosComAlguma)}</td>
        <td>${pct}%</td>
        <td>${f.media.toFixed(2)}</td>
        <td>${milhares(f.minimo)}</td>
        <td>${milhares(f.maximo)}</td>
      </tr>`;
    })
    .join('');

  const quinze = resumo.faixas.find((f) => f.acertos === 15);
  const destaque = quinze
    ? `<p class="ajuda"><b>${milhares(quinze.sorteiosComAlguma)} dos ${milhares(
        resumo.sorteios
      )} sorteios</b> simulados tiveram ao menos uma cartela com 15 acertos — ` +
      `${(quinze.proporcao * 100).toFixed(2)}%. É a única faixa que paga, e ` +
      `esta é uma frequência observada numa simulação, não uma chance prometida.</p>`
    : '';

  $('chk-estatistica').innerHTML =
    `<caption>${milhares(resumo.sorteios)} sorteios sobre ${milhares(
      resumo.cartelas
    )} cartelas</caption>` +
    '<thead><tr><th>Acertos</th><th>Sorteios com alguma</th><th>%</th>' +
    '<th>Média</th><th>Mín</th><th>Máx</th></tr></thead>' +
    `<tbody>${linhas}</tbody>`;

  $('chk-estatistica-rolagem').insertAdjacentHTML('afterend', '');
  const nota = $('chk-multi-cartao').querySelector('.ajuda.simulacao');
  if (nota) nota.remove();
  if (destaque) {
    $('chk-estatistica-rolagem').insertAdjacentHTML(
      'afterend',
      destaque.replace('class="ajuda"', 'class="ajuda simulacao"')
    );
  }
}

async function chkSimularVarios() {
  if (!chkFonte || chkSimulando) return;

  const quantos = chkQuantosSorteios;
  const trabalho = quantos * chkFonte.cartelas.length;

  chkSimulando = true;
  $('chk-simular').disabled = true;
  chkPintarAndamento(0, quantos);

  try {
    if (trabalho < TRABALHO_PARA_O_WORKER) {
      // Pequeno o bastante para não valer a viagem até o worker. Cede um quadro
      // antes para a barra de andamento chegar a aparecer.
      await new Promise((r) => setTimeout(r, 0));
      const resumo = checagem.simularVarios(chkFonte.cartelas, quantos, {
        mascaras: chkMascaras,
      });
      chkPintarEstatistica(resumo);
    } else {
      const resumo = await new Promise((resolver, rejeitar) => {
        const w = chkGarantirTrabalhador();
        w.onmessage = ({ data }) => {
          if (data.tipo === 'andamento') chkPintarAndamento(data.feitos, data.total);
          else if (data.tipo === 'pronto') resolver(data.resumo);
          else if (data.tipo === 'erro') rejeitar(new Error(data.mensagem));
        };
        w.onerror = (e) => rejeitar(new Error(e.message || 'falha na simulação'));
        // Uma cópia das máscaras: transferir o original deixaria a tela sem
        // elas para a próxima conferência.
        w.postMessage({ tipo: 'simular', mascaras: chkMascaras.slice(), quantos });
      });
      chkPintarEstatistica(resumo);
    }
  } catch (erro) {
    $('chk-andamento').hidden = false;
    $('chk-andamento').innerHTML = `<b>A simulação falhou.</b> <em>${escapar(
      erro.message
    )}</em>`;
  } finally {
    chkSimulando = false;
    $('chk-simular').disabled = false;
  }
}

/* ─────────── ligações da tela ─────────── */

ligar('chk-fechamento', 'change', (e) => chkSelecionar(e.target.value));

ligar('chk-conferir', 'click', () => {
  const lido = checagem.interpretarResultado($('chk-resultado').value);
  if (lido.erro) {
    chkMostrarErro(lido.erro);
    return;
  }
  chkConferir(lido.dezenas);
});

ligar('chk-sortear', 'click', () => {
  const dezenas = checagem.sortearResultado();
  $('chk-resultado').value = dezenas.map((d) => String(d).padStart(2, '0')).join(' ');
  chkConferir(dezenas);
  // Depois do primeiro, o botão passa a se chamar pelo que ele de fato faz
  // agora: sortear outro. "Simular sorteio" com um sorteio já na tela sugere
  // que ele faria outra coisa.
  $('chk-sortear').textContent = 'Novo sorteio';
});

ligar('chk-mais', 'click', chkMostrarMaisCartelas);
ligar('chk-simular', 'click', chkSimularVarios);

ligar('res-checar', 'click', () => abrirChecagem('busca'));
ligar('lot-checar', 'click', () => abrirChecagem('lotinha'));

/** Abre a ferramenta já com um fechamento escolhido. */
function abrirChecagem(chave) {
  chkPreferida = chave;
  mostrarPainel('checar');
}

/**
 * Repinta a lista de fechamentos, se ela mudou.
 *
 * Repintar sem necessidade apagaria a conferência que a pessoa acabou de fazer
 * — sair para o Resultado e voltar não pode custar o trabalho.
 */
function chkAtualizarFontes() {
  const chaves = chkFontes()
    .map((f) => `${f.chave}#${f.cartelas.length}`)
    .join('|');
  const pedida = chkPreferida;
  chkPreferida = null;

  if (chaves === chkChavesPintadas && !pedida) return;
  chkChavesPintadas = chaves;
  chkPintarSeletor(pedida);
}

aoIniciar('a tela de Checar', () => {
  chkPintarQuantos();
  chkAtualizarFontes();
});

/* ─────────── manter a tela ligada ─────────── */

/*
 * Quando a tela do iPhone apaga, o Safari congela a página e a busca para.
 * A API de Wake Lock (Safari 16.4 em diante) evita isso enquanto o usuário
 * quiser. O sistema solta a trava sozinho se a aba sair de foco, então é
 * preciso repedi-la ao voltar.
 */
async function segurarTelaLigada() {
  if (!$('manter-tela').checked || !('wakeLock' in navigator)) return;
  try {
    travaDeTela = await navigator.wakeLock.request('screen');
  } catch {
    /* o sistema pode recusar, por exemplo com bateria baixa */
  }
}

function soltarTelaLigada() {
  travaDeTela?.release?.();
  travaDeTela = null;
}

ligar('manter-tela', 'change', () => {
  if ($('manter-tela').checked && fase === 'buscando') segurarTelaLigada();
  else soltarTelaLigada();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && fase === 'buscando') segurarTelaLigada();
});

if (!('wakeLock' in navigator)) {
  $('manter-tela').disabled = true;
  $('aviso-tela').textContent =
    'Este navegador não permite manter a tela ligada. A busca pausa quando a tela apaga e continua quando você volta — o progresso fica salvo.';
}

/* ─────────── avisos ─────────── */

let tempoDoAviso = null;

function avisar(mensagem, bom = false) {
  const caixa = $('aviso');
  caixa.textContent = mensagem;
  caixa.classList.toggle('bom', bom);
  caixa.hidden = false;
  clearTimeout(tempoDoAviso);
  tempoDoAviso = setTimeout(() => (caixa.hidden = true), 5000);
}

/* ─────────── partida ─────────── */

pintarRecordes();
definirFase('ocioso');

// Traz a busca única da versão anterior para dentro do histórico, para quem
// já usava o aplicativo não perder o trabalho em andamento na atualização.
historico.migrarDaVersaoAntiga();
pintarHistorico();

/* ─────────── atualização do aplicativo ─────────── */

/*
 * O service worker faz o aplicativo abrir sem internet — e, mal configurado,
 * faz o usuário ficar preso numa versão antiga para sempre. Foi o que
 * aconteceu: uma correção era publicada, chegava ao servidor, e o aparelho
 * continuava servindo a cópia guardada, sem sinal nenhum de que havia algo
 * novo.
 *
 * Três medidas fecham essa porta, e nenhuma depende de o usuário fazer nada:
 *
 * - `updateViaCache: 'none'` impede que o próprio `sw.js` venha do cache do
 *   navegador. Se ele viesse, a atualização nunca seria percebida.
 * - `update()` a cada abertura força a verificação, em vez de esperar a
 *   heurística do navegador.
 * - Quando a versão nova assume o controle, a página recarrega uma vez
 *   sozinha. Sem isso, o usuário veria o código antigo até fechar e abrir de
 *   novo por conta própria — e não teria como saber que precisava.
 */
if ('serviceWorker' in navigator) {
  // Guardado antes de qualquer registro: numa primeira visita não existe
  // controlador, e a tomada de controle inicial não deve provocar recarga.
  const jaEraControlada = Boolean(navigator.serviceWorker.controller);
  let recarregando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaEraControlada || recarregando) return;
    recarregando = true;
    location.reload();
  });

  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.tipo === 'versao') mostrarVersao(data.versao);
  });

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registro) => {
      registro.update().catch(() => {});
      perguntarVersao();
    })
    .catch(() => {});

  // A versão é perguntada de novo a cada troca de controlador, para o número
  // na tela acompanhar a atualização em vez de ficar mostrando a anterior.
  navigator.serviceWorker.addEventListener('controllerchange', perguntarVersao);
} else {
  mostrarVersao(null);
}

/**
 * Pergunta ao service worker em que versão ele está.
 *
 * Espera por `ready` de propósito: numa primeira visita ainda não existe
 * controlador, e perguntar naquele instante seria falar com ninguém — o número
 * simplesmente nunca apareceria. `ready` resolve quando há um service worker
 * ativo, controlando esta página ou não.
 */
async function perguntarVersao() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registro = await navigator.serviceWorker.ready;
    (navigator.serviceWorker.controller ?? registro.active)?.postMessage({ tipo: 'versao' });
  } catch {
    /* sem service worker: a versão fica em branco, e nada mais é afetado */
  }
}

/**
 * Mostra qual versão está de fato rodando no aparelho.
 *
 * Serve para responder, sem adivinhação, à pergunta "a correção chegou aqui?".
 * Sem esse número, a única forma de saber era comparar comportamentos — que é
 * exatamente o que falha quando o cache serve código velho.
 */
function mostrarVersao(versao) {
  const destino = $('versao');
  if (!destino) return;
  destino.textContent = versao ? `versão ${versao.replace('sonho-lucido-', '')}` : '';
}
