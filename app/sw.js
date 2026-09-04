// Funcionar no avião, na segunda visita.
//
// O carimbo é derivado do conteúdo publicado: qualquer byte diferente muda o
// nome do cache, o navegador baixa tudo de novo e a versão velha é apagada.
// Quem mantém o projeto confere o carimbo no rodapé para saber se o que está na
// mão da pessoa é o que acabou de ser publicado.
const CARIMBO = 'dev';

// A casca do aplicativo mais o índice, que é o que decide qualquer resposta.
// Os arquivos de fechamento não entram aqui: são mais de trezentos, e cada
// pessoa usa um punhado. Ficam em cache conforme forem pedidos.
const CASCA = ['./', 'index.html', 'app.js', 'catalogo.js', 'conferir.js', 'estrategia.js',
  'volante.js', 'estilo.css', 'manifest.webmanifest', 'icone.svg',
  'catalogo/indice.json', 'catalogo/precos.json', 'catalogo/acaso.json'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CARIMBO)
      .then((cache) => cache.addAll(CASCA))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CARIMBO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== location.origin) return;

  // O catálogo é imutável por construção: um arquivo de fechamento nunca muda
  // de conteúdo sem mudar de publicação. Cache primeiro, sem nem tentar a rede.
  //
  // Para o resto vale a rede primeiro com o cache atrás: uma correção
  // publicada chega no mesmo instante, e falta de rede nunca apaga a tela.
  const doCatalogo = pedido.url.includes('/catalogo/f/');

  evento.respondWith(
    doCatalogo
      ? caches.match(pedido).then((guardado) => guardado ?? buscarEGuardar(pedido))
      : buscarEGuardar(pedido).catch(
          () => caches.match(pedido).then((g) => g ?? caches.match('index.html')),
        ),
  );
});

async function buscarEGuardar(pedido) {
  const resposta = await fetch(pedido);
  if (resposta.ok) {
    const cache = await caches.open(CARIMBO);
    cache.put(pedido, resposta.clone());
  }
  return resposta;
}
