// Quanto tempo a tela leva para responder numa rede ruim.
//
// A especificação pede **primeira renderização útil em menos de 1 s em 3G
// rápido**, e essa era a única promessa do projeto que vivia como frase num
// documento, sem jeito de conferir. Todo outro número — preço, quantidade de
// bilhetes, garantia — é recalculado do catálogo e cobrado em CI. Este ficava
// no boca a boca de quem mediu uma vez.
//
//     node ferramentas/medir-3g.mjs [publicar]
//
// A medição só vale se as condições forem as do GitHub Pages, e não as de um
// servidor de arquivos qualquer:
//
//   - **HTTP/2**, porque é o que muda o custo de pedir dez arquivos em vez de
//     um. Medido em HTTP/1.1, as dicas de `modulepreload` não mostravam ganho
//     nenhum — foi o que aconteceu na primeira tentativa, e quase enterrou uma
//     otimização que funciona.
//   - **Compressão**, porque 40 KiB comprimidos e 200 KiB crus são redes
//     diferentes.
//   - A rede "3G rápido" do próprio Chrome: 1,6 Mbps de descida, 750 kbps de
//     subida e **562,5 ms** de ida e volta. A latência é o que domina: com dois
//     saltos encadeados, o piso é 1,13 s antes de transferir um byte.
//
// O certificado é gerado na hora e o navegador é instruído a aceitá-lo. Não há
// segredo nele: é um servidor de arquivos que vive por trinta segundos.

import { spawnSync } from 'node:child_process';
import { createSecureServer } from 'node:http2';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const RAIZ = new URL(`../${process.argv[2] ?? 'publicar'}`, import.meta.url).pathname;

// A rede "3G rápido" do Chrome, nos valores que o próprio DevTools usa.
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

const pasta = mkdtempSync(join(tmpdir(), 'medir-3g-'));
spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-keyout', join(pasta, 'k.pem'), '-out', join(pasta, 'c.pem')],
{ stdio: 'ignore' });

const servidor = createSecureServer({
  key: await readFile(join(pasta, 'k.pem')),
  cert: await readFile(join(pasta, 'c.pem')),
});

let pedidos = 0;
servidor.on('stream', async (fluxo, cabecalhos) => {
  pedidos++;
  let relativo = decodeURIComponent(cabecalhos[':path']).split('?')[0].slice(1) || 'index.html';
  if (relativo.endsWith('/')) relativo += 'index.html';
  const tipo = extname(relativo);
  try {
    const corpo = await readFile(join(RAIZ, normalize(`/${relativo}`)));
    const comprimir = COMPRIME.has(tipo);
    fluxo.respond({
      ':status': 200,
      'content-type': TIPOS[tipo] ?? 'application/octet-stream',
      ...(comprimir ? { 'content-encoding': 'gzip' } : {}),
      // O que o GitHub Pages manda. Fica por fidelidade, e não pelo efeito:
      // medido dos dois jeitos, `no-store` e `max-age=600` dão a mesma
      // contagem de pedidos — o service worker rebaixa a casca inteira ao
      // instalar de qualquer forma. Esta linha já teve um comentário dizendo
      // o contrário; a medição desmentiu, e é a medição que vale.
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

// A estrangulação é do protocolo de depuração, e não do Playwright: é a mesma
// que o painel de rede do Chrome aplica quando se escolhe "Fast 3G".
const cdp = await contexto.newCDPSession(pagina);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', TRES_G);

const comeco = Date.now();
await pagina.goto(endereco, { waitUntil: 'commit' });

// Três marcos, do menos ao mais útil: a primeira tinta na tela, a grade pronta
// para receber um toque, e a resposta — que é a única que interessa a quem usa.
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
// O caminho crítico é o que **a página** pediu para chegar até aqui, e quem
// sabe isso é a própria página. Contar no servidor mistura nela a instalação do
// service worker, que rebaixa a casca inteira logo depois da resposta e não
// atrasa ninguém: o número dobra sem que nada tenha piorado. Os dois vão para a
// tela, separados, porque os dois dizem coisas diferentes — um é o que a pessoa
// espera, o outro é o que a rede dela paga.
const noCaminho = await pagina.evaluate(
  () => performance.getEntriesByType('resource').length + 1);

const linha = (nome, ms) => `  ${nome.padEnd(22)} ${String(ms).padStart(5)} ms`;
console.log(`3G rápido (1,6 Mbps, ${TRES_G.latency} ms de ida e volta) · ${RAIZ.split('/').pop()}/`);
console.log(linha('primeira pintura', pintura));
console.log(linha('grade tocável', grade));
console.log(linha('resposta na tela', resposta));
console.log(`  ${'pedidos até a resposta'.padEnd(22)} ${String(noCaminho).padStart(5)}`);
console.log(`  ${'pedidos no total'.padEnd(22)} ${String(pedidos).padStart(5)}`);
// O piso: duas idas e voltas encadeadas — o HTML, e tudo o que ele referencia.
console.log(`  ${'piso de duas voltas'.padEnd(22)} ${String(Math.round(2 * TRES_G.latency)).padStart(5)} ms`);

await navegador.close();
servidor.close();
