/*
 * Teste da ferramenta Lotinha, num navegador de verdade.
 *
 * O que precisa ficar provado:
 *
 *   1. A escolha das dezenas é do usuário, e o pool aceita de 17 a 25 — as 25
 *      inclusive, quando o sorteio cai dentro com certeza.
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
    tamanhos.join(',') === '17,18,19,20,21,22,23,24,25',
    'o pool vai de 17 a 25 dezenas — as bancas param em 23, a matemática não',
    tamanhos.join(' · ')
  );

  const quantosNumeros = await pagina.locator('#lot-grade .numero').count();
  marcar(quantosNumeros === 25, 'as 25 dezenas do universo estão na tela');

  const linhasMatriz = await pagina.locator('#lot-matriz tbody tr').count();
  marcar(linhasMatriz === 45, 'a matriz cobre as 45 combinações da modalidade', `${linhasMatriz} linhas`);

  const emAberto = await pagina.locator('#lot-matriz td.aberto').count();
  marcar(emAberto === 21, 'e marca as 21 em que o mínimo é problema aberto', `${emAberto} marcadas`);

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

  // ─── 3b. o piso é o mais forte que se sabe, não o mais fácil de calcular ───
  //
  // Um limite inferior fraco não erra — ele só é inútil. E este errava por
  // muito: a cota de contagem diz que 20 dezenas com jogos de 17 não fecham com
  // menos de 114, quando a de Schönheim prova 160. A tela mostrava 114 e a de
  // Buscar mostrava 160, para o mesmo problema.
  //
  // A prova de que a cota certa é a de Schönheim não é teórica: nas 15
  // combinações desta modalidade em que o mínimo verdadeiro é **conhecido** —
  // as de `a ≤ 2`, onde há teorema fechado — ela acerta as 15 sem folga
  // nenhuma. Se um piso alcança o mínimo em todo caso em que o mínimo é
  // sabido, é esse piso que merece ir para a tela.
  //
  // Aqui a cota é recalculada do zero, em inteiros exatos, sem tocar em
  // `lotinha.js`. As duas contas têm de bater.
  const pisos = await pagina.evaluate(async () => {
    const lot = await import('./lotinha.js');

    // Schönheim reimplementada com BigInt: L(v,k,t) = ⌈(v/k)·L(v−1,k−1,t−1)⌉.
    // O `lotinha.js` usa ponto flutuante, que é rápido e cabe nos tamanhos
    // desta modalidade — mas quem confere não pode usar a mesma aritmética de
    // quem é conferido.
    const tetoDe = (a, b) => (a + b - 1n) / b;
    const L = (v, k, t) => {
      if (t === 1) return tetoDe(BigInt(v), BigInt(k));
      return tetoDe(BigInt(v) * L(v - 1, k - 1, t - 1), BigInt(k));
    };

    // E a de contagem, que é a que estava na tela: C(P,15) sorteios a atender,
    // C(k,15) atendidos por jogo.
    const C = (n, k) => {
      if (k < 0 || k > n) return 0n;
      let r = 1n;
      for (let i = 0n; i < BigInt(k); i++) r = (r * (BigInt(n) - i)) / (i + 1n);
      return r;
    };

    const linhas = [];
    for (const l of lot.matriz()) {
      linhas.push({
        pool: l.pool,
        jogo: l.jogo,
        exato: l.exato,
        jogos: l.jogos,
        piso: l.piso,
        schonheim: Number(L(l.pool, l.jogo, 15)),
        contagem: Number(tetoDe(C(l.pool, 15), C(l.jogo, 15))),
      });
    }
    return linhas;
  });

  const conhecidas = pisos.filter((l) => l.exato && l.jogos > 1);
  const cravadas = conhecidas.filter((l) => l.piso === l.jogos);
  marcar(
    conhecidas.length === 15 && cravadas.length === 15,
    'onde o mínimo é conhecido, o piso da tela é o próprio mínimo',
    `${cravadas.length} de ${conhecidas.length} combinações cravadas`
  );

  const frouxas = conhecidas.filter((l) => l.contagem < l.jogos);
  marcar(
    frouxas.length === conhecidas.length,
    'e a cota de contagem sozinha ficaria abaixo do mínimo em todas elas',
    `pior caso: ${Math.max(...frouxas.map((l) => Math.round((l.jogos / l.contagem - 1) * 100)))}% de folga`
  );

  const abaixo = pisos.filter((l) => l.piso < l.schonheim);
  marcar(
    abaixo.length === 0,
    'a conta do aplicativo bate com a de inteiros exatos, sem perder precisão',
    `${pisos.length} combinações conferidas em BigInt`
  );

  // ─── 3c. a tela diz a que distância do piso ela está ───
  //
  // "Não dá com menos de 11.967" é verdade e é inútil sozinho: o usuário recebe
  // 26.844 jogos e não tem como saber se o aplicativo falhou ou se o problema é
  // assim mesmo. A tela passa a dizer os dois números e de onde o maior vem —
  // porque a origem é o que muda a decisão de deixar o motor rodando.
  const distancia = async (pool, jogo) => {
    await pagina.click(`#lot-pool .opcao[data-pool="${pool}"]`);
    await pagina.click(`#lot-jogo .opcao[data-jogo="${jogo}"]`);
    return {
      explicacao: (await pagina.locator('#lot-explicacao').textContent()).replace(/\s+/g, ' '),
      economia: (await pagina.locator('#lot-economia').textContent()).replace(/\s+/g, ' '),
    };
  };

  const doBanco = await distancia(23, 17);
  marcar(
    /10\.122/.test(doBanco.explicacao) &&
      /3\.996/.test(doBanco.explicacao) &&
      /buscar mais rende pouco/.test(doBanco.explicacao),
    'num caso já buscado, a tela mostra entrega, piso e que buscar mais rende pouco',
    doBanco.explicacao.slice(-76).trim()
  );

  // A única combinação da modalidade sem resposta pronta: 25 dezenas com jogos
  // de 17. A construção por grupos tem 1,08 milhão de jogos e o motor chegou a
  // 81 mil — grande demais para viajar dentro do aplicativo. Aqui a tela não
  // pode inventar um tamanho, e não inventa.
  const semPronto = await distancia(25, 17);
  marcar(
    /só aparece depois/.test(semPronto.explicacao) && /27\.124/.test(semPronto.explicacao),
    'e onde nada está pronto, não inventa um tamanho que ainda não existe',
    semPronto.explicacao.slice(-76).trim()
  );
  marcar(
    /o piso conhecido/.test(semPronto.economia),
    'aí o custo vem rotulado como piso, em vez de prometer um preço',
    semPronto.economia.slice(0, 70).trim()
  );

  // E o placar geral: quantas das 45 combinações já saem prontas do aplicativo,
  // sem o motor precisar ser acionado. É o que o pré-processamento comprou.
  const prontidao = await pagina.evaluate(async () => {
    const lot = await import('./lotinha.js');
    await lot.carregarBanco();
    let prontas = 0;
    for (const l of lot.matriz()) {
      if (lot.previsao(l.pool, l.jogo).quantidade !== null) prontas++;
    }
    return prontas;
  });
  marcar(
    prontidao === 44,
    '44 das 45 combinações têm o tamanho conhecido antes do toque',
    `${prontidao} de 45`
  );

  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');

  // ─── 3d. a fórmula alcança o mínimo onde o mínimo é conhecido ───
  //
  // A construção que o aplicativo usa quando não há resposta pronta deixou de
  // ser "parta o pool em grupos e compre todos os subconjuntos". Essa perdia
  // feio quando faltavam muitas dezenas ao jogo: em 25 dezenas com jogos de 19
  // pedia 177.100 jogos contra um piso de 1.261.
  //
  // A nova soma três argumentos e fica com o menor deles — o terceiro é uma
  // recursão por um ponto, que é onde está o ganho. O teste da qualidade dela é
  // direto: nas 24 combinações em que o mínimo é comprovado, a fórmula tem de
  // **acertar o mínimo**, sem folga. Uma construção que erre ali não merece
  // confiança onde o mínimo é desconhecido.
  const formula = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) =>
      lot.matriz().map((l) => ({
        pool: l.pool,
        jogo: l.jogo,
        exato: l.exato,
        jogos: l.jogos,
        piso: l.piso,
        construcao: lot.tamanhoDaConstrucao(l.pool, l.jogo),
      }))
    )
  );

  const comprovadas = formula.filter((l) => l.exato);
  const naMosca = comprovadas.filter((l) => l.construcao === l.jogos);
  marcar(
    comprovadas.length === 24 && naMosca.length === 24,
    'nas 24 combinações de mínimo comprovado, a fórmula acerta o mínimo',
    `${naMosca.length} de ${comprovadas.length}`
  );

  // E acima do piso em todas — uma construção abaixo do piso seria defeito de
  // cobertura disfarçado de recorde.
  marcar(
    formula.every((l) => l.construcao >= l.piso),
    'e nenhuma construção fica abaixo do piso matemático',
    `${formula.length} combinações conferidas`
  );

  // A prova de que ela cobre não é o argumento: é a varredura. 24 dezenas com
  // jogos de 20 é o caso onde a fórmula nova bate até o motor — 400 contra os
  // 499 que ele achou — e são 1.307.504 sorteios para conferir um a um.
  const varredura = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) => {
      const dezenas = Array.from({ length: 24 }, (_, i) => i + 1);
      const jogos = lot.construir(24, 20, dezenas);
      const c = lot.conferirCobertura(dezenas, jogos, 15, 1, { exaustivo: true });
      return { jogos: jogos.length, cobertos: c.cobertos, total: c.total };
    })
  );
  marcar(
    varredura.jogos === 400 && varredura.cobertos === varredura.total,
    'e os 400 jogos que ela dá em 24/20 cobrem os sorteios, um a um',
    `${varredura.cobertos} de ${varredura.total} sorteios`
  );

  // ─── 4. o fechamento pronto, e a conferência ───
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Garantia/.test(document.getElementById('lot-conferencia').textContent),
    undefined,
    { timeout: 30000 }
  );

  const conferencia = (await pagina.locator('#lot-conferencia').textContent()).trim();
  marcar(
    /Garantia comprovada: 100%/.test(conferencia),
    'o validador do aplicativo confirma 100% da garantia',
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

  // ─── 8. garantir mais de uma cartela premiada ───
  //
  // A funcionalidade e a surpresa que ela guarda: num pool de 18 com jogos de
  // 17, a segunda cartela premiada custa **um** jogo, não dezesseis. E há um
  // teto — só 3 jogos distintos podem conter um mesmo sorteio, porque cada jogo
  // é o pool menos uma dezena e o sorteio deixa 3 de fora.
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  const opcoesPremiadas = await pagina.$$eval('#lot-premiadas .opcao', (b) =>
    b.map((x) => x.textContent)
  );
  marcar(
    opcoesPremiadas.join(',') === '1,2,3',
    'o teto de cartelas premiadas respeita quantos jogos podem premiar juntos',
    opcoesPremiadas.join(' · ')
  );

  await pagina.click('#lot-premiadas .opcao[data-premiadas="2"]');
  const comDuas = (await pagina.locator('#lot-explicacao').textContent()).trim();
  marcar(
    /17 jogos/.test(comDuas) && /mínimo comprovado/.test(comDuas),
    'duas cartelas premiadas custam um jogo a mais, e isso é comprovado',
    comDuas.replace(/\s+/g, ' ').slice(0, 76)
  );

  // O banco embutido só guarda o caso padrão — garantir as 15 numa cartela.
  // Para duas cartelas premiadas não há entrada lá, e mesmo assim o fechamento
  // sai na hora: `15 + r` é fórmula fechada, e a tela não precisa do motor
  // para entregá-la.
  const antesDeCarregar = Date.now();
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Garantia|conferidos ao acaso/.test(
      document.getElementById('lot-conferencia').textContent
    ),
    undefined,
    { timeout: 60000 }
  );
  const demorou = Date.now() - antesDeCarregar;
  marcar(
    demorou < 5000,
    'sem entrada no banco, a fórmula entrega o fechamento sem acionar o motor',
    `${demorou} ms`
  );

  await pagina.waitForFunction(
    () => document.getElementById('melhor-cartelas').textContent.trim() === '17',
    undefined,
    { timeout: 120000 }
  );
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.click('#lot-conferir');
  await pagina.waitForFunction(
    () => /Garantia comprovada|Garantia cumprida/.test(
      document.getElementById('lot-conferencia').textContent
    ),
    undefined,
    { timeout: 60000 }
  );
  const duasPremiadas = (await pagina.locator('#lot-conferencia').textContent()).trim();
  marcar(
    /Garantia comprovada: 100%/.test(duasPremiadas) && /2 cartelas com 15/.test(duasPremiadas),
    'e a conferência independente confirma as duas cartelas premiadas, sorteio a sorteio',
    duasPremiadas.replace(/\s+/g, ' ').slice(0, 92)
  );

  // ─── 8b. trocar a exigência invalida o que estava carregado ───
  //
  // O defeito que isto cobre: a economia continuava calculando em cima do
  // fechamento antigo enquanto a explicação já falava do novo. Cada um estava
  // certo sobre uma pergunta diferente, e juntos mentiam.
  await pagina.click('#lot-premiadas .opcao[data-premiadas="1"]');
  const economiaUma = (await pagina.locator('#lot-economia').textContent()).match(/(\d+) jogos/);
  await pagina.click('#lot-premiadas .opcao[data-premiadas="2"]');
  const economiaDuas = (await pagina.locator('#lot-economia').textContent()).match(/(\d+) jogos/);
  const explicaDuas = (await pagina.locator('#lot-explicacao').textContent()).match(/(\d+) jogos bastam/);
  marcar(
    economiaUma?.[1] === '16' && economiaDuas?.[1] === '17' && explicaDuas?.[1] === '17',
    'trocar a exigência atualiza a economia junto com a explicação',
    `${economiaUma?.[1]} → ${economiaDuas?.[1]}, explicação diz ${explicaDuas?.[1]}`
  );

  // ─── 9. garantir menos de 15, e a honestidade que isso exige ───
  await pagina.click('#lot-premiadas .opcao[data-premiadas="1"]');
  await pagina.click('#lot-garantia .opcao[data-garantia="13"]');
  const economiaParcial = (await pagina.locator('#lot-economia').textContent()).trim();
  marcar(
    /Prêmio garantido nesta modalidade/.test(economiaParcial) &&
      /nenhum/.test(economiaParcial),
    'garantir 13 não promete prêmio na Lotinha, e a tela diz isso',
    economiaParcial.replace(/\s+/g, ' ').slice(0, 92)
  );

  // ─── 10. as 25 dezenas: o sorteio cai dentro com certeza ───
  await pagina.click('#lot-garantia .opcao[data-garantia="15"]');
  await pagina.click('#lot-pool .opcao[data-pool="25"]');
  // Trocar de pool preserva o que já estava marcado; faltam as demais.
  for (let n = 1; n <= 25; n++) {
    if (!ESCOLHIDAS.includes(n)) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  }
  const contagem25 = (await pagina.locator('#lot-contagem').textContent()).trim();
  marcar(
    /25 de 25/.test(contagem25) && /1 em 1/.test(contagem25),
    'com as 25 dezenas, a chance de o sorteio cair no pool é 1 em 1',
    contagem25.replace(/\s+/g, ' ').slice(0, 76)
  );

  // ─── 10b. o banco vem no formato enxuto ───
  //
  // O banco guarda o **complemento** de cada jogo: as dezenas que faltam, não
  // as que estão. Num pool de 23 com jogos de 17 são 6 números em vez de 17.
  // Não é economia de arquivo por economia: é o que permite ter 44 das 45
  // combinações prontas de fábrica em vez de 28.
  const banco = await pagina.evaluate(async () => {
    const r = await fetch('./lotinha.json');
    const b = await r.json();
    const chaves = Object.keys(b.fechamentos ?? {});
    const exemplo = chaves.find((c) => c.startsWith('23,17')) ?? chaves.at(-1);
    return {
      formato: b.formato,
      entradas: chaves.length,
      exemplo,
      tamanhoDaLinha: exemplo ? b.fechamentos[exemplo][0].length : null,
    };
  });
  marcar(
    banco.formato === 2,
    'o banco declara o formato de complementos',
    `formato ${banco.formato}, ${banco.entradas} combinações prontas`
  );
  marcar(
    banco.exemplo !== '23,17' || banco.tamanhoDaLinha === 6,
    'e guarda o que falta ao jogo, não o jogo',
    `${banco.exemplo}: ${banco.tamanhoDaLinha} números por linha`
  );

  // ─── 11. a fórmula: caminho rápido, e correto ───
  //
  // Antes desta mudança, 25 dezenas com jogos de 22 ligavam um motor de 39 MB,
  // rodavam um guloso de seis segundos e chegavam a 139 jogos. Hoje saem 72 do
  // banco, na hora. O motor deixou de partir sozinho nos pools pesados: ele
  // passou a ser um segundo passo, para quem quiser tentar reduzir mais.
  await pagina.click('#lot-pool .opcao[data-pool="25"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="22"]');
  const antesDaFormula = Date.now();
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Garantia|conferidos ao acaso/.test(
      document.getElementById('lot-conferencia').textContent
    ),
    undefined,
    { timeout: 60000 }
  );
  const tempoDaFormula = Date.now() - antesDaFormula;
  const daFormula = (await pagina.locator('#lot-conferencia').textContent()).trim();

  marcar(
    /usando 72 jogos/.test(daFormula),
    '25 dezenas com jogos de 22 saem com 72 jogos, não com os 139 do guloso',
    daFormula.replace(/\s+/g, ' ').slice(0, 76)
  );

  // A fórmula continua viva e continua certa, mesmo tendo deixado de ser o
  // caminho de entrega: ela é o que sobra se o banco não puder ser lido, e é
  // dela que o gerador parte. Chamada direto, dá 78 — pior que os 72 que o
  // motor achou, e ainda assim muito melhor que os 139 do guloso.
  const semBanco = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) =>
      lot.construir(25, 22, Array.from({ length: 25 }, (_, i) => i + 1)).length
    )
  );
  marcar(
    semBanco === 78,
    'e a fórmula, que é o que sobra sem o banco, chega perto sozinha',
    `${semBanco} jogos por fórmula`
  );

  // E o número que a tela anunciou **antes** do toque tem de ser este. Uma
  // previsão que não bate com a entrega é pior do que previsão nenhuma: ela
  // vira preço errado no painel financeiro.
  const previsto = await pagina.evaluate(async () => {
    const lot = await import('./lotinha.js');
    await lot.carregarBanco();
    return lot.previsao(25, 22).quantidade;
  });
  marcar(
    previsto === 72,
    'e o número anunciado antes do toque é o mesmo que sai depois dele',
    `previsto ${previsto}, entregue 72`
  );
  marcar(
    tempoDaFormula < 4000,
    'e saem por fórmula, sem os seis segundos que o motor levava',
    `${tempoDaFormula} ms`
  );
  marcar(
    await pagina.locator('#lot-otimizar').isVisible(),
    'nos pools pesados o motor espera ser chamado, em vez de ligar sozinho'
  );

  // A amostra não pode se anunciar como prova.
  marcar(
    !/Garantia comprovada: 100%/.test(daFormula) || /conferidos um a um/.test(daFormula),
    'uma conferência por amostra nunca é apresentada como 100% comprovada',
    /ao acaso/.test(daFormula) ? 'diz "ao acaso"' : 'varreu tudo'
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
