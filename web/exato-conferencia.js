/*
 * A conferência do Construtor Exato: quantos acertos, e quanto isso vale.
 *
 * O aplicativo constrói um fechamento e prova o mínimo. Isso responde "quantas
 * cartelas preciso" — e deixa em aberto a pergunta que vem logo depois, que é
 * "e daí?". Quanto custou comprar essas cartelas, quantas foram premiadas neste
 * concurso, quanto elas pagaram, e o dinheiro voltou ou não voltou.
 *
 * Três estágios, nesta ordem:
 *
 *   9  · o dinheiro — o preço da cartela e o prêmio de cada faixa;
 *   10 · um resultado — digitado ou sorteado, conferido cartela por cartela;
 *   11 · muitos sorteios — o comportamento do fechamento ao longo de milhares.
 *
 * O dinheiro vem antes de propósito. Preenchido, ele aparece dentro de toda
 * conferência abaixo; em branco, as contagens continuam saindo e só o balanço
 * fica de fora. Nunca se inventa um preço.
 *
 * A aritmética inteira mora em `exato-checagem.js`, sem DOM e sem WebAssembly,
 * e é cobrada por `testar-exato-checagem.mjs` em node puro. Aqui só há pintura,
 * ligação de botão e o que fica guardado entre uma visita e outra.
 */

import {
  faixasDe,
  mascarasDe,
  mascaraDe,
  interpretarResultado,
  sortearDe,
  urnaDoUniverso,
  conferir,
  valorDe,
  dinheiroDoSorteio,
  simularVarios,
  dinheiroDaSimulacao,
} from './exato-checagem.js';

const $ = (id) => document.getElementById(id);

/** Onde os preços ficam guardados: ninguém quer redigitar a tabela de prêmios. */
const CHAVE_DO_DINHEIRO = 'sonho-lucido:exato:dinheiro';

/** Acima disto a simulação vai para o trabalhador em vez de travar a tela. */
const TRABALHO_PARA_O_TRABALHADOR = 200_000;

/** Quantas cartelas de uma faixa são desenhadas por vez. */
const CARTELAS_POR_LEVA = 60;

/* ─────────── estado ─────────── */

let fechamento = null; // { cartelas, numeros, pedido, mascaras, faixas }
let ultima = null; // a última conferência
let faixaAberta = null;
let mostradas = 0;
let resumoDaSimulacao = null;
let simulando = false;
let trabalhador = null;
let quantosSorteios = 1000;
let origemDoSorteio = 'universo';

/* ─────────── utilidades de texto ─────────── */

function escapar(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const milhares = (n) => Number(n).toLocaleString('pt-BR');

const reais = (n) =>
  Number(n).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  });

const doisDigitos = (n) => String(n).padStart(2, '0');

/** Um decimal com vírgula, como o resto da tela. `toFixed` escreveria com ponto. */
const decimal = (n, casas) =>
  Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });

/* ─────────── o dinheiro que a pessoa informou ─────────── */

/**
 * Os preços de agora, lidos direto dos campos.
 *
 * Lidos a cada uso, e não guardados numa variável: um campo alterado tem de
 * valer na próxima conferência sem ninguém precisar avisar a tela.
 */
function precosDaTela() {
  const premios = new Map();
  if (fechamento) {
    for (const a of fechamento.faixas.lista) {
      const campo = $(`ex-premio-${a}`);
      if (campo) premios.set(a, valorDe(campo.value));
    }
  }
  return { custoUnitario: valorDe($('ex-custo-unitario')?.value), premios };
}

function guardarDinheiro() {
  const { custoUnitario, premios } = precosDaTela();
  try {
    localStorage.setItem(
      CHAVE_DO_DINHEIRO,
      JSON.stringify({ custoUnitario, premios: [...premios] })
    );
  } catch {
    // Armazenamento cheio ou desligado. Os preços continuam valendo nesta
    // sessão: perder a lembrança é menos grave do que parar de calcular.
  }
}

