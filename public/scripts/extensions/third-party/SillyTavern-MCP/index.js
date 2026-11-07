const MODULE_NAME = 'SillyTavern-MCP';
const EXTENSION_PATH = 'scripts/extensions/third-party/SillyTavern-MCP';

let activeApiBase = 'http://127.0.0.1:8005';
let isPolling = false;
let isConnected = false;
let lastSyncedName = null;
let lastSyncTimestamp = null;
let pollIntervalId = null;

// Stores the last assembled prompt (as captured by prompt ready events, like PromptInspector)
let lastAssembledPrompt = null;

/**
 * Determine best available API endpoint (port 8005 or Express route)
 */
async function resolveApiBase() {
    try {
        const res = await fetch('http://127.0.0.1:8005/status', { method: 'GET' });
        if (res.ok) {
            activeApiBase = 'http://127.0.0.1:8005';
            return activeApiBase;
        }
    } catch (_) {}

    try {
        const res = await fetch('/api/plugins/mcp/status', { method: 'GET' });
        if (res.ok) {
            activeApiBase = '/api/plugins/mcp';
            return activeApiBase;
        }
    } catch (_) {}

    return activeApiBase;
}

/**
 * Force SillyTavern to assemble the full prompt (Lorebook/World Info, Prompts, Chat History)
 * via dryRun without sending any request to the AI API.
 */
async function requestAssembledPrompt() {
    const context = SillyTavern.getContext();
    if (!context || typeof context.generate !== 'function') {
        return lastAssembledPrompt;
    }

    const isChat = context.mainApi === 'openai';

    return new Promise(async (resolve) => {
        let finished = false;

        const onChatPromptReady = (data) => {
            if (finished) return;
            finished = true;
            lastAssembledPrompt = {
                type: 'chat_completion',
                messages: data.chat,
                timestamp: Date.now()
            };
            cleanup();
            resolve(lastAssembledPrompt);
        };

        const onTextPromptReady = (data) => {
            if (finished) return;
            finished = true;
            lastAssembledPrompt = {
                type: 'text_completion',
                prompt: data.prompt,
                timestamp: Date.now()
            };
            cleanup();
            resolve(lastAssembledPrompt);
        };

        const cleanup = () => {
            if (context.eventSource && context.eventTypes) {
                if (context.eventTypes.CHAT_COMPLETION_PROMPT_READY) {
                    context.eventSource.removeListener(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, onChatPromptReady);
                }
                if (context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS) {
                    context.eventSource.removeListener(context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS, onTextPromptReady);
                }
            }
        };

        if (context.eventSource && context.eventTypes) {
            if (isChat && context.eventTypes.CHAT_COMPLETION_PROMPT_READY) {
                context.eventSource.once(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, onChatPromptReady);
            } else if (!isChat && context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS) {
                context.eventSource.once(context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS, onTextPromptReady);
            }
        }

        // Safety timeout: 4 seconds
        setTimeout(() => {
            if (!finished) {
                finished = true;
                cleanup();
                resolve(lastAssembledPrompt);
            }
        }, 4000);

        try {
            // dryRun = true: Assembles all active lore, system prompts, chat history, then stops
            await context.generate('normal', {}, true);
        } catch (err) {
            console.debug('[MCP Bridge] dryRun prompt assembly note:', err);
            if (!finished) {
                finished = true;
                cleanup();
                resolve(lastAssembledPrompt);
            }
        }
    });
}

/**
 * Sync current SillyTavern state with the MCP Server Plugin
 */
