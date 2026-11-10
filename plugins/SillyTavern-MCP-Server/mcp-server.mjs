#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'context_cache.json');

function loadContextCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function saveContextCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (_) {}
}

// Default to dedicated bridge port 8005, with fallback options
const ST_BASE = process.env.SILLYTAVERN_URL || `http://127.0.0.1:${process.env.SILLYTAVERN_MCP_PORT || '8005'}`;

const IMAGES_ROOT = 'C:/Petra/Jogos/SillyTavern/data/default-user/user/images';
const MESSAGE_IMAGES_ROOT = 'C:/Petra/Jogos/SillyTavern/data/default-user/user/images/messageImages';
const WORLDS_DIR = 'C:/Petra/Jogos/SillyTavern/data/default-user/worlds';

function computeHash(content) {
    if (!content || typeof content !== 'string') return '00000000';
    return crypto.createHash('md5').update(content.trim()).digest('hex').slice(0, 8);
}

function countWords(str) {
    if (!str || typeof str !== 'string') return 0;
    return str.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Resolve an image filename and absolute path on disk
 */
function resolveImagePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const clean = rawPath.replace(/\\/g, '/');
    const filename = clean.split('/').pop();
    if (!filename || filename === 'five.png') return null;

    let absolutePath = '';
    if (clean.includes('/messageImages/')) {
        absolutePath = `${MESSAGE_IMAGES_ROOT}/${filename}`;
    } else if (clean.startsWith('/user/images/')) {
        absolutePath = `${IMAGES_ROOT}/${filename}`;
    } else if (clean.startsWith('img/')) {
        absolutePath = `C:/Petra/Jogos/SillyTavern/public/${clean}`;
    } else {
        absolutePath = `${IMAGES_ROOT}/${filename}`;
    }

    return {
        filename,
        rawPath,
        absolutePath: absolutePath.replace(/\\/g, '/')
    };
}

/**
 * Extract context sections (Instructions, Lore, Scenario) from assembled prompt
 */
function extractContextSections(promptObj, fallbackData = {}) {
    let instructions = '';
    let lore = '';
    let scenario = '';

    const messages = promptObj?.type === 'chat_completion' && Array.isArray(promptObj.messages)
        ? promptObj.messages
        : null;

    if (messages) {
        let currentTag = null;
        for (const m of messages) {
            const content = String(m.content || '').trim();

            if (content.includes('<writing_instructions>') && content.includes('</writing_instructions>')) {
                const match = content.match(/<writing_instructions>([\s\S]*?)<\/writing_instructions>/i);
                instructions = match ? match[1].trim() : instructions;
                continue;
            }
            if (content.includes('<world_info>') && content.includes('</world_info>')) {
                const match = content.match(/<world_info>([\s\S]*?)<\/world_info>/i);
                lore = match ? match[1].trim() : lore;
                continue;
            }
            if (content.includes('<scenario>') && content.includes('</scenario>')) {
                const match = content.match(/<scenario>([\s\S]*?)<\/scenario>/i);
                scenario = match ? match[1].trim() : scenario;
                continue;
            }

            if (/^<writing_instructions>/i.test(content)) {
                currentTag = 'writing_instructions';
                const stripped = content.replace(/^<writing_instructions>/i, '').trim();
                if (stripped) instructions = (instructions ? instructions + '\n\n' : '') + stripped;
                continue;
            }
            if (/^<world_info>/i.test(content)) {
                currentTag = 'world_info';
                const stripped = content.replace(/^<world_info>/i, '').trim();
                if (stripped) lore = (lore ? lore + '\n\n' : '') + stripped;
                continue;
            }
            if (/^<scenario>/i.test(content)) {
                currentTag = 'scenario';
                const stripped = content.replace(/^<scenario>/i, '').trim();
                if (stripped) scenario = (scenario ? scenario + '\n\n' : '') + stripped;
                continue;
            }

            if (currentTag && content.includes(`</${currentTag}>`)) {
                const stripped = content.replace(new RegExp(`</${currentTag}>.*$`, 'i'), '').trim();
                if (stripped) {
                    if (currentTag === 'writing_instructions') instructions = (instructions ? instructions + '\n\n' : '') + stripped;
                    else if (currentTag === 'world_info') lore = (lore ? lore + '\n\n' : '') + stripped;
                    else if (currentTag === 'scenario') scenario = (scenario ? scenario + '\n\n' : '') + stripped;
                }
                currentTag = null;
                continue;
            }

            if (currentTag) {
                if (currentTag === 'writing_instructions') instructions = (instructions ? instructions + '\n\n' : '') + content;
                else if (currentTag === 'world_info') lore = (lore ? lore + '\n\n' : '') + content;
                else if (currentTag === 'scenario') scenario = (scenario ? scenario + '\n\n' : '') + content;
            }
        }
    } else if (typeof promptObj?.prompt === 'string') {
        const p = promptObj.prompt;
        const instMatch = p.match(/<writing_instructions>([\s\S]*?)<\/writing_instructions>/i);
        if (instMatch) instructions = instMatch[1].trim();
        const loreMatch = p.match(/<world_info>([\s\S]*?)<\/world_info>/i);
        if (loreMatch) lore = loreMatch[1].trim();
        const scenMatch = p.match(/<scenario>([\s\S]*?)<\/scenario>/i);
        if (scenMatch) scenario = scenMatch[1].trim();
    }

    if (!scenario && fallbackData) {
        scenario = fallbackData.scenario || fallbackData.character?.scenario || fallbackData.group?.scenario || '';
    }

    return { instructions, lore, scenario };
}

/**
 * Extract active lore entries with book name, uid, title, hash, and content
 */