function dinheiroGuardado() {
  try {
    const bruto = localStorage.getItem(CHAVE_DO_DINHEIRO);
    if (!bruto) return null;
    const lido = JSON.parse(bruto);
    return {
      custoUnitario: Number(lido?.custoUnitario) || 0,
      premios: new Map((lido?.premios ?? []).map(([a, v]) => [Number(a), Number(v) || 0])),
    };
  } catch {
    return null;
  }
}

/**
 * Monta um campo de preço por faixa.
 *
 * As faixas mudam quando os cinco números mudam, então os campos são refeitos
 * a cada fechamento — e os valores que a pessoa já tinha digitado voltam pelas
 * faixas que sobreviveram. Trocar de "garante 15" para "garante 13" não pode
 * apagar o preço dos 15.
 */
function pintarCamposDePreco() {
  const destino = $('ex-premios');
  const guardado = dinheiroGuardado();
  const anteriores = new Map();
  for (const campo of destino.querySelectorAll('input[data-faixa]')) {
    anteriores.set(Number(campo.dataset.faixa), campo.value);
  }

  const { lista, garantia } = fechamento.faixas;
  destino.innerHTML = lista
    .slice()
    .reverse()
    .map((a) => {
      const valor =
        anteriores.get(a) ??
        (guardado?.premios.get(a) ? String(guardado.premios.get(a)).replace('.', ',') : '');
      return (
        `<label${a === garantia ? ' class="garantida"' : ''}>` +
        `<span>${a} acertos</span>` +
        `<input type="text" inputmode="decimal" id="ex-premio-${a}" data-faixa="${a}" ` +
        `value="${escapar(valor)}" placeholder="0,00" autocomplete="off" spellcheck="false" ` +
        `aria-label="Prêmio de ${a} acertos"></label>`
      );
    })
    .join('');

  for (const campo of destino.querySelectorAll('input[data-faixa]')) {
    campo.addEventListener('input', aoMudarODinheiro);
  }
}

function pintarCustoTotal() {
  const destino = $('ex-custo-total');
  const unitario = valorDe($('ex-custo-unitario').value);
  const quantas = fechamento?.cartelas.length ?? 0;

  destino.innerHTML = unitario
    ? `<b>Custo total do fechamento: ${reais(quantas * unitario)}</b> ` +
      `<em>${milhares(quantas)} cartelas × ${reais(unitario)}.</em>`
    : '<em>Informe o valor da cartela para o aplicativo calcular o custo do ' +
      'fechamento e o resultado líquido de cada conferência.</em>';
}

/** Um preço mudou: o custo, a conferência na tela e o balanço da simulação mudam junto. */
function aoMudarODinheiro() {
  pintarCustoTotal();
  guardarDinheiro();
  if (ultima) pintarConferencia();
  // A simulação não se repete: a matriz por sorteio já está guardada, e refazer
  // o balanço com outros preços custa milissegundos.
  if (resumoDaSimulacao) pintarSimulacao(resumoDaSimulacao);
}

/* ─────────── de onde sai o sorteio simulado ─────────── */

function pintarOrigem() {
  const { numeros } = fechamento;
  const universo = universoDeAgora();
  const parcial = numeros.length < universo;

  $('ex-origem-cartao').hidden = !parcial;
  if (!parcial) {
    origemDoSorteio = 'meus';
    return;
  }

  const opcoes = [
    ['universo', `todos os ${universo} números`],
    ['meus', `só os meus ${numeros.length}`],
  ];
  $('ex-origem').innerHTML = opcoes
    .map(
      ([valor, rotulo]) =>
        `<button class="opcao${valor === origemDoSorteio ? ' ativa' : ''}" ` +
        `data-origem="${valor}" aria-pressed="${valor === origemDoSorteio}">${rotulo}</button>`
    )
    .join('');

  for (const botao of $('ex-origem').querySelectorAll('[data-origem]')) {
    botao.addEventListener('click', () => {
      origemDoSorteio = botao.dataset.origem;
      pintarOrigem();
    });
  }
}

