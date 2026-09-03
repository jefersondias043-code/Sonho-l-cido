/*
 * Teste da tela de Configurações.
 *
 * O que ela promete é uma resposta a uma pergunta que ninguém pode conferir
 * sozinho: "estou na versão mais nova?". Quem lê a resposta não tem como saber
 * se ela foi verificada ou chutada — e um botão que sempre diz "tudo em dia" é
 * pior do que botão nenhum, porque quem confia nele para de procurar.
 *
 * Por isso as três situações são servidas de propósito aqui, e cada uma tem de
 * produzir uma frase diferente:
 *
 *   1. nada publicado de novo   → "você já está na versão mais recente";
 *   2. uma versão nova por baixo → os dois carimbos, e o botão de instalar;
 *   3. sem internet              → "não deu para verificar", e nunca um "não".
 *
 * A terceira é a que existe para pegar um defeito específico e sutil: o service
 * worker guarda os arquivos do aplicativo, e se ele servisse o próprio `sw.js`
 * do cache, a tela compararia o carimbo local com ele mesmo e responderia "em
 * dia" para quem está sem rede nenhuma.
 *
 *   ./construir-web.sh && node web/testar-configuracoes.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8145;

const BASE = (() => {
  const bruto = process.argv[2] ?? '/';
  const comInicio = bruto.startsWith('/') ? bruto : `/${bruto}`;
  return comInicio.endsWith('/') ? comInicio : `${comInicio}/`;
})();

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
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
        // Sem cache HTTP: o que interessa medir aqui é o cache do service
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

const CARIMBO_DE_MENTIRA = 'aaaabbbbcccc';
const endereco = (pagina) => `http://localhost:${PORTA}${BASE}${pagina}`;

const servidor = await servir();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

// A fase sem internet derruba requisições de propósito, e o navegador reclama
// no console por isso. Contar essas queixas como defeito faria o teste cobrar
// do aplicativo exatamente o que o teste provocou.
let redeDesligada = false;
const errosNoConsole = [];
pagina.on('console', (m) => {
  if (m.type() === 'error' && !redeDesligada) errosNoConsole.push(m.text());
});
pagina.on('pageerror', (e) => {
  if (!redeDesligada) errosNoConsole.push(String(e.message));
});

console.log('Teste da tela de Configurações\n');

const caminhoSw = join(RAIZ, 'sw.js');
const swOriginal = await readFile(caminhoSw, 'utf8');

const texto = (id) => pagina.locator(`#${id}`).textContent();
const versaoNaTela = async () => (await texto('cfg-versao')).trim();

/** Espera a resposta da verificação sair do estado "Verificando…". */
const esperarAResposta = () =>
  pagina.waitForFunction(
    () => {
      const r = document.getElementById('cfg-resultado');
      return r && !r.hidden && r.textContent.trim() !== '' && r.textContent.trim() !== 'Verificando…';
    },
    undefined,
    { timeout: 30000 }
  );

