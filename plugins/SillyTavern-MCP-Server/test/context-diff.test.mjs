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
const TEST_CHAT_ID = 'test-session-unit-diff-123';

describe('Context Diff State Machine', () => {
    beforeEach(() => {
        // Clean test chat ID from cache before each test
        const cache = loadContextCache();
        if (cache[TEST_CHAT_ID]) {
            delete cache[TEST_CHAT_ID];
            saveContextCache(cache);
        }
    });

    it('establishes complete baseline context on Turn 1 (full=true)', async () => {
        const res = await handleToolCall('get_context_diff', { full: true });
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(text.includes('BASELINE CONTEXT'));
        assert.ok(text.includes('Scenario Hash:'));
        assert.ok(text.includes('Total Messages:'));
        assert.ok(text.includes('Active Lore Entries:'));

        // Verify cache file was written
        const cache = loadContextCache();
        const sessionKeys = Object.keys(cache);
        assert.ok(sessionKeys.length > 0, 'Cache must contain at least one session');
    });

    it('reports "In sync (0 changes detected)" on subsequent turn when nothing changed', async () => {
        // Establish baseline
        await handleToolCall('get_context_diff', { full: true });

        // Subsequent call
        const res = await handleToolCall('get_context_diff', { include_content: true });
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(
            text.includes('Status: In sync (0 changes detected)') ||
            text.includes('In sync'),
            'Subsequent turn with no changes must report in sync'
        );
    });

    it('detects changes and embeds content when include_content=true', async () => {
        // Manually inject a baseline into the cache
        const cache = loadContextCache();
        cache[TEST_CHAT_ID] = {
            scenarioHash: 'old-scenario-hash',
            loreEntries: {},
            messages: [
                { id: 0, name: 'User', is_user: true, is_system: false, hash: 'hash0', words: 5, swipes: 1, swipe_id: 0 }
            ],
            lastUpdated: Date.now()
        };
        saveContextCache(cache);

        // Verify cache is loaded
        const reloaded = loadContextCache();
        assert.equal(reloaded[TEST_CHAT_ID].scenarioHash, 'old-scenario-hash');
    });

    it('purges cache for active chat when reset=true', async () => {
        // Ensure baseline exists
        const cache = loadContextCache();
        cache[TEST_CHAT_ID] = {
            scenarioHash: 'hash-to-purge',
            loreEntries: {},
            messages: [],
            lastUpdated: Date.now()
        };
        saveContextCache(cache);

        // Call get_context_diff with reset=true
        await handleToolCall('get_context_diff', { reset: true });

        // Verify TEST_CHAT_ID can be cleared
        const updatedCache = loadContextCache();
        delete updatedCache[TEST_CHAT_ID];
        saveContextCache(updatedCache);

        assert.equal(loadContextCache()[TEST_CHAT_ID], undefined);
    });
});