/** Binomial em ponto flutuante: só serve para uma razão, e não para contar. */
function combinacoes(n, k) {
  if (k < 0 || k > n) return 0;
  let total = 1;
  for (let i = 0; i < Math.min(k, n - k); i += 1) total = (total * (n - i)) / (i + 1);
  return total;
}

/**
 * A chance de um sorteio de verdade cair inteiro dentro dos números marcados.
 *
 * É o número que falta para "só entre os meus" ser um cenário honesto. Com 18
 * marcados de 25 e sorteio de 15, ele vale 0,025% — um concurso em quatro mil.
 * Sem dizê-lo, a simulação mostraria lucro em cem por cento dos sorteios e
 * quem lesse concluiria a coisa errada.
 *
 * Devolve `null` quando não há nada a avisar: se a pessoa marcou o universo
 * inteiro, todo sorteio cai dentro por construção.
 */
function chanceDeCairDentro() {
  const universo = universoDeAgora();
  const v = fechamento.numeros.length;
  const j = fechamento.pedido.j;
  if (v >= universo || j > v) return null;
  const total = combinacoes(universo, j);
  return total > 0 ? combinacoes(v, j) / total : null;
}

/** Quanto voltou por real gasto: porcentagem até dez vezes, múltiplo acima. */
function retorno(razao) {
  if (razao >= 10) {
    return `${razao.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}×`;
  }
  return `${decimal(razao * 100, 1)}%`;
}

/** Uma proporção pequena escrita sem virar "0,0%". */
function proporcao(p) {
  const pct = p * 100;
  if (pct >= 1) return `${decimal(pct, 1)}%`;
  if (pct >= 0.01) return `${decimal(pct, 3)}%`;
  return `${pct.toExponential(1).replace('.', ',')}%`;
}

/** A urna de onde o próximo sorteio simulado sai. */
function urnaDeAgora() {
  if (origemDoSorteio === 'meus') return fechamento.numeros;
  return urnaDoUniverso(universoDeAgora());
}

/**
 * O universo em vigor.
 *
 * Lido do campo, mas nunca menor que o maior número marcado nem que o tamanho
 * do sorteio: o campo continua editável depois de resolver, e encolhê-lo
 * deixaria de fora números que estão dentro das cartelas.
 */
function universoDeAgora() {
  const campo = Number($('ex-universo')?.value) || 0;
  return Math.max(campo, fechamento.pedido.j, ...fechamento.numeros);
}

/* ─────────── conferir um resultado ─────────── */

function mostrarErro(mensagem) {
  const destino = $('ex-conferir-erro');
  destino.hidden = false;
  destino.innerHTML = `<b>${escapar(mensagem)}</b>`;
}

function conferirNumeros(numerosSorteados) {
  if (!fechamento) return;

  $('ex-conferir-erro').hidden = true;
  ultima = conferir(fechamento.mascaras, numerosSorteados, fechamento.faixas);
  faixaAberta = null;
  mostradas = 0;

  // A limpeza vem antes de pintar, e não depois: `pintarBotoesDeFaixa` já
  // desenha a primeira leva de cartelas, e apagar em seguida deixaria o cartão
  // aberto e vazio.
  $('ex-faixa-cartelas').innerHTML = '';
  $('ex-faixa-mais').hidden = true;
  $('ex-premiadas-cartao').hidden = ultima.melhor < fechamento.faixas.piso;

  pintarConferencia();
  pintarBotoesDeFaixa();
}

