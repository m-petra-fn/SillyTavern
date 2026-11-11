import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processBridgeRequest } from '../index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, '..', 'context_cache.json');

function createMockReqRes(method = 'GET') {
    let statusCode = 200;
    const headers = {};
    let bodyText = '';

    const req = { method };
    const res = {
        writeHead: (code, hdrs) => {
            statusCode = code;
            if (hdrs) Object.assign(headers, hdrs);
        },
        setHeader: (k, v) => { headers[k] = v; },
        end: (data) => { if (data) bodyText += data; }
    };

    return {
        req,
        res,
        getResult: () => ({
            statusCode,
            headers,
            bodyText,
            json: () => JSON.parse(bodyText)
        })
    };
}

describe('Server Plugin HTTP API Routes', () => {
    it('GET /status returns plugin metadata and online status', async () => {
        const { req, res, getResult } = createMockReqRes('GET');
        await processBridgeRequest(req, res, '/status', null);
        const result = getResult();

        assert.equal(result.statusCode, 200);
        const data = result.json();
        assert.equal(data.ok, true);
        assert.equal(data.plugin, 'SillyTavern-MCP');
    });

    it('POST /state synchronizes active chat session metadata', async () => {
        const payload = {
            chatId: 'test-api-session-456',
            character: { name: 'TestHero' },
            scenario: 'Testing API endpoints',
            recentChat: [
                { id: 0, name: 'TestHero', mes: 'Ready for action.' }
            ]
        };

        const { req, res, getResult } = createMockReqRes('POST');
        await processBridgeRequest(req, res, '/state', payload);
        const result = getResult();

        assert.equal(result.statusCode, 200);
        const data = result.json();
        assert.equal(data.ok, true);
        assert.ok(data.receivedAt > 0);
    });

    it('GET /state returns the current in-memory state', async () => {
        const { req, res, getResult } = createMockReqRes('GET');
        await processBridgeRequest(req, res, '/state', null);
        const result = getResult();

        assert.equal(result.statusCode, 200);
        const data = result.json();
        assert.equal(data.ok, true);
        assert.ok(data.data !== undefined);
    });

    it('POST /clear-context-cache successfully purges specified chatId from cache', async () => {
        const testChatId = 'test-to-purge-789';
        // Setup cache entry
        let cache = {};
        if (fs.existsSync(CACHE_FILE)) {
            try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (_) {}
        }
        cache[testChatId] = { scenarioHash: 'test', loreEntries: {}, messages: [] };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');

        // Request purge
        const { req, res, getResult } = createMockReqRes('POST');
        await processBridgeRequest(req, res, '/clear-context-cache', { chatId: testChatId });
        const result = getResult();

        assert.equal(result.statusCode, 200);
        const data = result.json();
        assert.equal(data.ok, true);
        assert.equal(data.cleared, true);
        assert.equal(data.chatId, testChatId);

        // Verify cache file on disk
        const updatedCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        assert.equal(updatedCache[testChatId], undefined);
    });

    it('returns 404 for unknown endpoints', async () => {
        const { req, res, getResult } = createMockReqRes('GET');
        await processBridgeRequest(req, res, '/unknown-endpoint', null);
        const result = getResult();

        assert.equal(result.statusCode, 404);
        const data = result.json();
        assert.equal(data.ok, false);
    });
});
