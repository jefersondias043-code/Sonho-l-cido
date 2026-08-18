/*
 * Teste de ponta a ponta da interface, num navegador de verdade.
 *
 * Os testes em Rust provam que a matemática está certa. Este prova que ela
 * chega até a tela: que o WebAssembly carrega, que o worker responde, que o
 * botão faz o que promete e que os jogos exibidos realmente cobrem o que dizem
 * cobrir.
 *
 * A conferência de cobertura é feita aqui em JavaScript, lendo o que está na
 * tela — sem tocar em nada do Rust. Se a conta fosse refeita pelo mesmo código
 * que a produziu, o teste não provaria nada. E ela é feita sobre o resultado
 * **depois** de o motor ter trabalhado em cima dele, que é justamente o que
 * `testar-lotinha.mjs` não alcança: lá o fechamento é conferido recém-saído do
 * banco, antes de a busca poder mexer nele.
 *
 * Dois fechamentos guiam o roteiro, e a diferença entre eles é o assunto:
 *
 * - **18 dezenas, jogos de 17** — 16 jogos, e 16 é o mínimo comprovado. Serve
 *   para provar que o motor **não para** nem quando não há mais o que achar.
 * - **20 dezenas, jogos de 17** — 240 jogos, mínimo desconhecido, piso 114.
 *   Serve para o relógio, a pausa, o encerramento e a conferência de cobertura.
 *
 *   ./construir-web.sh && node web/testar.mjs
 */

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../site/', import.meta.url).pathname;
const PORTA = 8123;

/*
 * Sob qual caminho servir o site.
 *
 * O GitHub Pages de um projeto não serve na raiz do domínio, e sim em
 * `/nome-do-repositorio/`. Um caminho absoluto que funciona perfeitamente em
 * `localhost:8123/` aponta para o lugar errado em produção — e a falha só
 * apareceria depois de publicado. Rodar o teste sob uma subpasta reproduz a
 * condição real antes de qualquer publicação.
 *
 *   node web/testar.mjs                    # na raiz
 *   node web/testar.mjs /Sonho-l-cido/     # como no GitHub Pages
 */
const BASE = (() => {
  const bruto = process.argv[2] ?? '/';
  const comInicio = bruto.startsWith('/') ? bruto : `/${bruto}`;
  return comInicio.endsWith('/') ? comInicio : `${comInicio}/`;
})();

// As capturas ficam fora de `site/`: aquilo é o que vai ao ar, e captura de
// tela de teste não tem por que ser publicada.
const CAPTURAS = new URL('../capturas/', import.meta.url).pathname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/*
 * Tudo que o navegador pediu, com o que o servidor respondeu.
 *
 * Registrar aqui, e não no navegador, é o que torna a checagem completa: o
 * WebAssembly é buscado de dentro do Web Worker, e os eventos de rede da
 * página principal não enxergam as requisições dele.
 */
const pedidos = [];

function servir() {
  const servidor = createServer(async (req, res) => {
    const alvo = req.url.split('?')[0];
    try {
      let caminho = decodeURIComponent(req.url.split('?')[0]);
      if (BASE !== '/') {
        if (!caminho.startsWith(BASE)) {
          res.writeHead(404).end('fora da base');
          return;
        }
        caminho = caminho.slice(BASE.length - 1);
      }
      if (caminho.endsWith('/')) caminho += 'index.html';
      const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
      });
      res.end(conteudo);
      pedidos.push({ caminho: alvo, status: 200 });
    } catch {
      res.writeHead(404).end('não encontrado');
      pedidos.push({ caminho: alvo, status: 404 });
    }
  });
  return new Promise((ok) => servidor.listen(PORTA, () => ok(servidor)));
}

