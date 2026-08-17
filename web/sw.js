/*
 * Service worker — é o que faz o aplicativo abrir sem internet.
 *
 * ## O erro que esta versão corrige
 *
 * A primeira versão tinha um nome de cache fixo (`sonho-lucido-v1`) e servia
 * tudo pelo cache antes de tentar a rede. O efeito: quem tivesse aberto o
 * aplicativo uma vez ficava preso naquela versão para sempre. Publicações
 * novas chegavam ao servidor e nunca ao aparelho — e do lado do usuário isso
 * parece que nada foi corrigido.
 *
 * A causa raiz é sutil: o navegador só dispara a atualização de um service
 * worker quando os **bytes deste arquivo** mudam. Com o nome do cache escrito
 * à mão, esquecer de trocá-lo — o que é questão de tempo — congela o
 * aplicativo de todos os usuários.
 *
 * ## As três defesas
 *
 * 1. O carimbo abaixo é substituído a cada construção por um resumo do
 *    conteúdo do site. Ninguém precisa lembrar de nada: se algum arquivo
 *    mudou, este arquivo muda junto, e o navegador percebe.
 *
 * 2. O que define a aparência e o comportamento — página, script, estilo —
 *    é buscado **na rede primeiro**, com o cache como reserva. Assim, mesmo
 *    numa transição em que o service worker antigo ainda manda, o usuário
 *    recebe o conteúdo novo. Só o que é grande e imutável dentro de uma
 *    construção (WebAssembly, ícones) vem do cache primeiro.
 *
 * 3. `skipWaiting` e `clients.claim` fazem a versão nova assumir na hora, sem
 *    esperar todas as abas fecharem. A página escuta essa troca e recarrega
 *    sozinha uma vez.
 */

// Substituído por `construir-web.sh`. O valor literal só aparece em
// desenvolvimento, quando o site é servido direto de `web/`.
const CARIMBO = '__CARIMBO_DA_CONSTRUCAO__';
const VERSAO = `sonho-lucido-${CARIMBO}`;

/*
 * A lista é gerada por `construir-web.sh` a partir do que existe de fato em
 * `site/`, e não escrita à mão.
 *
 * O motivo: escrita à mão, ela sai de sincronia no dia em que alguém acrescenta
 * um arquivo — foi o que aconteceu com `historico.js`, que o `app.js` importa e
 * que ficou de fora. Um módulo faltando no cache derruba o aplicativo inteiro
 * sem internet, porque uma importação que falha impede o módulo que a fez de
 * carregar.
 *
 * O valor literal só aparece em desenvolvimento, quando o site é servido direto
 * de `web/`; nesse caso a lista fica vazia e tudo é buscado sob demanda.
 */
const ARQUIVOS = ['./', ...__ARQUIVOS_DA_CONSTRUCAO__];

/** Caminhos cujo conteúdo define o que o usuário vê e como o app se comporta. */
function ehDoAplicativo(url) {
  return /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then(async (cache) => {
      // `addAll` falha inteiro se um arquivo faltar. Guardar um a um deixa o
      // aplicativo utilizável mesmo que algum recurso opcional não venha.
      await Promise.all(ARQUIVOS.map((arquivo) => cache.add(arquivo).catch(() => {})));
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    ehDoAplicativo(url) ? redePrimeiro(requisicao) : cachePrimeiro(requisicao)
  );
});

/**
 * Tenta a rede; se ela falhar, recorre ao cache.
 *
 * É o que garante que uma correção publicada chegue ao usuário na próxima vez
 * que ele abrir o aplicativo com internet, sem deixar de funcionar offline.
 */
async function redePrimeiro(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      const cache = await caches.open(VERSAO);
      cache.put(requisicao, resposta.clone());
    }
    return resposta;
  } catch {
    const guardado = await caches.match(requisicao);
    return guardado ?? caches.match('./index.html');
  }
}

/**
 * Serve do cache; só vai à rede se não houver cópia.
 *
 * Para o WebAssembly e os ícones, que são grandes e não mudam dentro de uma
 * mesma construção. Quando a construção muda, o carimbo muda, o cache inteiro
 * é recriado e estes arquivos são buscados de novo.
 */
async function cachePrimeiro(requisicao) {
  const guardado = await caches.match(requisicao);
  if (guardado) return guardado;

  const resposta = await fetch(requisicao);
  if (resposta.ok) {
    const cache = await caches.open(VERSAO);
    cache.put(requisicao, resposta.clone());
  }
  return resposta;
}

// A página pode perguntar em que versão está — útil para conferir, de fora,
// se uma publicação chegou mesmo ao aparelho.
self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'versao') {
    evento.source?.postMessage({ tipo: 'versao', versao: VERSAO });
  }
});
