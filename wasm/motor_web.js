export class MotorWeb {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MotorWebFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_motorweb_free(ptr, 0);
    }
    /**
     * Aplica ajustes ao motor rodando, a partir de um JSON parcial.
     *
     * Um método só para treze parâmetros. A alternativa — treze métodos quase
     * iguais — seria treze lugares para esquecer o recálculo que alguns deles
     * exigem, e é o tipo de repetição que fica errada em silêncio.
     *
     * Um JSON ilegível é ignorado, e a busca segue com o que tinha: um painel
     * que derruba o motor por causa de um campo mal formado seria pior que um
     * painel que não muda nada.
     * @param {string} ajustes_json
     */
    ajustar(ajustes_json) {
        const ptr0 = passStringToWasm0(ajustes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.motorweb_ajustar(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Troca o gatilho da diversificação com o motor rodando.
     *
     * A tela oferece isto num seletor porque não existe um número certo para
     * todas as configurações — e porque quem acompanha a busca percebe antes de
     * qualquer medição quando ela parou de render. Nada do trabalho é
     * descartado: muda o limiar, e o relógio que o persegue recomeça.
     * @param {number} iteracoes
     */
    ajustar_diversificacao(iteracoes) {
        wasm.motorweb_ajustar_diversificacao(this.__wbg_ptr, iteracoes);
    }
    /**
     * Troca o esforço gasto ao montar cada cartela, com o motor rodando.
     *
     * A outra metade do custo de uma iteração: o teto de trocas manda no que
     * acontece depois de remontar, este manda no que acontece durante.
     * @param {number} orcamento
     */
    ajustar_orcamento_por_cartela(orcamento) {
        wasm.motorweb_ajustar_orcamento_por_cartela(this.__wbg_ptr, orcamento);
    }
    /**
     * Troca o modo da simetria com o motor rodando.
     *
     * Aceita `"automatico"`, `"livre"` e `"simetrica"`; qualquer outra coisa
     * vira automático, porque um modo ilegível não pode parar a busca.
     * @param {string} modo
     */
    ajustar_simetria(modo) {
        const ptr0 = passStringToWasm0(modo, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.motorweb_ajustar_simetria(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Troca o teto de trocas por iteração com o motor rodando.
     *
     * A descida por troca move uma dezena de uma cartela para outra. É
     * acabamento: quanto dele cabe em cada tentativa decide se o motor faz
     * poucas tentativas lapidadas ou muitas tentativas rápidas — e qual dos
     * dois rende depende da configuração e do momento.
     * @param {number} trocas
     */
    ajustar_teto_de_trocas(trocas) {
        wasm.motorweb_ajustar_teto_de_trocas(this.__wbg_ptr, trocas);
    }
    /**
     * Tudo que o motor está usando agora, em JSON.
     *
     * A tela mostra isto ao lado dos controles: sem ele, quem move um seletor
     * vê o que o seletor diz, e não o que o motor faz — e são coisas diferentes
     * enquanto a mensagem não chega, ou se algum ajuste for recusado.
     * @returns {string}
     */
    ajustes_em_vigor() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_ajustes_em_vigor(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Roda um lote de iterações e devolve o estado resultante em JSON.
     *
     * Um lote grande demais trava a interface; pequeno demais gasta mais tempo
     * atravessando a fronteira do que calculando. A interface calibra isso
     * sozinha, medindo quanto o lote anterior demorou.
     *
     * O parâmetro é `u32`, não `u64`, de propósito: `u64` atravessa a fronteira
     * como `BigInt`, e um número comum vindo do JavaScript seria recusado com
     * "Cannot convert to a BigInt" — a busca simplesmente não sairia do lugar.
     * Quatro bilhões de iterações por lote é folga de sobra, já que um lote
     * mira duzentos milissegundos.
     * @param {number} iteracoes
     * @param {number} max_ms
     * @returns {string}
     */
    avancar(iteracoes, max_ms) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_avancar(this.__wbg_ptr, iteracoes, max_ms);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * **Estágio 0** — o Motor Construtor.
     *
     * Procura construir direto a menor solução que conseguir, em vez de montar
     * uma qualquer para a busca reduzir depois. Devolve, a cada melhoria, uma
     * linha com quantas cartelas e de que construção veio — é o que a tela
     * mostra enquanto o estágio corre.
     *
     * O orçamento vem de fora porque quem o conhece é a tela: num celular
     * alguns segundos, num computador o tempo que a pessoa quiser dar.
     *
     * Numa sessão retomada este estágio não roda: devolve a lista vazia sem
     * gastar um segundo do orçamento. O fechamento salvo é o ponto de partida,
     * e construir outro por cima dele seria trocar o trabalho do usuário por
     * trabalho novo.
     * @param {number} segundos
     * @returns {string}
     */
    construir_partida(segundos) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_construir_partida(this.__wbg_ptr, segundos);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * As elites que cabem num orçamento de cartelas, para o histórico gravar.
     *
     * Separadas do retrato porque são a única parte grande — cada elite tem o
     * tamanho de um fechamento — e porque os dois destinos têm orçamentos
     * diferentes. O arquivo exportado sai uma vez e vai por mensagem; o
     * histórico mora no armazenamento do navegador, que é de alguns megabytes
     * e guarda vários trabalhos. Quem conhece o próprio limite é quem chama.
     *
     * Vale a pena mesmo apertado: medido, retomar sem o arquivo de elites
     * gastava doze mil iterações sem achar nada, onde a corrida contínua caiu
     * de 307 para 263 cartelas no mesmo intervalo. A diversificação reinicia de
     * uma elite metade das vezes, e sem arquivo essa metade vira reconstrução
     * do zero — que é ir para longe sem levar nada.
     * @param {number} teto_de_cartelas
     * @returns {string}
     */
    elites_para_gravar(teto_de_cartelas) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_elites_para_gravar(this.__wbg_ptr, teto_de_cartelas);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Estado atual, sem avançar nada.
     * @returns {string}
     */
    estado() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_estado(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Empacota a sessão inteira, para continuar depois — aqui ou noutro
     * aparelho (§15).
     * @returns {string}
     */
    exportar() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_exportar(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * A melhor solução em rótulos do universo, pronta para exibir ou exportar.
     * @returns {string}
     */
    melhor() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_melhor(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    modo_da_simetria() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_modo_da_simetria(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} configuracao_json
     */
    constructor(configuracao_json) {
        const ptr0 = passStringToWasm0(configuracao_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.motorweb_novo(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        MotorWebFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Pesos aprendidos por cada operador, para a interface mostrar o que o
     * motor descobriu sobre este problema (§36).
     * @returns {string}
     */
    pesos() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_pesos(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Constrói a solução inicial sem começar a busca.
     *
     * Existe para a interface ter o que mostrar. A construção gulosa acontece
     * dentro da primeira chamada de [`Self::avancar`], e num problema grande
     * ela sozinha leva segundos — durante os quais a tela ficaria parada, sem
     * número nenhum, indistinguível de um travamento.
     *
     * Separando-a, o usuário vê de imediato quantas cartelas o ponto de
     * partida usa, e a partir daí acompanha o número cair.
     * @returns {string}
     */
    preparar() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_preparar(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} estado_json
     */
    retomar(estado_json) {
        const ptr0 = passStringToWasm0(estado_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.motorweb_retomar(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * O retrato **inteiro** do motor, para o histórico gravar.
     *
     * Separado do estado que vai em cada lote por uma questão de peso: a
     * memória do critério de aceitação são 500 custos, e mandá-la cinco vezes
     * por segundo seria quinze quilobytes por lote atravessando a fronteira
     * para nada. Quem grava chama isto — uma vez a cada trinta segundos, e a
     * cada recorde novo.
     *
     * Sem as cartelas: nem as do recorde, que a interface já tem, nem as das
     * elites, que só cabem no arquivo exportado.
     * @returns {string}
     */
    retrato_de_sessao() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.motorweb_retrato_de_sessao(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} cartelas_json
     */
    semear(cartelas_json) {
        const ptr0 = passStringToWasm0(cartelas_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.motorweb_semear(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} cartelas_json
     */
    semear_do_banco(cartelas_json) {
        const ptr0 = passStringToWasm0(cartelas_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.motorweb_semear_do_banco(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} texto
     */
    semear_texto(texto) {
        const ptr0 = passStringToWasm0(texto, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.motorweb_semear_texto(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Verdadeiro quando este motor foi carregado de uma sessão salva.
     *
     * É por aqui que a tela decide entre os dois caminhos: sessão retomada vai
     * direto para a busca, otimização nova passa pelo estágio 0. Perguntar ao
     * motor, e não guardar a resposta do lado do JavaScript, é o que faz os
     * dois lados concordarem sempre.
     * @returns {boolean}
     */
    sessao_retomada() {
        const ret = wasm.motorweb_sessao_retomada(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Quantos alvos esta configuração gera — a interface usa para avisar antes
     * de tentar algo que não caberia na memória do celular.
     * @returns {number}
     */
    total_alvos() {
        const ret = wasm.motorweb_total_alvos(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) MotorWeb.prototype[Symbol.dispose] = MotorWeb.prototype.free;

/**
 * A camada de adaptação para o JavaScript.
 *
 * Cada método aqui é uma linha: chama a lógica acima e traduz o erro. Se
 * alguma regra aparecer neste bloco, ela deixou de ser testável — é o sinal de
 * que está no lugar errado.
 * @param {string} pedido_json
 * @returns {string}
 */
export function dividir(pedido_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pedido_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.dividir(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_undefined_6cff064c44e0d823: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_now_e7c6795a7f81e10f: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_performance_3fcf6e32a7e1ed0a: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_static_accessor_GLOBAL_THIS_466428f93b4eaa76: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_c7aea38d4de089bc: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_42d4fae05e59267a: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e0db14a0eba6a812: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./motor_web_bg.js": import0,
    };
}

const MotorWebFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_motorweb_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('motor_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
