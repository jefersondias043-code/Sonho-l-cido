/*
 * A biblioteca de coberturas do mundo, guardada no aparelho.
 *
 * ## O que é
 *
 * As melhores coberturas já construídas no mundo — as cartelas de verdade, não
 * só os números. Uma vez importadas, ficam salvas no celular e servem de ponto
 * de partida para qualquer busca, sem internet e sem refazer trabalho que já
 * foi feito por outros.
 *
 * ## Por que IndexedDB, e não o mesmo lugar do histórico
 *
 * O histórico mora em `localStorage`, que tem cerca de 5 MB e guarda tudo como
 * texto. A biblioteca é de outra ordem: o recorte útil tem 1.082 designs e
 * 1,7 milhão de blocos, algo entre 20 e 40 MB. Não cabe.
 *
 * IndexedDB é assíncrono e desajeitado de usar, mas é o único armazenamento do
 * navegador com essa capacidade — e, diferente do cache do service worker, é
 * feito para dados que o aplicativo consulta, não para arquivos que ele serve.
 *
 * ## O tamanho que importa
 *
 * O arquivo original da La Jolla tem 2,7 GB. Quase tudo ali é inalcançável num
 * celular: `C(99,25,8)` tem bilhões de combinações a cobrir, e o motor precisa
 * de 12 bytes por combinação só para começar. Medido sobre o catálogo inteiro:
 *
 *     tudo                        8.759 designs   2.216 MB
 *     cabe na memória do celular  7.191 designs     560 MB
 *     faixa de uso real            1.082 designs      29 MB
 *
 * Por isso o caminho recomendado é `ferramentas/preparar-biblioteca.py`, que
 * faz esse recorte antes de o arquivo chegar ao aparelho. O formato de saída é
 * idêntico ao original, então este módulo lê os dois sem distinção.
 */

const BANCO = 'sonho-lucido:biblioteca';
const DEPOSITO = 'coberturas';
const VERSAO = 1;

/**
 * Acima disto o `JSON.parse` do navegador derruba a aba antes de terminar.
 *
 * O limite não é do formato e sim da memória: analisar JSON exige o texto
 * inteiro mais a estrutura resultante, ambos na memória ao mesmo tempo. Recusar
 * com uma explicação é muito melhor que travar o aplicativo sem dizer nada.
 */
const MAIOR_ARQUIVO = 300 * 1024 * 1024;

let bancoAberto = null;

function abrir() {
  if (bancoAberto) return bancoAberto;

  bancoAberto = new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(BANCO, VERSAO);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(DEPOSITO)) {
        bd.createObjectStore(DEPOSITO, { keyPath: 'chave' });
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error ?? new Error('não consegui abrir a biblioteca'));
  });

  return bancoAberto;
}

function transacao(bd, modo) {
  return bd.transaction(DEPOSITO, modo).objectStore(DEPOSITO);
}

