import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findSTRoot() {
    let cur = __dirname;
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(cur, 'public/scripts/macros/engine/MacroEngine.js'))) return cur;
        cur = path.dirname(cur);
    }
    return 'C:/Petra/Jogos/SillyTavern';
}

const ST_ROOT = findSTRoot();
let CHEVROTAIN_MJS = path.join(ST_ROOT, 'node_modules/chevrotain/lib/chevrotain.mjs').replace(/\\/g, '/');
if (!fs.existsSync(CHEVROTAIN_MJS)) {
    // Fallback if inside worktree pointing to live node_modules
    CHEVROTAIN_MJS = 'C:/Petra/Jogos/SillyTavern/node_modules/chevrotain/lib/chevrotain.mjs';
}

const LIB_MOCK = encodeURIComponent(`
import * as chevrotain from 'file:///${CHEVROTAIN_MJS}';
export { chevrotain };
`);

const CORE_MACROS_MOCK = encodeURIComponent(`
export const ELSE_MARKER = '\\u0000\\u001FELSE\\u001F\\u0000';
`);

const UTILS_MOCK = encodeURIComponent(`
export function isFalseBoolean(val) { return val === false || val === 'false'; }
export function isTrueBoolean(val) { return val === true || val === 'true'; }
export function escapeRegex(s) { return String(s).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
export function getStringHash(s) { return 'hash'; }
`);

const STUBS_MOCK = encodeURIComponent(`
export const t = (s) => s;
export const Popup = class {};
export const POPUP_RESULT = {};
export const power_user = {};
export const accountStorage = { getItem: () => null, setItem: () => {} };
export const SimpleMutex = class {
    constructor() { this.update = async () => {}; }
    async mutex(fn) { return fn(); }
};
`);

export async function resolve(specifier, context, nextResolve) {
    const norm = specifier.replace(/\\/g, '/');
    if (norm.endsWith('/lib.js') || specifier === '../../../lib.js' || norm.endsWith('lib.js')) {
        return { shortCircuit: true, url: `data:text/javascript,${LIB_MOCK}` };
    }
    if (norm.endsWith('core-macros.js')) {
        return { shortCircuit: true, url: `data:text/javascript,${CORE_MACROS_MOCK}` };
    }
    if (norm.includes('scripts/utils.js') || norm.endsWith('/utils.js') || norm.endsWith('utils.js')) {
        return { shortCircuit: true, url: `data:text/javascript,${UTILS_MOCK}` };
    }
    if (norm.includes('scripts/i18n.js') || norm.includes('scripts/popup.js') || norm.includes('scripts/power-user.js') || norm.includes('scripts/util/')) {
        return { shortCircuit: true, url: `data:text/javascript,${STUBS_MOCK}` };
    }
    if (norm.endsWith('/script.js') || norm.endsWith('script.js')) {
        return { shortCircuit: true, url: `data:text/javascript,${CORE_MACROS_MOCK}` };
    }
    return nextResolve(specifier, context);
}