function getActiveLoreEntries(fallbackData = {}, promptObj = null) {
    const activeBooks = fallbackData?.activeLorebooks || [];
    const entries = [];
    const seenKeys = new Set();

    // 1. Scan active lorebook JSON files on disk
    if (Array.isArray(activeBooks) && activeBooks.length > 0) {
        for (const book of activeBooks) {
            const filename = book.endsWith('.json') ? book : `${book}.json`;
            const filePath = path.join(WORLDS_DIR, filename);
            if (fs.existsSync(filePath)) {
                try {
                    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const rawEntries = Object.values(raw.entries || {});
                    for (const e of rawEntries) {
                        if (e.constant && !e.disable) {
                            const hash = computeHash(e.content);
                            const key = `${book.toLowerCase()}:${e.uid}`;
                            seenKeys.add(key);
                            entries.push({
                                book,
                                entry_id: e.uid,
                                title: e.comment || 'Untitled',
                                content: e.content || '',
                                hash,
                                keys: Array.isArray(e.key) ? e.key : []
                            });
                        }
                    }
                } catch (_) {}
            }
        }
    }

    // 2. Also cross-reference with <world_info> in assembled prompt
    const { lore } = extractContextSections(promptObj, fallbackData);
    if (lore) {
        const regex = /^#\s+([^\n]+)\n([\s\S]*?)(?=(?:^#\s+[^\n]+)|\s*$)/gm;
        let match;
        let pIndex = 0;
        while ((match = regex.exec(lore)) !== null) {
            const title = match[1].trim();
            const content = match[2].trim();
            const hash = computeHash(content);

            const existing = entries.find(e => e.title.toLowerCase() === title.toLowerCase());
            if (!existing) {
                entries.push({
                    book: 'Active Lore',
                    entry_id: pIndex++,
                    title,
                    content,
                    hash,
                    keys: []
                });
            }
        }
    }

    return entries;
}

/**
 * Extract normalized chat messages from state with message IDs, hashes, word counts, and images
 */
function getChatMessages(data = {}) {
    const rawList = Array.isArray(data.allChat) && data.allChat.length > 0
        ? data.allChat
        : (Array.isArray(data.recentChat) ? data.recentChat : []);

    const enriched = enrichMessagesWithImages(rawList, data.chatId);
    return enriched.map((m, i) => {
        const id = (typeof m.id === 'number') ? m.id : i;
        const text = m.message || '';
        return {
            id,
            name: m.name || 'Character',
            is_user: !!m.is_user,
            is_system: !!m.is_system,
            message: text,
            send_date: m.send_date,
            swipes: m.swipes || 1,
            swipe_id: m.swipe_id ?? 0,
            images: m.images || [],
            hash: computeHash(text),
            words: countWords(text)
        };
    });
}

/**
 * Compute context delta / diff against server-side persistent cache per chatId
 */