try {
  // ─── 1. a tela abre e diz o que sabe ───
  await pagina.goto(endereco('configuracoes.html'), { waitUntil: 'networkidle' });
  await pagina.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, {
    timeout: 20000,
  });
  // Recarrega para partir de uma página já controlada, que é a condição
  // normal de uso: a primeira visita é a única em que não há service worker.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForFunction(
    () => document.getElementById('cfg-versao').textContent.trim() !== '—',
    undefined,
    { timeout: 20000 }
  );

  const versaoDaqui = await versaoNaTela();
  marcar(
    /^[0-9a-f]{12}$/.test(versaoDaqui),
    'a tela mostra o carimbo da versão que está rodando',
    versaoDaqui
  );

  // ─── 2. nenhum dado fica em branco ───
  //
  // Cada linha desta tela responde uma pergunta. Uma linha que fica no traço
  // não é neutra: ela diz "não sei" sobre algo que o navegador sabe, e o
  // usuário não tem como distinguir isso de um defeito.
  const linhas = await pagina.evaluate(() =>
    [
      'cfg-offline',
      'cfg-espaco',
      'cfg-persistencia',
      'cfg-hist-lotinha',
      'cfg-hist-exato',
      'cfg-espaco-trabalho',
      'cfg-nucleos',
      'cfg-wasm',
      'cfg-instalado',
    ].map((id) => [id, document.getElementById(id)?.textContent?.trim() ?? '(ausente)'])
  );
  const emBranco = linhas.filter(([, v]) => v === '—' || v === '' || v === '(ausente)');
  marcar(emBranco.length === 0, 'todas as linhas de dado são preenchidas', `${linhas.length} linhas`);
  marcar(
    linhas.find(([id]) => id === 'cfg-wasm')?.[1] === 'disponível',
    'e a tela reconhece que o WebAssembly está disponível'
  );
  marcar(
    /^\d+ arquivos?$/.test(linhas.find(([id]) => id === 'cfg-offline')?.[1] ?? ''),
    'e conta os arquivos guardados para uso sem internet',
    linhas.find(([id]) => id === 'cfg-offline')?.[1]
  );

  // ─── 3. os fechamentos guardados são contados de verdade ───
  //
  // Contagem inventada numa tela de "o que está guardado" é o pior tipo de
  // mentira: quem confia nela deixa de exportar o que acha que está salvo.
  await pagina.evaluate(() => {
    // O mesmo formato que o histórico aceita: sem `pool`, `cartela` e `melhor`
    // a sessão é descartada na leitura, e a tela contaria zero com razão.
    const sessao = (id) => ({
      id,
      criada: Date.now(),
      atualizada: Date.now(),
      configuracao: { pool: Array.from({ length: 18 }, (_, i) => i + 1), cartela: 17 },
      melhor: [[1, 2, 3], [4, 5, 6]],
    });
    localStorage.setItem('sonho-lucido:historico', JSON.stringify([sessao('a')]));
  });
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForFunction(
    () => document.getElementById('cfg-hist-lotinha').textContent.trim() !== '—',
    undefined,
    { timeout: 15000 }
  );
  const umSo = (await texto('cfg-hist-lotinha')).trim();
  marcar(
    umSo.startsWith('1 fechamento ') && !umSo.includes('1 fechamentos'),
    'um fechamento guardado é "1 fechamento", e não "1 fechamentos"',
    umSo
  );

  const ocupado = (await texto('cfg-espaco-trabalho')).trim();
  marcar(ocupado !== '0 B' && /\d/.test(ocupado), 'e o espaço que ele ocupa deixa de ser zero', ocupado);

  await pagina.evaluate(() => localStorage.removeItem('sonho-lucido:historico'));

  // ─── 4. verificar sem novidade nenhuma ───
  await pagina.click('#cfg-buscar');
  await esperarAResposta();
  const emDia = (await texto('cfg-resultado')).trim();
  marcar(
    emDia.includes('mais recente') && emDia.includes(versaoDaqui),
    'sem novidade, a tela diz que a versão é a mais recente — e mostra qual',
    emDia
  );
  marcar(
    (await pagina.locator('#cfg-resultado').getAttribute('class')).includes('boa'),
    'e a resposta vem marcada como boa'
  );
  marcar(
    !(await pagina.locator('#cfg-atualizar').isVisible()),
    'e o botão de instalar não aparece quando não há o que instalar'
  );
  marcar(
    /Última verificação: /.test((await texto('cfg-ultima')).trim()),
    'e a hora da verificação fica registrada',
    (await texto('cfg-ultima')).trim()
  );

  // ─── 5. sem internet: não saber, e dizer que não sabe ───
  //
  // Este é o defeito que a tela existe para não ter. Se o service worker
  // servisse o próprio `sw.js` do cache, a comparação seria do carimbo local
  // com ele mesmo e a resposta seria "em dia" — uma afirmação sobre o servidor
  // feita sem falar com o servidor.
  redeDesligada = true;
  await contexto.setOffline(true);
  await pagina.click('#cfg-buscar');
  await pagina.waitForFunction(
    () => /Não deu para verificar|mais recente|versão nova/.test(
      document.getElementById('cfg-resultado')?.textContent ?? ''
    ),
    undefined,
    { timeout: 30000 }
  );
  const semRede = (await texto('cfg-resultado')).trim();
  marcar(
    semRede.startsWith('Não deu para verificar'),
    'sem internet, a tela diz que não deu para verificar',
    semRede.slice(0, 70)
  );
  marcar(
    !/mais recente/.test(semRede),
    'e não afirma estar em dia sobre um servidor com quem não falou'
  );
  marcar(
    semRede.includes(versaoDaqui),
    'e continua dizendo em que versão o aparelho está'
  );
  marcar(
    (await pagina.locator('#cfg-resultado').getAttribute('class')).includes('sem-resposta'),
    'e a resposta não é pintada como boa'
  );

  // A defesa por baixo da frase: o `sw.js` não pode vir do cache do service
  // worker. Sem rede, buscá-lo tem de falhar — e não devolver a cópia guardada.
  const buscaOffline = await pagina.evaluate(async () => {
    try {
      const r = await fetch(`./sw.js?conferindo=${Date.now()}`, { cache: 'no-store' });
      return r.ok ? (await r.text()).slice(0, 200) : `status ${r.status}`;
    } catch (e) {
      return `falhou: ${e.name}`;
    }
  });
  marcar(
    !/const CARIMBO = '[0-9a-f]{12}'/.test(buscaOffline),
    'o service worker não serve a si mesmo do cache',
    buscaOffline.slice(0, 40)
  );

  await contexto.setOffline(false);
  redeDesligada = false;

  // ─── 6. uma versão nova é publicada por baixo ───
  await writeFile(
    caminhoSw,
    swOriginal.replace(/const CARIMBO = '[^']+'/, `const CARIMBO = '${CARIMBO_DE_MENTIRA}'`)
  );

  await pagina.click('#cfg-buscar');
  await pagina.waitForFunction(
    () => /versão nova/.test(document.getElementById('cfg-resultado')?.textContent ?? ''),
    undefined,
    { timeout: 30000 }
  );
  const novidade = (await texto('cfg-resultado')).trim();
  marcar(
    novidade.includes(versaoDaqui) && novidade.includes(CARIMBO_DE_MENTIRA),
    'com versão nova publicada, a tela mostra os dois carimbos',
    novidade
  );
  marcar(
    await pagina.locator('#cfg-atualizar').isVisible(),
    'e oferece o botão de instalar'
  );

  // ─── 7. instalar, e confirmar depois da recarga ───
  //
  // A confirmação tem de aparecer na página que **chega**, não na que sai. O
  // defeito medido: o service worker novo assumia, a nota era escrita, e a
  // recarga levava tudo um décimo de segundo depois — deixando quem tocou no
  // botão numa tela muda.
  await pagina.click('#cfg-atualizar');
  await pagina.waitForFunction(
    (novo) => {
      const r = document.getElementById('cfg-resultado');
      return (
        document.getElementById('cfg-versao')?.textContent?.trim() === novo &&
        r &&
        !r.hidden &&
        /Atualizado/.test(r.textContent)
      );
    },
    CARIMBO_DE_MENTIRA,
    { timeout: 60000 }
  );
  marcar(true, 'instalar a versão nova troca o carimbo e confirma depois da recarga',
    `${versaoDaqui} → ${await versaoNaTela()}`);

  // E a confirmação não fica presa: uma recarga seguinte não pode repeti-la,
  // ou a tela passaria a anunciar para sempre uma atualização de ontem.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2500);
  marcar(
    !/Atualizado/.test((await texto('cfg-resultado')) ?? ''),
    'e a confirmação não se repete na recarga seguinte'
  );

  // Devolve o carimbo verdadeiro e volta o aparelho para ele, para as
  // verificações seguintes não correrem sobre uma versão inventada.
  await writeFile(caminhoSw, swOriginal);
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForFunction(
    (bom) => document.getElementById('cfg-versao')?.textContent?.trim() === bom,
    versaoDaqui,
    { timeout: 60000 }
  );

  // ─── 8. o atalho leva à ferramenta ───
  //
  // Conferido pela peça, e não pelo `<h1>`: o título é o mesmo em todas as
  // páginas, e um teste que olhasse só para ele passaria com o atalho levando
  // ao lugar errado.
  await pagina.click('.atalho[href="./"]');
  await pagina.waitForFunction(
    () => !!document.getElementById('lot-grade'),
    undefined,
    { timeout: 15000 }
  );
  marcar(true, 'o atalho abre a ferramenta', '#lot-grade');
  await pagina.goBack({ waitUntil: 'networkidle' });

  // ─── 9. e a ferramenta leva até aqui ───
  //
  // Era um laço sobre duas telas. Agora há uma, e é dela que o caminho de volta
  // tem de sair: uma tela de Configurações sem porta de entrada é uma tela que
  // só se alcança digitando o endereço.
  await pagina.goto(endereco(''), { waitUntil: 'domcontentloaded' });
  const achou = await pagina.locator('a[href="./configuracoes.html"]').count();
  marcar(achou > 0, 'a ferramenta tem caminho para as Configurações');

  // ─── 10. apagar tudo e recomeçar ───
  //
  // O botão existe por um sintoma concreto: o aplicativo continuar se
  // comportando como uma versão antiga depois de o carimbo já ter mudado. Por
  // isso o que se cobra aqui não é a mensagem, e sim o efeito — nada nosso
  // sobra em `localStorage`, nada sobra no CacheStorage, e o service worker
  // deixa de estar registrado. Se qualquer um dos três sobrevivesse, o botão
  // seria um enfeite justamente no caso em que ele é a saída.
  await pagina.goto(endereco('configuracoes.html'), { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2500);

  // Sujeira de propósito: uma chave nossa, e uma de outro dono no mesmo
  // domínio. A segunda é a que **não** pode ser tocada.
  await pagina.evaluate(async () => {
    localStorage.setItem('sonho-lucido:historico', '[{"id":"x"}]');
    localStorage.setItem('sonho-lucido:esforco-por-cartela', '900');
    localStorage.setItem('outro-app:preferencia', 'guardar');
    // Um depósito de uma construção anterior, que é exatamente o que faz o
    // aplicativo continuar se comportando como a versão velha.
    await caches.open('sonho-lucido-de-ontem');
  });
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);

  marcar(
    /apagado|fechamento|ajuste/i.test((await texto('cfg-reset-resumo')) ?? ''),
    'o resumo diz o que será apagado antes do toque',
    await texto('cfg-reset-resumo')
  );

  const antes = await pagina.evaluate(async () => ({
    guardados: (await caches.keys()).length,
    trabalhadores: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  marcar(
    antes.guardados > 0 && antes.trabalhadores > 0,
    'antes de apagar há conteúdo guardado e service worker registrado',
    `${antes.guardados} depósito(s) · ${antes.trabalhadores} registro(s)`
  );

  // Apagar pede confirmação, e sem tratador o Playwright dispensa a caixa —
  // o que faria o teste medir o cancelamento em vez do reset.
  pagina.once('dialog', (caixa) => caixa.accept());
  await pagina.click('#cfg-reset');
  await pagina.waitForURL(/recomecado=/, { timeout: 30000 });
  await pagina.waitForLoadState('networkidle');

  const depois = await pagina.evaluate(async () => ({
    depositos: await caches.keys(),
    nossas: Object.keys(localStorage).filter((c) => c.startsWith('sonho-lucido:')),
    alheia: localStorage.getItem('outro-app:preferencia'),
  }));

  // Contar zero depósitos aqui mediria o instante errado: a página que chega
  // registra um service worker novo e guarda a versão atual, e é isso que
  // "recém-instalado" quer dizer. O que não pode sobreviver é o de antes.
  marcar(
    !depois.depositos.includes('sonho-lucido-de-ontem'),
    'apagar leva o conteúdo guardado da construção anterior',
    depois.depositos.join(', ') || 'nenhum'
  );
  marcar(
    (await versaoNaTela()) === versaoDaqui,
    'e o que volta é a versão publicada, baixada de novo',
    `${await versaoNaTela()}`
  );
  marcar(
    depois.nossas.length === 0,
    'apagar leva todas as chaves do aplicativo',
    depois.nossas.join(', ')
  );
  marcar(
    depois.alheia === 'guardar',
    'e não toca no que é de outro dono no mesmo domínio',
    String(depois.alheia)
  );

  // A confirmação é lida pela carga que chega, não escrita pela que sai — e o
  // endereço volta ao normal para uma recarga seguinte não repeti-la.
  marcar(
    await pagina.locator('#cfg-aviso:not([hidden])').count() > 0,
    'a página que chega confirma que recomeçou'
  );
  marcar(
    !/recomecado=/.test(pagina.url()),
    'e o endereço volta ao normal, para o aviso não se repetir',
    pagina.url().split('/').pop()
  );

  marcar(
    errosNoConsole.length === 0,
    'nenhum erro no console em todo o percurso',
    errosNoConsole.slice(0, 2).join(' · ')
  );
} finally {
  await writeFile(caminhoSw, swOriginal);
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
