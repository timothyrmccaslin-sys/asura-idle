export class Game {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GameFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_game_free(ptr, 0);
    }
    /**
     * Grant progress for `seconds` away. Returns a JSON summary.
     * @param {number} seconds
     * @returns {string}
     */
    apply_offline(seconds) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_apply_offline(this.__wbg_ptr, seconds);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    attack_speed() {
        const ret = wasm.game_attack_speed(this.__wbg_ptr);
        return ret;
    }
    /**
     * Buy `want` levels of upgrade `i` (want <= 0 means as many as affordable).
     * Returns the number of levels bought.
     * @param {number} i
     * @param {number} want
     * @returns {number}
     */
    buy(i, want) {
        const ret = wasm.game_buy(this.__wbg_ptr, i, want);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {boolean}
     */
    buy_shop(i) {
        const ret = wasm.game_buy_shop(this.__wbg_ptr, i);
        return ret !== 0;
    }
    /**
     * @param {number} i
     * @returns {boolean}
     */
    can_cast(i) {
        const ret = wasm.game_can_cast(this.__wbg_ptr, i);
        return ret !== 0;
    }
    /**
     * @param {number} i
     * @returns {boolean}
     */
    cast(i) {
        const ret = wasm.game_cast(this.__wbg_ptr, i);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    crit_chance() {
        const ret = wasm.game_crit_chance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    crit_mult() {
        const ret = wasm.game_crit_mult(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    damage() {
        const ret = wasm.game_damage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} v
     */
    debug_set_souls(v) {
        wasm.game_debug_set_souls(this.__wbg_ptr, v);
    }
    /**
     * @param {number} w
     */
    debug_set_wave(w) {
        wasm.game_debug_set_wave(this.__wbg_ptr, w);
    }
    /**
     * Debug/balance helper: simulate `seconds` with a greedy auto-buyer.
     * Not used by the UI; handy for play-testing and tuning.
     * @param {number} seconds
     * @param {boolean} autobuy
     * @returns {string}
     */
    debug_sim(seconds, autobuy) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_debug_sim(this.__wbg_ptr, seconds, autobuy);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Drain queued events: [type, x, y, a, b, c] * n
     * @returns {Float64Array}
     */
    drain_events() {
        const ret = wasm.game_drain_events(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Flat enemy buffer: [id, kind, x, y, hpFrac, size, age, flash, phase, boss, slow] * n
     * @returns {Float32Array}
     */
    enemies() {
        const ret = wasm.game_enemies(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} now_ms
     * @returns {string}
     */
    export_save(now_ms) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_export_save(this.__wbg_ptr, now_ms);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Per-frame scalars: [hpFrac, range, atkAnim, face, wave, waveKilled, waveTotal,
     *   stormLeft, beadsLeft, armsLeft, waveIntro, souls, isBossWave, hp, maxHp,
     *   atkPhase (0..1 toward the next swing), attacksPerSecond] — the last two are
     *   read-only hints so the renderer can start a move's wind-up before the hit lands.
     * @returns {Float64Array}
     */
    frame() {
        const ret = wasm.game_frame(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Jump to an earlier/later wave (only up to the best wave this life).
     * @param {number} w
     */
    goto_wave(w) {
        wasm.game_goto_wave(this.__wbg_ptr, w);
    }
    hard_reset() {
        wasm.game_hard_reset(this.__wbg_ptr);
    }
    /**
     * Import an exported string. Returns false (and changes nothing) if invalid.
     * @param {string} text
     * @returns {boolean}
     */
    import_save(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.game_import_save(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    last_save() {
        const ret = wasm.game_last_save(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} json
     * @returns {boolean}
     */
    load_json(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.game_load_json(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    max_hp() {
        const ret = wasm.game_max_hp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} seed
     */
    constructor(seed) {
        const ret = wasm.game_new(seed);
        this.__wbg_ptr = ret;
        GameFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    range() {
        const ret = wasm.game_range(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    rebirth() {
        const ret = wasm.game_rebirth(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    rebirth_beads() {
        const ret = wasm.game_rebirth_beads(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    regen() {
        const ret = wasm.game_regen(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} now_ms
     * @returns {string}
     */
    save_json(now_ms) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_save_json(this.__wbg_ptr, now_ms);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {boolean} on
     */
    set_auto(on) {
        wasm.game_set_auto(this.__wbg_ptr, on);
    }
    /**
     * @param {boolean} on
     */
    set_autocast(on) {
        wasm.game_set_autocast(this.__wbg_ptr, on);
    }
    /**
     * @returns {number}
     */
    siphon() {
        const ret = wasm.game_siphon(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    targets() {
        const ret = wasm.game_targets(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance the simulation by `dt` seconds (internally sub-stepped).
     * @param {number} dt
     */
    tick(dt) {
        wasm.game_tick(this.__wbg_ptr, dt);
    }
    /**
     * Full UI snapshot as JSON (call a few times per second).
     * @param {number} buy_mult
     * @returns {string}
     */
    ui(buy_mult) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_ui(this.__wbg_ptr, buy_mult);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Game.prototype[Symbol.dispose] = Game.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./asura_core_bg.js": import0,
    };
}

const GameFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_game_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
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

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
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
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
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

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('asura_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