async function computeContextDiff(args = {}) {
    const isFull = !!args?.full;
    const isReset = !!args?.reset;
    const includeContent = !!args?.include_content;

    const stateRes = await fetchState().catch(() => ({}));
    const data = stateRes?.data || {};
    const chatId = data.chatId || 'default';

    const cacheStore = loadContextCache();
    if (isReset && cacheStore[chatId]) {
        delete cacheStore[chatId];
        saveContextCache(cacheStore);
    }

    const { promptObj, fallbackData } = await getContextData();
    const combinedFallback = { ...fallbackData, ...data };
    const { scenario } = extractContextSections(promptObj, fallbackData);

    const currentScenarioHash = computeHash(scenario);
    const currentLoreEntries = getActiveLoreEntries(combinedFallback, promptObj);
    const currentMessages = getChatMessages(data);

    const cached = cacheStore[chatId];
    const isFirstTime = !cached;

    // Helper to build lore map
    const buildLoreMap = entries => {
        const map = {};
        for (const e of entries) {
            map[`${e.book}:${e.entry_id}`] = {
                book: e.book,
                entry_id: e.entry_id,
                title: e.comment || e.title,
                hash: e.hash,
                keys: e.keys || []
            };
        }
        return map;
    };

    // Helper to build message list
    const buildMsgList = msgs => msgs.map(m => ({
        id: m.id,
        name: m.name,
        is_user: m.is_user,
        is_system: m.is_system,
        hash: m.hash,
        words: m.words,
        swipes: m.swipes,
        swipe_id: m.swipe_id
    }));

    // If full sync requested or first time seeing this chatId
    if (isFull || isFirstTime) {
        cacheStore[chatId] = {
            scenarioHash: currentScenarioHash,
            loreEntries: buildLoreMap(currentLoreEntries),
            messages: buildMsgList(currentMessages),
            lastUpdated: Date.now()
        };
        saveContextCache(cacheStore);

        if (isFull) {
            let fullOut = `=== BASELINE CONTEXT [Session: ${chatId}] ===\n`;
            fullOut += `Scenario Hash: ${currentScenarioHash}\n`;
            fullOut += `Total Messages: ${currentMessages.length}\n`;
            fullOut += `Active Lore Entries: ${currentLoreEntries.length}\n\n`;

            if (scenario) {
                fullOut += `=== SECTION: SCENARIO ===\n${scenario}\n\n`;
            }

            if (currentLoreEntries.length > 0) {
                fullOut += `=== SECTION: ACTIVE LORE ===\n`;
                fullOut += currentLoreEntries.map(e => {
                    let block = `[${e.book}] #${e.entry_id} - ${e.title} (Hash: ${e.hash})`;
                    if (includeContent || isFull) {
                        block += `\n${e.content}`;
                    }
                    return block;
                }).join('\n\n---\n\n') + '\n\n';
            }

            if (currentMessages.length > 0) {
                fullOut += `=== SECTION: CHAT HISTORY ===\n`;
                fullOut += currentMessages.map(m => {
                    const role = m.is_user ? 'User' : (m.is_system ? 'System' : m.name);
                    const swipeInfo = (m.swipes > 1) ? ` (Swipe ${m.swipe_id + 1}/${m.swipes})` : '';
                    let block = `[Message #${m.id}] [${role}]${swipeInfo} (Hash: ${m.hash}, Words: ${m.words})`;
                    if (includeContent || isFull) {
                        block += `\nText:\n${m.message}`;
                    }
                    return block;
                }).join('\n\n---\n\n');
            }

            return fullOut.trim();
        }

        if (isFirstTime) {
            return `=== CONTEXT BASELINE ESTABLISHED [Session: ${chatId}] ===\nScenario Hash: ${currentScenarioHash}\nTotal Messages: ${currentMessages.length}\nActive Lore Entries: ${currentLoreEntries.length}\nStatus: Initial baseline saved. Future calls will return only deltas.`;
        }
    }

    const activeCached = cacheStore[chatId] || cached;

    // Delta calculation against cached baseline
    const changes = {
        scenarioChanged: false,
        loreModified: [],
        loreNew: [],
        loreRemoved: [],
        messagesRollback: false,
        messagesEdited: [],
        messagesNew: []
    };

    // 1. Scenario diff
    if (activeCached.scenarioHash !== currentScenarioHash) {
        changes.scenarioChanged = true;
    }

    // 2. Lore diff
    const currentLoreKeys = new Set();
    for (const e of currentLoreEntries) {
        const key = `${e.book}:${e.entry_id}`;
        currentLoreKeys.add(key);
        const oldE = activeCached.loreEntries?.[key];
        if (!oldE) {
            changes.loreNew.push(e);
        } else if (oldE.hash !== e.hash) {
            changes.loreModified.push(e);
        }
    }

    for (const [key, oldE] of Object.entries(activeCached.loreEntries || {})) {
        if (!currentLoreKeys.has(key)) {
            changes.loreRemoved.push(oldE);
        }
    }

    // 3. Message diff
    const oldMessages = activeCached.messages || [];
    if (currentMessages.length < oldMessages.length) {
        changes.messagesRollback = true;
    }

    for (const m of currentMessages) {
        if (m.id < oldMessages.length) {
            const oldM = oldMessages[m.id];
            if (oldM && oldM.hash !== m.hash) {
                changes.messagesEdited.push(m);
            }
        } else {
            changes.messagesNew.push(m);
        }
    }

    const hasChanges = changes.scenarioChanged ||
        changes.loreModified.length > 0 ||
        changes.loreNew.length > 0 ||
        changes.loreRemoved.length > 0 ||
        changes.messagesRollback ||
        changes.messagesEdited.length > 0 ||
        changes.messagesNew.length > 0;

    // Update server cache with the latest state
    cacheStore[chatId] = {
        scenarioHash: currentScenarioHash,
        loreEntries: buildLoreMap(currentLoreEntries),
        messages: buildMsgList(currentMessages),
        lastUpdated: Date.now()
    };
    saveContextCache(cacheStore);

    if (!hasChanges) {
        return `=== CONTEXT DIFF [Session: ${chatId}] ===\nStatus: In sync (0 changes detected).`;
    }

    let diffOut = `=== CONTEXT DIFF [Session: ${chatId}] ===\n`;

    if (changes.scenarioChanged) {
        diffOut += `\n[Scenario]: Modified (Hash: ${currentScenarioHash})`;
        if (includeContent) {
            diffOut += `\nContent:\n${scenario}\n`;
        }
    }

    if (changes.loreModified.length > 0 || changes.loreNew.length > 0 || changes.loreRemoved.length > 0) {
        diffOut += `\n[Active Lore]:`;
        if (changes.loreModified.length > 0) {
            diffOut += `\n  - Modified (${changes.loreModified.length}):\n` + changes.loreModified.map(e => {
                let s = `    * [${e.book}] #${e.entry_id} "${e.title}" (Hash: ${e.hash})`;
                if (includeContent) s += `\n      Content: ${e.content}`;
                return s;
            }).join('\n');
        }
        if (changes.loreNew.length > 0) {
            diffOut += `\n  - New (${changes.loreNew.length}):\n` + changes.loreNew.map(e => {
                let s = `    * [${e.book}] #${e.entry_id} "${e.title}" (Hash: ${e.hash})`;
                if (includeContent) s += `\n      Content: ${e.content}`;
                return s;
            }).join('\n');
        }
        if (changes.loreRemoved.length > 0) {
            diffOut += `\n  - Deactivated (${changes.loreRemoved.length}):\n` + changes.loreRemoved.map(e => {
                return `    * [${e.book}] #${e.entry_id} "${e.title}"`;
            }).join('\n');
        }
    }

    if (changes.messagesRollback) {
        diffOut += `\n[Chat Messages]: Rollback detected! Chat shrunk to ${currentMessages.length} messages (was ${oldMessages.length}).`;
    }

    if (changes.messagesEdited.length > 0 || changes.messagesNew.length > 0) {
        if (!changes.messagesRollback) diffOut += `\n[Chat Messages]:`;
        if (changes.messagesEdited.length > 0) {
            diffOut += `\n  - Edited (${changes.messagesEdited.length}):\n` + changes.messagesEdited.map(m => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : m.name);
                let s = `    * [#${m.id}] [${role}] (Words: ${m.words}, Hash: ${m.hash})`;
                if (includeContent) s += `\n      Text: ${m.message}`;
                return s;
            }).join('\n');
        }
        if (changes.messagesNew.length > 0) {
            diffOut += `\n  - New (${changes.messagesNew.length}):\n` + changes.messagesNew.map(m => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : m.name);
                let s = `    * [#${m.id}] [${role}] (Words: ${m.words}, Hash: ${m.hash})`;
                if (includeContent) s += `\n      Text: ${m.message}`;
                return s;
            }).join('\n');
        }
    }

    return diffOut.trim();
}

/**
 * Standard Model Context Protocol (MCP) Tools definition
 */
