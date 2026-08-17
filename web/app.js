/*
 * A interface.
 *
 * Não faz conta nenhuma: toda a matemática está no WebAssembly, dentro do
 * worker. Aqui só existe o que é de interface — trocar de aba, formatar
 * número, guardar o progresso e conversar com o worker.
 */

const $ = (id) => document.getElementById(id);

/* ─────────── estado da página ─────────── */

let trabalhador = null;
let rodando = false;
let recordes = [];
let melhorCartelas = [];
let travaDeTela = null;
const CHAVE_SALVO = 'sonho-lucido:busca';

/* ─────────── formatação ─────────── */

const milhares = (n) => Math.round(n).toLocaleString('pt-BR');
const porcento = (f) => `${(f * 100).toFixed(1).replace('.', ',')}%`;

/** `C(n, k)` em ponto flutuante — só para estimar o tamanho do problema. */
function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < k; i++) total = (total * (n - i)) / (i + 1);
  return total;
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
      case 'criado':
        aplicarEstado(data.estado);
        mostrarPainel('buscar');
        trabalhador.postMessage({ tipo: 'rodar' });
        rodando = true;
        $('pausar').textContent = 'Pausar';
        break;

      case 'estado':
        aplicarEstado(data.estado);
        break;

      case 'encerrado':
        aplicarEstado(data.estado);
        rodando = false;
        $('pausar').textContent = 'Continuar';
        soltarTelaLigada();
        avisar('Ótimo provado — não existe solução melhor.', true);
        break;

      case 'pausado':
        aplicarEstado(data.estado);
        break;

      case 'exportado':
        if (data.estado) localStorage.setItem(CHAVE_SALVO, data.estado);
        break;

      case 'erro':
        rodando = false;
        $('pausar').textContent = 'Continuar';
        avisar(data.mensagem);
        break;

      default:
        break;
    }
  };

  trabalhador.onerror = (erro) => {
    avisar(`Falha no motor: ${erro.message || 'erro desconhecido'}`);
  };

  return trabalhador;
}

/* ─────────── pintar a tela ─────────── */

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

  $('selo-otimo').hidden = !estado.optimalidade_provada;

  if (estado.novos_recordes?.length) {
    recordes = [...estado.novos_recordes.reverse(), ...recordes].slice(0, 40);
    pintarRecordes();
    pedirMelhorSolucao();
    // Cada recorde é gravado na hora. Se a aba morrer — e no celular ela morre
    // com frequência — o que já foi encontrado continua aqui.
    trabalhador.postMessage({ tipo: 'exportar' });
  }

  $('res-cartelas').textContent = estado.melhor_cartelas || '—';
  $('res-cobertura').textContent = porcento(estado.melhor_cobertura);
  $('res-redundancia').textContent = milhares(estado.melhor_redundancia);
}

function pintarRecordes() {
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

/*
 * As cartelas em si só são pedidas quando há um recorde novo. Trazê-las a cada
 * lote seria atravessar a fronteira dezenas de vezes por segundo para redesenhar
 * exatamente a mesma lista.
 */
let pedidoDeSolucao = null;

function pedirMelhorSolucao() {
  clearTimeout(pedidoDeSolucao);
  pedidoDeSolucao = setTimeout(() => {
    const salvo = localStorage.getItem(CHAVE_SALVO);
    if (!salvo) return;
    try {
      melhorCartelas = JSON.parse(salvo).melhor || [];
      pintarCartelas();
    } catch {
      /* estado salvo corrompido: a próxima gravação corrige */
    }
  }, 120);
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

  recordes = [];
  melhorCartelas = [];
  pintarRecordes();
  pintarCartelas();
  localStorage.removeItem(CHAVE_SALVO);

  garantirTrabalhador().postMessage({ tipo: 'criar', configuracao });
  segurarTelaLigada();
});

$('pausar').addEventListener('click', () => {
  if (!trabalhador) return;
  if (rodando) {
    trabalhador.postMessage({ tipo: 'pausar' });
    trabalhador.postMessage({ tipo: 'exportar' });
    rodando = false;
    $('pausar').textContent = 'Continuar';
    soltarTelaLigada();
  } else {
    trabalhador.postMessage({ tipo: 'rodar' });
    rodando = true;
    $('pausar').textContent = 'Pausar';
    segurarTelaLigada();
  }
});

$('reiniciar').addEventListener('click', () => mostrarPainel('configurar'));

$('retomar').addEventListener('click', () => {
  const salvo = localStorage.getItem(CHAVE_SALVO);
  if (!salvo) return;

  try {
    const estado = JSON.parse(salvo);
    recordes = [];
    melhorCartelas = estado.melhor || [];
    pintarCartelas();
    garantirTrabalhador().postMessage({
      tipo: 'criar',
      configuracao: estado.configuracao,
      salvo,
    });
    segurarTelaLigada();
  } catch {
    avisar('A busca salva está corrompida. Comece uma nova.');
    localStorage.removeItem(CHAVE_SALVO);
  }
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
  if ($('manter-tela').checked && rodando) segurarTelaLigada();
  else soltarTelaLigada();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rodando) segurarTelaLigada();
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

// O service worker é o que faz o aplicativo abrir sem internet depois da
// primeira visita. A ausência dele não impede nada de funcionar.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
