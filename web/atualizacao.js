/*
 * Versão e atualização: o que está rodando aqui, e o que está publicado lá.
 *
 * ## Por que não basta chamar `registro.update()`
 *
 * A tentação é ligar o botão "Buscar atualizações" direto ao `update()` do
 * service worker e relatar o que ele devolver. Não serve, por dois motivos que
 * levam à mesma consequência — dizer "tudo em dia" sem ter perguntado a
 * ninguém:
 *
 * 1. `update()` resolve igual nos dois casos. Ele não devolve "achei" nem "não
 *    achei"; ele resolve quando a verificação termina, tenha ela encontrado
 *    algo ou não. Quem só ouve o `update()` não sabe o que dizer ao usuário.
 *
 * 2. Sem internet ele falha calado. Uma tela que trate a falha como ausência
 *    de novidade afirma que não há atualização justamente quando não teve como
 *    olhar — e essa é a única resposta que não se pode dar de graça.
 *
 * Por isso a verificação é feita de fora: busca-se o `sw.js` publicado, lê-se o
 * carimbo de dentro dele, e compara-se com o carimbo do service worker que
 * controla esta página. São dois números concretos, e a tela mostra os dois.
 *
 * ## A armadilha do cache
 *
 * O `sw.js` buscado não pode vir do cache — se viesse, a comparação seria do
 * carimbo guardado com ele mesmo, e daria "em dia" para sempre, inclusive sem
 * internet. Três defesas, porque uma só já falhou antes neste projeto:
 *
 * - `cache: 'no-store'` na requisição, contra o cache HTTP do navegador;
 * - o service worker não serve a si mesmo (veja `sw.js`), contra o cache dele;
 * - uma marca de tempo na busca, para que nem por acidente exista cópia
 *   guardada daquele endereço exato.
 *
 * E, antes de tudo isso, `navigator.onLine === false` já responde "não deu para
 * verificar" sem gastar uma requisição.
 */

const PREFIXO = 'sonho-lucido-';

/** O carimbo sozinho, sem o prefixo com que o service worker nomeia o cache. */
export function semPrefixo(versao) {
  const limpo = String(versao ?? '').replace(PREFIXO, '').trim();
  return limpo || null;
}

/**
 * Lê o carimbo de dentro do texto de um `sw.js`.
 *
 * É a mesma linha que `construir-web.sh` carimba, e por isso o valor lido aqui
 * é exatamente o que o service worker publicado vai anunciar depois de
 * instalado — não uma aproximação dele.
 */
export function carimboDe(texto) {
  return /const CARIMBO = '([^']+)'/.exec(String(texto ?? ''))?.[1] ?? null;
}

/**
 * Pergunta ao service worker que controla esta página em que versão ele está.
 *
 * Espera por `ready` de propósito: numa primeira visita ainda não existe
 * controlador, e perguntar naquele instante seria falar com ninguém. O prazo
 * existe para o caso de o worker estar vivo mas não responder — sem ele a tela
 * ficaria em "verificando…" para sempre, que é pior do que uma resposta ruim.
 */
export function versaoDaqui({ espera = 5000 } = {}) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);

  return new Promise((responder) => {
    let respondido = false;

    const terminar = (valor) => {
      if (respondido) return;
      respondido = true;
      navigator.serviceWorker.removeEventListener('message', ouvir);
      clearTimeout(relogio);
      responder(valor);
    };

    const ouvir = ({ data }) => {
      if (data?.tipo === 'versao') terminar(semPrefixo(data.versao));
    };

    const relogio = setTimeout(() => terminar(null), espera);
    navigator.serviceWorker.addEventListener('message', ouvir);

    navigator.serviceWorker.ready
      .then((registro) => {
        const alvo = navigator.serviceWorker.controller ?? registro.active;
        if (alvo) alvo.postMessage({ tipo: 'versao' });
        else terminar(null);
      })
      .catch(() => terminar(null));
  });
}