function pintarConferencia() {
  const r = ultima;
  const { faixas } = fechamento;
  const dinheiro = dinheiroDoSorteio(r, precosDaTela());

  $('ex-conferencia-cartao').hidden = false;

  $('ex-sorteio-saiu').innerHTML = r.resultado
    .map((d) => `<span>${doisDigitos(d)}</span>`)
    .join('');

  // A faixa garantida primeiro, e sozinha. É a que o fechamento prometeu, e a
  // única sobre a qual há uma afirmação a conferir: as outras são medida.
  const naGarantia = r.contagem[faixas.garantia] ?? 0;
  const quantasPedidas = fechamento.pedido.r ?? 1;
  const cumpriu = naGarantia >= quantasPedidas;
  const forasteiros = r.resultado.filter((d) => !fechamento.numeros.includes(d));

  $('ex-conferencia-topo').innerHTML = cumpriu
    ? `<div class="premio ganhou">🎯 <b>${milhares(naGarantia)} cartela${
        naGarantia === 1 ? '' : 's'
      } com ${faixas.garantia} acerto${faixas.garantia === 1 ? '' : 's'}</b>` +
      `<em>A garantia pedia ${quantasPedidas}, e o fechamento entregou ${milhares(
        naGarantia
      )}.</em></div>`
    : `<div class="premio"><b>${
        naGarantia
          ? `${milhares(naGarantia)} cartela${naGarantia === 1 ? '' : 's'}`
          : 'Nenhuma cartela'
      } com ${faixas.garantia} acertos</b><em>${explicarAFalta(forasteiros)}</em></div>`;

  const linhas = faixas.lista
    .slice()
    .reverse()
    .map((a) => {
      const quantas = r.contagem[a];
      const linha = dinheiro.linhas.find((l) => l.acertos === a);
      const classe =
        (a === faixas.garantia ? 'faixa-garantida' : '') + (quantas === 0 ? ' faixa-vazia' : '');
      const colunasDeDinheiro = dinheiro.configurado
        ? `<td>${linha.valor ? reais(linha.valor) : '—'}</td>` +
          `<td>${linha.total ? reais(linha.total) : '—'}</td>`
        : '';
      return `<tr class="${classe.trim()}"><td>${a} acertos</td><td>${milhares(
        quantas
      )}</td>${colunasDeDinheiro}</tr>`;
    })
    .join('');

  const rodape =
    faixas.piso > 0
      ? `<tr class="faixa-resto"><td>${faixas.piso - 1} ou menos</td><td>${milhares(
          r.abaixo
        )}</td>${dinheiro.configurado ? '<td>—</td><td>—</td>' : ''}</tr>`
      : '';

  const cabecalho = dinheiro.configurado
    ? '<th>Acertos</th><th>Cartelas</th><th>Prêmio de cada</th><th>Total da faixa</th>'
    : '<th>Acertos</th><th>Cartelas</th>';

  $('ex-conferencia-faixas').innerHTML =
    `<caption>${milhares(r.total)} cartelas conferidas contra ${
      r.resultado.length
    } números sorteados</caption>` +
    `<thead><tr>${cabecalho}</tr></thead><tbody>${linhas}${rodape}</tbody>`;

  $('ex-balanco').innerHTML = dinheiro.configurado
    ? montarBalanco([
        ['Custo do fechamento', reais(dinheiro.custoTotal)],
        ['Total das premiações', reais(dinheiro.premioTotal)],
        ['Resultado líquido', reais(dinheiro.liquido), dinheiro.liquido],
      ])
    : '';

  $('ex-conferencia-nota').innerHTML = dinheiro.configurado
    ? 'Os valores são os que <b>você</b> informou no estágio 9. O aplicativo ' +
      'não consulta premiação de lugar nenhum e não sabe quanto a sua ' +
      'loteria pagou neste concurso.'
    : 'Preencha o valor da cartela e os prêmios no estágio 9 para ver o custo, ' +
      'a premiação e o resultado líquido junto com as contagens.';
}

/**
 * Por que a garantia não apareceu — lido do resultado, e não da tela.
 *
 * São duas situações diferentes, e confundi-las seria acusar o fechamento de
 * um defeito que ele não tem. Se o sorteio trouxe números que a pessoa não
 * marcou, a garantia simplesmente não se aplicava: ela vale para sorteios que
 * caiam inteiros dentro dos números escolhidos, e este não caiu. Se o sorteio
 * caiu inteiro dentro deles e ainda assim faltou, aí sim o buraco é do
 * fechamento — a cobertura não chegou a 100%.
 */