function comoPromessa(pedido) {
  return new Promise((resolver, rejeitar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

/** A chave de um design, no mesmo formato do arquivo da La Jolla. */
export function chaveDe(v, k, t) {
  return `C(${v},${k},${t})`;
}

/**
 * Os blocos da melhor cobertura conhecida para `C(v,k,t)`, ou `null`.
 *
 * Os números vêm como no catálogo: `1..v`, onde `v` é o tamanho do pool.
 */
export async function obter(v, k, t) {
  try {
    const bd = await abrir();
    const registro = await comoPromessa(transacao(bd, 'readonly').get(chaveDe(v, k, t)));
    return registro ? registro.blocos : null;
  } catch {
    // Sem biblioteca o aplicativo funciona igual, só sem o atalho. Um erro de
    // armazenamento não pode impedir uma busca de começar.
    return null;
  }
}

/** Quantos designs e quantos blocos estão guardados. */
export async function resumo() {
  try {
    const bd = await abrir();
    const registros = await comoPromessa(transacao(bd, 'readonly').getAll());
    return {
      designs: registros.length,
      blocos: registros.reduce((soma, r) => soma + r.blocos.length, 0),
    };
  } catch {
    return { designs: 0, blocos: 0 };
  }
}

export async function limpar() {
  const bd = await abrir();
  await comoPromessa(transacao(bd, 'readwrite').clear());
}

/**
 * Interpreta e guarda um arquivo no formato da La Jolla.
 *
 * Cada entrada é conferida contra a própria chave antes de entrar: todo bloco
 * precisa ter exatamente `k` números, todos dentro de `1..v`, e sem repetição.
 * Um design malformado que passasse daqui viraria um fechamento furado
 * apresentado como recorde mundial — o pior defeito que este aplicativo poderia
 * ter.
 *
 * `aoProgredir(guardados, total)` é chamado ao longo da gravação, porque num
 * arquivo de dezenas de megabytes isso leva segundos e a tela não pode ficar
 * muda.
 */
export async function importar(texto, aoProgredir = () => {}) {
  if (texto.length > MAIOR_ARQUIVO) {
    throw new Error(
      `esse arquivo tem ${(texto.length / 1e6).toFixed(0)} MB e não cabe na ` +
        `memória do navegador. Use ferramentas/preparar-biblioteca.py para ` +
        `recortar a faixa que o aparelho consegue usar.`
    );
  }

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new Error('não é um arquivo JSON válido de coberturas.');
  }

  const entradas = Object.entries(bruto).filter(([chave]) => /^C\(\d+,\d+,\d+\)$/.test(chave));
  if (!entradas.length) {
    throw new Error(
      'nenhuma cobertura encontrada. O arquivo precisa ter chaves no formato ' +
        '"C(v,k,t)", como o covers.json da La Jolla.'
    );
  }

  const bd = await abrir();
  let guardados = 0;

  // Em lotes: uma transação por design seria lenta, e uma única transação para
  // milhares deles segura a tela até o fim sem dar notícia.
  const LOTE = 50;
  for (let i = 0; i < entradas.length; i += LOTE) {
    const fatia = entradas.slice(i, i + LOTE);
    const deposito = transacao(bd, 'readwrite');

    for (const [chave, blocos] of fatia) {
      const [v, k, t] = chave.match(/\d+/g).map(Number);
      conferir(chave, v, k, t, blocos);
      deposito.put({ chave, v, k, t, blocos });
      guardados += 1;
    }

    await new Promise((resolver, rejeitar) => {
      deposito.transaction.oncomplete = resolver;
      deposito.transaction.onerror = () =>
        rejeitar(deposito.transaction.error ?? new Error('falha ao gravar'));
      deposito.transaction.onabort = () =>
        rejeitar(
          new Error(
            'o navegador recusou guardar mais dados. Libere espaço no aparelho ' +
              'ou importe um recorte menor.'
          )
        );
    });

    aoProgredir(guardados, entradas.length);
  }

  return guardados;
}

function conferir(chave, v, k, t, blocos) {
  if (!Array.isArray(blocos) || blocos.length === 0) {
    throw new Error(`${chave}: não tem blocos.`);
  }
  if (!(t >= 1 && t <= k && k <= v)) {
    throw new Error(`${chave}: parâmetros impossíveis.`);
  }
  for (const bloco of blocos) {
    if (!Array.isArray(bloco) || bloco.length !== k) {
      throw new Error(`${chave}: um bloco tem ${bloco?.length} números, deveria ter ${k}.`);
    }
    const unicos = new Set(bloco);
    if (unicos.size !== k) {
      throw new Error(`${chave}: um bloco tem números repetidos.`);
    }
    for (const n of bloco) {
      if (!Number.isInteger(n) || n < 1 || n > v) {
        throw new Error(`${chave}: o número ${n} está fora de 1..${v}.`);
      }
    }
  }
}

/**
 * Pede ao navegador para não apagar a biblioteca sob pressão de espaço.
 *
 * Sem isto, o iOS trata o armazenamento como descartável e pode limpá-lo
 * sozinho — e o usuário perderia um download de dezenas de megabytes sem
 * entender por quê. O pedido pode ser recusado; não há o que fazer além de
 * seguir em frente.
 */
export async function pedirPersistencia() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
