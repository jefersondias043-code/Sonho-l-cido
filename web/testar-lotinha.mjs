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
// Tarefas longas: qualquer bloco de mais de 50 ms na linha principal é tempo em
// que o toque não responde. É o que mede "a tela travou".
await contexto.addInitScript(() => {
  window.__longas = [];
  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) window.__longas.push(Math.round(e.duration));
  }).observe({ entryTypes: ['longtask'] });
});
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
    tamanhos.join(',') === '15,16,17,18,19,20,21,22,23,24,25',
    'o pool vai de 15 a 25 dezenas — 15 é o sorteio, e abaixo dele não há aposta',
    tamanhos.join(' · ')
  );

  const quantosNumeros = await pagina.locator('#lot-grade .numero').count();
  marcar(quantosNumeros === 25, 'as 25 dezenas do universo estão na tela');

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
    conhecidas.length === 27 && cravadas.length === 27,
    'onde o mínimo é conhecido, o piso da tela é o próprio mínimo',
    `${cravadas.length} de ${conhecidas.length} combinações cravadas`
  );

  // A cota de contagem erra por muito quase sempre — e acerta em cheio numa
  // família só, a dos jogos de 15 dezenas. Ali cada cartela contém **um**
  // sorteio, o igual a ela, então "sorteios ÷ sorteios por cartela" não é
  // aproximação nenhuma: é a conta certa, e o mínimo é `C(P,15)`.
  const frouxas = conhecidas.filter((l) => l.contagem < l.jogos);
  const justas = conhecidas.filter((l) => l.contagem === l.jogos);
  marcar(
    frouxas.length === 17 && justas.length === 10 && justas.every((l) => l.jogo === 15),
    'e a cota de contagem fica abaixo do mínimo em 17 delas — só nos jogos de 15 ela acerta',
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
  // 26.837 jogos e não tem como saber se o aplicativo falhou ou se o problema é
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
    prontidao === 61,
    '61 das 66 combinações têm o tamanho conhecido antes do toque',
    `${prontidao} de 66`
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
    comprovadas.length === 38 && naMosca.length === 38,
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

  // ─── 3e. o piso e a construção valem para qualquer garantia ───
  //
  // Durante muito tempo o aplicativo só sabia fechar para **uma** cartela
  // premiada. O piso que ele mostrava para duas era o de uma, e a construção
  // simplesmente desistia: `construir()` devolvia `null` assim que faltavam
  // duas dezenas ao jogo e se pediam duas premiadas.
  //
  // Generalizar isso mexe no caminho mais usado do aplicativo, e é por isso que
  // o primeiro teste desta seção é uma **trava contra regressão**: com uma
  // cartela premiada, a construção precisa devolver exatamente o que devolvia
  // antes, nas 45 combinações. Os números abaixo foram tirados da versão
  // anterior e ficam aqui congelados de propósito — se algum mudar, a mudança
  // foi para pior e o teste tem de gritar.
  const ANTES_DE_GENERALIZAR = {
    '17,17': 1, '18,17': 16, '18,18': 1, '19,17': 51, '19,18': 16, '19,19': 1,
    '20,17': 240, '20,18': 40, '20,19': 16, '20,20': 1,
    '21,17': 1200, '21,18': 260, '21,19': 34, '21,20': 16, '21,21': 1,
    '22,17': 5016, '22,18': 660, '22,19': 126, '22,20': 30, '22,21': 16, '22,22': 1,
    '23,17': 18282, '23,18': 2838, '23,19': 651, '23,20': 147, '23,21': 27,
    '23,22': 16, '23,23': 1,
    '24,17': 59664, '24,18': 10560, '24,19': 1584, '24,20': 400, '24,21': 80,
    '24,22': 24, '24,23': 16, '24,24': 1,
    '25,17': 177672, '25,18': 35112, '25,19': 6072, '25,20': 1784, '25,21': 266,
    '25,22': 78, '25,23': 23, '25,24': 16, '25,25': 1,
  };
  const intacto = await pagina.evaluate((esperado) =>
    import('./lotinha.js').then((lot) =>
      Object.entries(esperado)
        .map(([chave, valor]) => {
          const [pool, jogo] = chave.split(',').map(Number);
          return { chave, valor, obtido: lot.tamanhoDaConstrucao(pool, jogo) };
        })
        .filter((l) => l.valor !== l.obtido)
    ), ANTES_DE_GENERALIZAR);
  marcar(
    intacto.length === 0,
    'com uma cartela premiada a construção não mudou uma vírgula nas 45 combinações',
    intacto.length ? intacto.map((l) => `${l.chave}: ${l.valor}→${l.obtido}`).join(', ') : '45 conferidas'
  );

  // O piso de Schönheim acompanha a garantia pela base da recursão: cada dezena
  // precisa aparecer em `r` jogos, e não em um. Onde falta uma dezena ao jogo o
  // mínimo é `15 + r`, e o piso tem de bater nele exatamente — senão ele não é
  // piso, é palpite.
  const pisoPorGarantia = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) => ({
      a1: [1, 2, 3, 4, 5].map((r) => lot.minimo(23, 22, 15, r).piso),
      a2: [1, 2, 3, 4].map((r) => lot.minimo(23, 21, 15, r).piso),
      umaSo: lot.minimo(23, 21, 15, 1).piso,
      duas: lot.minimo(23, 21, 15, 2).piso,
    }))
  );
  marcar(
    pisoPorGarantia.a1.every((v, i) => v === 15 + (i + 1)),
    'o piso segue a garantia: em 23/22 ele dá 15 + r, para r de 1 a 5',
    pisoPorGarantia.a1.join(', ')
  );
  marcar(
    pisoPorGarantia.umaSo === 27 && pisoPorGarantia.duas === 33,
    'e em 23/21 ele sobe de 27 para 33 ao pedir a segunda cartela premiada',
    `${pisoPorGarantia.umaSo} → ${pisoPorGarantia.duas}`
  );

  // Construção e piso iguais significam mínimo provado: uma é limite de cima, o
  // outro é limite de baixo. É assim que o aplicativo passou a saber que 33 é o
  // mínimo de 23/21 com duas premiadas — antes ele chamava isso de problema em
  // aberto.
  const exatos = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) =>
      [22, 21].map((jogo) => ({
        jogo,
        linhas: [1, 2, 3, 4].map((r) => {
          const m = lot.minimo(23, jogo, 15, r);
          return { r, jogos: m.jogos, exato: m.exato };
        }),
      }))
    )
  );
  const a1 = exatos.find((e) => e.jogo === 22).linhas;
  const a2 = exatos.find((e) => e.jogo === 21).linhas;
  marcar(
    a1.every((l, i) => l.exato && l.jogos === 16 + i),
    'em 23/22 o mínimo é comprovado de 1 a 4 premiadas — 16, 17, 18 e 19',
    a1.map((l) => l.jogos).join(', ')
  );
  marcar(
    a2.every((l) => l.exato) && [27, 33, 42, 55].every((v, i) => a2[i].jogos === v),
    'e em 23/21 são 27, 33, 42 e 55, todos comprovados',
    a2.map((l) => l.jogos).join(', ')
  );

  // A prova de que a construção generalizada entrega o que promete não é o
  // argumento — é a varredura. Cada fechamento produzido é conferido sorteio a
  // sorteio, contando **quantas** cartelas atendem cada um, porque um fechamento
  // que prometa duas premiadas e entregue uma passaria batido numa conferência
  // que só perguntasse "alguém cobre?".
  //
  // Foi este teste que reprovou a primeira tentativa de generalizar o argumento
  // por grupos. A casa dos pombos garante que **uma** parte recebe ⌈b/g⌉ pontos,
  // não que várias recebam — o adversário concentra o sorteio numa parte só — e
  // a versão errada produzia fechamentos que cobriam tudo uma vez e prometiam
  // duas.
  const varreduraComGarantia = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) => {
      const saida = { conferidos: 0, falhas: [] };
      for (let pool = 17; pool <= 23; pool++) {
        const dezenas = Array.from({ length: pool }, (_, i) => i + 1);
        for (let jogo = 17; jogo <= pool; jogo++) {
          const teto = Math.min(lot.maximoPremiadas(pool, jogo), 4);
          for (let premiadas = 1; premiadas <= teto; premiadas++) {
            const quantos = lot.tamanhoDaConstrucao(pool, jogo, 15, premiadas);
            // Acima disto a varredura fica cara demais para uma suíte; os casos
            // grandes são justamente aqueles em que a construção é grosseira.
            if (quantos === null || quantos > 1000) continue;
            const jogos = lot.construir(pool, jogo, dezenas, 15, premiadas);
            if (!jogos) continue;
            const c = lot.conferirCobertura(dezenas, jogos, 15, premiadas, { exaustivo: true });
            const distintos = new Set(jogos.map((j) => j.join(','))).size;
            saida.conferidos += 1;
            if (
              jogos.length !== quantos ||
              c.cobertos !== c.total ||
              c.minimoPremiadas < premiadas ||
              distintos !== jogos.length ||
              jogos.some((j) => j.length !== jogo)
            ) {
              saida.falhas.push(
                `${pool}/${jogo} r=${premiadas}: ${jogos.length} jogos, ` +
                  `${c.cobertos}/${c.total} cobertos, pior caso ${c.minimoPremiadas}`
              );
            }
          }
        }
      }
      return saida;
    })
  );
  marcar(
    varreduraComGarantia.falhas.length === 0 && varreduraComGarantia.conferidos >= 60,
    'e toda construção entrega a garantia que promete, conferida sorteio a sorteio',
    varreduraComGarantia.falhas.length
      ? varreduraComGarantia.falhas.slice(0, 3).join(' | ')
      : `${varreduraComGarantia.conferidos} fechamentos varridos até 4 premiadas`
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

  // A tabela vem preenchida. Antes eram sete campos vazios, e sem número
  // nenhum a tela não podia dizer se o fechamento paga — que é a pergunta que
  // decide a compra.
  //
  // Por rótulo: os tamanhos vão de 15 a 25, e a tabela da banca cobria 17 a 23.
  const cotacoes = await pagina.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('#lot-cotacao label')].map((l) => [
        l.textContent.trim().split(' ')[0],
        l.querySelector('input').value,
      ])
    )
  );
  marcar(
    [17, 18, 19, 20, 21, 22, 23].map((k) => cotacoes[k]).join(',') ===
      '7000,1300,300,100,30,10,4',
    'a cotação vem preenchida, de 17 a 23 dezenas',
    [17, 18, 19, 20, 21, 22, 23].map((k) => cotacoes[k]).join(' · ')
  );
  marcar(
    [15, 16, 24, 25].every((k) => cotacoes[k] === '') && Object.keys(cotacoes).length === 11,
    'e os tamanhos que a tabela dessa banca não cobria ficam vazios — 15, 16, 24 e 25',
    `${Object.keys(cotacoes).length} campos, de ${Object.keys(cotacoes)[0]} a ${Object.keys(cotacoes).at(-1)} dezenas`
  );

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

  // ─── 6a. a régua da cotação ───
  //
  // É a única informação da tela capaz de mudar o retorno — nem fechamento,
  // nem pool, nem garantia entram nessa conta — e é a que a tabela da banca
  // esconde. 7.000× numa cartela de 17 parece generoso e paga 29% do neutro;
  // 4× numa de 23 parece miséria e paga 60%. Sem a régua, a intuição escolhe
  // justamente a aposta em que a banca cobra mais caro.
  // Por rótulo, e não por posição: a lista começou em 17 e passou a começar em
  // 15, e três testes quebraram de uma vez por contarem a partir do zero.
  const reguaDe = async (jogo) =>
    (
      await pagina.evaluate((k) => {
        const rotulo = [...document.querySelectorAll('#lot-cotacao label')].find((l) =>
          l.textContent.startsWith(`${k} dezenas`)
        );
        return rotulo.querySelector('.regua-cotacao').textContent;
      }, jogo)
    )
      .replace(/\s+/g, ' ')
      .trim();

  const regua17 = await reguaDe(17);
  const regua23 = await reguaDe(23);
  marcar(
    /neutro seria 24\.035×/.test(regua17) && /29,1%/.test(regua17),
    'cada cotação vem com a régua: quanto seria neutro e quanto a oferta paga',
    regua17.slice(0, 76)
  );
  marcar(
    /neutro seria 6,7×/.test(regua23),
    'e o neutro sai com decimal onde ele decide — 6,7× e não 7× nas de 23',
    regua23.slice(0, 60)
  );

  // A conferência independente: a régua tem de bater com o retorno esperado,
  // porque são o mesmo número dito de dois jeitos.
  const doisCaminhos = await pagina.evaluate(async () => {
    const lot = await import('./lotinha.js');
    return [17, 20, 23].map((k) => {
      const justo = lot.cotacaoJusta(k);
      const e = lot.economia({
        pool: 25,
        jogo: k,
        quantidade: 1,
        cotacao: lot.COTACAO_PADRAO,
      });
      return {
        jogo: k,
        fracao: lot.COTACAO_PADRAO[k] / justo,
        retorno: e.retornoEsperado,
      };
    });
  });
  marcar(
    doisCaminhos.every((c) => Math.abs(c.fracao - c.retorno) < 1e-9),
    'a fração do neutro é exatamente o retorno por real, por dois caminhos',
    doisCaminhos.map((c) => `${c.jogo}: ${(c.fracao * 100).toFixed(1)}%`).join(' · ')
  );

  // Uma oferta acima do neutro é reconhecida como tal. Nenhuma banca real
  // paga isso, e é justamente por isso que a tela precisa saber dizer: sem
  // esse ramo, a régua viraria uma escala que só desce.
  const campo23 = pagina.locator('#lot-cotacao label', { hasText: /^23 dezenas/ }).locator('input');
  await campo23.fill('7');
  const acima = await reguaDe(23);
  marcar(
    /acima do neutro/.test(acima) && /105,0%/.test(acima),
    'e uma oferta acima do neutro é reconhecida, em vez de ficar na faixa boa',
    acima.trim().slice(0, 70)
  );
  await campo23.fill('4');

  // ─── 6b. o veredito: este fechamento paga? ───
  //
  // Duas perguntas diferentes, e confundi-las é o que custa dinheiro:
  //
  //   - **no longo prazo** nenhuma combinação devolve o que custa, e o número
  //     de cartelas cancela na conta. Otimizar não muda isso.
  //   - **no ramo em que se ganha**, o fechamento garante `r` cartelas com as
  //     15, que pagam `r · mult`, contra um custo de `N` cartelas. Aí sim o
  //     tamanho decide — e em 23/20 falta **uma** cartela para o fechamento
  //     passar a pagar, depois de o ataque dedicado tirar duas.
  //
  // O veredito responde só a segunda, e a asserção final desta seção é o que
  // impede alguém de, um dia, transformá-lo numa promessa de lucro.
  const vereditos = await pagina.evaluate(async () => {
    const lot = await import('./lotinha.js');
    await lot.carregarBanco();

    const classificar = (pool, jogo) => {
      const m = lot.minimo(pool, jogo);
      const v = lot.veredito({
        jogo,
        quantidade: lot.previsao(pool, jogo).quantidade,
        piso: m.piso,
      });
      return { ...v, pool, jogo };
    };

    // E o retorno esperado de toda combinação que a banca cota.
    const retornos = [];
    for (const l of lot.matriz()) {
      if (!lot.COTACAO_PADRAO[l.jogo]) continue;
      const e = lot.economia({
        pool: l.pool,
        jogo: l.jogo,
        quantidade: lot.previsao(l.pool, l.jogo).quantidade ?? l.piso,
        cotacao: lot.COTACAO_PADRAO,
      });
      retornos.push({ pool: l.pool, jogo: l.jogo, retorno: e.retornoEsperado });
    }

    const todos = lot.matriz().map((l) => classificar(l.pool, l.jogo));
    const conta = {};
    for (const v of todos) conta[v.classe] = (conta[v.classe] ?? 0) + 1;

    return {
      lucra: classificar(22, 20),
      possivel: classificar(23, 20),
      impossivel: classificar(25, 20),
      semCotacao: classificar(24, 24),
      conta,
      retornos,
    };
  });

  marcar(
    vereditos.lucra.classe === 'lucra' && vereditos.lucra.folga === 70,
    '22 dezenas com jogos de 20: 30 cartelas para um prêmio de 100× — paga',
    `sobram ${vereditos.lucra.folga}× a aposta`
  );
  marcar(
    vereditos.possivel.classe === 'possivel' && vereditos.possivel.faltamCortar === 1,
    '23 com jogos de 20 está a uma cartela de pagar, e o piso permite',
    `100 hoje, prêmio 100×, piso ${vereditos.possivel.piso}`
  );
  marcar(
    vereditos.impossivel.classe === 'impossivel' &&
      Math.abs(vereditos.impossivel.custoDoPiso - 3.17) < 0.02,
    '25 com jogos de 20 não paga nem no mínimo matemático',
    `piso ${vereditos.impossivel.piso} custa ${vereditos.impossivel.custoDoPiso.toFixed(2)}× o prêmio`
  );
  marcar(
    vereditos.semCotacao.classe === 'sem-cotacao',
    'e uma cartela de 24 dezenas não recebe veredito, porque não tem cotação'
  );
  marcar(
    vereditos.conta.lucra === 23 &&
      vereditos.conta.possivel === 4 &&
      vereditos.conta.impossivel === 15 &&
      vereditos.conta['sem-cotacao'] === 24,
    'as 66 combinações se repartem em 23 que pagam, 4 possíveis, 15 que não e 24 sem cotação',
    JSON.stringify(vereditos.conta)
  );

  // A trava. Se um dia alguém fizer o veredito parecer promessa de lucro, é
  // aqui que o teste quebra: no longo prazo **nenhuma** combinação devolve o
  // que custa, e é por isso que a tela mostra os dois ramos sempre juntos.
  const positivos = vereditos.retornos.filter((r) => r.retorno >= 1);
  const melhor = vereditos.retornos.reduce((a, b) => (b.retorno > a.retorno ? b : a));
  marcar(
    positivos.length === 0,
    'e nenhuma das 41 combinações cotadas devolve o que custa, no longo prazo',
    `a menos ruim é ${melhor.pool}/${melhor.jogo}, com R$ ${melhor.retorno
      .toFixed(2)
      .replace('.', ',')} por real`
  );

  // ─── 6c. o selo na tela, nas três formas ───
  const selos = {};
  for (const [pool, jogo] of [[22, 20], [23, 20], [25, 20]]) {
    await pagina.click(`#lot-pool .opcao[data-pool="${pool}"]`);
    await pagina.click(`#lot-jogo .opcao[data-jogo="${jogo}"]`);
    const selo = pagina.locator('#lot-economia .veredito');
    selos[`${pool}/${jogo}`] = {
      classe: (await selo.count()) ? await selo.getAttribute('class') : '',
      texto: (await selo.count()) ? (await selo.textContent()).replace(/\s+/g, ' ') : '',
    };
  }
  marcar(
    /paga/.test(selos['22/20'].classe) &&
      /quase/.test(selos['23/20'].classe) &&
      /nao-paga/.test(selos['25/20'].classe),
    'a tela mostra o veredito com as três aparências distintas',
    Object.entries(selos)
      .map(([k, v]) => `${k}: ${v.classe.replace('veredito ', '')}`)
      .join(' · ')
  );
  marcar(
    /Faltam cortar 1 cartela\b/.test(selos['23/20'].texto),
    'e diz quantas cartelas faltam cortar para a combinação passar a pagar',
    selos['23/20'].texto.slice(0, 76)
  );
  marcar(
    /Não é falta de otimização/.test(selos['25/20'].texto),
    'e separa "ainda não conseguimos" de "ninguém vai conseguir"',
    selos['25/20'].texto.slice(-70)
  );

  // Volta ao fechamento de 18 dezenas **carregado** para as seções seguintes:
  // trocar de pool esquece o fechamento, e o simulador precisa dele na mão.
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(
    () => /Garantia|conferidos ao acaso/.test(
      document.getElementById('lot-conferencia').textContent
    ),
    undefined,
    { timeout: 60000 }
  );
  // Carregar um fechamento leve liga o motor e leva a tela para o painel de
  // busca; as seções seguintes são todas da Lotinha.
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');

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

  // ─── 12. o motor escolhe pelo bolso ───
  //
  // A pergunta que o aplicativo passa a responder é a inversa da de sempre. Não
  // "quantas cartelas custa garantir isto", mas "dado o que posso gastar, o que
  // vale a pena comprar" — com a garantia como resposta, e não como pergunta.
  //
  // O caso que motivou a mudança: alguém pediu um fechamento lucrativo de 25
  // dezenas com jogos de 18. Não existe, e não é questão de procurar melhor.
  // Cada cartela de 18 contém C(18,15) = 816 dos C(25,15) sorteios, cobrir todos
  // `r` vezes exige N ≥ r · 4.006 cartelas, e o retorno 1300r/N fica preso
  // abaixo de 0,325× — para qualquer N, qualquer garantia, qualquer algoritmo.
  // O outro lado da mesma conta: o pool 24 com jogos de 23 era rotulado de
  // impossível porque o aplicativo só olhava uma cartela premiada. Com nove,
  // são as 24 cartelas que cabem no pool, todo sorteio deixa nove dezenas de
  // fora, e são essas nove que o premiam — 36× por 24×, fixo.
  const vinteQuatro = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) => {
      const m = lot.minimo(24, 23, 15, 9);
      const v = lot.veredito({ jogo: 23, quantidade: m.jogos, piso: m.piso, premiadas: 9 });
      const dezenas = Array.from({ length: 24 }, (_, i) => i + 1);
      const jogos = lot.construir(24, 23, dezenas, 15, 9);
      const c = lot.conferirCobertura(dezenas, jogos, 15, 9, { exaustivo: true });
      return {
        jogos: m.jogos,
        exato: m.exato,
        classe: v.classe,
        premio: v.premio,
        construidas: jogos.length,
        cobertos: c.cobertos,
        total: c.total,
        pior: c.minimoPremiadas,
        comUma: lot.veredito({ jogo: 23, quantidade: 16, piso: lot.minimo(24, 23).piso, premiadas: 1 }).classe,
      };
    })
  );
  marcar(
    vinteQuatro.jogos === 24 && vinteQuatro.exato && vinteQuatro.classe === 'lucra',
    'o 24/23 com nove premiadas são 24 cartelas, é mínimo provado, e paga',
    `${vinteQuatro.jogos} cartelas, prêmio ${vinteQuatro.premio}×, veredito ${vinteQuatro.classe}`
  );
  marcar(
    vinteQuatro.comUma === 'impossivel',
    'e a mesma dupla com uma cartela premiada é impossível — era só isso que se via',
    `com 1: ${vinteQuatro.comUma}, com 9: ${vinteQuatro.classe}`
  );
  marcar(
    vinteQuatro.cobertos === vinteQuatro.total && vinteQuatro.pior === 9,
    'e as nove premiadas são conferidas nos 1.307.504 sorteios, uma a uma',
    `${vinteQuatro.cobertos} de ${vinteQuatro.total}, pior caso ${vinteQuatro.pior}`
  );

  // A trava que não pode sumir: no longo prazo **nenhuma** combinação devolve o
  // que custa. O retorno esperado é `multiplicador · chance da cartela`, o
  // número de cartelas cancela na conta, e nada que a tela ofereça o altera.
  const semLucroNoLongoPrazo = await pagina.evaluate(() =>
    import('./lotinha.js').then((lot) => {
      const cotadas = lot
        .matriz()
        .filter((l) => lot.COTACAO_PADRAO[l.jogo])
        .map((l) => ({
          par: `${l.pool}/${l.jogo}`,
          retorno: lot.economia({
            pool: l.pool,
            jogo: l.jogo,
            quantidade: 1,
            cotacao: lot.COTACAO_PADRAO,
          }).retornoEsperado,
        }));
      return { total: cotadas.length, positivas: cotadas.filter((c) => c.retorno >= 1) };
    })
  );
  marcar(
    semLucroNoLongoPrazo.total === 42 && semLucroNoLongoPrazo.positivas.length === 0,
    'nenhuma das 42 combinações cotadas tem retorno esperado positivo, porque nenhuma pode ter',
    `${semLucroNoLongoPrazo.total} conferidas, todas abaixo de R$ 1,00 por real`
  );

  // ─── 13. a conferência não pode congelar a tela ───
  //
  // A conferência varre todo sorteio possível do pool contra toda cartela. Em
  // 25 dezenas com jogos de 21 são 266 cartelas contra 3.268.760 sorteios: 869
  // milhões de comparações. Medido num aparelho quatro vezes mais lento que o
  // desta máquina, isso travava a tela por **cinco segundos** — sem toque, sem
  // cursor, sem nada dizendo que havia trabalho em curso; 22/17 travava por
  // dois, e meia dúzia de outras combinações por mais de um.
  //
  // Agora roda num trabalhador. O que este teste exige é o que o usuário sente:
  // que a tela continue respondendo, e que ela diga o que está fazendo.
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click('#lot-pool .opcao[data-pool="25"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="21"]');
  await pagina.click('#lot-sortear');
  await pagina.evaluate(() => { window.__longas = []; });

  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(() => /Conferindo/.test(document.getElementById('lot-conferencia').textContent), undefined, { timeout: 20000 });
  const avisou = (await pagina.locator('#lot-conferencia').textContent()).replace(/\s+/g, ' ');

  // Durante o cálculo: trocar de aba tem de responder na hora.
  const comecouTroca = Date.now();
  await pagina.click('.aba[data-painel="checar"]');
  await pagina.waitForSelector('#checar.ativo', { timeout: 5000 });
  const trocaMs = Date.now() - comecouTroca;
  await pagina.click('.aba[data-painel="lotinha"]');

  await pagina.waitForFunction(
    () => /Garantia comprovada/.test(document.getElementById('lot-conferencia').textContent),
    undefined,
    { timeout: 120000 }
  );
  const longas = await pagina.evaluate(() => window.__longas.filter((d) => d > 300));

  marcar(
    /Conferindo/.test(avisou),
    'a conferência diz que está trabalhando, em vez de deixar a tela muda',
    avisou.slice(0, 70)
  );
  marcar(
    trocaMs < 1500,
    'e a tela responde durante ela — trocar de aba não espera o cálculo',
    `${trocaMs} ms para trocar de aba no meio de 869 milhões de comparações`
  );
  marcar(
    longas.length === 0,
    'nenhum bloco acima de 300 ms na linha principal, onde antes havia um de 5.000',
    longas.length ? `blocos: ${longas.join(', ')} ms` : 'nenhum'
  );
  marcar(
    /3\.268\.760 sorteios conferidos um a um/.test(
      (await pagina.locator('#lot-conferencia').textContent()).replace(/\s+/g, ' ')
    ),
    'e o resultado é o mesmo de antes: os 3.268.760 sorteios, um a um',
    (await pagina.locator('#lot-conferencia').textContent()).replace(/\s+/g, ' ').slice(0, 70)
  );

  // Trocar a configuração no meio de uma conferência longa: a resposta antiga
  // não pode chegar depois e pintar por cima da nova. Enquanto o cálculo
  // bloqueava, este defeito não existia — tirá-lo do bloqueio o cria.
  await pagina.click('#lot-pool .opcao[data-pool="25"]');
  await pagina.click('#lot-jogo .opcao[data-jogo="21"]');
  await pagina.click('#lot-sortear');
  await pagina.click('#lot-iniciar');
  await pagina.waitForFunction(() => /Conferindo/.test(document.getElementById('lot-conferencia').textContent), undefined, { timeout: 20000 });
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.waitForTimeout(6000);
  const depoisDaTroca = (await pagina.locator('#lot-conferencia').textContent()).replace(/\s+/g, ' ');
  marcar(
    !/3\.268\.760/.test(depoisDaTroca),
    'e um resultado que chega tarde não pinta por cima da seleção nova',
    depoisDaTroca.slice(0, 70)
  );

  // ─── 14. as abas como o padrão manda ───
  //
  // `role="tablist"` é uma promessa: quem usa leitor de tela ouve "aba 1 de 5"
  // e tenta a seta para a direita, porque é assim que abas funcionam em toda
  // parte. A promessa era falsa — as setas não faziam nada, as abas não diziam
  // que painel abriam, e os painéis não diziam de que aba vinham.
  const abas = await pagina.evaluate(() => {
    const abas = [...document.querySelectorAll('[role="tab"]')];
    const paineis = [...document.querySelectorAll('[role="tabpanel"]')];
    return {
      total: abas.length,
      comControle: abas.filter((a) => document.getElementById(a.getAttribute('aria-controls'))).length,
      paineisRotulados: paineis.filter((x) => document.getElementById(x.getAttribute('aria-labelledby'))).length,
      naTabulacao: abas.filter((a) => a.tabIndex === 0).length,
      rotuloDaLista: document.querySelector('[role="tablist"]').getAttribute('aria-label') ?? '',
    };
  });
  marcar(
    abas.comControle === abas.total && abas.paineisRotulados === abas.total,
    'cada aba diz que painel abre, e cada painel diz de que aba veio',
    `${abas.comControle} de ${abas.total} abas, ${abas.paineisRotulados} painéis`
  );
  marcar(
    abas.naTabulacao === 1 && abas.rotuloDaLista.length > 0,
    'e só a aba aberta entra na tabulação, como manda o índice móvel',
    `${abas.naTabulacao} na tabulação, lista rotulada "${abas.rotuloDaLista}"`
  );

  await pagina.click('.aba[data-painel="lotinha"]');
  const comSetas = [];
  for (const [tecla, esperado] of [
    ['ArrowRight', 'buscar'],
    ['ArrowRight', 'resultado'],
    ['ArrowLeft', 'buscar'],
    ['End', 'historico'],
    ['Home', 'lotinha'],
  ]) {
    await pagina.keyboard.press(tecla);
    await pagina.waitForTimeout(120);
    const painel = await pagina.evaluate(() => document.querySelector('.painel.ativo')?.id);
    const foco = await pagina.evaluate(() => document.activeElement?.dataset?.painel);
    comSetas.push(painel === esperado && foco === esperado);
  }
  marcar(
    comSetas.every(Boolean),
    'as setas andam entre as abas, e o foco vai junto — Home e End também',
    `${comSetas.filter(Boolean).length} de ${comSetas.length} movimentos certos`
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 120));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
