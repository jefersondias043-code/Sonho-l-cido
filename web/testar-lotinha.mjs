/*
 * Teste da ferramenta Lotinha, num navegador de verdade.
 *
 * O que precisa ficar provado:
 *
 *   1. A escolha das dezenas é do usuário, e o pool aceita de 17 a 23.
 *   2. Os fechamentos vêm prontos do banco embutido — sem download, sem cálculo
 *      na hora de abrir.
 *   3. **A cobertura é real.** Todo sorteio possível dentro do pool cai em algum
 *      jogo.
 *   4. A tela distingue o que é mínimo comprovado do que é problema em aberto.
 *   5. O painel financeiro mostra os dois ramos — o que ganha e o que perde —
 *      e nunca um sem o outro.
 *
 * A conferência do item 3 é feita aqui por uma **terceira** implementação: nem
 * a do motor que gerou o fechamento, nem a do validador do aplicativo. Duas
 * implementações que concordam podem estar erradas juntas se compartilharem a
 * ideia; três que concordam por caminhos diferentes, dificilmente.
 *
 *   ./construir-web.sh && node web/testar-lotinha.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8135;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function servir() {
  const servidor = createServer(async (req, res) => {
    let caminho = decodeURIComponent(req.url.split('?')[0]);
    if (caminho.endsWith('/')) caminho += 'index.html';
    try {
      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
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

/**
 * Terceira opinião sobre a cobertura, deliberadamente ingênua.
 *
 * Sem máscaras de bits, sem enumeração incremental: gera todos os sorteios com
 * recursão simples e compara conjuntos. É lento e é para ser — o objetivo é não
 * compartilhar nenhuma ideia com as duas implementações que já existem, para que
 * um erro de raciocínio não se repita nas três.
 */
function conferirIngenuamente(dezenas, jogos, tamanhoSorteio) {
  const conjuntos = jogos.map((j) => new Set(j));
  let total = 0;
  let descoberto = null;

  const atual = [];
  (function passo(inicio) {
    if (descoberto) return;
    if (atual.length === tamanhoSorteio) {
      total += 1;
      const cobre = conjuntos.some((jogo) => atual.every((d) => jogo.has(d)));
      if (!cobre) descoberto = [...atual];
      return;
    }
    for (let i = inicio; i < dezenas.length; i++) {
      atual.push(dezenas[i]);
      passo(i + 1);
      atual.pop();
    }
  })(0);

  return { total, descoberto };
}

await mkdir(new URL('../capturas/', import.meta.url).pathname, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()));
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

console.log('Teste da ferramenta Lotinha\n');

