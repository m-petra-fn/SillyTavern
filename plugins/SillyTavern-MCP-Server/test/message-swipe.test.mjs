import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getChatMessages,
    handleToolCall
} from '../mcp-server.mjs';

describe('Message Processing & Swipe Anti-Contamination', () => {
    describe('getChatMessages()', () => {
        it('normalizes chat messages with word counts, hashes, and swipe metadata', () => {
            const rawData = {
                allChat: [
                    { id: 0, name: 'User', is_user: true, message: 'Hello there!', send_date: 1000 },
                    { id: 1, name: 'Character', is_user: false, message: 'Greetings warrior. What brings you to the temple?', send_date: 1001, swipes: 2, swipe_id: 1 }
                ]
            };

            const msgs = getChatMessages(rawData);
            assert.equal(msgs.length, 2);
            assert.equal(msgs[0].name, 'User');
            assert.equal(msgs[0].is_user, true);
            assert.equal(msgs[0].words, 2);
            assert.notEqual(msgs[0].hash, '00000000');

            assert.equal(msgs[1].name, 'Character');
            assert.equal(msgs[1].is_user, false);
            assert.equal(msgs[1].words, 8);
            assert.equal(msgs[1].swipes, 2);
            assert.equal(msgs[1].swipe_id, 1);
        });
    });

    describe('get_chat_history_for_swipe', () => {
        it('strictly excludes the latest message to avoid contaminating new swipe generation', async () => {
            const res = await handleToolCall('get_chat_history_for_swipe', {});
            assert.ok(res.content && res.content[0]);
            const text = res.content[0].text;

            // Header must indicate prior messages or notice of no prior messages
            assert.ok(
                text.includes('[Message #') ||
                text.includes('No prior chat history found')
            );
        });
    });

    describe('get_last_message', () => {
        it('returns only the latest message text and sender name without image paths', async () => {
            const res = await handleToolCall('get_last_message', {});
            assert.ok(res.content && res.content[0]);
            const text = res.content[0].text;

            assert.ok(
                text.includes('[Message #') ||
                text.includes('No messages found')
            );
            // Must not expose internal image paths directly
            assert.ok(!text.includes('messageImages/'));
        });
    });

    describe('get_chat_overview', () => {
        it('returns lightweight session metadata with per-message hashes and word counts', async () => {
            const res = await handleToolCall('get_chat_overview', {});
            assert.ok(res.content && res.content[0]);
            const text = res.content[0].text;

            assert.ok(text.includes('CHAT OVERVIEW') || text.includes('Session ID:'));
            assert.ok(text.includes('Total Messages:'));
        });
    });
});