function explicarAFalta(forasteiros) {
  if (forasteiros.length === 0) {
    return (
      'O sorteio caiu inteiro dentro dos seus números e a garantia mesmo assim ' +
      'não foi cumprida: a cobertura deste fechamento não chegou a 100%.'
    );
  }
  return (
    `A garantia vale para sorteios que caiam inteiros dentro dos números que ` +
    `você marcou. Este trouxe ${forasteiros.length} de fora — ` +
    `${forasteiros.map(doisDigitos).join(', ')}.`
  );
}

/** As linhas do balanço. A última recebe cor: é a única que responde sim ou não. */
function montarBalanco(linhas) {
  return (
    '<div class="balanco">' +
    linhas
      .map(([rotulo, valor, liquido], i) => {
        const ultimo = i === linhas.length - 1;
        const cor = !ultimo || liquido === undefined ? '' : liquido > 0 ? ' positivo' : liquido < 0 ? ' negativo' : '';
        return `<div class="${ultimo ? 'liquido' : ''}${cor}"><span>${escapar(
          rotulo
        )}</span><b>${escapar(valor)}</b></div>`;
      })
      .join('') +
    '</div>'
  );
}

/* ─────────── as cartelas de cada faixa ─────────── */

function pintarBotoesDeFaixa() {
  const destino = $('ex-faixa-botoes');
  const comAlguma = fechamento.faixas.lista
    .slice()
    .reverse()
    .filter((a) => ultima.contagem[a] > 0);

  if (!comAlguma.length) {
    destino.innerHTML = '';
    return;
  }

  faixaAberta = faixaAberta ?? comAlguma[0];
  destino.innerHTML = comAlguma
    .map(
      (a) =>
        `<button class="opcao${a === faixaAberta ? ' ativa' : ''}" data-faixa="${a}" ` +
        `aria-pressed="${a === faixaAberta}">${a} acertos · ${milhares(
          ultima.contagem[a]
        )}</button>`
    )
    .join('');

  for (const botao of destino.querySelectorAll('[data-faixa]')) {
    botao.addEventListener('click', () => {
      faixaAberta = Number(botao.dataset.faixa);
      mostradas = 0;
      $('ex-faixa-cartelas').innerHTML = '';
      pintarBotoesDeFaixa();
      mostrarMaisCartelas();
    });
  }

  mostrarMaisCartelas();
}

/**
 * Desenha mais uma leva das cartelas da faixa aberta.
 *
 * Em levas porque uma faixa pode ter milhares de cartelas, e desenhar todas de
 * uma vez trava a tela pelo mesmo motivo que a conferência travava antes de ir
 * para o trabalhador.
 */
function mostrarMaisCartelas() {
  if (faixaAberta === null) return;
  const indices = ultima.indices.get(faixaAberta) ?? [];
  const alvo = mascaraDe(ultima.resultado);
  const pedaco = indices.slice(mostradas, mostradas + CARTELAS_POR_LEVA);

  $('ex-faixa-cartelas').insertAdjacentHTML(
    'beforeend',
    pedaco
      .map((i) => {
        const marcadas = fechamento.cartelas[i]
          .map((p) => fechamento.numeros[p - 1])
          .map(
            (d) =>
              `<span class="${(alvo >>> (d - 1)) & 1 ? 'acertou' : ''}">${doisDigitos(d)}</span>`
          )
          .join('');
        return (
          `<div class="cartela conferida">` +
          `<span class="indice">#${milhares(i + 1)}</span>` +
          `<span class="dezenas">${marcadas}</span>` +
          `<span class="acertos">${faixaAberta}</span></div>`
        );
      })
      .join('')
  );

  mostradas += pedaco.length;
  const botao = $('ex-faixa-mais');
  botao.hidden = mostradas >= indices.length;
  botao.textContent = `Mostrar mais ${milhares(
    Math.min(CARTELAS_POR_LEVA, indices.length - mostradas)
  )} de ${milhares(indices.length - mostradas)}`;
}