try {
  await pagina.goto(`http://localhost:${PORTA}/`, { waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');

  // ─── 1. a estrutura da modalidade ───
  const tamanhos = await pagina.$$eval('#lot-pool .opcao', (b) => b.map((x) => x.textContent));
  marcar(
    tamanhos.join(',') === '17,18,19,20,21,22,23',
    'o pool vai de 17 a 23 dezenas, como a modalidade',
    tamanhos.join(' · ')
  );

  const quantosNumeros = await pagina.locator('#lot-grade .numero').count();
  marcar(quantosNumeros === 25, 'as 25 dezenas do universo estão na tela');

  const linhasMatriz = await pagina.locator('#lot-matriz tbody tr').count();
  marcar(linhasMatriz === 28, 'a matriz cobre as 28 combinações da modalidade', `${linhasMatriz} linhas`);

  const emAberto = await pagina.locator('#lot-matriz td.aberto').count();
  marcar(emAberto === 10, 'e marca as 10 em que o mínimo é problema aberto', `${emAberto} marcadas`);

  // ─── 2. a seleção é do usuário ───
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  marcar(await pagina.locator('#lot-iniciar').isDisabled(), 'nada começa sem escolher as dezenas');

  const ESCOLHIDAS = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25];
  for (const n of ESCOLHIDAS) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);

  const contagem = (await pagina.locator('#lot-contagem').textContent()).trim();
  marcar(
    /18 de 18/.test(contagem) && /816/.test(contagem),
    'com 18 escolhidas, anuncia os 816 sorteios possíveis',
    contagem.replace(/\s+/g, ' ').slice(0, 76)
  );

  const naoEscolhida = [3, 6, 9].find((n) => !ESCOLHIDAS.includes(n));
  await pagina.click(`#lot-grade .numero[data-n="${naoEscolhida}"]`);
  marcar(
    /18 de 18/.test((await pagina.locator('#lot-contagem').textContent()).trim()),
    'uma 19ª dezena é recusada'
  );

  // ─── 3. a tela distingue o comprovado do desconhecido ───
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  const exato = (await pagina.locator('#lot-explicacao').textContent()).trim();
  marcar(
    /16 jogos/.test(exato) && /mínimo comprovado/.test(exato),
    'pool 18 com jogos de 17: diz que 16 é o mínimo comprovado',
    exato.replace(/\s+/g, ' ').slice(0, 76)
  );

  await pagina.click('#lot-jogo .opcao[data-jogo="18"]');
  const unico = (await pagina.locator('#lot-explicacao').textContent()).trim();
  marcar(
    /um jogo só/i.test(unico),
    'e que jogar as 18 de uma vez é aposta única, sem fechamento',
    unico.replace(/\s+/g, ' ').slice(0, 76)
  );

  await pagina.screenshot({ path: 'capturas/captura-lotinha.png' });

  // ─── 4. o fechamento pronto, e a conferência ───
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Cobertura/.test(document.getElementById('lot-conferencia').textContent),
    undefined,
    { timeout: 30000 }
  );

  const conferencia = (await pagina.locator('#lot-conferencia').textContent()).trim();
  marcar(
    /Cobertura comprovada: 100%/.test(conferencia),
    'o validador do aplicativo confirma 100% de cobertura',
    conferencia.replace(/\s+/g, ' ').slice(0, 76)
  );

  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');
  await pagina.waitForFunction(
    () => document.querySelectorAll('#lista-cartelas .cartela').length > 0,
    undefined,
    { timeout: 20000 }
  );
  const jogos = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );

  marcar(jogos.length === 16, 'o fechamento tem os 16 jogos previstos', `${jogos.length} jogos`);
  marcar(
    jogos.every((j) => j.length === 17),
    'e cada jogo tem 17 dezenas',
    `tamanhos: ${[...new Set(jogos.map((j) => j.length))].join(', ')}`
  );

  const fora = jogos.flat().filter((n) => !ESCOLHIDAS.includes(n));
  marcar(fora.length === 0, 'todas as dezenas jogadas são as que você escolheu');

  // ─── 5. a terceira opinião ───
  const { total, descoberto } = conferirIngenuamente(ESCOLHIDAS, jogos, 15);
  marcar(
    total === 816 && descoberto === null,
    'conferência independente do teste: todos os 816 sorteios cobertos',
    descoberto ? `descoberto: ${descoberto.join(' ')}` : `${total} de 816`
  );

  // ─── 6. o painel financeiro, com os dois ramos ───
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.locator('#lot-cotacao-cartao summary').click();
  const campo17 = pagina.locator('#lot-cotacao .campo input').first();
  await campo17.fill('7000');

  const economia = (await pagina.locator('#lot-economia').textContent()).trim();
  marcar(/R\$\s?16,00/.test(economia), 'mostra o custo do fechamento', 'R$ 16,00');
  marcar(
    /Se o sorteio cair no seu pool/.test(economia) && /Se não cair/.test(economia),
    'mostra o ramo que ganha E o ramo que perde, juntos'
  );
  marcar(
    /nenhum arranjo de fechamento o altera/i.test(economia),
    'e diz que o retorno esperado não muda com o arranjo'
  );

  const retorno = economia.match(/Retorno esperado\s*R\$\s?([\d,]+)/);
  marcar(
    retorno !== null && Math.abs(Number(retorno[1].replace(',', '.')) - 0.29) < 0.05,
    'o retorno esperado bate com a matemática da modalidade',
    retorno ? `R$ ${retorno[1]} por real` : 'não encontrado'
  );

  // ─── 7. o simulador ───
  await pagina.locator('#lot-simulador-cartao summary').click();
  // Um sorteio dentro do pool: as 15 primeiras escolhidas. Tem de premiar.
  await pagina.fill('#lot-resultado', ESCOLHIDAS.slice(0, 15).join(' '));
  await pagina.click('#lot-simular');
  const dentro = (await pagina.locator('#lot-simulacao').textContent()).trim();
  marcar(
    /com 15 acertos/.test(dentro),
    'o simulador premia um sorteio que cai dentro do pool',
    dentro.replace(/\s+/g, ' ').slice(0, 66)
  );

  // E um que não cai: troca uma dezena por outra de fora.
  const deFora = [3, 6, 9, 12].find((n) => !ESCOLHIDAS.includes(n));
  await pagina.fill('#lot-resultado', [...ESCOLHIDAS.slice(0, 14), deFora].join(' '));
  await pagina.click('#lot-simular');
  const naoCai = (await pagina.locator('#lot-simulacao').textContent()).trim();
  marcar(
    /Nenhum jogo com 15/.test(naoCai),
    'e não premia um sorteio que sai do pool',
    naoCai.replace(/\s+/g, ' ').slice(0, 66)
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
