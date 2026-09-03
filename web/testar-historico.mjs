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

/**
 * Carrega um fechamento da Lotinha e espera a busca registrar uma solução.
 *
 * As dezenas são sempre as `pool` primeiras: quais são não muda nada aqui — o
 * fechamento vem do banco em posições, e o histórico grava a configuração, não
 * a sorte de quem escolheu.
 */
async function buscar({ pool, jogo }) {
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click(`#lot-pool .opcao[data-pool="${pool}"]`);
  await pagina.click('#lot-limpar');
  for (let n = 1; n <= pool; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click(`#lot-jogo .opcao[data-jogo="${jogo}"]`);
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
  await pagina.click('#lot-iniciar');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
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
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 15000 });
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
  await buscar({ pool: 18, jogo: 17 });
  await encerrar();

  let sessoes = await sessoesGravadas();
  marcar(sessoes.length === 1, 'a busca é salva sem o usuário pedir', `${sessoes.length} registro`);
  marcar(
    sessoes[0].melhor.length > 0 && sessoes[0].melhor.every((c) => c.length === 17),
    'o registro guarda os jogos de verdade',
    `${sessoes[0].melhor.length} jogos de 17 dezenas`
  );

  // ─── 2. uma busca nova não apaga a anterior ───
  //
  // Era exatamente o defeito da versão anterior: existia um único espaço de
  // gravação, e começar outro trabalho apagava o primeiro sem aviso.
  await buscar({ pool: 19, jogo: 17 });
  await encerrar();

  sessoes = await sessoesGravadas();
  marcar(
    sessoes.length === 2,
    'uma busca nova não apaga a anterior',
    `${sessoes.length} registros guardados`
  );

  const configuracoes = sessoes.map((s) => s.configuracao.pool.length).sort();
  marcar(
    configuracoes.join(',') === '18,19',
    'cada registro guarda a própria configuração',
    `pools ${configuracoes.join(' e ')}`
  );

  // ─── 3. continuar retoma e atualiza o mesmo registro ───
  //
  // Usa um fechamento cujo mínimo é problema em aberto, para que continuar
  // tenha mesmo o que melhorar. Vinte dezenas com jogos de 17: 240 jogos, piso
  // conhecido 160, e ninguém no mundo sabe o mínimo — o motor não vai provar
  // nada ali e segue rodando enquanto deixarem.
  await buscar({ pool: 20, jogo: 17 });
  await pagina.waitForTimeout(2500);
  await encerrar();

  sessoes = await sessoesGravadas();
  const antes = sessoes.find((s) => s.configuracao.pool.length === 20);
  marcar(!!antes, 'o trabalho longo também foi salvo', `${antes?.melhor.length} jogos`);

  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  marcar(
    (await pagina.locator('.sessao').count()) === 3,
    'os três trabalhos aparecem na lista'
  );
  await pagina.screenshot({ path: 'capturas/captura-historico.png' });

  // Continua justamente o trabalho de 20 dezenas.
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
    `${antes.melhor.length} → ${depois.melhor.length} jogos`
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

  // ─── quando o aparelho fica sem espaço, quem perde trabalho fica sabendo ───
  //
  // O histórico abre espaço descartando os mais antigos, e essa é a escolha
  // certa: perder o que se está fazendo agora seria pior. O que estava errado
  // era fazer isso calado. Um fechamento de 23 dezenas com jogos de 17 ocupa
  // meio megabyte, oito enchem o armazenamento de um iPhone, e o nono comia os
  // primeiros sem uma palavra — a pessoa só descobria ao ir procurar.
  const semEspaco = await pagina.evaluate(async () => {
    const h = await import('./historico.js');
    h.limpar();
    const recados = [];
    // O registro devolve como desfazer só o dele: o aviso que o aplicativo
    // registrou na partida continua de pé, e é o que a próxima verificação usa.
    const parar = h.quandoFaltarEspaco((r) => recados.push(r));
    // Cartelas grandes de propósito: é assim que se chega ao limite sem esperar
    // uma busca de verdade.
    const gordas = Array.from({ length: 11546 }, () =>
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    const config = { pool: Array.from({ length: 23 }, (_, i) => i + 1), cartela: 17 };
    let criadas = 0;
    for (let i = 0; i < 14 && !recados.length; i++) {
      h.criar(config, { melhor: gordas });
      criadas++;
    }
    const guardadas = h.quantidade();
    parar();
    h.limpar();
    return { criadas, guardadas, recados };
  });
  marcar(
    semEspaco.recados.length > 0,
    'o histórico avisa quando precisa descartar trabalhos por falta de espaço',
    `${semEspaco.criadas} gravados, ${semEspaco.guardadas} couberam, ${semEspaco.recados.length} aviso(s)`
  );
  marcar(
    semEspaco.recados.every((r) => r.descartadas > 0 && typeof r.guardou === 'boolean'),
    'e diz quantos saíram e se o novo entrou',
    JSON.stringify(semEspaco.recados[0] ?? null)
  );

  // O aviso chega até a tela: é o mesmo caminho, e é o que a pessoa vê.
  const naTela = await pagina.evaluate(async () => {
    const h = await import('./historico.js');
    h.limpar();
    const gordas = Array.from({ length: 11546 }, () =>
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    const config = { pool: Array.from({ length: 23 }, (_, i) => i + 1), cartela: 17 };
    const caixa = document.getElementById('aviso');
    for (let i = 0; i < 14 && caixa.hidden; i++) h.criar(config, { melhor: gordas });
    const texto = caixa.textContent;
    h.limpar();
    return { aparecido: !caixa.hidden, texto };
  });
  marcar(
    naTela.aparecido && /espaço/i.test(naTela.texto),
    'e o aviso chega à tela, em vez de morrer no módulo',
    naTela.texto.slice(0, 70)
  );

  /** O número que está num elemento da tela, sem a pontuação de milhar. */
  const numero = async (seletor) =>
    Number((await pagina.locator(seletor).textContent()).replace(/\D/g, ''));

  // ─── o sistema encerra a página, e o trabalho não se perde ───
  //
  // É o caso que o modo automático de horas existe para sobreviver: o iPhone
  // encerra a página por bateria, memória ou tempo em segundo plano, e o
  // aplicativo não tem chance nenhuma de anotar que parou. O que sobra é o que
  // ficou gravado — e é isso que precisa bastar.
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click('#lot-pool .opcao[data-pool="18"]');
  await pagina.click('#lot-limpar');
  for (const n of [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25]) {
    await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  }
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
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
  await pagina.waitForTimeout(1500);

  const gravado = await pagina.evaluate(() => {
    const bruto = JSON.parse(localStorage.getItem('sonho-lucido:historico') ?? '[]');
    return bruto[0] ?? null;
  });
  marcar(
    gravado?.emCurso === true,
    'enquanto o motor roda, fica gravado que há trabalho em andamento',
    `emCurso: ${gravado?.emCurso}`
  );
  marcar(
    Number(gravado?.motor?.iteracoes) > 0 && Number(gravado?.motor?.alvo_cartelas) > 0,
    'e o estado do motor é gravado junto, não só as cartelas',
    `${gravado?.motor?.iteracoes} iterações · meta ${gravado?.motor?.alvo_cartelas}`
  );

  // O encerramento pelo sistema: a página some sem despedida.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  await pagina.waitForSelector('#cartao-interrompido:not([hidden])', { timeout: 10000 });
  const resumo = (await pagina.locator('#resumo-interrompido').textContent()).replace(/\s+/g, ' ');
  marcar(
    /o motor estava trabalhando quando o aplicativo fechou/.test(resumo) &&
      /iterações/.test(resumo),
    'ao reabrir, o aplicativo reconhece o trabalho interrompido e mostra onde parou',
    resumo.slice(0, 90)
  );

  await pagina.click('#retomar-interrompido');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => Number(document.getElementById('iteracoes').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 30000 }
  );
  marcar(
    (await numero('#iteracoes')) >= Number(gravado.motor.iteracoes),
    'e retomar continua das iterações gravadas, em vez de recomeçar',
    `gravadas ${gravado.motor.iteracoes}, retomadas ${await numero('#iteracoes')}`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForTimeout(400);
  marcar(
    await pagina.locator('#cartao-interrompido').isHidden(),
    'e encerrar de propósito não deixa o aviso de interrupção para trás',
    'cartão escondido'
  );

  // ─── a sessão atravessa para outro aparelho ───
  //
  // A promessa inteira do arquivo: dez horas de motor num aparelho continuam
  // sendo dez horas no outro. O que se prova aqui é que o arquivo carrega a
  // sessão e não as cartelas — e que importar não encosta no que já existe.
  await pagina.click('.aba[data-painel="lotinha"]');
  await pagina.waitForSelector('#lotinha.ativo');
  await pagina.click('#lot-pool .opcao[data-pool="20"]');
  await pagina.click('#lot-limpar');
  for (let n = 1; n <= 20; n++) await pagina.click(`#lot-grade .numero[data-n="${n}"]`);
  await pagina.click('#lot-jogo .opcao[data-jogo="17"]');
  // O estágio 0 roda em um segundo aqui: o que se testa é que ele acontece e
  // entrega, não quanto ele consegue achar com tempo de verdade.
  await pagina.evaluate(() => {
    const campo = document.getElementById('segundos-construtor');
    if (campo) campo.value = '1';
  });
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
  await pagina.waitForTimeout(2500);

  // A exportação não pausa nada: o motor segue rodando enquanto o arquivo sai.
  const arquivo = await pagina.evaluate(async () => {
    const capturado = { nome: null, texto: null };
    // Intercepta a entrega para pegar o arquivo sem depender de download nem de
    // compartilhamento — o que se está testando é o conteúdo, não o encanamento
    // do sistema operacional.
    const criarOriginal = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      capturado.blob = blob;
      return criarOriginal.call(URL, blob);
    };
    const cliqueOriginal = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      capturado.nome = this.download;
    };
    document.getElementById('exportar-sessao').click();
    for (let i = 0; i < 100 && !capturado.blob; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    HTMLAnchorElement.prototype.click = cliqueOriginal;
    URL.createObjectURL = criarOriginal;
    capturado.texto = capturado.blob ? await capturado.blob.text() : null;
    delete capturado.blob;
    return capturado;
  });

  marcar(
    typeof arquivo.texto === 'string' && arquivo.texto.length > 100,
    'exportar entrega um arquivo com o motor ainda rodando',
    `${arquivo.nome} · ${arquivo.texto ? Math.round(arquivo.texto.length / 1024) : 0} KB`
  );

  const dentro = JSON.parse(arquivo.texto);
  const m = dentro.sessao?.motor ?? {};
  marcar(
    dentro.aplicativo === 'sonho-lucido/sessao' &&
      Array.isArray(dentro.sessao?.melhor) &&
      dentro.sessao.melhor.length > 0 &&
      Array.isArray(dentro.sessao?.atual) &&
      dentro.sessao.atual.length > 0,
    'e o arquivo traz o recorde e a solução em curso, não só as cartelas',
    `${dentro.sessao?.melhor?.length} no recorde, ${dentro.sessao?.atual?.length} em curso`
  );
  marcar(
    m.iteracoes > 0 && m.alvo_cartelas > 0 && (m.pesos_dos_operadores ?? []).length > 1,
    'e traz o trabalho do motor: iterações, meta perseguida e pesos aprendidos',
    `${m.iteracoes} iterações · meta ${m.alvo_cartelas} · ${
      (m.pesos_dos_operadores ?? []).length
    } pesos`
  );
  // O que separa "gravar o resultado" de "gravar a busca". Medido: sem o
  // relógio da diversificação e sem o estado do gerador, retomar não achava
  // **nenhuma** melhoria em quinze mil iterações, enquanto a corrida contínua
  // caía de 307 para 263 cartelas no mesmo intervalo.
  marcar(
    (m.memoria_aceitacao ?? []).length > 3 &&
      typeof m.gerador === 'string' &&
      Number.isFinite(m.iteracoes_sem_recorde) &&
      Array.isArray(dentro.sessao?.elites),
    'e o estado da busca: memória da aceitação, gerador, relógio da diversificação',
    `${(m.memoria_aceitacao ?? []).length / 3} custos · parada há ${
      m.iteracoes_sem_recorde
    } · ${(dentro.sessao?.elites ?? []).length} elites`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });

  // O outro aparelho: histórico zerado, nada em comum além do arquivo.
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');
  const antesDeImportar = await pagina.locator('.sessao').count();

  await pagina.setInputFiles('#arquivo-sessao', {
    name: arquivo.nome,
    mimeType: 'application/json',
    buffer: Buffer.from(arquivo.texto),
  });
  await pagina.waitForSelector('#confirmar-importacao', { timeout: 10000 });
  const previa = (await pagina.locator('#previa-importacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /iterações/.test(previa) && /cartelas de 17 dezenas/.test(previa),
    'a tela descreve a sessão antes de abrir, e espera confirmação',
    previa.slice(0, 90)
  );

  await pagina.click('#confirmar-importacao');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await pagina.waitForFunction(
    () => {
      const t = document.getElementById('iteracoes').textContent.replace(/\D/g, '');
      return t !== '' && Number(t) > 0;
    },
    undefined,
    { timeout: 30000 }
  );
  const aoRetomar = await numero('#iteracoes');
  marcar(
    aoRetomar >= m.iteracoes,
    'e o motor retoma com as iterações da sessão, em vez de recomeçar do zero',
    `gravadas ${m.iteracoes}, retomadas ${aoRetomar}`
  );
  marcar(
    (await numero('#melhor-cartelas')) <= dentro.sessao.melhor.length,
    'e o recorde importado é o ponto de partida, não um recomeço',
    `${await numero('#melhor-cartelas')} contra ${dentro.sessao.melhor.length} no arquivo`
  );

  // Depois de importar há o estágio 0 antes da busca: esperar pelo número
  // subindo, e não por um relógio fixo, é o que torna este teste independente de
  // quanto o construtor demora.
  await pagina.waitForFunction(
    (antes) => Number(document.getElementById('iteracoes').textContent.replace(/\D/g, '')) > antes,
    aoRetomar,
    { timeout: 30000 }
  );
  marcar(true, 'e o trabalho novo soma ao que veio no arquivo', `${aoRetomar} → ${await numero('#iteracoes')}`);

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  await pagina.click('.aba[data-painel="historico"]');
  marcar(
    (await pagina.locator('.sessao').count()) === antesDeImportar + 1,
    'a sessão importada entra como trabalho novo, sem encostar no que já existia',
    `${antesDeImportar} antes, ${await pagina.locator('.sessao').count()} depois`
  );

  // ─── o que fica gravado é o trabalho do motor, não só o resultado ───
  //
  // A queixa: retomar uma otimização já avançada demorava muito para voltar a
  // achar melhorias, às vezes mais do que começar outra do zero. A causa não era
  // lentidão do algoritmo — era o que a gravação deixava de fora. Um motor que
  // recebe as cartelas certas e o resto zerado é um motor novo segurando um bom
  // fechamento.
  //
  // O que precisa estar gravado, e o que cada peça faz:
  //
  //   iteracoes_sem_recorde  o relógio da diversificação, que dispara em 50.000
  //                          iterações sem recorde. Zerá-lo era o mais caro.
  //   memoria_aceitacao      os 500 custos com que a busca decide cada iteração
  //   gerador                o ponto do gerador de aleatórios, em texto
  //   pontos/usos do segmento  o aprendizado do seletor ainda não convertido
  const oMotorGravado = await pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:historico');
    const sessoes = bruto ? JSON.parse(bruto) : [];
    const comMotor = sessoes.find((s) => Array.isArray(s.motor?.memoria_aceitacao))
      ?? sessoes.find((s) => s.motor && Object.keys(s.motor).length > 3);
    return {
      motor: comMotor?.motor ?? null,
      elites: comMotor?.elites ?? null,
      chaves: Object.keys(comMotor?.motor ?? {}),
    };
  });
  console.log('    chaves gravadas:', oMotorGravado.chaves.join(', '));

  marcar(
    oMotorGravado.motor !== null && Number(oMotorGravado.motor.iteracoes) > 0,
    'o histórico grava o retrato do motor junto das cartelas',
    oMotorGravado.motor ? `${oMotorGravado.motor.iteracoes} iterações · meta ${oMotorGravado.motor.alvo_cartelas}` : '(nada oMotorGravado)'
  );
  marcar(
    Array.isArray(oMotorGravado.motor?.memoria_aceitacao) &&
      oMotorGravado.motor.memoria_aceitacao.length > 3 &&
      oMotorGravado.motor.memoria_aceitacao.length % 3 === 0,
    'e grava a memória do critério de aceitação, que decide cada iteração',
    `${(oMotorGravado.motor?.memoria_aceitacao?.length ?? 0) / 3} custos`
  );
  marcar(
    typeof oMotorGravado.motor?.gerador === 'string' && /^\d+$/.test(oMotorGravado.motor.gerador),
    'e o estado do gerador, em texto — 128 bits não cabem num número do JavaScript',
    String(oMotorGravado.motor?.gerador ?? '(ausente)').slice(0, 44)
  );
  marcar(
    typeof oMotorGravado.motor?.iteracoes_sem_recorde === 'number' &&
      Array.isArray(oMotorGravado.motor?.pontos_do_segmento) &&
      oMotorGravado.motor.pontos_do_segmento.length > 1,
    'e o relógio da diversificação e o segmento em formação do seletor',
    `parada há ${oMotorGravado.motor?.iteracoes_sem_recorde} · ${oMotorGravado.motor?.pontos_do_segmento?.length} operadores`
  );

  // ─── uma sessão retomada tem prioridade sobre o Motor Construtor ───
  //
  // O defeito relatado: importar um fechamento de 160 cartelas e ver o estágio 0
  // montar 198 do zero, anunciar "partiu de construção gulosa", e a otimização
  // recomeçar de 198. O recorde de 160 sobrevivia, mas o trabalho em curso —
  // que é de onde a busca continua — tinha sido trocado por um pior.
  //
  // O caso escolhido é o mais duro que existe para a regra: sessenta cartelas
  // para 20 dezenas com jogos de 18, numa configuração que o aplicativo fecha
  // com quarenta. O construtor bateria as sessenta com folga. Não importa: um
  // fechamento retomado não é um candidato a ser batido, é o pedido do usuário.
  //
  // As sessenta são um fechamento de verdade — as quarenta do banco mais vinte
  // cartelas válidas por cima. Acrescentar cartela nunca descobre um sorteio,
  // então a garantia continua inteira; o que sobra é gordura, e tirá-la é
  // trabalho da busca, na frente de quem está olhando.
  const arquivo60 = await pagina.evaluate(async () => {
    const lotinha = await import('./lotinha.js');
    const dezenas = Array.from({ length: 20 }, (_, i) => i + 1);
    const base = await lotinha.fechamentoPara(20, 18, dezenas);

    const jaTem = new Set(base.map((c) => [...c].sort((x, y) => x - y).join(',')));
    const extras = [];
    for (let a = 0; a < 20 && extras.length < 60 - base.length; a++) {
      for (let b = a + 1; b < 20 && extras.length < 60 - base.length; b++) {
        const cartela = dezenas.filter((_, i) => i !== a && i !== b);
        const chave = cartela.join(',');
        if (jaTem.has(chave)) continue;
        jaTem.add(chave);
        extras.push(cartela);
      }
    }
    const melhor = [...base.map((c) => [...c]), ...extras];

    return {
      aplicativo: 'sonho-lucido/sessao',
      formato: 1,
      criadoEm: new Date().toISOString(),
      versao: 'teste',
      rotulo: 'fechamento de 60 cartelas',
      sessao: {
        configuracao: {
          universo: lotinha.UNIVERSO,
          pool: dezenas,
          cartela: 18,
          alvo: lotinha.SORTEIO,
          intersecao: lotinha.SORTEIO,
          premiadas: 1,
          orcamento: null,
          semente: 1,
        },
        melhor,
        atual: melhor,
        iteracoes: 12345,
        motor: {
          iteracoes: 12345,
          aceitas: 900,
          recordes: 4,
          diversificacoes: 2,
          duplicadas_evitadas: 7,
          segundos: 61.5,
          alvo_cartelas: 59,
          passo_atual: 1,
          iteracao_da_meta: 12000,
          melhor_iteracao: 11800,
          pesos_dos_operadores: [1, 1, 1, 1],
        },
        historico: [],
      },
    };
  });

  marcar(
    arquivo60.sessao.melhor.length === 60 &&
      new Set(arquivo60.sessao.melhor.map((c) => c.join(','))).size === 60 &&
      arquivo60.sessao.melhor.every((c) => c.length === 18),
    'o fechamento de teste tem 60 cartelas distintas de 18 dezenas',
    `${arquivo60.sessao.melhor.length} cartelas`
  );

  // O outro aparelho de novo: nada em comum com a sessão além do arquivo.
  await pagina.evaluate(() => localStorage.clear());
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');

  await pagina.setInputFiles('#arquivo-sessao', {
    name: 'sessao-60.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(arquivo60)),
  });
  await pagina.waitForSelector('#confirmar-importacao', { timeout: 10000 });
  const previa60 = (await pagina.locator('#previa-importacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    // Sem `\b` antes do 60: o texto sai colado ao rótulo ("Fechamento60
    // cartelas"), porque cada campo do resumo é um elemento e a leitura junta
    // tudo. O que interessa é o número na frente do que ele conta.
    /60 cartelas de 18 dezenas/.test(previa60),
    'as 60 cartelas são identificadas antes de abrir',
    previa60.slice(0, 90)
  );

  // O observador entra ANTES do clique. O que se quer provar é o **primeiro**
  // estado que a tela pinta, e ele dura o tempo de um lote: perguntar depois
  // pegaria a busca já trabalhando, que é outra coisa.
  await pagina.evaluate(() => {
    window.__vistos = { melhor: null, atual: null, cartelas: null, avisos: [], partidas: [] };
    const digitos = (id) => document.getElementById(id).textContent.replace(/\D/g, '');
    window.__olho = setInterval(() => {
      const v = window.__vistos;
      const m = digitos('melhor-cartelas');
      if (m && v.melhor === null) {
        v.melhor = Number(m);
        // As cartelas do primeiro estado, antes de a busca encostar nelas.
        v.cartelas = document.getElementById('lista-cartelas').textContent;
      }
      const a = digitos('atual-cartelas');
      if (a && v.atual === null) v.atual = Number(a);

      const aviso = document.getElementById('aviso');
      if (!aviso.hidden && aviso.textContent.trim()) {
        const t = aviso.textContent.trim();
        if (v.avisos[v.avisos.length - 1] !== t) v.avisos.push(t);
      }
      const partida = document.getElementById('partida');
      if (!partida.hidden && partida.textContent.trim()) {
        const t = partida.textContent.trim();
        if (v.partidas[v.partidas.length - 1] !== t) v.partidas.push(t);
      }
    }, 20);
  });

  await pagina.click('#confirmar-importacao');
  await pagina.waitForSelector('#buscar.ativo', { timeout: 30000 });
  await esperarSolucao();
  await pagina.waitForTimeout(1200);

  const vistos = await pagina.evaluate(() => {
    clearInterval(window.__olho);
    return window.__vistos;
  });

  marcar(
    vistos.melhor === 60,
    'o primeiro estado da otimização é o fechamento de 60, e não uma construção nova',
    `primeiro recorde pintado: ${vistos.melhor}`
  );
  marcar(
    vistos.atual === 60,
    'e os motores de otimização recebem diretamente as 60 cartelas importadas',
    `primeira solução em curso: ${vistos.atual}`
  );

  const veioDoConstrutor = vistos.avisos.some((a) => /^Construtor:/.test(a));
  marcar(
    !veioDoConstrutor && vistos.avisos.some((a) => /Sessão retomada/.test(a)),
    'o Motor Construtor não é executado, e a tela diz que retomou',
    vistos.avisos.join(' | ').slice(0, 100) || '(nenhum aviso)'
  );
  marcar(
    vistos.partidas.every((t) => !/construção gulosa/.test(t)) &&
      vistos.partidas.some((t) => /sessão importada/.test(t)),
    'e a origem anunciada é a sessão importada, nunca uma construção gulosa',
    vistos.partidas.join(' | ').slice(0, 100) || '(nada anunciado)'
  );

  // Nenhuma cartela do fechamento original foi trocada por uma construída.
  const enviadas = new Set(
    arquivo60.sessao.melhor.map((c) =>
      [...c].sort((x, y) => x - y).map((n) => String(n).padStart(2, '0')).join(' ')
    )
  );
  const pintadas = (vistos.cartelas ?? '').match(/(?:\d{2} ){17}\d{2}/g) ?? [];
  marcar(
    pintadas.length === 60 && pintadas.every((c) => enviadas.has(c)),
    'nenhuma cartela do fechamento original foi substituída por uma construção nova',
    `${pintadas.filter((c) => enviadas.has(c)).length} das ${pintadas.length} na tela vieram do arquivo`
  );

  // E a redução funciona normalmente a partir dali: as vinte cartelas de
  // gordura saem pela busca, que é quem tem de tirá-las.
  await pagina.waitForFunction(
    () => Number(document.getElementById('melhor-cartelas').textContent.replace(/\D/g, '')) < 60,
    undefined,
    { timeout: 60000 }
  );
  marcar(
    (await numero('#melhor-cartelas')) < 60,
    'e a redução continua normal a partir das 60 importadas',
    `60 → ${await numero('#melhor-cartelas')}`
  );

  const iteracoes60 = await numero('#iteracoes');
  marcar(
    iteracoes60 >= 12345,
    'com as iterações do arquivo somando, e não recomeçando do zero',
    `12.345 no arquivo, ${iteracoes60} na tela`
  );

  // ─── o arquivo de elites também é gravado ───
  //
  // Aqui a busca já reduziu de 60 para 40, então juntou elites de verdade — é o
  // ponto do teste em que elas existem. Pausar força uma gravação na hora, sem
  // esperar os trinta segundos.
  //
  // Sem elas a diversificação reinicia do zero em vez de partir de algo que já
  // funcionou. Medido: retomar sem o arquivo de elites gastou doze mil
  // iterações sem achar nada, onde a corrida contínua caiu de 307 para 263.
  await pagina.waitForFunction(
    () => Number(document.getElementById('elites').textContent.replace(/\D/g, '')) > 0,
    undefined,
    { timeout: 60000 }
  );
  const elitesNaTela = await numero('#elites');
  await pagina.click('#pausar');
  await pagina.waitForTimeout(600);

  const gravacao = await pagina.evaluate(() => {
    const bruto = localStorage.getItem('sonho-lucido:historico');
    const sessoes = bruto ? JSON.parse(bruto) : [];
    const s = sessoes.find((x) => Array.isArray(x.elites) && x.elites.length > 0) ?? sessoes[0];
    return {
      elites: s?.elites ?? [],
      cartelas: (s?.elites ?? []).reduce((t, e) => t + e.length, 0),
    };
  });
  marcar(
    gravacao.elites.length > 0 &&
      gravacao.elites.every((e) => Array.isArray(e) && e.length > 0) &&
      gravacao.cartelas <= 2000,
    'o arquivo de elites é gravado junto, dentro do orçamento de 2.000 cartelas',
    `${elitesNaTela} na tela · ${gravacao.elites.length} gravadas · ${gravacao.cartelas} cartelas`
  );

  await pagina.click('#encerrar');
  await pagina.waitForSelector('#lotinha.ativo', { timeout: 20000 });
  await pagina.click('.aba[data-painel="historico"]');
  await pagina.waitForSelector('#historico.ativo');

  // Um arquivo estragado não pode desmontar nada.
  await pagina.setInputFiles('#arquivo-sessao', {
    name: 'quebrado.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"aplicativo":"sonho-lucido/sessao","formato":1,"sessao":{}}'),
  });
  await pagina.waitForTimeout(400);
  const recusa = (await pagina.locator('#previa-importacao').textContent()).replace(/\s+/g, ' ');
  marcar(
    /não pôde ser aberta/.test(recusa) && /Nada neste aparelho foi alterado/.test(recusa),
    'um arquivo sem sessão dentro é recusado dizendo o que houve, sem mexer em nada',
    recusa.slice(0, 80)
  );

  /* ─── a cota é da origem, não da chave ─── */

  /*
   * O defeito que este teste existe para não deixar voltar: os dois históricos
   * disputam os mesmos megabytes do navegador, e cada um só sabia aparar as
   * próprias sessões. Encher o do Construtor Exato fazia a Lotinha falhar ao
   * salvar — e a Lotinha então descartava trabalho **dela**, o que não libera
   * um único byte do que o outro ocupou.
   *
   * A primeira verificação é uma guarda contra teste vazio: se o enchimento
   * não encheu nada, as seguintes passariam sem provar coisa alguma. Já
   * escrevi esse teste errado uma vez nesta mesma sessão.
   */
  const atravessado = await pagina.evaluate(async () => {
    const h = await import('./historico.js');
    const e = await import('./exato-historico.js');
    h.limpar();
    e.limpar();

    // `escalada` é o estado do motor, guardado como texto — é o campo que pesa,
    // e é por ele que se enche a origem depressa.
    const pesado = 'x'.repeat(400_000);
    const pedido = { v: 23, k: 17, j: 15, t: 15, r: 1 };
    const numeros = Array.from({ length: 23 }, (_, n) => n + 1);
    for (let i = 0; i < 14; i += 1) {
      e.criar({ pedido, numeros, escalada: pesado, cartelasContadas: 100 });
    }
    const noExato = e.quantidade();

    const cedeu = [];
    const pararDeOuvir = e.quandoFaltarEspaco((r) => cedeu.push(r));

    // Agora a Lotinha tenta guardar o trabalho dela.
    const config = { pool: numeros, cartela: 17 };
    const gordas = Array.from({ length: 4000 }, () =>
      Array.from({ length: 17 }, (_, i) => i + 1)
    );
    h.criar(config, { melhor: gordas });
    const naLotinha = h.quantidade();
    const sobrouNoExato = e.quantidade();

    pararDeOuvir();
    h.limpar();
    e.limpar();
    return { noExato, naLotinha, sobrouNoExato, cedeu: cedeu.length };
  });

  marcar(
    atravessado.noExato >= 2,
    'o cenário de fato enche o histórico do Exato antes de medir',
    `${atravessado.noExato} sessões no Exato`
  );
  marcar(
    atravessado.naLotinha >= 1,
    'com o Exato ocupando a origem, a Lotinha ainda consegue guardar',
    `${atravessado.naLotinha} na Lotinha`
  );
  marcar(
    atravessado.sobrouNoExato === atravessado.noExato || atravessado.cedeu > 0,
    'e se o Exato cedeu espaço, ele avisou — nada some em silêncio',
    `${atravessado.noExato} → ${atravessado.sobrouNoExato}, ${atravessado.cedeu} aviso(s)`
  );

  marcar(errosDeConsole.length === 0, 'nenhum erro no console', errosDeConsole.join(' | ').slice(0, 140));
} finally {
  await navegador.close();
  servidor.close();
}

const falhas = passos.filter((p) => !p.certo);
console.log(`\n${passos.length - falhas.length} de ${passos.length} verificações passaram.`);
process.exit(falhas.length === 0 ? 0 : 1);