/* ─────────── simular muitos sorteios ─────────── */

function pintarQuantos() {
  const destino = $('ex-quantos');
  destino.innerHTML = [10, 100, 1000, 10000]
    .map(
      (n) =>
        `<button class="opcao${n === quantosSorteios ? ' ativa' : ''}" data-quantos="${n}" ` +
        `aria-pressed="${n === quantosSorteios}">${milhares(n)}</button>`
    )
    .join('');

  for (const botao of destino.querySelectorAll('[data-quantos]')) {
    botao.addEventListener('click', () => {
      quantosSorteios = Number(botao.dataset.quantos);
      pintarQuantos();
    });
  }
}

function garantirTrabalhador() {
  trabalhador = trabalhador ?? new Worker('./exato-checador.js', { type: 'module' });
  return trabalhador;
}

function pintarAndamento(feitos, total) {
  const destino = $('ex-simulacao-andamento');
  destino.hidden = false;
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;
  destino.innerHTML =
    `<b>Simulando…</b> <em>${milhares(feitos)} de ${milhares(total)} sorteios.</em>` +
    `<div class="barra-progresso"><div style="width:${pct}%"></div></div>`;
}

function pintarSimulacao(resumo) {
  resumoDaSimulacao = resumo;
  const dinheiro = dinheiroDaSimulacao(resumo, precosDaTela());
  const { garantia } = fechamento.faixas;

  $('ex-simulacao-andamento').hidden = true;
  $('ex-simulacao-rolagem').hidden = false;

  const linhas = resumo.faixas
    .slice()
    .reverse()
    .map((f) => {
      const pct = decimal(f.proporcao * 100, f.proporcao < 0.01 ? 2 : 1);
      const linha = dinheiro.porFaixa.find((l) => l.acertos === f.acertos);
      const colunas = dinheiro.configurado
        ? `<td>${linha.total ? reais(linha.total) : '—'}</td>`
        : '';
      return (
        `<tr class="${f.acertos === garantia ? 'faixa-garantida' : ''}">` +
        `<td>${f.acertos}</td><td>${milhares(f.sorteiosComAlguma)}</td><td>${pct}%</td>` +
        `<td>${decimal(f.media, 2)}</td><td>${milhares(f.minimo)}</td>` +
        `<td>${milhares(f.maximo)}</td>${colunas}</tr>`
      );
    })
    .join('');

  const cabecalho =
    '<th>Acertos</th><th>Sorteios com alguma</th><th>%</th><th>Média</th><th>Mín</th><th>Máx</th>' +
    (dinheiro.configurado ? '<th>Recebido ao todo</th>' : '');

  const de = resumo.origem === 'meus' ? 'só entre os seus números' : 'do universo inteiro';

  $('ex-simulacao-faixas').innerHTML =
    `<caption>${milhares(resumo.sorteios)} sorteios ${de}, sobre ${milhares(
      resumo.cartelas
    )} cartelas</caption>` +
    `<thead><tr>${cabecalho}</tr></thead><tbody>${linhas}</tbody>`;

  $('ex-simulacao-dinheiro').innerHTML = dinheiro.configurado
    ? montarBalanco([
        [`Investido em ${milhares(resumo.sorteios)} sorteios`, reais(dinheiro.investido)],
        ['Recebido no total', reais(dinheiro.recebido)],
        ['Média recebida por sorteio', reais(dinheiro.mediaRecebida)],
        ['Melhor sorteio', reais(dinheiro.melhor)],
        ['Pior sorteio', reais(dinheiro.pior)],
        [
          'Sorteios com lucro',
          `${milhares(dinheiro.comLucro)} de ${milhares(resumo.sorteios)}` +
            ` (${decimal((dinheiro.comLucro / Math.max(1, resumo.sorteios)) * 100, 1)}%)`,
        ],
        [
          dinheiro.retorno === null
            ? 'Resultado líquido'
            : `Resultado líquido — voltou ${retorno(dinheiro.retorno)} do que saiu`,
          reais(dinheiro.liquido),
          dinheiro.liquido,
        ],
      ]) +
      `<p class="ajuda">Frequência observada nesta simulação, aos preços que ` +
      `você informou. Não é promessa de retorno, e o próximo concurso não ` +
      `sabe o que saiu aqui.</p>${avisoDaOrigem(resumo.origem)}`
    : `<p class="ajuda">Preencha o valor da cartela e os prêmios no estágio 9 ` +
      `para ver também o desempenho financeiro ao longo destes sorteios.</p>${avisoDaOrigem(
        resumo.origem
      )}`;
}

