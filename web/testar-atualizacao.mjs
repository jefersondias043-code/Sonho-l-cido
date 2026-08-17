/*
 * Teste da atualização automática.
 *
 * Reproduz o defeito que deixou o aplicativo congelado: uma correção era
 * publicada, chegava ao servidor, e o aparelho continuava servindo a versão
 * guardada — sem aviso nenhum de que havia algo novo.
 *
 * O roteiro simula exatamente isso:
 *
 *   1. abre o aplicativo, deixa o service worker assumir e guardar tudo;
 *   2. publica uma versão diferente por baixo, como faria uma correção real;
 *   3. reabre e exige que o conteúdo novo apareça sozinho.
 *
 * Sem esta última exigência, "corrigido" seria só uma afirmação.
 *
 *   ./construir-web.sh && node web/testar-atualizacao.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8127;
const BASE = '/Sonho-l-cido/';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function servir() {
  const servidor = createServer(async (req, res) => {
    try {
      let caminho = decodeURIComponent(req.url.split('?')[0]);
      if (!caminho.startsWith(BASE)) {
        res.writeHead(404).end('fora da base');
        return;
      }
      caminho = caminho.slice(BASE.length - 1);
      if (caminho.endsWith('/')) caminho += 'index.html';

      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
        // Sem cache HTTP: aqui o que interessa medir é o cache do service
        // worker, não o do navegador.
        'Cache-Control': 'no-store',
      });
      res.end(conteudo);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  });
  return new Promise((ok) => servidor.listen(PORTA, () => ok(servidor)));
}

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

/** Espera o service worker assumir o controle da página. */
async function esperarControle(pagina) {
  await pagina.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, {
    timeout: 20000,
  });
}

const lerVersao = (pagina) => pagina.locator('#versao').textContent();

const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

console.log('Teste da atualização automática\n');

const caminhoSw = join(RAIZ, 'sw.js');
const caminhoEstilo = join(RAIZ, 'estilo.css');
const swOriginal = await readFile(caminhoSw, 'utf8');
const estiloOriginal = await readFile(caminhoEstilo, 'utf8');

try {
  // ─── 1. a versão que o usuário já tem ───
  await pagina.goto(`http://localhost:${PORTA}${BASE}`, { waitUntil: 'networkidle' });
  await esperarControle(pagina);
  await pagina.waitForFunction(
    () => document.getElementById('versao').textContent.trim() !== '',
    undefined,
    { timeout: 15000 }
  );

  const versaoAntiga = (await lerVersao(pagina)).trim();
  marcar(
    /^versão [0-9a-f]{12}$/.test(versaoAntiga),
    'o aplicativo mostra qual versão está rodando',
    versaoAntiga
  );
  marcar(
    !swOriginal.includes('__CARIMBO_DA_CONSTRUCAO__'),
    'o service worker foi carimbado na construção'
  );

  // ─── 2. uma correção é publicada por baixo ───
  const marcaNova = '/* correcao-publicada-neste-teste */';
  await writeFile(caminhoEstilo, `${estiloOriginal}\n${marcaNova}\n`);
  await writeFile(caminhoSw, swOriginal.replace(/const CARIMBO = '[^']+'/, "const CARIMBO = 'aaaabbbbcccc'"));
  console.log('\n  … publicada uma versão nova enquanto o app estava aberto\n');

  // ─── 3. o aparelho precisa recebê-la sozinho ───
  await pagina.reload({ waitUntil: 'networkidle' });

  await pagina.waitForFunction(
    (anterior) => {
      const atual = document.getElementById('versao').textContent.trim();
      return atual !== '' && atual !== anterior;
    },
    versaoAntiga,
    { timeout: 30000 }
  );

  const versaoNova = (await lerVersao(pagina)).trim();
  marcar(
    versaoNova !== versaoAntiga,
    'a versão nova assume sozinha, sem o usuário fazer nada',
    `${versaoAntiga} → ${versaoNova}`
  );

  // E o conteúdo servido é mesmo o novo, não a cópia guardada.
  const estiloServido = await pagina.evaluate(async () => {
    const resposta = await fetch('./estilo.css', { cache: 'no-store' });
    return resposta.text();
  });
  marcar(
    estiloServido.includes('correcao-publicada-neste-teste'),
    'o conteúdo entregue é o novo, não o guardado em cache'
  );

  // E o aplicativo continua funcionando depois da troca.
  marcar(await pagina.locator('#iniciar').isEnabled(), 'o aplicativo segue utilizável após atualizar');

  // ─── 4. sem internet ───
  //
  // O defeito que isto cobre: a lista de arquivos guardados era escrita à mão,
  // e saiu de sincronia quando `historico.js` foi acrescentado. Um módulo
  // faltando no cache derruba o aplicativo inteiro offline — uma importação
  // que falha impede o módulo que a fez de carregar, e a tela fica em branco
  // sem erro visível para o usuário.
  await contexto.setOffline(true);
  await pagina.reload({ waitUntil: 'domcontentloaded' });

  marcar(await pagina.locator('h1').isVisible(), 'sem internet, o aplicativo abre');

  // Abrir não basta: os módulos precisam ter carregado de verdade. Se algum
  // faltasse, os ouvintes não existiriam e a tela não reagiria a nada.
  let offlineUtilizavel = true;
  try {
    await pagina.waitForFunction(
      () => document.getElementById('texto-previsao').textContent.includes('combinações'),
      undefined,
      { timeout: 10000 }
    );
    await pagina.click('.aba[data-painel="historico"]');
    await pagina.waitForSelector('#historico.ativo', { timeout: 5000 });
  } catch {
    offlineUtilizavel = false;
  }
  marcar(offlineUtilizavel, 'sem internet, todos os módulos carregam e a tela responde');

  // E o motor — que é o arquivo maior — precisa rodar a partir do cache.
  let motorOffline = true;
  try {
    await pagina.click('.aba[data-painel="configurar"]');
    await pagina.fill('#universo', '13');
    await pagina.fill('#pool', '13');
    await pagina.fill('#cartela', '4');
    await pagina.fill('#cobrir', '2');
    await pagina.click('#iniciar');
    await pagina.waitForFunction(
      () => {
        const t = document.getElementById('melhor-cartelas').textContent.trim();
        return t !== '' && t !== '—' && Number(t) > 0;
      },
      undefined,
      { timeout: 30000 }
    );
  } catch {
    motorOffline = false;
  }
  marcar(motorOffline, 'sem internet, o motor roda a partir do cache');

  await contexto.setOffline(false);
} finally {
  await writeFile(caminhoSw, swOriginal);
  await writeFile(caminhoEstilo, estiloOriginal);
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