const TOOLS = [
    {
        name: 'get_context_diff',
        description: 'Get a lightweight delta of only what changed (scenario, active lore, or new/edited messages) since the last turn for the active chat. By default returns only IDs and hashes of changes (~15-45 tokens). Pass full=true on Turn 1 of a new agent conversation to establish the baseline.',
        inputSchema: {
            type: 'object',
            properties: {
                full: {
                    type: 'boolean',
                    description: 'If true, returns the complete baseline context (scenario, active lore, and chat history) and establishes the server reference. Use on Turn 1 of a new agent conversation.',
                    default: false
                },
                include_content: {
                    type: 'boolean',
                    description: 'If true, embeds the full text of modified lore entries and new messages directly into the diff to avoid extra roundtrips.',
                    default: false
                },
                reset: {
                    type: 'boolean',
                    description: 'If true, forcibly purges the server cache for the active chat.',
                    default: false
                }
            }
        }
    },
    {
        name: 'get_chat_overview',
        description: 'Get a lightweight overview of all messages in the chat (~80-150 tokens) with session ID, scenario hash, total messages, and per-message hashes, word counts, swipe counts, and image counts (without filenames). Use this to detect if earlier messages were edited or new messages added.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_message',
        description: 'Get the full text, sender name, swipe info, and metadata for a single message by its 0-indexed ID (without image filenames; use get_message_images for images).',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: {
                    type: 'integer',
                    description: '0-indexed ID of the message to retrieve'
                }
            },
            required: ['message_id']
        }
    },
    {
        name: 'get_last_message',
        description: 'Get solely the latest message in the active chat with full text, sender name, and swipe count (without image filenames). Ideal for continuing/appending text (/message-edit append=true) with zero token bloat.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_active_lore',
        description: 'List all currently active lorebooks and their active entries, with lorebook name, entry ID (uid), title, and content hash (~50-120 tokens). Use this to check which lore is active and whether any entry was modified.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_lore_entry',
        description: 'Get the full text content of a single specific lore entry by lorebook name and entry ID (uid).',
        inputSchema: {
            type: 'object',
            properties: {
                book: {
                    type: 'string',
                    description: 'Name of the lorebook (e.g. "[Chalcoa] Bronze Variants")'
                },
                entry_id: {
                    type: 'integer',
                    description: 'Unique entry ID (uid) within the lorebook'
                }
            },
            required: ['book', 'entry_id']
        }
    },
    {
        name: 'get_lore_entries',
        description: 'Batch-retrieve multiple lore entries across one or more lorebooks in a single call. Accepts an array of { book: string, uids: number[] } (e.g. [{ book: "bookname1", uids: [1, 3, 4] }, { book: "bookname2", uids: [4, 2, 1] }]).',
        inputSchema: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    description: 'Array of objects, each containing "book" (string) and "uids" (array of integer entry IDs).',
                    items: {
                        type: 'object',
                        properties: {
                            book: {
                                type: 'string',
                                description: 'Name of the lorebook'
                            },
                            uids: {
                                type: 'array',
                                description: 'List of entry IDs (uids) to retrieve',
                                items: {
                                    type: 'integer'
                                }
                            }
                        },
                        required: ['book', 'uids']
                    }
                }
            },
            required: ['entries']
        }
    },
    {
        name: 'get_message_images',
        description: 'List attached image filenames, labels, and local disk paths for messages in the active chat. Use this only when visual image analysis is explicitly required by the user.',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: {
                    type: 'integer',
                    description: 'Optional 0-indexed ID of a specific message. If omitted, returns image attachments for messages in the chat.'
                },
                limit: {
                    type: 'integer',
                    description: 'Number of recent messages to inspect for images when message_id is omitted (default: 30)',
                    default: 30
                }
            }
        }
    },
    {
        name: 'get_full_context',
        description: 'Get all scene context sections (Writing Instructions, Active Lore, and Scenario) combined in clean structured text format without roles and without chat history.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_current_lore',
        description: 'Get only the currently active World Info / Lore section matching the current scene.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_chat_scenario',
        description: 'Get the active Scenario text for the current chat, prefixed with its content hash.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_writing_instructions',
        description: 'Get only the active Writing Instructions text.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_current_context',
        description: 'Get a structured summary of the active session: group name, container character, user name, chat ID, scenario hash, lore hash, active lore titles, and last message preview (without image filenames).',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_chat_history',
        description: 'Get chat messages in clean structured text format with sender name, swipe info, timestamps, and message text (without image filenames; use get_message_images for images). Supports delta queries via since_id.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: 'Number of messages to retrieve (default: 30, max: 100)',
                    default: 30
                },
                since_id: {
                    type: 'integer',
                    description: 'Optional 0-indexed message ID. If specified, returns only messages logged after this ID (delta messages).'
                }
            }
        }
    },
    {
        name: 'get_chat_history_for_swipe',
        description: 'Get chat history excluding the very last message in the session (without image filenames). Use this when writing an alternative swipe for the latest message so that the message being swiped does not contaminate the context.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: 'Number of prior messages to retrieve (default: 30, max: 100)',
                    default: 30
                }
            }
        }
    },
    {
        name: 'post_character_message',
        description: 'Post a message as a specific character into the active chat log (supports new message via /sendas, new swipe via /swipes-add, or continue/append via /message-edit).',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Dialogue or narrative action text to post.'
                },
                character_name: {
                    type: 'string',
                    description: 'Name of the character to post as (defaults to current character or Storyteller).'
                },
                swipe: {
                    type: 'boolean',
                    description: 'If true, adds this message as a new alternative swipe on the last message (via /swipes-add).',
                    default: false
                },
                append: {
                    type: 'boolean',
                    description: 'If true, appends text to the last message (via /message-edit append=true).',
                    default: false
                }
            },
            required: ['text']
        }
    },
    {
        name: 'post_user_message',
        description: 'Post a message as the user in SillyTavern into the active chat. Can optionally trigger the character to generate a reply.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'The user message to send.'
                },
                trigger_generation: {
                    type: 'boolean',
                    description: 'Whether to trigger character response generation immediately after posting (default: true).',
                    default: true
                }
            },
            required: ['text']
        }
    },
    {
        name: 'post_system_message',
        description: 'Inject a system message or narrator note into the active SillyTavern chat.',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'The system message text to inject.'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'trigger_generation',
        description: 'Trigger SillyTavern to generate the next response using the currently configured LLM API.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'execute_slash_command',
        description: 'Execute a SillyTavern slash command (e.g. /sendas name=Storyteller ..., /swipes-add ..., /message-edit append=true ...).',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The slash command string to execute.'
                }
            },
            required: ['command']
        }
    },
    {
        name: 'list_characters',
        description: 'List all available characters currently installed in SillyTavern.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'select_character',
        description: 'Switch the currently active character in SillyTavern by character name or index.',
        inputSchema: {
            type: 'object',
            properties: {
                character: {
                    type: 'string',
                    description: 'Character name or numerical index to select and open.'
                }
            },
            required: ['character']
        }
    }
];