/**
 * Confere que todo sorteio possível dentro do pool cai em algum jogo.
 *
 * Máscaras de bits sobre a posição da dezena no pool: um jogo contém o sorteio
 * quando `(sorteio | jogo) === jogo`. São 15.504 sorteios contra 240 jogos no
 * pool de 20 — alguns milhões de operações inteiras, instantâneo.
 *
 * O que se está conferindo aqui **não** é o fechamento do banco: é o que a tela
 * está exibindo agora, depois de o motor ter tido a chance de reorganizá-lo. Um
 * motor que "melhorasse" quebrando a cobertura passaria por todos os testes de
 * Rust e seria pego aqui.
 */
function conferirCobertura(jogos, dezenas, tamanhoSorteio) {
  const posicao = new Map(dezenas.map((d, i) => [d, i]));
  const mascaras = jogos.map((jogo) =>
    jogo.reduce((m, d) => m | (1 << posicao.get(d)), 0)
  );

  let total = 0;
  let descoberto = null;
  const escolhidas = [];

  (function passo(inicio, mascara) {
    if (descoberto) return;
    if (escolhidas.length === tamanhoSorteio) {
      total += 1;
      if (!mascaras.some((jogo) => (mascara | jogo) === jogo)) {
        descoberto = [...escolhidas];
      }
      return;
    }
    // Poda: sem dezenas suficientes à frente, não há sorteio a completar.
    if (dezenas.length - inicio < tamanhoSorteio - escolhidas.length) return;

    for (let i = inicio; i < dezenas.length; i++) {
      escolhidas.push(dezenas[i]);
      passo(i + 1, mascara | (1 << i));
      escolhidas.pop();
    }
  })(0, 0);

  return { total, descoberto };
}

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao, detalhe });
  console.log(`${certo ? '  ✓' : '  ✗'} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

await mkdir(CAPTURAS, { recursive: true });
const servidor = await servir();
const navegador = await chromium.launch();
// Um iPhone de verdade: viewport, toque e agente de usuário do Safari móvel.
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();

const errosDeConsole = [];
pagina.on('console', (m) => {
  if (m.type() === 'error') errosDeConsole.push(m.text());
});
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));

/** Escolhe o pool, marca as dezenas, escolhe o tamanho do jogo e carrega. */
async function carregarFechamento(pool, jogo, dezenas) {
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click(`#lot-pool .opcao[data-pool="${pool}"]`);
  await pagina.click('#lot-limpar');
  for (const n of dezenas) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click(`#lot-jogo .opcao[data-jogo="${jogo}"]`);
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 30000 }
  );
}

const texto = async (seletor) => (await pagina.locator(seletor).textContent()).trim();
const numero = async (seletor) => Number((await texto(seletor)).replace(/\D/g, ''));

const DEZOITO = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25];
const VINTE = Array.from({ length: 20 }, (_, i) => i + 1);

console.log(`Teste de ponta a ponta — interface no iPhone (servindo em ${BASE})\n`);

