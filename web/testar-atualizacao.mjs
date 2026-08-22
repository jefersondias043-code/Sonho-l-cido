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
const caminhoLotinha = join(RAIZ, 'lotinha.js');
const caminhoIndex = join(RAIZ, 'index.html');
const swOriginal = await readFile(caminhoSw, 'utf8');
const estiloOriginal = await readFile(caminhoEstilo, 'utf8');
const lotinhaOriginal = await readFile(caminhoLotinha, 'utf8');
const indexOriginal = await readFile(caminhoIndex, 'utf8');

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
  // O botão nasce desabilitado, com o rótulo servindo de instrução — é a
  // seleção das dezenas que o libera. Que ele exista e diga o que falta já
  // prova que os módulos carregaram e a tela reagiu.
  marcar(
    /Escolha \d+ dezenas?/.test(await pagina.locator('#lot-iniciar').textContent()),
    'o aplicativo segue utilizável após atualizar'
  );

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
    // A matriz das 66 combinações é desenhada por `lotinha.js`, importado por
    // `app.js` — se o módulo faltasse no cache, a tabela ficaria vazia.
    await pagina.waitForFunction(
      () => document.querySelectorAll('#lot-matriz tbody tr').length === 66,
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
    await pagina.click('.aba[data-painel="lotinha"]');
    await pagina.waitForSelector('#lotinha.ativo');
    await pagina.click('#lot-pool .opcao[data-pool="18"]');
    for (let n = 1; n <= 18; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
    await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
    await pagina.click('#lot-iniciar');
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

  // ─── peças de construções diferentes ───
  //
  // O acidente real: o `app.js` de uma construção chegou ao aparelho junto com
  // o `lotinha.js` da anterior. A primeira função que ele chamou ainda não
  // existia lá, o `TypeError` subiu no corpo do módulo, e **tudo o que vinha
  // depois nunca foi executado** — quarenta `addEventListener` de topo, nenhum
  // registrado.
  //
  // Do lado do usuário: a primeira tela da Lotinha respondia, porque os botões
  // dela são pendurados antes, e o aplicativo inteiro depois disso estava
  // morto, sem uma mensagem. Um arquivo velho no cache parecendo um aplicativo
  // quebrado.
  //
  // O teste serve a mistura de propósito e exige as duas defesas: perceber
  // antes de usar, e não recarregar para sempre quando o remendo não resolve.
  const semAsNovas = lotinhaOriginal
    .replace(/export function garantiaQuePaga/, 'function garantiaQuePagaAntiga')
    .replace(/export function melhorConfiguracao/, 'function melhorConfiguracaoAntiga');
  await writeFile(caminhoLotinha, semAsNovas);

  const pagina2 = await contexto.newPage();
  let cargas = 0;
  pagina2.on('load', () => (cargas += 1));
  await pagina2.goto(`http://localhost:${PORTA}${BASE}`);
  await pagina2.waitForTimeout(3500);

  marcar(
    cargas > 1,
    'peças de construções diferentes fazem o aplicativo buscar as certas sozinho',
    `${cargas} cargas`
  );
  marcar(
    await pagina2.evaluate(() => {
      const aviso = document.getElementById('aviso');
      return !!aviso && !aviso.hidden && /incompleta/.test(aviso.textContent);
    }),
    'e quando nem isso resolve, ele diz o que houve em vez de morrer calado',
    await pagina2.evaluate(() => document.getElementById('aviso')?.textContent?.slice(0, 60) ?? '')
  );
  marcar(
    cargas < 5,
    'e não recarrega em laço, que seria pior do que o defeito',
    `${cargas} cargas em 3,5 s`
  );
  await writeFile(caminhoLotinha, lotinhaOriginal);
  await pagina2.close();

  // ─── uma peça de tela ausente não apaga o resto ───
  //
  // O outro caminho para o mesmo estrago: `$('x').addEventListener(...)` com o
  // elemento ausente lança, e os registros seguintes somem junto. `#lot-simular`
  // fica de fora do `index.html` — ele não está na lista de peças exigidas, então
  // a auto-cura não entra e o que se mede é o isolamento.
  await writeFile(caminhoIndex, indexOriginal.replace('id="lot-simular"', 'id="lot-simular-ausente"'));
  const pagina3 = await contexto.newPage();
  await pagina3.goto(`http://localhost:${PORTA}${BASE}`);
  await pagina3.waitForTimeout(2500);

  const vivos = await pagina3.evaluate(async () => {
    const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const antesLot = document.querySelectorAll('#lot-grade .numero.escolhido').length;
    document.getElementById('lot-sortear')?.click();
    await dormir(300);
    const lotinhaViva = document.querySelectorAll('#lot-grade .numero.escolhido').length !== antesLot;

    const botao = document.getElementById('chk-sortear');
    const antesChk = (document.getElementById('chk-resultado')?.value ?? '').length;
    if (botao) {
      botao.disabled = false;
      botao.click();
    }
    await dormir(400);
    const checarViva = (document.getElementById('chk-resultado')?.value ?? '').length !== antesChk;

    document.querySelector('.aba[data-painel="historico"]')?.click();
    await dormir(200);
    const historicoVivo = document.getElementById('historico').classList.contains('ativo');

    return { lotinhaViva, checarViva, historicoVivo };
  });
  marcar(
    vivos.lotinhaViva && vivos.checarViva && vivos.historicoVivo,
    'um elemento ausente derruba só o botão dele, e não as telas registradas depois',
    `Lotinha ${vivos.lotinhaViva ? 'viva' : 'morta'} · Checar ${vivos.checarViva ? 'viva' : 'morta'} · Histórico ${vivos.historicoVivo ? 'vivo' : 'morto'}`
  );
  await pagina3.close();
} finally {
  await writeFile(caminhoSw, swOriginal);
  await writeFile(caminhoEstilo, estiloOriginal);
  await writeFile(caminhoLotinha, lotinhaOriginal);
  await writeFile(caminhoIndex, indexOriginal);
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
