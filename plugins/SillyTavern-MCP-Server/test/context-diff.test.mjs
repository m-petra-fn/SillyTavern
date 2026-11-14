import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    handleToolCall,
    loadContextCache,
    saveContextCache,
    computeHash
} from '../mcp-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, '..', 'context_cache.json');

describe('Context Diff State Machine & Content Verification', () => {
    beforeEach(() => {
        // Purge cache before each test run
        saveContextCache({});
    });

    it('omits hashes by default on get_context_diff and includes them when include_hashes=true', async () => {
        const defaultRes = await handleToolCall('get_context_diff', { full: true, reset: true });
        const defaultText = defaultRes.content[0].text;
        assert.ok(!defaultText.includes('Scenario Hash:'), 'Default output must omit Scenario Hash');
        assert.ok(!/\(Hash:\s*[0-9a-f]+\)/.test(defaultText), 'Default output must omit entry/message hashes');

        const res = await handleToolCall('get_context_diff', { full: true, reset: true, include_hashes: true });
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(text.includes('=== BASELINE CONTEXT'), 'Must include baseline header');
        assert.ok(text.includes('Scenario Hash:'), 'Must include scenario hash');
        assert.ok(text.includes('=== SECTION: SCENARIO ==='), 'Must include scenario section');
        assert.ok(text.includes('=== SECTION: ACTIVE LORE ==='), 'Must include active lore section');
        assert.ok(text.includes('=== SECTION: CHAT HISTORY ==='), 'Must include chat history section');

        // Check that NO lore entry has a zero hash
        const zeroHashes = text.match(/Hash:\s*00000000/g);
        assert.equal(zeroHashes, null, 'No lore entry or message should have hash 00000000');

        // Check that every lore entry contains actual narrative content, not just headers
        const loreSection = text.split('=== SECTION: ACTIVE LORE ===')[1]?.split('=== SECTION: CHAT HISTORY ===')[0] || '';
        assert.ok(loreSection.length > 200, 'Active lore section must have substantial content');

        // Check that entries are separated by --- and have text between headers and separators
        const loreBlocks = loreSection.split('\n\n---\n\n').map(b => b.trim()).filter(Boolean);
        assert.ok(loreBlocks.length > 0, 'Must have at least one lore entry block');
        for (const block of loreBlocks) {
            const lines = block.split('\n').filter(Boolean);
            assert.ok(lines.length >= 2, `Lore block must contain header and content:\n${block}`);
            assert.match(lines[0], /\[.+\] #\d+ - .+ \(Hash: [0-9a-f]{8}\)/, `Header must match pattern: ${lines[0]}`);
            // Check that content line is non-empty
            const contentLines = lines.slice(1).join(' ').trim();
            assert.ok(contentLines.length > 0, `Lore entry content must not be empty in block:\n${block}`);
        }

        // Verify context_cache.json on disk contains non-zero hashes
        const cache = loadContextCache();
        const sessionKey = Object.keys(cache)[0];
        assert.ok(sessionKey, 'Session must exist in cache');
        const sessionData = cache[sessionKey];
        assert.notEqual(sessionData.scenarioHash, '00000000');
        for (const [key, entry] of Object.entries(sessionData.loreEntries || {})) {
            assert.notEqual(entry.hash, '00000000', `Cache entry ${key} must not have hash 00000000`);
            assert.notEqual(entry.book, 'Active Lore', `Entry ${key} should match its real lorebook, not fallback`);
        }
    });

    it('returns "In sync (0 changes detected)" on subsequent turns when context is unchanged', async () => {
        // Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // Call delta check
        const res = await handleToolCall('get_context_diff', { include_content: true });
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(
            text.includes('Status: In sync (0 changes detected)') ||
            text.includes('In sync'),
            'Must report in sync when context has not changed'
        );
    });

    it('detects and embeds modified lore entries when include_content=true', async () => {
        // 1. Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // 2. Tamper with cache to simulate an outdated lore entry hash
        const cache = loadContextCache();
        const sessionKey = Object.keys(cache)[0];
        const loreKeys = Object.keys(cache[sessionKey].loreEntries || {});
        assert.ok(loreKeys.length > 0, 'Must have lore entries');
        const targetKey = loreKeys[0];
        cache[sessionKey].loreEntries[targetKey].hash = 'stale000';
        saveContextCache(cache);

        // 3. Call delta check with include_content=true
        const res = await handleToolCall('get_context_diff', { include_content: true });
        const text = res.content[0].text;

        assert.ok(text.includes('Modified (') || text.includes('[Active Lore]:'), 'Diff must detect modified lore');
        assert.ok(text.includes(cache[sessionKey].loreEntries[targetKey].title), 'Diff must report modified entry title');
        // Because include_content=true, the entry content must be embedded
        assert.ok(text.includes('Content: ') || text.includes('Content:\n'), 'Modified lore entry must embed full content');
    });

    it('detects and embeds updated scenario when include_content=true', async () => {
        // 1. Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // 2. Tamper with cache scenario hash
        const cache = loadContextCache();
        const sessionKey = Object.keys(cache)[0];
        cache[sessionKey].scenarioHash = 'outdated1';
        saveContextCache(cache);

        // 3. Call delta check with include_content=true
        const res = await handleToolCall('get_context_diff', { include_content: true });
        const text = res.content[0].text;

        assert.ok(text.includes('[Scenario]: Modified'), 'Diff must detect scenario modification');
        assert.ok(text.includes('Content:\n'), 'Diff must embed updated scenario text when include_content=true');
    });

    it('detects and embeds new messages when include_content=true', async () => {
        // 1. Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // 2. Tamper with cache by removing the last message
        const cache = loadContextCache();
        const sessionKey = Object.keys(cache)[0];
        const msgs = cache[sessionKey].messages || [];
        if (msgs.length > 1) {
            cache[sessionKey].messages = msgs.slice(0, -1);
            saveContextCache(cache);

            // 3. Call delta check with include_content=true
            const res = await handleToolCall('get_context_diff', { include_content: true });
            const text = res.content[0].text;

            assert.ok(text.includes('New Messages') || text.includes('New ('), 'Diff must report new messages');
            assert.ok(text.includes('Text:'), 'New message must embed full text when include_content=true');
        }
    });

    it('returns only IDs and hashes without full text when include_content=false', async () => {
        // 1. Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // 2. Tamper with cache lore hash
        const cache = loadContextCache();
        const sessionKey = Object.keys(cache)[0];
        const loreKeys = Object.keys(cache[sessionKey].loreEntries || {});
        assert.ok(loreKeys.length > 0);
        cache[sessionKey].loreEntries[loreKeys[0]].hash = 'stale111';
        saveContextCache(cache);

        // 3. Call delta check with include_content=false (zero text overhead mode)
        const res = await handleToolCall('get_context_diff', { include_content: false });
        const text = res.content[0].text;

        assert.ok(text.includes('Modified (') || text.includes('[Active Lore]:'));
        // Must NOT embed content
        assert.ok(!text.includes('Content:\n') && !text.includes('      Content: '), 'Zero overhead mode must not embed content');
    });

    it('purges cache for active chat when reset=true and clear_only=true', async () => {
        // 1. Establish baseline
        await handleToolCall('get_context_diff', { full: true });
        const cacheBefore = loadContextCache();
        const sessionKey = Object.keys(cacheBefore)[0];
        assert.ok(sessionKey);

        // 2. Call reset with clear_only
        await handleToolCall('get_context_diff', { reset: true, clear_only: true });

        // 3. Verify session was removed from cache
        const cacheAfter = loadContextCache();
        assert.equal(cacheAfter[sessionKey], undefined);
    });

    it('verifies get_context_diff parses {{ // }} comments and variables from lore and scenario', async () => {
        const res = await handleToolCall('get_context_diff', { full: true });
        const text = res.content[0].text;

        // Neither the baseline nor the lore blocks should ever contain unparsed comment tags
        assert.ok(!text.includes('{{ // }}'), 'Must parse and strip opening scoped comments');
        assert.ok(!text.includes('{{ /// }}'), 'Must parse and strip closing scoped comments');
        assert.ok(!text.includes('{{//'), 'Must parse and strip inline comments');
        assert.ok(!text.includes('{{char}}'), 'Must replace {{char}} with actual character name');
        assert.ok(!text.includes('{{user}}'), 'Must replace {{user}} with actual user name');
    });

    it('omits the last message from output and baseline when swipe=true', async () => {
        // First get normal full baseline to know total messages
        const fullRes = await handleToolCall('get_context_diff', { full: true, reset: true });
        const fullText = fullRes.content[0].text;
        const totalMatch = fullText.match(/Total Messages:\s*(\d+)/);
        assert.ok(totalMatch, 'Must report Total Messages');
        const totalMsgs = Number(totalMatch[1]);
        assert.ok(totalMsgs >= 1, 'Test fixture must have at least 1 message');

        // Now call with full=true, swipe=true
        const swipeRes = await handleToolCall('get_context_diff', { full: true, reset: true, swipe: true });
        const swipeText = swipeRes.content[0].text;
        const swipeTotalMatch = swipeText.match(/Total Messages:\s*(\d+)/);
        assert.ok(swipeTotalMatch);
        assert.equal(Number(swipeTotalMatch[1]), totalMsgs - 1, 'swipe=true must omit the last message');
        assert.ok(!swipeText.includes(`[Message #${totalMsgs - 1}]`), 'Last message must not appear in swipe=true output');

        // Subsequent non-swipe diff should detect the last message as New
        const nextRes = await handleToolCall('get_context_diff', { include_content: true, swipe: false });
        const nextText = nextRes.content[0].text;
        assert.ok(nextText.includes(`[#${totalMsgs - 1}]`), 'Subsequent swipe=false call must report the omitted message as new');
    });

    it('supports inclusive start_id and end_id range filtering on get_chat_history', async () => {
        const res = await handleToolCall('get_chat_history', { start_id: 0, end_id: 0 });
        const text = res.content[0].text;
        assert.ok(text.includes('[Message #0]'), 'Range 0..0 must include Message #0');
        assert.ok(!text.includes('[Message #1]'), 'Range 0..0 must not include Message #1');
    });

    it('omits hashes by default on granular endpoints and includes them when include_hashes=true', async () => {
        const msgDefault = (await handleToolCall('get_message', { message_id: 0 })).content[0].text;
        assert.ok(!msgDefault.includes('Hash:'), 'get_message must omit Hash by default');
        const msgHashed = (await handleToolCall('get_message', { message_id: 0, include_hashes: true })).content[0].text;
        assert.ok(msgHashed.includes('Hash:'), 'get_message must include Hash when include_hashes=true');

        const scenDefault = (await handleToolCall('get_chat_scenario', {})).content[0].text;
        assert.ok(!scenDefault.includes('Scenario Hash:'), 'get_chat_scenario must omit hash by default');
        const scenHashed = (await handleToolCall('get_chat_scenario', { include_hashes: true })).content[0].text;
        assert.ok(scenHashed.includes('[Scenario Hash:'), 'get_chat_scenario must include hash when include_hashes=true');

        const loreDefault = (await handleToolCall('list_active_lore', {})).content[0].text;
        assert.ok(!loreDefault.includes('Hash:'), 'list_active_lore must omit Hash by default');
        const loreHashed = (await handleToolCall('list_active_lore', { include_hashes: true })).content[0].text;
        assert.ok(loreHashed.includes('Hash:'), 'list_active_lore must include Hash when include_hashes=true');

        const overviewDefault = (await handleToolCall('get_chat_overview', {})).content[0].text;
        assert.ok(!overviewDefault.includes('Hash:'), 'get_chat_overview must omit Hash by default');
        const overviewHashed = (await handleToolCall('get_chat_overview', { include_hashes: true })).content[0].text;
        assert.ok(overviewHashed.includes('Scenario Hash:') && overviewHashed.includes('Hash:'), 'get_chat_overview must include hashes when include_hashes=true');

        const lastDefault = (await handleToolCall('get_last_message', {})).content[0].text;
        assert.ok(!lastDefault.includes('Hash:'), 'get_last_message must omit Hash by default');
        const lastHashed = (await handleToolCall('get_last_message', { include_hashes: true })).content[0].text;
        assert.ok(lastHashed.includes('Hash:'), 'get_last_message must include Hash when include_hashes=true');

        const ctxDefault = (await handleToolCall('get_current_context', {})).content[0].text;
        assert.ok(!ctxDefault.includes('Hash:'), 'get_current_context must omit Hash by default');
        const ctxHashed = (await handleToolCall('get_current_context', { include_hashes: true })).content[0].text;
        assert.ok(ctxHashed.includes('Scenario Hash:'), 'get_current_context must include hashes when include_hashes=true');
    });
});