try {
  await pagina.goto(`http://localhost:${PORTA}${BASE}`, { waitUntil: 'networkidle' });

  // ─── 1. o aplicativo é a Lotinha ───
  marcar(await pagina.locator('h1').isVisible(), 'a página carrega');

  const abas = await pagina.$$eval('.aba', (b) => b.map((x) => x.textContent.trim()));
  marcar(
    abas.join(',') === 'Lotinha,Buscar,Resultado,Histórico',
    'as abas são as quatro da Lotinha, sem a tela de configuração',
    abas.join(' · ')
  );
  marcar(
    (await pagina.$eval('.painel.ativo', (e) => e.id)) === 'lotinha',
    'a Lotinha é a tela de entrada'
  );

  // O carimbo mudou de casa junto com a tela antiga; sem ele não há como
  // conferir se uma correção publicada chegou a este aparelho.
  await pagina.waitForFunction(
    () => document.getElementById('versao').textContent.trim() !== '',
    undefined,
    { timeout: 15000 }
  );
  marcar(/^versão \w+/.test(await texto('#versao')), 'o carimbo da versão está na tela', await texto('#versao'));

  await pagina.screenshot({ path: join(CAPTURAS, 'captura-lotinha.png') });

  // ─── 2. a resposta ao toque ───
  //
  // O defeito que isto cobre: a tela de busca só aparecia depois de o
  // WebAssembly carregar. Do lado do usuário, o toque no botão não produzia
  // reação nenhuma por vários segundos — indistinguível de um aplicativo
  // quebrado. A troca de tela acontece antes de o worker existir.
  //
  // Os 816 sorteios do pool 18 são conferidos antes disso, de propósito: a
  // cobertura é confirmada antes de qualquer promessa na tela.
  const antesDoToque = Date.now();
  await carregarFechamento(18, 17, DEZOITO);
  const atraso = Date.now() - antesDoToque;
  marcar(atraso < 5000, 'carregar o fechamento leva menos de cinco segundos', `${atraso} ms`);

  marcar(
    /Garantia comprovada: 100%/.test(
      await pagina.locator('#lot-conferencia').textContent()
    ),
    'a cobertura foi conferida antes de a busca começar'
  );

  const wasm = pedidos.find((p) => p.caminho.endsWith('.wasm'));
  marcar(
    !!wasm && wasm.status === 200 && wasm.caminho.startsWith(BASE),
    'o WebAssembly veio do caminho certo',
    wasm ? `${wasm.caminho} → ${wasm.status}` : 'nenhuma requisição .wasm'
  );

  const naoServidos = pedidos.filter((p) => p.status >= 400);
  marcar(
    naoServidos.length === 0,
    'nenhum arquivo faltando sob a subpasta',
    naoServidos.map((p) => `${p.caminho} → ${p.status}`).join(', ') ||
      `${pedidos.length} pedidos, todos servidos`
  );

  // ─── 3. o mínimo comprovado — e o motor que segue mesmo assim ───
  marcar((await texto('#melhor-cartelas')) === '16', 'o fechamento de 18 dezenas sai com 16 jogos');
  marcar(
    !(await pagina.locator('#selo-otimo').isHidden()),
    'o selo de mínimo comprovado acende'
  );

  const referencia = await texto('#referencia-busca');
  marcar(
    /Mínimo comprovado/.test(referencia) && /Turán/.test(referencia),
    'a tela explica de onde vem o mínimo, em vez de dizer "sem referência"',
    referencia.replace(/\s+/g, ' ').slice(0, 78)
  );

  /*
   * A verificação que dá nome a esta mudança.
   *
   * O defeito relatado: ao alcançar o mínimo comprovado o aplicativo parava
   * sozinho — a faixa dizia "ótimo provado" e o botão Pausar ficava
   * desabilitado, sem como pedir para continuar. A cota de Schönheim para
   * C(18,17,15) dá exatamente 16, que é o que o banco entrega, então este
   * fechamento disparava o defeito na primeira tentativa.
   *
   * Agora o motor segue. Quem para é o usuário.
   */
  const iteracoesNoMinimo = await numero('#iteracoes');
  await pagina.waitForFunction(
    (antes) => Number(document.getElementById('iteracoes').textContent.replace(/\D/g, '')) > antes,
    iteracoesNoMinimo,
    { timeout: 15000 }
  );
  const iteracoesDepois = await numero('#iteracoes');
  marcar(
    iteracoesDepois > iteracoesNoMinimo,
    'com o mínimo já comprovado, o motor continua trabalhando',
    `${iteracoesNoMinimo} → ${iteracoesDepois} iterações`
  );
  marcar(
    !(await pagina.locator('#pausar').isDisabled()),
    'e o botão de parar continua nas mãos do usuário'
  );
  marcar(
    /mínimo comprovado/.test(await texto('#texto-situacao')),
    'a faixa diz que o mínimo foi alcançado, sem parar por isso',
    await texto('#texto-situacao')
  );
  marcar(
    (await texto('#melhor-cartelas')) === '16',
    'e continuar procurando não custa o recorde já alcançado'
  );

  await pagina.screenshot({ path: join(CAPTURAS, 'captura-buscar.png') });

  // ─── 4. o resultado ───
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');
  const jogos18 = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );
  marcar(jogos18.length === 16, 'os 16 jogos aparecem na tela', `${jogos18.length} exibidos`);
  marcar(
    jogos18.every((j) => j.length === 17),
    'cada jogo tem 17 dezenas',
    `tamanhos: ${[...new Set(jogos18.map((j) => j.length))].join(', ')}`
  );
  marcar(
    jogos18.flat().every((n) => DEZOITO.includes(n)),
    'e todas as dezenas jogadas são as que foram escolhidas'
  );

  await pagina.screenshot({ path: join(CAPTURAS, 'captura-resultado.png') });

  // ─── 5. encerrar devolve à Lotinha ───
  //
  // O defeito que isto cobre: o botão antigo só trocava de aba, e a busca
  // continuava rodando por baixo, consumindo processador e bateria.
  await pagina.click('.aba[data-painel="buscar"]');
  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 15000 });
  marcar(true, 'encerrar devolve à tela da Lotinha');

  const situacaoFinal = await pagina.locator('#situacao').getAttribute('class');
  marcar(
    !situacaoFinal.includes('trabalhando'),
    'encerrar realmente para o motor',
    `situação: "${situacaoFinal.replace('situacao', '').trim() || 'parada'}"`
  );

  const iteracoesAoEncerrar = await texto('#iteracoes');
  await pagina.waitForTimeout(2000);
  marcar(
    (await texto('#iteracoes')) === iteracoesAoEncerrar,
    'nada continua rodando em segundo plano',
    `congelado em ${iteracoesAoEncerrar}`
  );

  // ─── 6. o caso em aberto: relógio, pausa e conferência ───
  //
  // 20 dezenas com jogos de 17: 240 jogos, e ninguém no mundo sabe o mínimo.
  // O motor não vai provar nada aqui, que é exatamente a condição em que o
  // relógio e a pausa precisam ser exercitados.
  await carregarFechamento(20, 17, VINTE);
  marcar(true, 'uma segunda busca roda limpa depois de encerrar', `${await texto('#melhor-cartelas')} jogos`);

  const emAberto = await texto('#referencia-busca');
  marcar(
    /problema em aberto/.test(emAberto) && /114/.test(emAberto),
    'no caso em aberto a tela mostra o piso conhecido, não um mínimo inventado',
    emAberto.replace(/\s+/g, ' ').slice(0, 78)
  );
  marcar(
    await pagina.locator('#selo-otimo').isHidden(),
    'e o selo de mínimo comprovado fica apagado onde não há mínimo comprovado'
  );

  marcar(
    await pagina.locator('#situacao.trabalhando').isVisible(),
    'numa busca que dura, o indicador de atividade pulsa'
  );

  const relogioAntes = await texto('#relogio');
  await pagina.waitForFunction(
    (anterior) => document.getElementById('relogio').textContent.trim() !== anterior,
    relogioAntes,
    { timeout: 10000 }
  );
  marcar(true, 'o relógio corre durante a busca', `saiu de ${relogioAntes}`);

  marcar(
    (await pagina.locator('#lista-recordes li').count()) >= 1,
    'a lista de recordes registra o ponto de partida',
    `${await pagina.locator('#lista-recordes li').count()} recordes`
  );

  /*
   * As cartelas precisam aparecer no Resultado **enquanto** a busca corre.
   *
   * O defeito que isto cobre: elas só apareciam quando a busca terminava.
   * Durante a busca — que é quando o usuário vai olhar, porque o painel já
   * anunciou ter encontrado algo — a aba ficava vazia. A causa era o caminho
   * que percorriam: worker → armazenamento local → temporizador → tela.
   */
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');
  let durante = { anunciadas: 0, exibidas: 0 };
  let coerente = true;
  try {
    durante = await pagina
      .waitForFunction(
        () => {
          const anunciadas = Number(
            document.getElementById('melhor-cartelas').textContent.trim()
          );
          const exibidas = document.querySelectorAll('#lista-cartelas .cartela').length;
          return exibidas > 0 && exibidas === anunciadas ? { anunciadas, exibidas } : null;
        },
        undefined,
        { timeout: 20000 }
      )
      .then((alca) => alca.jsonValue());
  } catch {
    coerente = false;
    durante = await pagina.evaluate(() => ({
      anunciadas: Number(document.getElementById('melhor-cartelas').textContent.trim()),
      exibidas: document.querySelectorAll('#lista-cartelas .cartela').length,
    }));
  }
  marcar(
    coerente,
    'os jogos aparecem no Resultado enquanto a busca ainda corre',
    `painel anuncia ${durante.anunciadas}, aba mostra ${durante.exibidas}`
  );

  // Pausar precisa congelar de verdade: as iterações param de subir.
  await pagina.click('.aba[data-painel="buscar"]');
  await pagina.click('#pausar');
  await pagina.waitForFunction(
    () => document.getElementById('texto-situacao').textContent.includes('pausado'),
    undefined,
    { timeout: 10000 }
  );
  const iteracoesAoPausar = await texto('#iteracoes');
  await pagina.waitForTimeout(1500);
  marcar(
    (await texto('#iteracoes')) === iteracoesAoPausar,
    'pausar congela a busca de verdade',
    `parada em ${iteracoesAoPausar} iterações`
  );
  marcar(
    (await texto('#pausar')).includes('Continuar'),
    'o botão passa a oferecer continuar'
  );

  // Pausado, o resultado tem de estar completo — e é o momento certo de
  // conferir a cobertura, porque nada mais muda enquanto se lê.
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');
  const aoPausar = await pagina.evaluate(() => ({
    anunciadas: Number(document.getElementById('melhor-cartelas').textContent.trim()),
    exibidas: document.querySelectorAll('#lista-cartelas .cartela').length,
  }));
  marcar(
    aoPausar.exibidas > 0 && aoPausar.exibidas === aoPausar.anunciadas,
    'com a busca pausada, o resultado continua completo',
    `${aoPausar.exibidas} jogos`
  );

  const jogos20 = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );
  const { total, descoberto } = conferirCobertura(jogos20, VINTE, 15);
  marcar(
    total === 15504 && descoberto === null,
    'o que está na tela cobre os 15.504 sorteios, conferido fora do motor',
    descoberto ? `descoberto: ${descoberto.join(' ')}` : `${total} de 15.504`
  );

  // Continuar retoma de onde parou.
  await pagina.click('.aba[data-painel="buscar"]');
  await pagina.click('#pausar');
  await pagina.waitForFunction(
    (anterior) => document.getElementById('iteracoes').textContent.trim() !== anterior,
    iteracoesAoPausar,
    { timeout: 15000 }
  );
  marcar(true, 'continuar retoma de onde parou');

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 15000 });

  // ─── 7. persistência ───
  const guardadas = await pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:historico');
    return bruto ? JSON.parse(bruto).length : 0;
  });
  marcar(guardadas > 0, 'os trabalhos ficam salvos no aparelho', `${guardadas} no histórico`);

  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  const listadas = await pagina.locator('.sessao').count();
  marcar(
    listadas === guardadas,
    'ao reabrir, o histórico continua lá',
    `${listadas} trabalhos listados`
  );

  const descricao = (await pagina.locator('.sessao-config').first().textContent()).trim();
  marcar(
    /dezenas · jogos de/.test(descricao),
    'e descreve os trabalhos na língua da modalidade',
    descricao.replace(/\s+/g, ' ').slice(0, 60)
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
