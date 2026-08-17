/*
 * Teste de ponta a ponta da interface, num navegador de verdade.
 *
 * Os testes em Rust provam que a matemática está certa. Este prova que ela
 * chega até a tela: que o WebAssembly carrega, que o worker responde, que o
 * botão faz o que promete e que as cartelas exibidas realmente cobrem o que
 * dizem cobrir.
 *
 * A verificação final é feita aqui em JavaScript, lendo o que está na tela —
 * sem tocar em nada do Rust. Se a conta fosse refeita pelo mesmo código que a
 * produziu, o teste não provaria nada.
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

/** Confere, de forma independente, que o fechamento cobre todos os pares. */
function conferirCobertura(cartelas, pool) {
  const faltando = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (!cartelas.some((c) => c.includes(a) && c.includes(b))) {
        faltando.push([a, b]);
      }
    }
  }
  return faltando;
}

const passos = [];
function marcar(certo, descricao, detalhe = '') {
  passos.push({ certo, descricao, detalhe });
  const simbolo = certo ? '  ✓' : '  ✗';
  console.log(`${simbolo} ${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
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


console.log(`Teste de ponta a ponta — interface no iPhone (servindo em ${BASE})\n`);

try {
  await pagina.goto(`http://localhost:${PORTA}${BASE}`, { waitUntil: 'networkidle' });

  marcar(await pagina.locator('h1').isVisible(), 'a página carrega');

  // ─── configuração ───
  // C(16,4,2) = 20, que o motor sabe provar. Assim o teste tem um alvo exato.
  await pagina.fill('#universo', '16');
  await pagina.fill('#pool', '16');
  await pagina.fill('#cartela', '4');
  await pagina.fill('#cobrir', '2');

  const previsao = await pagina.locator('#texto-previsao').textContent();
  marcar(
    previsao.includes('120'),
    'a previsão calcula o tamanho do problema',
    previsao.trim().slice(0, 60)
  );

  await pagina.screenshot({ path: 'capturas/captura-configurar.png' });



  // ─── a resposta imediata ao toque ───
  //
  // O defeito que isto cobre: a tela de busca só aparecia depois de o
  // WebAssembly carregar. Do lado do usuário, o toque no botão não produzia
  // reação nenhuma por vários segundos — indistinguível de um aplicativo
  // quebrado.
  const antesDoToque = Date.now();
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  const atraso = Date.now() - antesDoToque;

  marcar(
    atraso < 1000,
    'a tela responde ao toque de imediato',
    `${atraso} ms até trocar de tela`
  );

  const situacaoInicial = await pagina.locator('#texto-situacao').textContent();
  marcar(
    /carregando|montando|procurando/.test(situacaoInicial),
    'a tela diz o que está acontecendo',
    `"${situacaoInicial.trim()}"`
  );

  // A faixa precisa estar num estado vivo — trabalhando ou já concluída.
  //
  // Exigir só "trabalhando" virou uma corrida depois que a construção algébrica
  // passou a resolver C(16,4,2) antes da primeira iteração: numa máquina rápida
  // a busca termina entre o clique e esta leitura, a faixa já está em
  // "concluída", e o teste acusava um defeito que não existe. O que não pode
  // acontecer é a faixa ficar morta, sem dizer nada.
  const faixaViva = await pagina.locator('#situacao').getAttribute('class');
  marcar(
    /trabalhando|concluida/.test(faixaViva),
    'a faixa de situação está viva',
    faixaViva.replace('situacao', '').trim() || 'sem estado'
  );

  // Antes de qualquer iteração já existe uma solução na tela: é a construção
  // inicial, separada justamente para o usuário não ficar olhando para o vazio.
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 20000 }
  );
  const primeiraSolucao = await pagina.locator('#melhor-cartelas').textContent();
  marcar(
    Number(primeiraSolucao) > 0,
    'uma primeira solução aparece antes da busca',
    `${primeiraSolucao.trim()} cartelas de partida`
  );

  // Só agora o worker existe e o WebAssembly foi buscado. Um caminho absoluto
  // funcionaria na raiz e falharia aqui — que é exatamente a condição do
  // GitHub Pages.
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

  // O motor precisa chegar ao ótimo provado; C(16,4,2) leva alguns segundos.
  await pagina.waitForSelector('#selo-otimo:not([hidden])', { timeout: 90000 });

  const melhor = await pagina.locator('#melhor-cartelas').textContent();
  const limite = await pagina.locator('#limite-inferior').textContent();
  const iteracoes = await pagina.locator('#iteracoes').textContent();
  const velocidade = await pagina.locator('#velocidade').textContent();

  marcar(melhor.trim() === '20', 'chega ao ótimo conhecido de C(16,4,2)', `${melhor} cartelas`);
  marcar(limite.trim() === '20', 'o limite inferior confere', `≥ ${limite}`);
  marcar(true, 'velocidade no navegador', `${velocidade} iterações por segundo`);
  marcar(true, 'iterações executadas', iteracoes);

  const quantosRecordes = await pagina.locator('#lista-recordes li').count();
  marcar(quantosRecordes >= 1, 'a lista de recordes registra a solução', `${quantosRecordes} recordes`);

  // C(16,4,2) é o plano afim AG(2,4): sai pronto da construção algébrica, sem
  // uma única iteração de busca. Antes, a mesma configuração levava segundos de
  // busca para chegar às mesmas 20 cartelas.
  marcar(
    Number(iteracoes.replace(/\D/g, '')) === 0,
    'a construção algébrica resolve antes da primeira iteração',
    `${iteracoes} iterações`
  );

  const referencia = (await pagina.locator('#referencia-busca').textContent()).trim();
  marcar(
    /melhor conhecido no mundo/i.test(referencia) && referencia.includes('20'),
    'a tela mostra o melhor conhecido no mundo',
    referencia.replace(/\s+/g, ' ').slice(0, 78)
  );

  await pagina.screenshot({ path: 'capturas/captura-buscar.png' });

  // ─── resultado ───
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');

  const cartelas = await pagina.$$eval('#lista-cartelas .cartela span:last-child', (nos) =>
    nos.map((n) => n.textContent.trim().split(/\s+/).map(Number))
  );

  marcar(cartelas.length === 20, 'as 20 cartelas aparecem na tela', `${cartelas.length} exibidas`);
  marcar(
    cartelas.every((c) => c.length === 4),
    'toda cartela tem os 4 números pedidos'
  );

  const pool = Array.from({ length: 16 }, (_, i) => i + 1);
  const faltando = conferirCobertura(cartelas, pool);
  marcar(
    faltando.length === 0,
    'verificação independente: todos os 120 pares cobertos',
    faltando.length ? `faltaram ${faltando.length}` : '120 de 120'
  );

  const redundancia = await pagina.locator('#res-redundancia').textContent();
  marcar(
    redundancia.trim() === '0',
    'redundância zero: é um sistema de Steiner exato',
    `redundância ${redundancia}`
  );

  await pagina.screenshot({ path: 'capturas/captura-resultado.png' });

  // ─── uma busca longa: relógio, pausa e encerramento ───
  //
  // Precisa ser uma configuração que fique de fato correndo — é a condição em
  // que o relógio, o botão de pausa e o de encerrar são exercitados. Num
  // problema que termina antes do primeiro segundo, nada disso chega a ser
  // testado.
  //
  // Aqui já esteve C(25,5,2), que levava minutos. Não serve mais: é o plano
  // afim AG(2,5) e agora sai pronto por construção. C(26,6,3) não tem fórmula
  // fechada neste projeto e o melhor conhecido no mundo (130) está muito
  // abaixo do que a busca alcança em segundos, então ela não para.
  await pagina.click('.aba[data-painel="configurar"]');
  // O universo precisa acompanhar o pool: um pool maior que o universo é
  // configuração inválida, e a tela recusa iniciar — corretamente.
  await pagina.fill('#universo', '26');
  await pagina.fill('#pool', '26');
  await pagina.fill('#cartela', '6');
  await pagina.fill('#cobrir', '3');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });

  // ─── o resultado durante a busca ───
  //
  // O defeito que isto cobre: as cartelas apareciam na aba Resultado só depois
  // que a busca terminava. Durante a busca — que é quando o usuário vai olhar,
  // porque o motor já anunciou ter encontrado algo — a aba ficava vazia.
  //
  // A causa era o caminho que as cartelas percorriam: worker → armazenamento
  // local → temporizador → tela. A gravação esperava na fila atrás da leva de
  // iterações em curso, enquanto o temporizador já lia. O teste antigo não
  // pegava porque só conferia a aba depois do fim, quando tudo já assentou.
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 30000 }
  );

  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');

  /*
   * Os dois números são lidos no mesmo instante, dentro de uma única avaliação.
   * Lê-los em momentos diferentes daria falso negativo numa busca veloz: entre
   * uma leitura e outra o motor encontra uma solução melhor, e os valores
   * divergem sem que nada esteja errado.
   *
   * Com o defeito presente a lista ficaria vazia e a espera estouraria — que é
   * exatamente o que se quer detectar.
   */
  let durante = { anunciadas: 0, exibidas: 0 };
  let coerente = true;
  try {
    durante = await pagina.waitForFunction(
      () => {
        const anunciadas = Number(
          document.getElementById('melhor-cartelas').textContent.trim()
        );
        const exibidas = document.querySelectorAll('#lista-cartelas .cartela').length;
        return exibidas > 0 && exibidas === anunciadas ? { anunciadas, exibidas } : null;
      },
      undefined,
      { timeout: 15000 }
    ).then((alca) => alca.jsonValue());
  } catch {
    coerente = false;
    durante = await pagina.evaluate(() => ({
      anunciadas: Number(document.getElementById('melhor-cartelas').textContent.trim()),
      exibidas: document.querySelectorAll('#lista-cartelas .cartela').length,
    }));
  }

  marcar(
    coerente,
    'as cartelas aparecem no Resultado enquanto a busca ainda corre',
    `painel anuncia ${durante.anunciadas}, aba mostra ${durante.exibidas}`
  );

  await pagina.click('.aba[data-painel="buscar"]');

  // O relógio precisa andar. É a prova de vida que não exige entender nada do
  // que está escrito na tela.
  marcar(
    await pagina.locator('#situacao.trabalhando').isVisible(),
    'numa busca que dura, o indicador de atividade pulsa'
  );

  const relogioAntes = await pagina.locator('#relogio').textContent();
  await pagina.waitForFunction(
    (anterior) => document.getElementById('relogio').textContent !== anterior,
    relogioAntes,
    { timeout: 8000 }
  );
  marcar(true, 'o relógio corre durante a busca', `saiu de ${relogioAntes}`);

  // Numa configuração difícil as melhorias vêm ao longo de segundos, não no
  // primeiro instante — esperar por elas é mais fiel do que fotografar a lista
  // assim que o relógio anda.
  let recordesLongos = 0;
  try {
    await pagina.waitForFunction(
      () => document.querySelectorAll('#lista-recordes li').length > 1,
      undefined,
      { timeout: 20000 }
    );
  } catch {
    /* o marcar abaixo reporta o que houver */
  }
  recordesLongos = await pagina.locator('#lista-recordes li').count();
  marcar(
    recordesLongos > 1,
    'a lista de recordes acompanha a evolução',
    `${recordesLongos} recordes`
  );

  const distancia = (await pagina.locator('#referencia-busca').textContent()).trim();
  marcar(
    /faltam?\s/.test(distancia),
    'a tela diz quanto falta para o melhor do mundo',
    distancia.replace(/\s+/g, ' ').slice(0, 78)
  );

  // Pausar precisa congelar de verdade: as iterações param de subir.
  await pagina.click('#pausar');
  await pagina.waitForFunction(
    () => document.getElementById('texto-situacao').textContent.includes('pausado'),
    undefined,
    { timeout: 10000 }
  );
  const iteracoesAoPausar = await pagina.locator('#iteracoes').textContent();
  await pagina.waitForTimeout(1500);
  marcar(
    (await pagina.locator('#iteracoes').textContent()) === iteracoesAoPausar,
    'pausar congela a busca de verdade',
    `parada em ${iteracoesAoPausar} iterações`
  );
  marcar(
    (await pagina.locator('#pausar').textContent()).includes('Continuar'),
    'o botão passa a oferecer continuar'
  );

  // Pausado, o resultado tem de estar completo e coerente com o painel.
  // Pausado nada mais muda, então uma leitura única já é confiável.
  await pagina.click('.aba[data-painel="resultado"]');
  await pagina.waitForSelector('#resultado.ativo');
  const aoPausar = await pagina.evaluate(() => ({
    anunciadas: Number(document.getElementById('melhor-cartelas').textContent.trim()),
    exibidas: document.querySelectorAll('#lista-cartelas .cartela').length,
  }));
  marcar(
    aoPausar.exibidas > 0 && aoPausar.exibidas === aoPausar.anunciadas,
    'com a busca pausada, o resultado continua completo',
    `${aoPausar.exibidas} cartelas`
  );
  await pagina.click('.aba[data-painel="buscar"]');

  // Continuar retoma de onde parou.
  await pagina.click('#pausar');
  await pagina.waitForFunction(
    (anterior) => document.getElementById('iteracoes').textContent !== anterior,
    iteracoesAoPausar,
    { timeout: 10000 }
  );
  marcar(true, 'continuar retoma de onde parou');

  // ─── encerrar ───
  //
  // O defeito que isto cobre: o botão antigo só trocava de aba, e a busca
  // continuava rodando por baixo, consumindo processador e bateria.
  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });
  marcar(true, 'encerrar devolve à tela de configuração');

  const situacaoFinal = await pagina.locator('#situacao').getAttribute('class');
  marcar(
    !situacaoFinal.includes('trabalhando'),
    'encerrar realmente para o motor',
    `situação: "${situacaoFinal.replace('situacao', '').trim() || 'parada'}"`
  );

  // E as iterações param de subir de vez — se o worker tivesse sobrevivido,
  // continuariam correndo em segundo plano.
  const iteracoesAoEncerrar = await pagina.locator('#iteracoes').textContent();
  await pagina.waitForTimeout(2000);
  marcar(
    (await pagina.locator('#iteracoes').textContent()) === iteracoesAoEncerrar,
    'nada continua rodando em segundo plano',
    `congelado em ${iteracoesAoEncerrar}`
  );

  // E dá para começar outra busca em seguida, com outra configuração.
  await pagina.fill('#universo', '13');
  await pagina.fill('#pool', '13');
  await pagina.fill('#cartela', '4');
  await pagina.fill('#cobrir', '2');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForSelector('#selo-otimo:not([hidden])', { timeout: 60000 });
  const segunda = await pagina.locator('#melhor-cartelas').textContent();
  marcar(
    segunda.trim() === '13',
    'uma segunda busca roda limpa depois de encerrar',
    `C(13,4,2) = 13, encontrou ${segunda.trim()}`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });

  // ─── importar um fechamento pronto ───
  //
  // É a segunda metade do processo em duas etapas: o resultado de qualquer
  // outra ferramenta entra aqui e o motor continua a partir dele, em vez de
  // recomeçar do zero.
  await pagina.fill('#universo', '9');
  await pagina.fill('#pool', '9');
  await pagina.fill('#cartela', '3');
  await pagina.fill('#cobrir', '2');

  // Um erro de digitação primeiro: precisa apontar a linha e não deixar o
  // usuário preso na tela de busca com um aviso que some sozinho.
  await pagina.locator('#importar summary').click();
  await pagina.fill('#texto-fechamento', '1 2 3\n4 5 seis');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#erro-fechamento:not([hidden])', { timeout: 20000 });
  const erroImportacao = (await pagina.locator('#erro-fechamento').textContent()).trim();
  marcar(
    erroImportacao.includes('linha 2'),
    'texto inválido aponta a linha, junto da caixa onde foi colado',
    erroImportacao
  );
  marcar(
    await pagina.locator('#configurar.ativo').isVisible(),
    'e devolve o usuário à tela onde ele conserta'
  );

  // Agora um fechamento válido, com os separadores e comentários que aparecem
  // na prática. É o mesmo interpretador da linha de comando.
  const fechamentoColado = [
    '# fechamento vindo de outra ferramenta',
    '1 2 3',
    '4,5,6',
    '7 - 8 - 9',
  ].join('\n');
  await pagina.fill('#texto-fechamento', fechamentoColado);
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForSelector('#selo-otimo:not([hidden])', { timeout: 90000 });

  const partindoDoColado = await pagina.locator('#melhor-cartelas').textContent();
  marcar(
    partindoDoColado.trim() === '12',
    'a busca parte do fechamento colado e chega ao ótimo de C(9,3,2)',
    `${partindoDoColado.trim()} cartelas`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });
  await pagina.fill('#texto-fechamento', '');

  // ─── teto de cartelas: a comparação com o mundo tem de se calar ───
  //
  // Com teto o objetivo é cobrir o máximo possível dentro dele, e a solução tem
  // cobertura parcial de propósito. Comparar a contagem de cartelas com o
  // recorde mundial ali anunciaria "acima do melhor conhecido no mundo" para um
  // fechamento furado.
  await pagina.fill('#universo', '21');
  await pagina.fill('#pool', '21');
  await pagina.fill('#cartela', '5');
  await pagina.fill('#cobrir', '2');
  await pagina.fill('#orcamento', '8');
  await pagina.click('#iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 15000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('melhor-cartelas').textContent.trim();
      return t !== '' && t !== '—';
    },
    undefined,
    { timeout: 20000 }
  );

  const comTeto = await pagina.evaluate(() => ({
    selo: !document.getElementById('selo-recorde').hidden,
    texto: document.getElementById('referencia-busca').textContent.trim(),
    cobertura: document.getElementById('cobertura').textContent.trim(),
  }));
  marcar(
    !comTeto.selo,
    'com teto de cartelas, nada é anunciado como recorde mundial',
    `cobertura ${comTeto.cobertura}`
  );
  marcar(
    /não se comparam/.test(comTeto.texto),
    'e a tela explica por que os números não se comparam',
    comTeto.texto.replace(/\s+/g, ' ').slice(0, 78)
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#configurar.ativo', { timeout: 10000 });
  await pagina.fill('#orcamento', '');

  // ─── persistência ───
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

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