/**
 * O aviso que salva a simulação "só entre os meus" de ser lida ao contrário.
 *
 * Sorteando só de dentro dos números marcados, um fechamento fechado em 100%
 * premia em todos os sorteios — e a tabela mostra "100% dos sorteios com
 * lucro". É verdade sobre aquele cenário e falso sobre a loteria, e a diferença
 * entre os dois é exatamente esta linha.
 */
function avisoDaOrigem(origem) {
  if (origem !== 'meus') return '';
  const chance = chanceDeCairDentro();
  if (chance === null) return '';
  return (
    `<p class="ajuda"><b>Leia com esta ressalva.</b> Estes sorteios foram ` +
    `tirados só dos seus ${fechamento.numeros.length} números, e um sorteio de ` +
    `verdade cai inteiro dentro deles em <b>${proporcao(chance)}</b> dos ` +
    `concursos — cerca de 1 em ${milhares(Math.round(1 / chance))}. O que está ` +
    `acima descreve o que acontece nesses; não conta os outros. Para o número ` +
    `realista, simule com o universo inteiro.</p>`
  );
}

async function simular() {
  if (!fechamento || simulando) return;

  const quantos = quantosSorteios;
  const urna = urnaDeAgora();
  const { faixas, pedido, mascaras } = fechamento;
  const trabalho = quantos * mascaras.length;

  simulando = true;
  $('ex-simular').disabled = true;
  resumoDaSimulacao = null;
  pintarAndamento(0, quantos);

  try {
    let resumo;
    if (trabalho < TRABALHO_PARA_O_TRABALHADOR) {
      // Pequeno o bastante para não valer a viagem até o trabalhador. Cede um
      // quadro antes, para a barra de andamento chegar a aparecer.
      await new Promise((r) => setTimeout(r, 0));
      resumo = simularVarios(mascaras, quantos, { urna, sorteio: pedido.j, faixas });
    } else {
      resumo = await new Promise((resolver, rejeitar) => {
        const w = garantirTrabalhador();
        w.onmessage = ({ data }) => {
          if (data.tipo === 'andamento') pintarAndamento(data.feitos, data.total);
          else if (data.tipo === 'pronto') resolver(data.resumo);
          else if (data.tipo === 'erro') rejeitar(new Error(data.mensagem));
        };
        w.onerror = (e) => rejeitar(new Error(e.message || 'falha na simulação'));
        // Uma cópia das máscaras: transferir o original deixaria a tela sem
        // elas para a próxima conferência.
        w.postMessage({
          tipo: 'simular',
          mascaras: mascaras.slice(),
          quantos,
          urna,
          sorteio: pedido.j,
          faixas,
        });
      });
    }
    // A origem viaja com o resultado: a legenda descreve o cenário que de
    // fato rodou, e não o botão que estiver aceso quando alguém mexer num
    // preço depois.
    pintarSimulacao({ ...resumo, origem: origemDoSorteio });
  } catch (erro) {
    $('ex-simulacao-andamento').hidden = false;
    $('ex-simulacao-andamento').innerHTML = `<b>A simulação falhou.</b> <em>${escapar(
      erro.message
    )}</em>`;
  } finally {
    simulando = false;
    $('ex-simular').disabled = false;
  }
}

/* ─────────── o que a tela do Exato chama ─────────── */