async function syncState() {
    const context = SillyTavern.getContext();
    if (!context) return;

    let characterData = null;
    let groupData = null;

    // Check if in group chat
    if (context.groupId && context.groups) {
        const currentGroup = context.groups.find(g => g.id == context.groupId);
        if (currentGroup) {
            const groupMembers = Array.isArray(currentGroup.members)
                ? currentGroup.members.map(avatar => (context.characters || []).find(c => c.avatar === avatar)).filter(Boolean)
                : [];

            groupData = {
                id: currentGroup.id,
                name: currentGroup.name,
                memberCount: groupMembers.length,
                members: groupMembers.map(m => m.name)
            };

            // If characters are in group, use the first/active one as character context
            if (groupMembers.length > 0) {
                const char = groupMembers[0];
                characterData = {
                    id: (context.characters || []).indexOf(char),
                    name: char.name,
                    avatar: char.avatar,
                    description: char.description || '',
                    personality: char.personality || '',
                    scenario: char.scenario || '',
                    first_mes: char.first_mes || '',
                    mes_example: char.mes_example || '',
                    inGroup: true,
                    groupName: currentGroup.name
                };
            }
        }
    }

    // Single character chat fallback
    if (!characterData && context.characters && context.characterId !== undefined && context.characters[context.characterId]) {
        const char = context.characters[context.characterId];
        characterData = {
            id: context.characterId,
            name: char.name || context.name2 || 'Character',
            avatar: char.avatar,
            description: char.description || '',
            personality: char.personality || '',
            scenario: char.scenario || '',
            first_mes: char.first_mes || '',
            mes_example: char.mes_example || ''
        };
    }

    const historyLimit = parseInt($('#mcp_chat_history_limit').val(), 10) || 30;
    const chatList = context.chat || [];
    const recentChat = chatList.slice(-historyLimit).map(m => {
        const images = [];
        if (m.force_avatar) images.push({ slot: 'force_avatar', label: 'Avatar / Slot 1', path: m.force_avatar });
        if (m.secondImage) images.push({ slot: 'secondImage', label: 'Slot 2', path: m.secondImage });
        if (m.thirdImage) images.push({ slot: 'thirdImage', label: 'Slot 3', path: m.thirdImage });
        if (m.fourthImage) images.push({ slot: 'fourthImage', label: 'Slot 4', path: m.fourthImage });
        if (m.portraitImage) images.push({ slot: 'portraitImage', label: 'Portrait', path: m.portraitImage });
        if (m.extra?.image) images.push({ slot: 'extra_image', label: 'Attached Image', path: m.extra.image });
        if (m.extra?.media) images.push({ slot: 'extra_media', label: 'Attached Media', path: m.extra.media });

        return {
            name: m.name,
            is_user: !!m.is_user,
            is_system: !!m.is_system,
            message: m.mes,
            send_date: m.send_date,
            swipes: Array.isArray(m.swipes) ? m.swipes.length : 1,
            swipe_id: m.swipe_id ?? 0,
            images: images
        };
    });

    // Extract active prompt settings
    let promptSettings = null;
    try {
        const pm = typeof context.getPresetManager === 'function' ? context.getPresetManager() : null;
        promptSettings = {
            mainApi: context.mainApi,
            presetName: pm?.getSelected ? pm.getSelected() : null,
            model: typeof context.getChatCompletionModel === 'function' ? context.getChatCompletionModel() : null,
            availableLorebooks: typeof context.getWorldInfoNames === 'function' ? context.getWorldInfoNames() : []
        };
    } catch (e) {}

    const payload = {
        character: characterData,
        group: groupData,
        userName: context.name1 || 'User',
        chatId: context.chatId || null,
        generationActive: !!context.onlineStatus,
        recentChat,
        promptSettings,
        assembledPrompt: lastAssembledPrompt
    };

    try {
        const res = await fetch(`${activeApiBase}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            updateStatusUI(true, groupData?.name || characterData?.name || 'Connected');
        } else {
            await resolveApiBase();
            updateStatusUI(false);
        }
    } catch (err) {
        await resolveApiBase();
        updateStatusUI(false);
    }
}

/**
 * Update settings drawer UI indicators
 */
function updateStatusUI(connected, charName) {
    isConnected = connected;
    if (charName) lastSyncedName = charName;
    if (connected) lastSyncTimestamp = Date.now();

    const statusEl = $('#mcp_bridge_status');
    const charEl = $('#mcp_active_character');
    const syncEl = $('#mcp_last_sync');

    if (statusEl.length) {
        if (connected) {
            statusEl.text('Connected').removeClass('mcp-badge-disconnected').addClass('mcp-badge-connected');
            charEl.text(lastSyncedName || 'Connected');
            syncEl.text(new Date(lastSyncTimestamp || Date.now()).toLocaleTimeString());
        } else {
            statusEl.text('Bridge Inactive').removeClass('mcp-badge-connected').addClass('mcp-badge-disconnected');
        }
    }
}

/**
 * Poll for pending actions from MCP Client
 */
async function pollActions() {
    if (isPolling) return;
    isPolling = true;

    try {
        const res = await fetch(`${activeApiBase}/poll-action`);
        if (!res.ok) {
            isPolling = false;
            return;
        }

        const data = await res.json();
        if (data.action) {
            await handleAction(data.action);
        }
    } catch (err) {
        // Silently handle temporary network errors
    } finally {
        isPolling = false;
    }
}

/**
 * Execute an incoming action inside SillyTavern
 */
async function handleAction(action) {
    const { id, type, args = {} } = action;
    const context = SillyTavern.getContext();

    try {
        let result = null;

        switch (type) {
            case 'get_full_context': {
                // Assemble fresh prompt on demand (active lore, system prompt, chat history)
                const assembled = await requestAssembledPrompt();
                result = {
                    assembledPrompt: assembled,
                    group: context.groupId && context.groups ? context.groups.find(g => g.id == context.groupId) : null,
                    character: context.characterId !== undefined ? context.characters?.[context.characterId] : null,
                    chatLength: context.chat?.length ?? 0
                };
                break;
            }

            case 'post_character_message': {
                let charName = args.character_name;
                if (!charName) {
                    if (context.groupId && context.groups) {
                        const currentGroup = context.groups.find(g => g.id == context.groupId);
                        if (currentGroup?.members?.length > 0) {
                            const firstChar = (context.characters || []).find(c => c.avatar === currentGroup.members[0]);
                            if (firstChar) charName = firstChar.name;
                        }
                    }
                }
                if (!charName) {
                    charName = context.name2 || (context.characters?.[context.characterId]?.name) || 'Storyteller';
                }

                if (args.swipe === true) {
                    // Add as a new alternative swipe using /swipes-add
                    const cmd = `/swipes-add ${args.text}`;
                    const output = await context.executeSlashCommandsWithOptions(cmd);
                    result = {
                        message: 'Added new swipe via /swipes-add',
                        output: output?.pipe ?? 'OK'
                    };
                } else if (args.append === true) {
                    // Continue/append to last message using /message-edit append=true
                    const cmd = `/message-edit append=true ${args.text}`;
                    const output = await context.executeSlashCommandsWithOptions(cmd);
                    result = {
                        message: 'Appended text to last message via /message-edit',
                        output: output?.pipe ?? 'OK'
                    };
                } else {
                    // Post new message using /sendas
                    const cmd = `/sendas name="${charName}" ${args.text}`;
                    const output = await context.executeSlashCommandsWithOptions(cmd);
                    result = {
                        message: `Posted message via /sendas name="${charName}"`,
                        output: output?.pipe ?? 'OK'
                    };
                }
                break;
            }

            case 'post_user_message': {
                const userName = context.name1 || 'User';
                const mes = {
                    name: userName,
                    is_user: true,
                    is_name: true,
                    send_date: Date.now(),
                    mes: args.text,
                    extra: {}
                };

                context.chat.push(mes);
                await context.saveChat();
                const chatId = context.chat.length - 1;

                if (context.eventSource && context.eventTypes) {
                    await context.eventSource.emit(context.eventTypes.MESSAGE_SENT, chatId);
                }
                context.addOneMessage(mes);
                if (context.eventSource && context.eventTypes) {
                    await context.eventSource.emit(context.eventTypes.USER_MESSAGE_RENDERED, chatId);
                }

                if (args.trigger_generation !== false) {
                    context.generate();
                }

                result = { message: `Posted message as ${userName}`, messageIndex: chatId, generated: !!args.trigger_generation };
                break;
            }

            case 'post_system_message': {
                const mes = {
                    name: 'System',
                    is_user: false,
                    is_system: true,
                    send_date: Date.now(),
                    mes: args.text,
                    extra: {}
                };

                context.chat.push(mes);
                await context.saveChat();
                context.addOneMessage(mes);

                result = { message: `System note posted`, text: args.text };
                break;
            }

            case 'trigger_generation': {
                context.generate();
                result = { message: 'Generation started' };
                break;
            }

            case 'execute_slash_command': {
                if (typeof context.executeSlashCommandsWithOptions === 'function') {
                    const output = await context.executeSlashCommandsWithOptions(args.command);
                    result = { output: output?.pipe ?? 'Command executed' };
                } else if (typeof context.executeSlashCommands === 'function') {
                    const output = await context.executeSlashCommands(args.command);
                    result = { output: output?.pipe ?? 'Command executed' };
                } else {
                    throw new Error('Slash command executor not available in this SillyTavern version');
                }
                break;
            }

            case 'list_characters': {
                const chars = (context.characters || []).map((c, i) => ({
                    id: i,
                    name: c.name,
                    avatar: c.avatar,
                    description: c.description ? c.description.slice(0, 160) + '...' : ''
                }));
                result = { count: chars.length, characters: chars };
                break;
            }

            case 'select_character': {
                const query = String(args.character || '').trim().toLowerCase();
                const idx = (context.characters || []).findIndex((c, i) =>
                    i.toString() === query ||
                    (c.name && c.name.toLowerCase() === query) ||
                    (c.avatar && c.avatar.toLowerCase().includes(query))
                );

                if (idx !== -1) {
                    await context.selectCharacterById(idx);
                    const selected = context.characters[idx];
                    setTimeout(syncState, 600);
                    result = { character: selected.name, id: idx };
                } else {
                    throw new Error(`Character '${args.character}' not found`);
                }
                break;
            }

            default:
                throw new Error(`Unsupported action type: ${type}`);
        }

        // Report success back to Server Plugin
        await fetch(`${activeApiBase}/action-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, success: true, result })
        });

        // Trigger immediate state sync after an action
        syncState();
    } catch (err) {
        console.error('[MCP Bridge] Failed to execute action:', err);
        await fetch(`${activeApiBase}/action-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, success: false, error: err.message })
        });
    }
}

/**
 * Initialize Extension on SillyTavern Load
 */
jQuery(async () => {
    try {
        const templateHtml = await $.get(`/${EXTENSION_PATH}/settings.html`);
        $('#extensions_settings').append(templateHtml);
        // Refresh UI badge with current connection status immediately
        updateStatusUI(isConnected, lastSyncedName);
    } catch (e) {
        console.warn('[MCP Bridge] Could not load settings template HTML:', e);
    }

    // Resolve API endpoint (8005 or Express route)
    await resolveApiBase();

    // Bind UI actions
    $('#mcp_btn_sync_now').on('click', async () => {
        toastr.info('Syncing SillyTavern state to MCP Bridge...');
        await resolveApiBase();
        requestAssembledPrompt().catch(() => {});
        await syncState();
        toastr.success(isConnected ? 'Bridge is online and synced!' : 'Server plugin not reachable. Check plugins/SillyTavern-MCP.');
    });

    $('#mcp_btn_test_ping').on('click', async () => {
        try {
            await resolveApiBase();
            const res = await fetch(`${activeApiBase}/status`);
            const data = await res.json();
            if (data.ok) {
                toastr.success(`MCP Bridge active! Active: ${data.activeCharacter || 'Connected'}`);
                updateStatusUI(true, data.activeCharacter);
                syncState();
            } else {
                toastr.warning('Plugin responded but status is not ok.');
            }
        } catch (err) {
            toastr.error('Could not reach MCP Bridge server. Ensure SillyTavern is running with plugins enabled.');
            updateStatusUI(false);
        }
    });

    const context = SillyTavern.getContext();
    if (context?.eventSource && context?.eventTypes) {
        const syncEvents = [
            context.eventTypes.APP_READY,
            context.eventTypes.CHAT_CHANGED,
            context.eventTypes.MESSAGE_SENT,
            context.eventTypes.MESSAGE_RECEIVED,
            context.eventTypes.MESSAGE_UPDATED,
            context.eventTypes.MESSAGE_DELETED,
            context.eventTypes.MESSAGE_SWIPED,
            context.eventTypes.CHARACTER_EDITED,
            context.eventTypes.GROUP_UPDATED,
            context.eventTypes.PERSONA_CHANGED
        ];

        for (const ev of syncEvents) {
            if (ev) {
                context.eventSource.on(ev, () => {
                    syncState();
                });
            }
        }

        // Continuous prompt capture (PromptInspector pattern)
        if (context.eventTypes.CHAT_COMPLETION_PROMPT_READY) {
            context.eventSource.on(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, (data) => {
                if (data?.chat && Array.isArray(data.chat) && data.chat.length > 0) {
                    lastAssembledPrompt = {
                        type: 'chat_completion',
                        messages: data.chat,
                        timestamp: Date.now()
                    };
                    syncState();
                }
            });
        }
        if (context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS) {
            context.eventSource.on(context.eventTypes.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
                if (context.mainApi !== 'openai' && data?.prompt) {
                    lastAssembledPrompt = {
                        type: 'text_completion',
                        prompt: data.prompt,
                        timestamp: Date.now()
                    };
                    syncState();
                }
            });
        }
    }

    // Immediate initial sync (run right away, then again once chat is loaded)
    await syncState();
    setTimeout(syncState, 1000);
    setTimeout(async () => {
        requestAssembledPrompt().catch(() => {});
        syncState();
    }, 2500);

    // Regular interval state sync
    setInterval(() => {
        if ($('#mcp_auto_sync').length === 0 || $('#mcp_auto_sync').is(':checked')) {
            syncState();
        }
    }, 4000);

    // Action polling loop
    pollIntervalId = setInterval(pollActions, 750);
    console.log('[SillyTavern-MCP] Extension initialized with PromptInspector & auto-sync support.');
});