/**
 * Fetch state from SillyTavern Server Plugin
 */
async function fetchState() {
    try {
        const res = await fetch(`${ST_BASE}/state`);
        if (!res.ok) {
            throw new Error(`SillyTavern returned HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    } catch (err) {
        if (!process.env.SILLYTAVERN_URL && !process.env.SILLYTAVERN_MCP_PORT) {
            const fallbackRes = await fetch('http://127.0.0.1:8000/api/plugins/mcp/state');
            if (fallbackRes.ok) return await fallbackRes.json();
        }
        throw err;
    }
}

/**
 * Send an action request to SillyTavern Server Plugin
 */
async function sendAction(type, args = {}) {
    const res = await fetch(`${ST_BASE}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, args })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}: Failed to perform action`);
    }
    return json.result;
}

function isValidPromptObject(obj) {
    if (!obj) return false;
    if (obj.type === 'chat_completion' && Array.isArray(obj.messages) && obj.messages.length > 0) return true;
    if (obj.type === 'text_completion' && typeof obj.prompt === 'string' && obj.prompt.trim().length > 0) return true;
    return false;
}

/**
 * Helper to get prompt object and session metadata
 */
async function getContextData() {
    let fullData = null;
    try {
        fullData = await sendAction('get_full_context', {});
    } catch (_) {}

    const stateRes = await fetchState().catch(() => ({}));
    const stateData = stateRes?.data || {};

    let promptObj = null;
    if (isValidPromptObject(fullData?.assembledPrompt)) {
        promptObj = fullData.assembledPrompt;
    } else if (isValidPromptObject(stateData.assembledPrompt)) {
        promptObj = stateData.assembledPrompt;
    }

    return {
        promptObj,
        fallbackData: {
            scenario: stateData.scenario,
            group: fullData?.group || stateData.group,
            character: fullData?.character || stateData.character,
            chatId: stateData.chatId
        }
    };
}

/**
 * Enrich messages with attached images (from memory or chat jsonl)
 */
function enrichMessagesWithImages(messages, chatId) {
    if (!Array.isArray(messages) || messages.length === 0) return messages || [];
    let jsonlMessages = [];
    if (chatId) {
        try {
            const groupFile = `C:/Petra/Jogos/SillyTavern/data/default-user/group chats/${chatId}.jsonl`;
            let targetFile = null;
            if (fs.existsSync(groupFile)) {
                targetFile = groupFile;
            } else {
                const chatsDir = 'C:/Petra/Jogos/SillyTavern/data/default-user/chats';
                if (fs.existsSync(chatsDir)) {
                    const charDirs = fs.readdirSync(chatsDir);
                    for (const charDir of charDirs) {
                        const candidate = path.join(chatsDir, charDir, `${chatId}.jsonl`);
                        if (fs.existsSync(candidate)) {
                            targetFile = candidate;
                            break;
                        }
                    }
                }
            }

            if (targetFile) {
                const lines = fs.readFileSync(targetFile, 'utf8').trim().split('\n');
                jsonlMessages = lines.map(l => {
                    try { return JSON.parse(l); } catch (_) { return null; }
                }).filter(m => m && !m.chat_metadata);
            }
        } catch (_) {}
    }

    return messages.map((m, idx) => {
        const enriched = { ...m };
        const diskMsg = jsonlMessages[idx] || (jsonlMessages.length >= messages.length ? jsonlMessages[jsonlMessages.length - messages.length + idx] : null);
        const src = diskMsg || m;

        const imgs = [];
        const slots = [
            { key: 'force_avatar', label: 'Slot 1 (Avatar)' },
            { key: 'secondImage', label: 'Slot 2' },
            { key: 'thirdImage', label: 'Slot 3' },
            { key: 'fourthImage', label: 'Slot 4' },
            { key: 'portraitImage', label: 'Portrait' },
            { key: 'image', label: 'Attached Image' }
        ];

        for (const slot of slots) {
            const val = src[slot.key] || src.extra?.[slot.key];
            if (val && typeof val === 'string' && !val.includes('img/five.png')) {
                const res = resolveImagePath(val);
                if (res) {
                    imgs.push({ slot: slot.key, label: slot.label, filename: res.filename, path: res.absolutePath });
                }
            }
        }

        // Fallback: If no slot keys found on src, resolve any images already passed by the UI
        if (imgs.length === 0 && Array.isArray(m.images) && m.images.length > 0) {
            for (const img of m.images) {
                const raw = img.path || img.filename;
                const res = resolveImagePath(raw);
                if (res) {
                    let label = img.label || 'Image';
                    if (label === 'Avatar / Slot 1' || img.slot === 'force_avatar') {
                        label = 'Slot 1 (Avatar)';
                    }
                    imgs.push({
                        slot: img.slot || 'image',
                        label: label,
                        filename: res.filename,
                        path: res.absolutePath
                    });
                }
            }
        }

        if (imgs.length > 0) {
            enriched.images = imgs;
        }
        return enriched;
    });
}

/**
 * Handle MCP Tool execution
 */
async function handleToolCall(name, args) {
    switch (name) {
        case 'get_context_diff': {
            const diffText = await computeContextDiff(args);
            return { content: [{ type: 'text', text: diffText }] };
        }

        case 'get_full_context': {
            const { promptObj, fallbackData } = await getContextData();
            const { instructions, lore, scenario } = extractContextSections(promptObj, fallbackData);
            const sections = [];
            if (instructions) {
                sections.push(`=== SECTION: WRITING INSTRUCTIONS ===\n${instructions}`);
            }
            if (lore) {
                sections.push(`=== SECTION: ACTIVE LORE ===\n${lore}`);
            }
            if (scenario) {
                sections.push(`=== SECTION: SCENARIO ===\n${scenario}`);
            }

            const text = sections.length > 0
                ? sections.join('\n\n')
                : 'No context sections found in assembled prompt.';

            return { content: [{ type: 'text', text }] };
        }

        case 'get_current_lore': {
            const { promptObj, fallbackData } = await getContextData();
            const { lore } = extractContextSections(promptObj, fallbackData);
            const text = lore
                ? `=== SECTION: ACTIVE LORE ===\n${lore}`
                : 'No active lore found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_chat_scenario': {
            const { promptObj, fallbackData } = await getContextData();
            const { scenario } = extractContextSections(promptObj, fallbackData);
            const hash = computeHash(scenario);
            const text = scenario
                ? `[Scenario Hash: ${hash}]\n\n=== SECTION: SCENARIO ===\n${scenario}`
                : 'No active scenario found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_writing_instructions': {
            const { promptObj, fallbackData } = await getContextData();
            const { instructions } = extractContextSections(promptObj, fallbackData);
            const text = instructions
                ? `=== SECTION: WRITING INSTRUCTIONS ===\n${instructions}`
                : 'No writing instructions found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_chat_overview': {
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const { promptObj, fallbackData } = await getContextData();
            const { scenario } = extractContextSections(promptObj, fallbackData);
            const scenHash = computeHash(scenario);
            const msgs = getChatMessages(data);

            let out = '=== ACTIVE SESSION OVERVIEW ===\n';
            out += `Session ID: ${data.chatId || 'Active Chat'}\n`;
            out += `Group: ${data.group?.name || 'None'}\n`;
            out += `Container Character: ${data.character?.name || 'Storyteller'}\n`;
            out += `User Name: ${data.userName || 'User'}\n`;
            out += `Scenario Hash: ${scenHash} (Words: ${countWords(scenario)})\n`;
            out += `Total Messages: ${msgs.length}\n\n`;

            if (msgs.length === 0) {
                out += 'No messages logged in session.';
            } else {
                out += 'Messages:\n';
                out += msgs.map(m => {
                    const role = m.is_user ? 'User' : (m.is_system ? 'System' : m.name);
                    const swipeInfo = (m.swipes > 1) ? `, Swipes: ${m.swipe_id + 1}/${m.swipes}` : '';
                    const imgInfo = (Array.isArray(m.images) && m.images.length > 0) ? `, Images: ${m.images.length}` : '';
                    return `- [#${m.id}] [${role}] (Words: ${m.words}, Hash: ${m.hash}${swipeInfo}${imgInfo})`;
                }).join('\n');
            }

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_message': {
            const msgId = Number(args?.message_id);
            if (isNaN(msgId)) throw new Error('Missing or invalid parameter: message_id');
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const msgs = getChatMessages(data);
            const msg = msgs.find(m => m.id === msgId) || (msgId >= 0 && msgId < msgs.length ? msgs[msgId] : null);

            if (!msg) {
                return {
                    content: [{
                        type: 'text',
                        text: `Message #${msgId} not found in the active session.`
                    }]
                };
            }

            const role = msg.is_user ? 'User' : (msg.is_system ? 'System' : msg.name);
            const swipeInfo = (msg.swipes > 1) ? ` (Swipe ${msg.swipe_id + 1}/${msg.swipes})` : '';
            let header = `[Message #${msg.id}] [${role}]${swipeInfo} (Hash: ${msg.hash}, Words: ${msg.words})`;
            if (msg.send_date) header += `\nDate: ${msg.send_date}`;

            return {
                content: [{
                    type: 'text',
                    text: `${header}\nText:\n${msg.message || ''}`
                }]
            };
        }

        case 'get_last_message': {
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const msgs = getChatMessages(data);

            if (msgs.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No messages found in the active session.'
                    }]
                };
            }

            const last = msgs[msgs.length - 1];
            const role = last.is_user ? 'User' : (last.is_system ? 'System' : last.name);
            const swipeInfo = (last.swipes > 1) ? ` (Swipe ${last.swipe_id + 1}/${last.swipes})` : '';
            let header = `[Message #${last.id}] [${role}]${swipeInfo} (Hash: ${last.hash}, Words: ${last.words})`;
            if (last.send_date) header += `\nDate: ${last.send_date}`;

            return {
                content: [{
                    type: 'text',
                    text: `${header}\nText:\n${last.message || ''}`
                }]
            };
        }

        case 'get_message_images': {
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const msgs = getChatMessages(data);
            const msgId = (args?.message_id !== undefined && args?.message_id !== null && !isNaN(Number(args.message_id)))
                ? Number(args.message_id)
                : null;

            if (msgId !== null) {
                const msg = msgs.find(m => m.id === msgId) || (msgId >= 0 && msgId < msgs.length ? msgs[msgId] : null);
                if (!msg) {
                    return { content: [{ type: 'text', text: `Message #${msgId} not found in the active session.` }] };
                }
                const role = msg.is_user ? 'User' : (msg.is_system ? 'System' : msg.name);
                if (!Array.isArray(msg.images) || msg.images.length === 0) {
                    return { content: [{ type: 'text', text: `Message #${msg.id} [${role}] has no attached images.` }] };
                }
                let out = `=== IMAGES FOR MESSAGE #${msg.id} [${role}] ===\n`;
                out += msg.images.map(img => `- ${img.label}: ${img.filename}\n  Path: ${img.path}`).join('\n');
                return { content: [{ type: 'text', text: out }] };
            }

            const limit = Math.min(Number(args?.limit) || 30, 100);
            const recentMsgs = msgs.slice(-limit).filter(m => Array.isArray(m.images) && m.images.length > 0);

            if (recentMsgs.length === 0) {
                return { content: [{ type: 'text', text: 'No attached images found in recent chat messages.' }] };
            }

            let out = '=== ACTIVE CHAT IMAGES ===\n';
            out += recentMsgs.map(m => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : m.name);
                let block = `[Message #${m.id}] [${role}]:\n`;
                block += m.images.map(img => `  - ${img.label}: ${img.filename}\n    Path: ${img.path}`).join('\n');
                return block;
            }).join('\n\n');

            return { content: [{ type: 'text', text: out }] };
        }

        case 'list_active_lore': {
            const { promptObj, fallbackData } = await getContextData();
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const combinedFallback = { ...fallbackData, ...data };
            const loreEntries = getActiveLoreEntries(combinedFallback, promptObj);

            if (loreEntries.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No active lore entries found.'
                    }]
                };
            }

            let out = '=== ACTIVE LOREBOOK ENTRIES ===\n';
            out += loreEntries.map(e => {
                const words = countWords(e.content);
                const keysStr = (e.keys && e.keys.length > 0) ? ` | Keys: [${e.keys.slice(0, 5).join(', ')}]` : '';
                return `- Book: "${e.book}" | ID: ${e.entry_id} | Title: "${e.title}" | Hash: ${e.hash} (Words: ${words})${keysStr}`;
            }).join('\n');

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_lore_entry': {
            const book = String(args?.book || '').trim();
            const entryId = args?.entry_id;
            if (!book || entryId === undefined || entryId === null) {
                throw new Error('Parameters "book" and "entry_id" are required.');
            }

            const { promptObj, fallbackData } = await getContextData();
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const combinedFallback = { ...fallbackData, ...data };
            const loreEntries = getActiveLoreEntries(combinedFallback, promptObj);

            let entry = loreEntries.find(e =>
                (e.book.toLowerCase() === book.toLowerCase() || book === '*') &&
                String(e.entry_id) === String(entryId)
            );

            // If not found in active list, try directly loading the world file from disk
            if (!entry) {
                const filename = book.endsWith('.json') ? book : `${book}.json`;
                const filePath = path.join(WORLDS_DIR, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        const rawEntries = Object.values(raw.entries || {});
                        const found = rawEntries.find(e => String(e.uid) === String(entryId));
                        if (found) {
                            entry = {
                                book,
                                entry_id: found.uid,
                                title: found.comment || 'Untitled',
                                content: found.content || '',
                                hash: computeHash(found.content),
                                keys: Array.isArray(found.key) ? found.key : []
                            };
                        }
                    } catch (_) {}
                }
            }

            if (!entry) {
                return {
                    content: [{
                        type: 'text',
                        text: `Lore entry not found for book: "${book}", entry_id: ${entryId}`
                    }]
                };
            }

            let out = `=== LORE ENTRY: [${entry.book}] #${entry.entry_id} - ${entry.title} ===\n`;
            out += `Hash: ${entry.hash}\n`;
            if (entry.keys && entry.keys.length > 0) {
                out += `Keys: ${entry.keys.join(', ')}\n`;
            }
            out += `\nContent:\n${entry.content}`;

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_lore_entries': {
            let reqList = args?.entries;
            if (typeof reqList === 'string') {
                try { reqList = JSON.parse(reqList); } catch (_) { reqList = null; }
            }
            if (!Array.isArray(reqList) || reqList.length === 0) {
                throw new Error('Missing or invalid parameter: entries. Expected an array of { book: string, uids: number[] }.');
            }

            const { promptObj, fallbackData } = await getContextData();
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const combinedFallback = { ...fallbackData, ...data };
            const activeEntries = getActiveLoreEntries(combinedFallback, promptObj);

            const worldCache = new Map();
            const results = [];
            const notFound = [];

            for (const item of reqList) {
                const book = String(item.book || '').trim();
                const uids = Array.isArray(item.uids) ? item.uids : [];
                if (!book || uids.length === 0) continue;

                let diskEntries = null;
                const bookKey = book.toLowerCase();

                if (!worldCache.has(bookKey)) {
                    const filename = book.endsWith('.json') ? book : `${book}.json`;
                    const filePath = path.join(WORLDS_DIR, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            diskEntries = Object.values(raw.entries || {});
                        } catch (_) {}
                    }
                    worldCache.set(bookKey, diskEntries);
                } else {
                    diskEntries = worldCache.get(bookKey);
                }

                for (const uid of uids) {
                    let entry = activeEntries.find(e =>
                        (e.book.toLowerCase() === bookKey || book === '*') &&
                        String(e.entry_id) === String(uid)
                    );

                    if (!entry && diskEntries) {
                        const found = diskEntries.find(e => String(e.uid) === String(uid));
                        if (found) {
                            entry = {
                                book,
                                entry_id: found.uid,
                                title: found.comment || 'Untitled',
                                content: found.content || '',
                                hash: computeHash(found.content),
                                keys: Array.isArray(found.key) ? found.key : []
                            };
                        }
                    }

                    if (entry) {
                        results.push(entry);
                    } else {
                        notFound.push(`[${book}] #${uid}`);
                    }
                }
            }

            if (results.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: notFound.length > 0
                            ? `No lore entries found for the requested books and IDs: ${notFound.join(', ')}`
                            : 'No valid lore entries requested.'
                    }]
                };
            }

            let out = results.map(entry => {
                let block = `=== LORE ENTRY: [${entry.book}] #${entry.entry_id} - ${entry.title} ===\n`;
                block += `Hash: ${entry.hash}\n`;
                if (entry.keys && entry.keys.length > 0) {
                    block += `Keys: ${entry.keys.join(', ')}\n`;
                }
                block += `\nContent:\n${entry.content}`;
                return block;
            }).join('\n\n---\n\n');

            if (notFound.length > 0) {
                out += `\n\n---\n[Notice: The following entries were not found: ${notFound.join(', ')}]`;
            }

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_current_context': {
            const { promptObj, fallbackData } = await getContextData();
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const combinedFallback = { ...fallbackData, ...data };
            const { scenario } = extractContextSections(promptObj, fallbackData);
            const scenHash = computeHash(scenario);
            const loreEntries = getActiveLoreEntries(combinedFallback, promptObj);
            const msgs = getChatMessages(data);

            let out = '=== ACTIVE SESSION SUMMARY ===\n';
            out += `Session: ${data.chatId || 'Active Chat'}\n`;
            out += `Group: ${data.group?.name || 'None'}\n`;
            out += `Container Character: ${data.character?.name || 'Storyteller'}\n`;
            out += `User Name: ${data.userName || 'User'}\n`;
            out += `Scenario Hash: ${scenHash}\n`;
            out += `Total Messages: ${msgs.length}\n\n`;

            out += '=== ACTIVE LORE ENTRIES ===\n';
            out += (loreEntries.length > 0
                ? loreEntries.map(e => `- [${e.book}] #${e.entry_id} "${e.title}" (Hash: ${e.hash})`).join('\n')
                : 'No active lore detected.') + '\n\n';

            if (msgs.length > 0) {
                const last = msgs[msgs.length - 1];
                const role = last.is_user ? 'User' : (last.is_system ? 'System' : last.name);
                const swipeInfo = (last.swipes > 1) ? ` (Swipe ${last.swipe_id + 1}/${last.swipes})` : '';
                out += `=== LATEST MESSAGE PREVIEW ===\n`;
                out += `[${role}]${swipeInfo} (Hash: ${last.hash})\n`;
                out += `Text:\n${last.message || ''}`;
            }

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_chat_history': {
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const limit = Math.min(Number(args?.limit) || 30, 100);
            const sinceId = (args?.since_id !== undefined && args?.since_id !== null) ? Number(args.since_id) : null;

            let msgs = getChatMessages(data);

            if (sinceId !== null && !isNaN(sinceId)) {
                msgs = msgs.filter(m => m.id > sinceId);
            }

            const rawMessages = msgs.slice(-limit);

            if (rawMessages.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: sinceId !== null
                            ? `No new chat messages found since ID ${sinceId}.`
                            : 'No chat history found in the active session.'
                    }]
                };
            }

            const formatted = rawMessages.map(m => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : (m.name || 'Storyteller'));
                const swipeInfo = (m.swipes > 1) ? ` (Swipe ${m.swipe_id + 1}/${m.swipes})` : '';
                let header = `[Message #${m.id}] [${role}]${swipeInfo}`;
                if (m.send_date) header += `\nDate: ${m.send_date}`;

                return `${header}\nText:\n${m.message || ''}`;
            }).join('\n\n---\n\n');

            return { content: [{ type: 'text', text: formatted }] };
        }

        case 'get_chat_history_for_swipe': {
            const stateRes = await fetchState().catch(() => ({}));
            const data = stateRes?.data || {};
            const limit = Math.min(Number(args?.limit) || 30, 100);

            const allMessages = getChatMessages(data);
            const priorMessages = allMessages.slice(0, -1);
            const rawMessages = priorMessages.slice(-limit);

            if (rawMessages.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No prior chat history found before the latest message.'
                    }]
                };
            }

            const formatted = rawMessages.map(m => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : (m.name || 'Storyteller'));
                const swipeInfo = (m.swipes > 1) ? ` (Swipe ${m.swipe_id + 1}/${m.swipes})` : '';
                let header = `[Message #${m.id}] [${role}]${swipeInfo}`;
                if (m.send_date) header += `\nDate: ${m.send_date}`;

                return `${header}\nText:\n${m.message || ''}`;
            }).join('\n\n---\n\n');

            return { content: [{ type: 'text', text: formatted }] };
        }

        case 'post_character_message': {
            const text = String(args?.text || '').trim();
            if (!text) throw new Error('Missing parameter: text');
            const result = await sendAction('post_character_message', {
                text,
                character_name: args?.character_name,
                swipe: !!args?.swipe,
                append: !!args?.append
            });
            return {
                content: [{
                    type: 'text',
                    text: result?.message || `Successfully executed character message action.`
                }]
            };
        }

        case 'post_user_message': {
            const text = String(args?.text || '').trim();
            if (!text) throw new Error('Missing parameter: text');
            const trigger = args?.trigger_generation !== false;
            const result = await sendAction('post_user_message', {
                text,
                trigger_generation: trigger
            });
            return {
                content: [{
                    type: 'text',
                    text: `Successfully posted user message.${trigger ? ' Character reply generation triggered.' : ''}`
                }]
            };
        }

        case 'post_system_message': {
            const text = String(args?.text || '').trim();
            if (!text) throw new Error('Missing parameter: text');
            const result = await sendAction('post_system_message', { text });
            return {
                content: [{
                    type: 'text',
                    text: `System note injected: "${text}"`
                }]
            };
        }

        case 'trigger_generation': {
            const result = await sendAction('trigger_generation', {});
            return {
                content: [{
                    type: 'text',
                    text: result?.message || 'Generation triggered.'
                }]
            };
        }

        case 'execute_slash_command': {
            const command = String(args?.command || '').trim();
            if (!command) throw new Error('Missing parameter: command');
            const result = await sendAction('execute_slash_command', { command });
            return {
                content: [{
                    type: 'text',
                    text: `Executed slash command: ${command}\nOutput: ${JSON.stringify(result)}`
                }]
            };
        }

        case 'list_characters': {
            const stateRes = await fetchState();
            const char = stateRes.data?.character;
            const group = stateRes.data?.group;
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        activeCharacter: char?.name || null,
                        groupChat: group?.name || null,
                        groupMembers: group?.members || []
                    }, null, 2)
                }]
            };
        }

        case 'select_character': {
            const character = String(args?.character || '').trim();
            if (!character) throw new Error('Missing parameter: character');
            const result = await sendAction('select_character', { character });
            return {
                content: [{
                    type: 'text',
                    text: result?.message || `Selected character: ${character}`
                }]
            };
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

/**
 * Handle MCP Request
 */
async function handleRequest(request) {
    const { id, method, params } = request;

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'sillytavern-mcp',
                        version: '1.2.0'
                    }
                }
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    tools: TOOLS
                }
            };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            try {
                const result = await handleToolCall(name, args);
                return {
                    jsonrpc: '2.0',
                    id,
                    result
                };
            } catch (err) {
                return {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32603,
                        message: err.message || 'Internal tool execution error'
                    }
                };
            }
        }

        default:
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`
                }
            };
    }
}

/**
 * JSON-RPC Standard Stdio Loop
 */
function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
            const request = JSON.parse(trimmed);
            const response = await handleRequest(request);
            if (response) {
                process.stdout.write(JSON.stringify(response) + '\n');
            }
        } catch (err) {
            process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: `Parse error: ${err.message}`
                }
            }) + '\n');
        }
    });

    process.stderr.write('[SillyTavern-MCP] stdio server running.\n');
}

main();
