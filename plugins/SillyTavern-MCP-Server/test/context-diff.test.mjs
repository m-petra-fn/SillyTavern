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

    it('establishes complete baseline on Turn 1 (full=true) with full lore content and valid non-zero hashes', async () => {
        const res = await handleToolCall('get_context_diff', { full: true, reset: true });
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
});
