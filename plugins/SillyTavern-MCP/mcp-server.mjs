#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';

// Default to dedicated bridge port 8005, with fallback options
const ST_BASE = process.env.SILLYTAVERN_URL || `http://127.0.0.1:${process.env.SILLYTAVERN_MCP_PORT || '8005'}`;

const IMAGES_ROOT = 'C:/Petra/Jogos/SillyTavern/data/default-user/user/images';
const MESSAGE_IMAGES_ROOT = 'C:/Petra/Jogos/SillyTavern/data/default-user/user/images/messageImages';

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
function extractContextSections(promptObj) {
    let instructions = '';
    let lore = '';
    let scenario = '';

    const messages = promptObj?.type === 'chat_completion' && Array.isArray(promptObj.messages)
        ? promptObj.messages
        : null;

    if (messages) {
        for (const m of messages) {
            const content = String(m.content || '');
            if (content.includes('<writing_instructions>')) {
                const match = content.match(/<writing_instructions>([\s\S]*?)<\/writing_instructions>/i);
                instructions = match ? match[1].trim() : content.replace(/<\/?writing_instructions>/gi, '').trim();
            } else if (content.includes('<world_info>')) {
                const match = content.match(/<world_info>([\s\S]*?)<\/world_info>/i);
                lore = match ? match[1].trim() : content.replace(/<\/?world_info>/gi, '').trim();
            } else if (content.includes('<scenario>')) {
                const match = content.match(/<scenario>([\s\S]*?)<\/scenario>/i);
                scenario = match ? match[1].trim() : content.replace(/<\/?scenario>/gi, '').trim();
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

    return { instructions, lore, scenario };
}

/**
 * Standard Model Context Protocol (MCP) Tools definition
 */
const TOOLS = [
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
        description: 'Get only the active Scenario text for the current chat.',
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
        description: 'Get a structured summary of the active session: group name, container character, user name, chat ID, active lore titles, and last message with images.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_chat_history',
        description: 'Get recent chat messages in clean structured text format with sender name, swipe info, timestamps, attached image filenames/paths, and message text.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: 'Number of messages to retrieve (default: 30, max: 100)',
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

/**
 * Helper to get prompt object from action or cached state
 */
async function getAssembledPromptObject() {
    let fullData = null;
    try {
        fullData = await sendAction('get_full_context', {});
    } catch (_) {}

    if (!fullData?.assembledPrompt) {
        const stateRes = await fetchState();
        fullData = {
            assembledPrompt: stateRes.data?.assembledPrompt,
            group: stateRes.data?.group,
            character: stateRes.data?.character
        };
    }
    return fullData?.assembledPrompt || null;
}

/**
 * Enrich messages with attached images (from memory or chat jsonl)
 */
function enrichMessagesWithImages(messages, chatId) {
    if (!chatId) return messages;
    let jsonlMessages = [];
    try {
        const groupFile = `C:/Petra/Jogos/SillyTavern/data/default-user/group chats/${chatId}.jsonl`;
        if (fs.existsSync(groupFile)) {
            const lines = fs.readFileSync(groupFile, 'utf8').trim().split('\n');
            jsonlMessages = lines.map(l => {
                try { return JSON.parse(l); } catch (_) { return null; }
            }).filter(Boolean);
        }
    } catch (_) {}

    return messages.map((m, idx) => {
        const enriched = { ...m };
        const diskMsg = jsonlMessages[idx] || jsonlMessages[jsonlMessages.length - messages.length + idx];
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
        case 'get_full_context': {
            const promptObj = await getAssembledPromptObject();
            if (!promptObj) {
                return {
                    content: [{
                        type: 'text',
                        text: '⚠️ Could not assemble prompt context. Make sure SillyTavern is open in your browser.'
                    }]
                };
            }

            const { instructions, lore, scenario } = extractContextSections(promptObj);
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
            const promptObj = await getAssembledPromptObject();
            const { lore } = extractContextSections(promptObj);
            const text = lore
                ? `=== SECTION: ACTIVE LORE ===\n${lore}`
                : 'No active lore found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_chat_scenario': {
            const promptObj = await getAssembledPromptObject();
            const { scenario } = extractContextSections(promptObj);
            const text = scenario
                ? `=== SECTION: SCENARIO ===\n${scenario}`
                : 'No active scenario found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_writing_instructions': {
            const promptObj = await getAssembledPromptObject();
            const { instructions } = extractContextSections(promptObj);
            const text = instructions
                ? `=== SECTION: WRITING INSTRUCTIONS ===\n${instructions}`
                : 'No writing instructions found in current prompt.';
            return { content: [{ type: 'text', text }] };
        }

        case 'get_current_context': {
            const stateRes = await fetchState();
            const data = stateRes.data || {};
            const promptObj = await getAssembledPromptObject();
            const { lore } = extractContextSections(promptObj);

            // Extract titles from active lore
            const loreTitles = lore
                ? (lore.match(/^#\s+[^\n]+/gm) || []).map(t => t.replace(/^#\s*/, '').trim())
                : [];

            let out = '=== ACTIVE SESSION SUMMARY ===\n';
            out += `Session: ${data.chatId || 'Active Chat'}\n`;
            out += `Group: ${data.group?.name || 'None'}\n`;
            out += `Container Character: ${data.character?.name || 'Storyteller'}\n`;
            out += `User Name: ${data.userName || 'User'}\n`;
            out += `Total Messages: ${data.recentChat?.length || 0}\n\n`;

            out += '=== ACTIVE LORE ENTRIES ===\n';
            out += (loreTitles.length > 0 ? loreTitles.map(t => `- ${t}`).join('\n') : 'No active lore detected.') + '\n\n';

            const rawMessages = (data.recentChat || []).slice(-1);
            const enriched = enrichMessagesWithImages(rawMessages, data.chatId);
            if (enriched.length > 0) {
                const last = enriched[0];
                const swipeInfo = (last.swipes > 1) ? ` (Swipe ${last.swipe_id + 1}/${last.swipes})` : '';
                out += `=== LATEST MESSAGE PREVIEW ===\n`;
                out += `[${last.name || 'Character'}]${swipeInfo}\n`;
                if (Array.isArray(last.images) && last.images.length > 0) {
                    out += 'Images:\n' + last.images.map(img => `  - ${img.label}: ${img.filename}\n    Path: ${img.path}`).join('\n') + '\n';
                }
                out += `Text:\n${last.message || ''}`;
            }

            return { content: [{ type: 'text', text: out }] };
        }

        case 'get_chat_history': {
            const stateRes = await fetchState();
            const data = stateRes.data || {};
            const limit = Math.min(Number(args?.limit) || 30, 100);
            const rawMessages = (data.recentChat || []).slice(-limit);
            const enriched = enrichMessagesWithImages(rawMessages, data.chatId);

            if (enriched.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: 'No chat history found in the active session.'
                    }]
                };
            }

            const formatted = enriched.map((m, idx) => {
                const role = m.is_user ? 'User' : (m.is_system ? 'System' : (m.name || 'Storyteller'));
                const swipeInfo = (m.swipes > 1) ? ` (Swipe ${m.swipe_id + 1}/${m.swipes})` : '';
                let header = `[Message #${idx + 1}] [${role}]${swipeInfo}`;
                if (m.send_date) header += `\nDate: ${m.send_date}`;

                let imgBlock = '';
                if (Array.isArray(m.images) && m.images.length > 0) {
                    imgBlock = '\nImages:\n' + m.images.map(img => `  - ${img.label}: ${img.filename}\n    Path: ${img.path}`).join('\n');
                }

                return `${header}${imgBlock}\nText:\n${m.message || ''}`;
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
