// Quanto custa a **segunda** visita.
//
// `medir-3g.mjs` mede quem chega pela primeira vez, e é a medida que estava na
// especificação. Mas a promessa do service worker é sobre a volta — "depois
// disso o aplicativo funciona sem ela", diz a tela —, e essa metade nunca foi
// medida. Quem usa o aplicativo abre-o de novo antes do sorteio seguinte, e é
// nessa visita que ele passa a maior parte da vida.
//
//     node ferramentas/medir-volta.mjs [publicar]
//
// O procedimento: uma visita para instalar o service worker e encher o cache,
// espera até ele estar no controle, e então a visita que se mede — com a
// mesma rede 3G rápido da outra ferramenta, no mesmo contexto de navegador,
// para o cache do service worker sobreviver.
//
// **Entre uma e outra, o cache HTTP do navegador é apagado**, e isso é o ponto
// da medição. Sem apagar, a segunda visita acontece segundos depois da
// primeira, tudo ainda cabe dentro do `max-age=600` que o GitHub Pages manda, e
// o número que sai é o de quem recarregou a página — não o de quem voltou no
// dia seguinte, que é quem o service worker existe para atender. O cache do
// service worker é outro armazenamento e não é tocado por essa limpeza: sobra
// exatamente o estado de quem volta depois.

import { spawnSync } from 'node:child_process';
import { createSecureServer } from 'node:http2';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const RAIZ = new URL(`../${process.argv[2] ?? 'publicar'}`, import.meta.url).pathname;

const TRES_G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 562.5,
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const COMPRIME = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);

const pasta = mkdtempSync(join(tmpdir(), 'medir-volta-'));
spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-keyout', join(pasta, 'k.pem'), '-out', join(pasta, 'c.pem')],
{ stdio: 'ignore' });

const servidor = createSecureServer({
  key: await readFile(join(pasta, 'k.pem')),
  cert: await readFile(join(pasta, 'c.pem')),
});

let pedidos = [];
servidor.on('stream', async (fluxo, cabecalhos) => {
  let relativo = decodeURIComponent(cabecalhos[':path']).split('?')[0].slice(1) || 'index.html';
  if (relativo.endsWith('/')) relativo += 'index.html';
  pedidos.push(relativo);
  const tipo = extname(relativo);
  try {
    const corpo = await readFile(join(RAIZ, normalize(`/${relativo}`)));
    const comprimir = COMPRIME.has(tipo);
    fluxo.respond({
      ':status': 200,
      'content-type': TIPOS[tipo] ?? 'application/octet-stream',
      ...(comprimir ? { 'content-encoding': 'gzip' } : {}),
      'cache-control': 'max-age=600',
    });
    fluxo.end(comprimir ? gzipSync(corpo) : corpo);
  } catch {
    fluxo.respond({ ':status': 404 });
    fluxo.end();
  }
});
await new Promise((pronto) => servidor.listen(0, pronto));
const endereco = `https://127.0.0.1:${servidor.address().port}/`;

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--ignore-certificate-errors'],
});
const contexto = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  ignoreHTTPSErrors: true,
});
const pagina = await contexto.newPage();
const cdp = await contexto.newCDPSession(pagina);
await cdp.send('Network.enable');

// ── a visita de instalação, sem estrangular: só interessa que termine ───────
await pagina.goto(endereco, { waitUntil: 'load' });
await pagina.waitForSelector('.resposta .aviso, .resposta .numero', { timeout: 60000 });
// O service worker no controle **e** a casca inteira no cache. Sem esperar as
// duas coisas, a medição de baixo pega uma instalação pela metade e mede outra
// coisa.
await pagina.waitForFunction(async () => {
  if (!navigator.serviceWorker.controller) return false;
  const nomes = await caches.keys();
  if (!nomes.length) return false;
  const cache = await caches.open(nomes[0]);
  return (await cache.keys()).length >= 14;
}, null, { timeout: 60000 });

// ── a visita que se mede ───────────────────────────────────────────────────
// O cache HTTP vai embora; o do service worker fica. É a volta no dia seguinte.
await cdp.send('Network.clearBrowserCache');
await cdp.send('Network.emulateNetworkConditions', TRES_G);
pedidos = [];
const comeco = Date.now();
await pagina.goto(endereco, { waitUntil: 'commit' });
const pintura = await pagina.evaluate(() => new Promise((pronto) => {
  new PerformanceObserver((lista, obs) => {
    const p = lista.getEntries().find((e) => e.name === 'first-contentful-paint');
    if (p) { obs.disconnect(); pronto(Math.round(p.startTime)); }
  }).observe({ type: 'paint', buffered: true });
}));
await pagina.waitForSelector('.grade button', { timeout: 60000 });
const grade = Date.now() - comeco;
await pagina.waitForSelector('.resposta .aviso, .resposta .numero', { timeout: 60000 });
const resposta = Date.now() - comeco;
// Quantos pedidos chegaram ao servidor **antes** de a resposta aparecer. É a
// conta que separa uma casca servida do cache de uma casca rebaixada de novo.
const ateAResposta = pedidos.length;

const linha = (nome, ms) => `  ${nome.padEnd(24)} ${String(ms).padStart(5)} ms`;
console.log(`segunda visita, 3G rápido (${TRES_G.latency} ms de ida e volta) · ${
  RAIZ.split('/').pop()}/`);
console.log(linha('primeira pintura', pintura));
console.log(linha('grade tocável', grade));
console.log(linha('resposta na tela', resposta));
console.log(`  ${'pedidos à rede'.padEnd(24)} ${String(ateAResposta).padStart(5)}`);
if (ateAResposta) console.log(`  ${''.padEnd(24)} ${pedidos.slice(0, 16).join(' ')}`);

await navegador.close();
servidor.close();
