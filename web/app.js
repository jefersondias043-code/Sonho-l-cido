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
 *                                          ↓
 *                                      concluida
 */

const $ = (id) => document.getElementById(id);

/* ─────────── estado da página ─────────── */

let trabalhador = null;
let fase = 'ocioso';
let recordes = [];
let melhorCartelas = [];
let travaDeTela = null;

/* O relógio é da interface, não do motor: mede o que o usuário esperou. */
let inicioDoTrecho = 0;
let tempoAcumulado = 0;
let cronometro = null;

const CHAVE_SALVO = 'sonho-lucido:busca';

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

/** `C(n, k)` em ponto flutuante — só para estimar o tamanho do problema. */
function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < k; i++) total = (total * (n - i)) / (i + 1);
  return total;
}

/* ─────────── situação e relógio ─────────── */

const SITUACOES = {
  ocioso: { classe: '', texto: 'parado' },
  carregando: { classe: 'trabalhando', texto: 'carregando o motor…' },
  preparando: { classe: 'trabalhando', texto: 'montando a primeira solução…' },
  buscando: { classe: 'trabalhando', texto: 'procurando soluções melhores' },
  pausado: { classe: 'pausada', texto: 'pausado' },
  concluida: { classe: 'concluida', texto: 'ótimo provado — não há melhor' },
  falhou: { classe: 'falhou', texto: 'algo deu errado' },
};

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
  $('pausar').disabled = ['ocioso', 'carregando', 'preparando', 'concluida', 'falhou'].includes(nova);
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
    a.classList.toggle('ativa', a.dataset.painel === nome);
  });
  document.querySelectorAll('.painel').forEach((p) => {
    p.classList.toggle('ativo', p.id === nome);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─────────── escolha da regra ─────────── */

let tipoDeRegra = 'cobrir';

document.querySelectorAll('#tipo-regra .opcao').forEach((botao) => {
  botao.addEventListener('click', () => {
    tipoDeRegra = botao.dataset.regra;
    document.querySelectorAll('#tipo-regra .opcao').forEach((b) => {
      b.classList.toggle('ativa', b === botao);
    });
    $('regra-cobrir').hidden = tipoDeRegra !== 'cobrir';
    $('regra-garantir').hidden = tipoDeRegra !== 'garantir';
    atualizarPrevisao();
  });
});

/** Lê a tela e devolve a configuração no formato que o motor espera. */
function lerConfiguracao() {
  const universo = Number($('universo').value);
  const tamanhoPool = Number($('pool').value);
  const cartela = Number($('cartela').value);

  const alvo = tipoDeRegra === 'cobrir' ? Number($('cobrir').value) : Number($('alvo').value);
  const intersecao =
    tipoDeRegra === 'cobrir' ? Number($('cobrir').value) : Number($('intersecao').value);

  const orcamentoBruto = $('orcamento').value.trim();

  return {
    universo,
    pool: Array.from({ length: tamanhoPool }, (_, i) => i + 1),
    cartela,
    alvo,
    intersecao,
    orcamento: orcamentoBruto === '' ? null : Number(orcamentoBruto),
    semente: Number($('semente').value) || 1,
  };
}

/* ─────────── previsão antes de começar ─────────── */

/*
 * Um celular tem muito menos memória que um computador, e o Safari do iOS não
 * avisa quando estoura: ele simplesmente recarrega a página. Por isso a conta é
 * feita aqui, na interface, antes de o motor ser criado.
 */
const ALVOS_CONFORTAVEIS = 2_000_000;
const ALVOS_ARRISCADOS = 8_000_000;

['universo', 'pool', 'cartela', 'cobrir', 'alvo', 'intersecao', 'orcamento'].forEach((id) => {
  $(id).addEventListener('input', atualizarPrevisao);
});

function atualizarPrevisao() {
  const c = lerConfiguracao();
  const destino = $('texto-previsao');
  const explicacao = tipoDeRegra === 'cobrir' ? $('explicacao-cobrir') : $('explicacao-garantir');

  if (tipoDeRegra === 'cobrir') {
    explicacao.textContent =
      `Toda combinação de ${c.alvo} números dentro do seu pool de ${c.pool.length} ` +
      `vai aparecer inteira em alguma cartela.`;
  } else {
    explicacao.textContent =
      `Se ${c.alvo} dos seus ${c.pool.length} números forem sorteados, ` +
      `alguma cartela terá pelo menos ${c.intersecao} deles.`;
  }

  const problemas = validar(c);
  if (problemas) {
    destino.innerHTML = `<strong style="color:var(--vermelho)">${problemas}</strong>`;
    $('iniciar').disabled = true;
    return;
  }

  const alvos = combinacoes(c.pool.length, c.alvo);
  const memoria = (alvos * 12) / 1e6;

  let recado;
  if (alvos > ALVOS_ARRISCADOS) {
    recado =
      `<strong style="color:var(--vermelho)">Pesado demais para um celular.</strong> ` +
      `São ${milhares(alvos)} combinações a cobrir (cerca de ${Math.round(memoria)} MB). ` +
      `Diminua o pool ou o tamanho do grupo a cobrir.`;
    $('iniciar').disabled = true;
  } else {
    if (alvos > ALVOS_CONFORTAVEIS) {
      recado =
        `<strong style="color:var(--ouro)">Vai puxar o aparelho.</strong> ` +
        `${milhares(alvos)} combinações a cobrir, cerca de ${Math.round(memoria)} MB. ` +
        `Deve funcionar, mas devagar.`;
    } else {
      recado = `${milhares(alvos)} combinações a cobrir. Tamanho tranquilo para o aparelho.`;
    }
    $('iniciar').disabled = false;
  }

  destino.innerHTML = recado;
}

function validar(c) {
  if (!(c.universo >= 1)) return 'O universo precisa ser pelo menos 1.';
  if (!(c.pool.length >= 1)) return 'O pool precisa ter pelo menos 1 número.';
  if (c.pool.length > c.universo) return 'O pool não pode ser maior que o universo.';
  if (c.pool.length > 128) return 'O pool máximo suportado é 128 números.';
  if (!(c.cartela >= 1)) return 'A cartela precisa ter pelo menos 1 número.';
  if (c.cartela > c.pool.length) return 'A cartela não pode ser maior que o pool.';
  if (!(c.alvo >= 1) || c.alvo > c.pool.length) return 'O grupo a cobrir precisa caber no pool.';
  if (!(c.intersecao >= 1) || c.intersecao > Math.min(c.alvo, c.cartela)) {
    return 'Os acertos garantidos precisam caber no grupo e na cartela.';
  }
  if (c.orcamento !== null && !(c.orcamento >= 1)) return 'O teto de cartelas precisa ser positivo.';
  return null;
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
        if (data.estado.encerrado) {
          definirFase('concluida');
          avisar('Ótimo provado já na primeira tentativa.', true);
        } else {
          trabalhador.postMessage({ tipo: 'rodar' });
          definirFase('buscando');
        }
        break;

      case 'estado':
        aplicarMensagem(data);
        if (fase === 'buscando') {
          $('texto-situacao').textContent = `procurando algo menor que ${data.estado.melhor_cartelas}`;
        }
        break;

      case 'otimo':
        aplicarMensagem(data);
        definirFase('concluida');
        soltarTelaLigada();
        avisar('Ótimo provado — não existe solução melhor.', true);
        break;

      case 'pausado':
        aplicarMensagem(data);
        definirFase('pausado');
        break;

      // O usuário mandou encerrar. O worker já devolveu tudo e liberou a
      // memória; aqui só resta desmontá-lo e voltar à configuração.
      case 'encerrado':
        aplicarMensagem(data);
        if (data.salvo) localStorage.setItem(CHAVE_SALVO, data.salvo);
        desmontarTrabalhador();
        definirFase('ocioso');
        zerarCronometro();
        soltarTelaLigada();
        $('retomar').hidden = !localStorage.getItem(CHAVE_SALVO);
        mostrarPainel('configurar');
        avisar('Busca encerrada. O resultado ficou salvo.', true);
        break;

      case 'exportado':
        if (data.estado) localStorage.setItem(CHAVE_SALVO, data.estado);
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
 * Atualiza a tela a partir de uma mensagem do worker.
 *
 * `cartelas` vem preenchido sempre que a solução mudou. Pintar a partir daqui
 * — e não de uma leitura posterior do armazenamento — é o que garante que a
 * aba Resultado mostre o que o painel de busca acabou de anunciar.
 */
function aplicarMensagem({ estado, cartelas }) {
  if (Array.isArray(cartelas)) {
    melhorCartelas = cartelas;
    pintarCartelas();
  }
  if (estado) aplicarEstado(estado);
}

function aplicarEstado(estado) {
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

  $('selo-otimo').hidden = !estado.optimalidade_provada;

  if (estado.novos_recordes?.length) {
    recordes = [...estado.novos_recordes.reverse(), ...recordes].slice(0, 40);
    pintarRecordes();
    // A gravação serve só para sobreviver ao fechamento da aba. As cartelas
    // exibidas não dependem dela: vieram na mesma mensagem que trouxe o
    // recorde.
    trabalhador?.postMessage({ tipo: 'exportar' });
  }

  $('res-cartelas').textContent = estado.melhor_cartelas || '—';
  $('res-cobertura').textContent = porcento(estado.melhor_cobertura);
  $('res-redundancia').textContent = milhares(estado.melhor_redundancia);
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

/* ─────────── botões ─────────── */

$('iniciar').addEventListener('click', () => {
  const configuracao = lerConfiguracao();
  const problema = validar(configuracao);
  if (problema) {
    avisar(problema);
    return;
  }

  comecar({ configuracao });
});

$('retomar').addEventListener('click', () => {
  const salvo = localStorage.getItem(CHAVE_SALVO);
  if (!salvo) return;

  try {
    const estado = JSON.parse(salvo);
    comecar({ configuracao: estado.configuracao, salvo }, estado.melhor || []);
  } catch {
    avisar('A busca salva está corrompida. Comece uma nova.');
    localStorage.removeItem(CHAVE_SALVO);
    $('retomar').hidden = true;
  }
});

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
function comecar({ configuracao, salvo }, cartelasIniciais = []) {
  // Um motor antigo ainda vivo continuaria consumindo processador e memória.
  desmontarTrabalhador();

  recordes = [];
  melhorCartelas = cartelasIniciais;
  pintarRecordes();
  pintarCartelas();
  if (!salvo) localStorage.removeItem(CHAVE_SALVO);

  ['melhor-cartelas', 'limite-inferior', 'gap', 'cobertura'].forEach((id) => {
    $(id).textContent = '—';
  });
  ['atual-cartelas', 'atual-descobertos', 'meta', 'elites', 'iteracoes', 'velocidade', 'recordes']
    .forEach((id) => {
      $(id).textContent = '—';
    });
  $('selo-otimo').hidden = true;

  zerarCronometro();
  mostrarPainel('buscar');
  definirFase('carregando');

  garantirTrabalhador().postMessage({ tipo: 'criar', configuracao, salvo });
  segurarTelaLigada();
}

$('pausar').addEventListener('click', () => {
  if (!trabalhador) return;

  if (fase === 'buscando') {
    trabalhador.postMessage({ tipo: 'pausar' });
    trabalhador.postMessage({ tipo: 'exportar' });
    soltarTelaLigada();
  } else if (fase === 'pausado') {
    trabalhador.postMessage({ tipo: 'rodar' });
    definirFase('buscando');
    segurarTelaLigada();
  }
});

$('encerrar').addEventListener('click', () => {
  if (!trabalhador) {
    definirFase('ocioso');
    mostrarPainel('configurar');
    return;
  }
  // O worker devolve o estado final e libera a memória; a resposta 'encerrado'
  // é quem desmonta tudo e traz o usuário de volta à configuração.
  definirFase('ocioso', 'encerrando…');
  trabalhador.postMessage({ tipo: 'encerrar' });
});

$('copiar').addEventListener('click', async () => {
  if (!melhorCartelas.length) return avisar('Nenhuma solução para copiar ainda.');
  try {
    await navigator.clipboard.writeText(textoDoFechamento());
    avisar('Cartelas copiadas.', true);
  } catch {
    avisar('O navegador não deixou copiar. Segure o dedo sobre as cartelas para selecionar.');
  }
});

$('compartilhar').addEventListener('click', async () => {
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
  const c = lerConfiguracao();
  const cabecalho =
    `# Sonho Lúcido — ${melhorCartelas.length} cartelas\n` +
    `# universo ${c.universo}, pool ${c.pool.length}, ${c.cartela} por cartela\n`;
  const corpo = melhorCartelas
    .map((cartela) => cartela.map((n) => String(n).padStart(2, '0')).join(' '))
    .join('\n');
  return `${cabecalho}${corpo}\n`;
}

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

$('manter-tela').addEventListener('change', () => {
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

atualizarPrevisao();
pintarRecordes();
definirFase('ocioso');

if (localStorage.getItem(CHAVE_SALVO)) {
  $('retomar').hidden = false;
  try {
    melhorCartelas = JSON.parse(localStorage.getItem(CHAVE_SALVO)).melhor || [];
    pintarCartelas();
  } catch {
    localStorage.removeItem(CHAVE_SALVO);
    $('retomar').hidden = true;
  }
}

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
