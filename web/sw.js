/*
 * Service worker — é o que faz o aplicativo abrir sem internet.
 *
 * Na primeira visita ele guarda tudo que o app precisa. Depois disso, o iPhone
 * abre direto do cache: sem espera, sem rede, funcionando no avião ou no
 * ônibus. Como o motor roda inteiro no aparelho, não existe nada que precise
 * do servidor depois desse primeiro download.
 *
 * A estratégia é "cache primeiro, rede como reserva". Trocar de versão invalida
 * tudo de uma vez — mais simples e mais seguro que tentar casar arquivos novos
 * com WebAssembly antigo.
 */

const VERSAO = 'sonho-lucido-v1';

const ARQUIVOS = [
  './',
  './index.html',
  './estilo.css',
  './app.js',
  './trabalhador.js',
  './manifest.webmanifest',
  './icone.svg',
  './icone-180.png',
  './wasm/motor_web.js',
  './wasm/motor_web_bg.wasm',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then(async (cache) => {
      // `addAll` falha inteiro se um arquivo faltar. Guardar um a um deixa o
      // aplicativo utilizável mesmo que algum recurso opcional não venha.
      await Promise.all(
        ARQUIVOS.map((arquivo) => cache.add(arquivo).catch(() => {}))
      );
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

  evento.respondWith(
    caches.match(requisicao).then((guardado) => {
      if (guardado) return guardado;

      return fetch(requisicao)
        .then((resposta) => {
          // Só guarda o que veio da própria origem e chegou inteiro.
          if (resposta.ok && resposta.type === 'basic') {
            const copia = resposta.clone();
            caches.open(VERSAO).then((cache) => cache.put(requisicao, copia));
          }
          return resposta;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