/**
 * Vai ao servidor e responde uma de quatro coisas.
 *
 * - `em-dia`          — o publicado é o mesmo que está rodando aqui;
 * - `ha-novidade`     — o publicado é outro, e `publicado` diz qual;
 * - `sem-resposta`    — não deu para perguntar (sem internet, ou servidor fora);
 * - `sem-guardado`    — o servidor respondeu, mas este navegador não guarda o
 *                       aplicativo, então não há versão local a comparar.
 *
 * Nenhuma delas é um palpite: `sem-resposta` é dito quando não se sabe, e é
 * essa distinção que faz o botão valer alguma coisa.
 */
export async function procurar() {
  const daqui = await versaoDaqui();

  if (navigator.onLine === false) {
    return { situacao: 'sem-resposta', daqui, publicado: null };
  }

  let publicado = null;
  try {
    const resposta = await fetch(`./sw.js?conferindo=${Date.now()}`, { cache: 'no-store' });
    if (resposta.ok) publicado = carimboDe(await resposta.text());
  } catch {
    publicado = null;
  }

  if (!publicado) return { situacao: 'sem-resposta', daqui, publicado: null };
  if (!daqui) return { situacao: 'sem-guardado', daqui: null, publicado };
  return { situacao: publicado === daqui ? 'em-dia' : 'ha-novidade', daqui, publicado };
}

/**
 * Manda instalar o que está publicado.
 *
 * O `skipWaiting` mora dentro do `install` do service worker, então a troca
 * normalmente acontece sozinha e a página recarrega pelo `controllerchange`. A
 * mensagem `assumir` cobre o caso em que ela não aconteceu: um worker parado em
 * `waiting` deixaria o usuário com o botão pressionado e nada mudando na tela.
 *
 * ## Rejeição de `update()` não é fracasso
 *
 * Medido: o `update()` **rejeita** quando a versão nova assume o controle antes
 * de ele terminar — e assumir o controle é exatamente o que se pediu. Tratando
 * a rejeição como erro, a tela dizia "não deu para instalar daqui" no mesmo
 * segundo em que a instalação dava certo, e apagava o bilhete que ia contar ao
 * usuário, depois da recarga, que tinha dado.
 *
 * Por isso a única falha que esta função relata é não haver registro nenhum
 * para atualizar. O veredito verdadeiro vem depois da recarga, comparando a
 * versão que chegou com a que se foi buscar — que é evidência, e não promessa.
 */
export async function aplicar() {
  if (!('serviceWorker' in navigator)) return false;

  const registro = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!registro) return false;

  try {
    await registro.update();
  } catch {
    /* a troca no meio do caminho: veja acima */
  }

  try {
    registro.waiting?.postMessage({ tipo: 'assumir' });
  } catch {
    /* registro já substituído: a troca aconteceu, que era o objetivo */
  }

  return true;
}

/**
 * O registro padrão do service worker, igual em todas as telas da plataforma.
 *
 * As três medidas que fazem uma correção publicada chegar ao aparelho, e
 * nenhuma delas depende de o usuário fazer nada:
 *
 * - `updateViaCache: 'none'` impede que o próprio `sw.js` venha do cache do
 *   navegador. Se viesse, a atualização nunca seria percebida.
 * - `update()` a cada abertura força a verificação, em vez de esperar a
 *   heurística do navegador.
 * - quando a versão nova assume, a página recarrega uma vez sozinha. Sem isso o
 *   usuário veria o código antigo até fechar e abrir por conta própria — e não
 *   teria como saber que precisava.
 *
 * A trava `jaEraControlada` é o que impede a recarga na primeira visita, quando
 * a tomada de controle é a normal e não uma troca de versão.
 */
export function registrar({ aoSaberAVersao, recarregar = true } = {}) {
  if (!('serviceWorker' in navigator)) {
    aoSaberAVersao?.(null);
    return;
  }

  const jaEraControlada = Boolean(navigator.serviceWorker.controller);
  let recarregando = false;

  const contar = () => versaoDaqui().then((versao) => aoSaberAVersao?.(versao));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    contar();
    if (!recarregar || !jaEraControlada || recarregando) return;
    recarregando = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((registro) => {
      registro.update().catch(() => {});
      contar();
    })
    .catch(() => aoSaberAVersao?.(null));
}
