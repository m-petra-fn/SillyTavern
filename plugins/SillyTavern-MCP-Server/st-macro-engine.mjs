import { register } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve SillyTavern root directory
function findSTRoot() {
    let cur = __dirname;
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(cur, 'public/scripts/macros/engine/MacroEngine.js'))) return cur;
        cur = path.dirname(cur);
    }
    return 'C:/Petra/Jogos/SillyTavern';
}

const ST_ROOT = findSTRoot();

// Register the custom loader hook for resolving ST modules in Node.js
try {
    register(pathToFileURL(path.resolve(__dirname, 'st-macro-loader.mjs')).href, import.meta.url);
} catch (err) {
    // If already registered or not supported
}

// Shim global SillyTavern object for macros that reference it
if (!globalThis.SillyTavern) {
    const globalMap = new Map();
    const localMap = new Map();
    globalThis.SillyTavern = {
        getContext: () => ({
            variables: {
                global: globalMap,
                local: localMap
            },
            chatMetadata: {},
            name1: 'User',
            name2: 'Character'
        })
    };
}
if (!globalThis.window) {
    globalThis.window = globalThis;
}

let MacroEngine = null;
let MacroRegistry = null;
let initPromise = null;

async function initSTMacroEngine() {
    if (MacroEngine && MacroRegistry) return { MacroEngine, MacroRegistry };
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const enginePath = path.join(ST_ROOT, 'public/scripts/macros/engine/MacroEngine.js');
        const registryPath = path.join(ST_ROOT, 'public/scripts/macros/engine/MacroRegistry.js');

        const engineMod = await import(pathToFileURL(enginePath).href);
        const registryMod = await import(pathToFileURL(registryPath).href);

        MacroEngine = engineMod.MacroEngine;
        MacroRegistry = registryMod.MacroRegistry;

        // Register the ST comment macro '//' as SillyTavern core does
        if (!MacroRegistry.hasMacro('//')) {
            MacroRegistry.registerMacro('//', {
                aliases: [{ alias: 'comment', visible: false }],
                category: 'utility',
                unnamedArgs: [
                    {
                        name: 'comment',
                        type: 'string',
                        optional: true,
                        description: 'Any kind of text as comment.'
                    }
                ],
                handler: () => '',
                description: 'Comment macro that produces an empty string.'
            });
        }

        // Register standard utility macros
        if (!MacroRegistry.hasMacro('newline')) {
            MacroRegistry.registerMacro('newline', {
                category: 'utility',
                handler: () => '\n',
                description: 'Newline macro'
            });
        }
        if (!MacroRegistry.hasMacro('trim')) {
            MacroRegistry.registerMacro('trim', {
                category: 'utility',
                handler: () => '',
                description: 'Trim macro'
            });
        }
        if (!MacroRegistry.hasMacro('noop')) {
            MacroRegistry.registerMacro('noop', {
                category: 'utility',
                handler: () => '',
                description: 'No-op macro'
            });
        }
        if (!MacroRegistry.hasMacro('space')) {
            MacroRegistry.registerMacro('space', {
                category: 'utility',
                unnamedArgs: [
                    {
                        name: 'count',
                        optional: true,
                        defaultValue: '1',
                        type: 'integer',
                        description: 'Number of spaces'
                    }
                ],
                handler: ({ unnamedArgs: [count] }) => ' '.repeat(Number(count ?? 1)),
                description: 'Space macro'
            });
        }

        return { MacroEngine, MacroRegistry };
    })();

    return initPromise;
}

// Pre-initialize
initSTMacroEngine().catch(err => {
    console.error('[ST Macro Engine] Failed to initialize:', err);
});

/**
 * Parse text using SillyTavern's native MacroEngine.
 * Strips comments (including scoped {{ // }} ... {{ /// }} and inline {{// ...}})
 * and substitutes variables ({{user}}, {{char}}, etc.).
 *
 * @param {string} text - The input text to parse
 * @param {Object} [context={}] - Context containing userName, charName, character, variables
 * @returns {string} The parsed text
 */
export function parseWithST(text, context = {}) {
    if (!text || typeof text !== 'string') return '';

    const userName = context.userName || context.user || 'User';
    const charName = context.charName || context.char || context.character?.name || 'Character';

    if (context.variables && typeof context.variables === 'object') {
        const ctx = globalThis.SillyTavern?.getContext?.();
        if (ctx?.variables?.global instanceof Map) {
            for (const [k, v] of Object.entries(context.variables)) {
                ctx.variables.global.set(k, v);
                ctx.variables.local.set(k, v);
            }
        }
    }

    const env = {
        content: text,
        contentHash: 'hash',
        names: { user: userName, char: charName, group: '', groupNotMuted: '', notChar: '' },
        character: context.character || {},
        system: { model: '' },
        functions: { postProcess: (x) => x },
        dynamicMacros: {
            user: userName,
            char: charName,
            ...(context.variables || {})
        },
        extra: {}
    };

    if (MacroEngine) {
        try {
            return MacroEngine.evaluate(text, env);
        } catch (err) {
            console.error('[ST Macro Engine] Evaluation error, falling back:', err);
        }
    }

    // Safety fallback: if MacroEngine not yet initialized synchronous call
    return text;
}

/**
 * Async version that ensures MacroEngine is initialized before evaluating
 */
export async function parseWithSTAsync(text, context = {}) {
    if (!text || typeof text !== 'string') return '';
    await initSTMacroEngine();
    return parseWithST(text, context);
}