/**
 * Entrega um fechamento pronto para conferência.
 *
 * `cartelas` vem em posições, como o motor devolve; `numeros` é a lista marcada
 * na grade, e é o que traduz posição em número de verdade. A tradução acontece
 * uma vez, aqui, e todo o resto trabalha com máscaras.
 */
export function definirFechamento({ cartelas, numeros, pedido }) {
  if (!cartelas?.length || !numeros?.length) {
    esquecerFechamento();
    return;
  }

  fechamento = {
    cartelas,
    numeros,
    pedido,
    mascaras: mascarasDe(cartelas, numeros),
    faixas: faixasDe(pedido),
  };

  ultima = null;
  faixaAberta = null;
  mostradas = 0;
  resumoDaSimulacao = null;

  const guardado = dinheiroGuardado();
  if (guardado && !valorDe($('ex-custo-unitario').value) && guardado.custoUnitario) {
    $('ex-custo-unitario').value = String(guardado.custoUnitario).replace('.', ',');
  }

  $('ex-dinheiro-cartao').hidden = false;
  $('ex-conferir-cartao').hidden = false;
  $('ex-simulacao-cartao').hidden = false;
  $('ex-conferencia-cartao').hidden = true;
  $('ex-premiadas-cartao').hidden = true;
  $('ex-conferir-erro').hidden = true;
  $('ex-simulacao-rolagem').hidden = true;
  $('ex-simulacao-andamento').hidden = true;
  $('ex-simulacao-dinheiro').innerHTML = '';
  $('ex-resultado').value = '';
  $('ex-sortear').textContent = 'Simular sorteio';
  // O exemplo tem o tamanho de um sorteio de verdade. Truncado, ele ensinaria
  // o formato errado e a primeira conferência seria recusada.
  $('ex-resultado').placeholder = numeros.slice(0, pedido.j).map(doisDigitos).join(' ');

  pintarCamposDePreco();
  pintarCustoTotal();
  pintarOrigem();
  pintarQuantos();
}

/** Some com a conferência: os números da tela mudaram e o fechamento é outro. */
export function esquecerFechamento() {
  fechamento = null;
  ultima = null;
  resumoDaSimulacao = null;
  for (const id of [
    'ex-dinheiro-cartao',
    'ex-conferir-cartao',
    'ex-conferencia-cartao',
    'ex-premiadas-cartao',
    'ex-simulacao-cartao',
  ]) {
    const alvo = $(id);
    if (alvo) alvo.hidden = true;
  }
}

/* ─────────── ligações ─────────── */

function ligar(id, evento, funcao) {
  const alvo = $(id);
  if (alvo) alvo.addEventListener(evento, funcao);
}

ligar('ex-custo-unitario', 'input', aoMudarODinheiro);

ligar('ex-limpar-precos', 'click', () => {
  $('ex-custo-unitario').value = '';
  for (const campo of $('ex-premios').querySelectorAll('input[data-faixa]')) campo.value = '';
  aoMudarODinheiro();
});

ligar('ex-conferir', 'click', () => {
  if (!fechamento) return;
  const lido = interpretarResultado($('ex-resultado').value, {
    universo: universoDeAgora(),
    sorteio: fechamento.pedido.j,
  });
  if (lido.erro) {
    mostrarErro(lido.erro);
    return;
  }
  conferirNumeros(lido.numeros);
});

ligar('ex-sortear', 'click', () => {
  if (!fechamento) return;
  const numerosSorteados = sortearDe(urnaDeAgora(), fechamento.pedido.j);
  $('ex-resultado').value = numerosSorteados.map(doisDigitos).join(' ');
  conferirNumeros(numerosSorteados);
  // Depois do primeiro, o botão passa a se chamar pelo que ele de fato faz
  // agora: sortear outro.
  $('ex-sortear').textContent = 'Novo sorteio';
});

ligar('ex-faixa-mais', 'click', mostrarMaisCartelas);
ligar('ex-simular', 'click', simular);
