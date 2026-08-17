/*
 * Teste do histórico de trabalhos.
 *
 * Verifica a promessa central: nenhum trabalho se perde, e dá para voltar a
 * qualquer um deles e continuar de onde parou.
 *
 * Quatro exigências, cada uma verificada de ponta a ponta num navegador:
 *
 *   1. toda busca é salva sozinha, sem o usuário pedir;
 *   2. buscas diferentes viram registros diferentes — a nova não apaga a velha,
 *      que era exatamente o defeito da versão anterior;
 *   3. continuar um trabalho retoma do ponto em que parou e **atualiza aquele
 *      mesmo registro**, em vez de espalhar cópias quase idênticas;
 *   4. excluir um trabalho não leva os outros junto.
 *
 *   ./construir-web.sh && node web/testar-historico.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8129;
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
      if (!caminho.startsWith(BASE)) return res.writeHead(404).end('fora da base');
      caminho = caminho.slice(BASE.length - 1);
      if (caminho.endsWith('/')) caminho += 'index.html';

      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
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

await mkdir(new URL('../capturas/', import.meta.url).pathname, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

/** As sessões como estão gravadas no aparelho. */
const sessoesGravadas = () =>
  pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:historico');
    return bruto ? JSON.parse(bruto) : [];
  });

/** Configura e roda uma busca até ela registrar ao menos uma solução. */
async function buscar({ universo, pool, cartela, cobrir }) {
  await pagina.click('.aba[data-painel="configurar"]');
  await pagina.fill('#universo', String(universo));
  await pagina.fill('#pool', String(pool));
  await pagina.fill('#cartela', String(cartela));
  await pagina.fill('#cobrir', String(cobrir));
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await esperarSolucao();
}

/** Espera até existir um número de cartelas na tela. */
async function esperarSolucao() {
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—' && Number(t) > 0;
    },
    undefined,
    { timeout: 40000 }
  );
}

async function encerrar() {
  await pagina.click('.aba[data-painel="buscar"]');
  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 15000 });
}

console.log('Teste do histórico de trabalhos\n');

try {
  await pagina.goto(`http://localhost:${PORTA}${BASE}`, { waitUntil: 'networkidle' });
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });

  // ─── começa vazio ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.historico-vazio').count()) === 1,
    'sem trabalhos, a tela explica que ainda não há nada'
  );

  // ─── 1. toda busca é salva sozinha ───
  await buscar({ universo: 16, pool: 16, cartela: 4, cobrir: 2 });
  await encerrar();

  let sessoes = await sessoesGravadas();
  marcar(sessoes.length === 1, 'a busca é salva sem o usuário pedir', `${sessoes.length} registro`);
  marcar(
    sessoes[0].melhor.length > 0 && sessoes[0].melhor.every((c) => c.length === 4),
    'o registro guarda as cartelas de verdade',
    `${sessoes[0].melhor.length} cartelas de 4 números`
  );

  // ─── 2. uma busca nova não apaga a anterior ───
  //
  // Era exatamente o defeito da versão anterior: existia um único espaço de
  // gravação, e começar outro trabalho apagava o primeiro sem aviso.
  await buscar({ universo: 13, pool: 13, cartela: 4, cobrir: 2 });
  await encerrar();

  sessoes = await sessoesGravadas();
  marcar(
    sessoes.length === 2,
    'uma busca nova não apaga a anterior',
    `${sessoes.length} registros guardados`
  );

  const configuracoes = sessoes.map((s) => s.configuracao.pool.length).sort();
  marcar(
    configuracoes.join(',') === '13,16',
    'cada registro guarda a própria configuração',
    `pools ${configuracoes.join(' e ')}`
  );

  // ─── 3. continuar retoma e atualiza o mesmo registro ───
  //
  // Usa um problema que não se resolve em segundos, para que continuar tenha
  // mesmo o que melhorar.
  await buscar({ universo: 25, pool: 25, cartela: 5, cobrir: 2 });
  await pagina.waitForTimeout(2500);
  await encerrar();

  sessoes = await sessoesGravadas();
  const antes = sessoes.find((s) => s.configuracao.pool.length === 25);
  marcar(!!antes, 'o trabalho longo também foi salvo', `${antes?.melhor.length} cartelas`);

  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.sessao').count()) === 3,
    'os três trabalhos aparecem na lista'
  );
  await pagina.screenshot({ path: 'capturas/captura-historico.png' });

  // Continua justamente o trabalho de pool 25.
  const posicao = await pagina.evaluate((id) => {
    const botoes = [...document.querySelectorAll('[data-acao="continuar"]')];
    return botoes.findIndex((b) => b.dataset.id === id);
  }, antes.id);
  await pagina.locator('[data-acao="continuar"]').nth(posicao).click();

  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await esperarSolucao();

  // A contagem de iterações precisa continuar de onde parou, não zerar.
  const iteracoesNaRetomada = await pagina.evaluate(() =>
    Number(document.getElementById('iteracoes').textContent.replace(/\D/g, ''))
  );
  marcar(
    iteracoesNaRetomada >= (antes.iteracoes ?? 0),
    'a retomada continua a contagem em vez de zerar',
    `parou em ${antes.iteracoes}, retomou em ${iteracoesNaRetomada}`
  );

  await pagina.waitForTimeout(3000);
  await encerrar();

  sessoes = await sessoesGravadas();
  marcar(
    sessoes.length === 3,
    'continuar atualiza o registro, não cria um segundo',
    `${sessoes.length} registros`
  );

  const depois = sessoes.find((s) => s.id === antes.id);
  marcar(!!depois, 'o registro continuado manteve a mesma identidade');
  marcar(
    depois.iteracoes > antes.iteracoes,
    'o trabalho continuado avançou',
    `${antes.iteracoes} → ${depois.iteracoes} iterações`
  );
  marcar(
    depois.melhor.length <= antes.melhor.length,
    'a solução só pode ter melhorado',
    `${antes.melhor.length} → ${depois.melhor.length} cartelas`
  );
  marcar(
    depois.criadaEm === antes.criadaEm && depois.atualizadaEm > antes.atualizadaEm,
    'a data de criação é preservada e a de atualização avança'
  );

  // ─── ver as cartelas de um trabalho salvo ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  await pagina.locator('[data-acao="ver"]').first().click();
  await pagina.waitForSelector('#resultado.ativo', { timeout: 10000 });
  marcar(
    (await pagina.locator('#lista-cartelas .cartela').count()) > 0,
    'dá para ver as cartelas de um trabalho salvo sem retomá-lo'
  );

  // ─── 4. excluir um não leva os outros ───
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  pagina.once('dialog', (d) => d.accept());
  await pagina.locator('[data-acao="excluir"]').first().click();
  await pagina.waitForFunction(() => document.querySelectorAll('.sessao').length === 2, undefined, {
    timeout: 10000,
  });

  sessoes = await sessoesGravadas();
  marcar(sessoes.length === 2, 'excluir remove só o trabalho escolhido', `restaram ${sessoes.length}`);

  // ─── sobrevive a fechar e reabrir ───
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.sessao').count()) === 2,
    'o histórico sobrevive a fechar e reabrir o aplicativo'
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 140));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
