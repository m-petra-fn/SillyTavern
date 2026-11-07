import { Router } from 'express';
import { jsonParser } from '../../src/express-common.js';
import http from 'node:http';
import crypto from 'node:crypto';

const MCP_PORT = process.env.SILLYTAVERN_MCP_PORT ? parseInt(process.env.SILLYTAVERN_MCP_PORT, 10) : 8005;

let latestState = {
    connected: false,
    lastSync: null,
    character: null,
    userName: null,
    chatId: null,
    generationActive: false,
    recentChat: []
};

const actionQueue = [];
const pendingActions = new Map();
let standaloneServer = null;

/**
 * Handle incoming MCP bridge requests (used by both Express router and loopback HTTP server)
 */
async function processBridgeRequest(req, res, pathname, body) {
    // Add CORS headers for browser UI extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const cleanPath = pathname.replace(/^\/api\/plugins\/mcp/, '') || '/';

    if (cleanPath === '/' || cleanPath === '/status') {
        const isFresh = latestState.lastSync && (Date.now() - latestState.lastSync < 900000);
        const data = {
            ok: true,
            plugin: 'SillyTavern-MCP',
            uiConnected: !!latestState.connected && isFresh,
            lastSync: latestState.lastSync,
            activeCharacter: latestState.character?.name ?? null,
            userName: latestState.userName,
            messageCount: latestState.recentChat?.length ?? 0
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (cleanPath === '/state' && req.method === 'POST') {
        latestState = {
            connected: true,
            lastSync: Date.now(),
            character: body?.character || null,
            group: body?.group || null,
            userName: body?.userName || null,
            chatId: body?.chatId || null,
            generationActive: !!body?.generationActive,
            recentChat: Array.isArray(body?.recentChat) ? body.recentChat : [],
            activeLore: body?.activeLore || null,
            promptSettings: body?.promptSettings || null,
            assembledPrompt: body?.assembledPrompt || null
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, receivedAt: latestState.lastSync }));
        return;
    }

    if (cleanPath === '/state' && req.method === 'GET') {
        const isFresh = latestState.lastSync && (Date.now() - latestState.lastSync < 900000);
        const data = {
            ok: true,
            uiConnected: !!latestState.connected && isFresh,
            lastSync: latestState.lastSync,
            data: latestState
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (cleanPath === '/action' && req.method === 'POST') {
        const { type, args = {} } = body || {};
        if (!type) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Missing action type' }));
            return;
        }

        const actionId = crypto.randomUUID();
        const actionPayload = { id: actionId, type, args, timestamp: Date.now() };
        actionQueue.push(actionPayload);

        const timeoutMs = 15000;
        const resultPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingActions.delete(actionId);
                reject(new Error(`Action '${type}' timed out after ${timeoutMs}ms (is SillyTavern browser tab open?)`));
            }, timeoutMs);

            pendingActions.set(actionId, { resolve, reject, timer });
        });

        try {
            const result = await resultPromise;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, actionId, result }));
        } catch (err) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, actionId, error: err.message }));
        }
        return;
    }

    if (cleanPath === '/poll-action' && req.method === 'GET') {
        const action = actionQueue.shift() || null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action }));
        return;
    }

    if (cleanPath === '/action-result' && req.method === 'POST') {
        const { id, success = true, result = null, error = null } = body || {};
        if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Missing action id' }));
            return;
        }

        const pending = pendingActions.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            pendingActions.delete(id);
            if (success) {
                pending.resolve(result);
            } else {
                pending.reject(new Error(error || 'Action failed in SillyTavern UI'));
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, received: true }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

/**
 * Initialize Plugin: setup loopback server and Express router
 * @param {Router} router
 */
export async function init(router) {
    // 1. Setup Express router routes (for in-browser calls under same origin)
    router.all('*', jsonParser, (req, res) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        processBridgeRequest(req, res, parsedUrl.pathname, req.body);
    });

    // 2. Start dedicated localhost loopback server on port 8005
    try {
        standaloneServer = http.createServer((req, res) => {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            let rawBody = '';

            req.on('data', chunk => { rawBody += chunk; });
            req.on('end', () => {
                let parsedBody = null;
                if (rawBody && req.headers['content-type']?.includes('application/json')) {
                    try { parsedBody = JSON.parse(rawBody); } catch (_) {}
                }
                processBridgeRequest(req, res, parsedUrl.pathname, parsedBody);
            });
        });

        standaloneServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[SillyTavern-MCP] Port ${MCP_PORT} in use, skipping dedicated server.`);
            } else {
                console.error('[SillyTavern-MCP] Standalone server error:', err);
            }
        });

        standaloneServer.listen(MCP_PORT, '127.0.0.1', () => {
            console.log(`[SillyTavern-MCP] Loopback bridge listening on http://127.0.0.1:${MCP_PORT}`);
        });
    } catch (e) {
        console.warn('[SillyTavern-MCP] Could not launch standalone HTTP server:', e);
    }

    console.log('[SillyTavern-MCP] Express plugin registered on /api/plugins/mcp');
    return Promise.resolve();
}

export async function exit() {
    if (standaloneServer) {
        standaloneServer.close();
        standaloneServer = null;
    }
    for (const [id, pending] of pendingActions.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('SillyTavern server shutting down'));
    }
    pendingActions.clear();
    return Promise.resolve();
}

export default {
    init,
    exit,
    info: {
        id: 'mcp',
        name: 'SillyTavern-MCP',
        description: 'Exposes SillyTavern context and character actions via Model Context Protocol (MCP).'
    }
};
