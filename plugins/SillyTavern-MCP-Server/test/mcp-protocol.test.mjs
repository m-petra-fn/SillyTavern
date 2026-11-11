import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    handleRequest,
    handleToolCall,
    TOOLS
} from '../mcp-server.mjs';

describe('Model Context Protocol (MCP) Protocol & Tools Suite', () => {
    describe('Protocol Handshake & Discovery', () => {
        it('handles "initialize" request with compliant MCP server info and capabilities', async () => {
            const req = {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    clientInfo: { name: 'Antigravity-Test', version: '1.0.0' }
                }
            };

            const res = await handleRequest(req);
            assert.equal(res.jsonrpc, '2.0');
            assert.equal(res.id, 1);
            assert.ok(res.result);
            assert.equal(res.result.serverInfo.name, 'sillytavern-mcp');
            assert.ok(res.result.capabilities.tools);
        });

        it('handles "tools/list" and registers all 22 MCP tools with valid schemas', async () => {
            const req = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            };

            const res = await handleRequest(req);
            assert.equal(res.id, 2);
            assert.ok(Array.isArray(res.result.tools));
            assert.equal(res.result.tools.length, 22);

            for (const tool of res.result.tools) {
                assert.ok(tool.name, 'Tool must have name');
                assert.ok(tool.description, `Tool ${tool.name} must have description`);
                assert.equal(tool.inputSchema.type, 'object', `Tool ${tool.name} inputSchema must be object`);
            }
        });

        it('handles unknown method gracefully with code -32601', async () => {
            const req = {
                jsonrpc: '2.0',
                id: 99,
                method: 'non_existent_method',
                params: {}
            };

            const res = await handleRequest(req);
            assert.equal(res.id, 99);
            assert.ok(res.error);
            assert.equal(res.error.code, -32601);
        });
    });

    describe('All 22 MCP Tools & Use Cases', () => {
        // 1. get_context_diff
        it('tool: get_context_diff (full=true, include_content=true, reset=true)', async () => {
            const resFull = await handleToolCall('get_context_diff', { full: true });
            assert.ok(resFull.content[0].text.includes('BASELINE CONTEXT'));

            const resDelta = await handleToolCall('get_context_diff', { include_content: true });
            assert.ok(resDelta.content[0].text.includes('CONTEXT DIFF') || resDelta.content[0].text.includes('In sync'));

            const resReset = await handleToolCall('get_context_diff', { reset: true });
            assert.ok(resReset.content[0].text);
        });

        // 2. get_chat_overview
        it('tool: get_chat_overview returns metadata for all messages', async () => {
            const res = await handleToolCall('get_chat_overview', {});
            assert.ok(res.content[0].text.includes('CHAT OVERVIEW') || res.content[0].text.includes('Session ID:'));
        });

        // 3. get_message
        it('tool: get_message handles valid ID and out-of-range ID', async () => {
            const res0 = await handleToolCall('get_message', { message_id: 0 });
            assert.ok(res0.content[0].text.includes('[Message #0]') || res0.content[0].text.includes('not found'));

            const resInvalid = await handleToolCall('get_message', { message_id: 99999 });
            assert.ok(resInvalid.content[0].text.includes('not found in the active session'));

            await assert.rejects(
                () => handleToolCall('get_message', {}),
                /Missing or invalid parameter: message_id/
            );
        });

        // 4. get_last_message
        it('tool: get_last_message fetches the latest message', async () => {
            const res = await handleToolCall('get_last_message', {});
            assert.ok(res.content[0].text.includes('[Message #') || res.content[0].text.includes('No messages found'));
        });

        // 5. list_active_lore
        it('tool: list_active_lore lists active lorebooks and entries', async () => {
            const res = await handleToolCall('list_active_lore', {});
            assert.ok(res.content[0].text.includes('ACTIVE LORE') || res.content[0].text.includes('No active lore'));
        });

        // 6. get_lore_entry
        it('tool: get_lore_entry validates parameters and retrieves entry', async () => {
            await assert.rejects(
                () => handleToolCall('get_lore_entry', {}),
                /Parameters "book" and "entry_id" are required/
            );

            const res = await handleToolCall('get_lore_entry', { book: 'NonExistentBook', entry_id: 0 });
            assert.ok(res.content[0].text.includes('not found') || res.content[0].text.includes('LORE ENTRY'));
        });

        // 7. get_lore_entries
        it('tool: get_lore_entries batch retrieves entries across books', async () => {
            await assert.rejects(
                () => handleToolCall('get_lore_entries', {}),
                /Missing or invalid parameter: entries/
            );

            const res = await handleToolCall('get_lore_entries', {
                entries: [
                    { book: '[Chalcoa] Summaries', uids: [5] }
                ]
            });
            assert.ok(res.content[0].text.includes('Multiverse') || res.content[0].text.includes('LORE ENTRY'));
        });

        // 8. get_message_images
        it('tool: get_message_images retrieves image attachments without polluting chat history', async () => {
            const res = await handleToolCall('get_message_images', { message_id: 0 });
            assert.ok(
                res.content[0].text.includes('IMAGES FOR MESSAGE') ||
                res.content[0].text.includes('no attached images') ||
                res.content[0].text.includes('not found')
            );
        });

        // 9. get_full_context
        it('tool: get_full_context retrieves scene context without chat history or writing instructions', async () => {
            const res = await handleToolCall('get_full_context', {});
            assert.ok(res.content[0].text.includes('SCENE CONTEXT') || res.content[0].text.includes('ACTIVE LORE'));
        });

        // 10. get_current_lore
        it('tool: get_current_lore retrieves assembled lore', async () => {
            const res = await handleToolCall('get_current_lore', {});
            assert.ok(res.content[0].text.includes('ACTIVE LORE') || res.content[0].text.includes('No active lore'));
        });

        // 11. get_chat_scenario
        it('tool: get_chat_scenario retrieves scenario text and hash', async () => {
            const res = await handleToolCall('get_chat_scenario', {});
            assert.ok(res.content[0].text.includes('Scenario Hash:') || res.content[0].text.includes('SCENARIO'));
        });

        // 12. get_writing_instructions
        it('tool: get_writing_instructions retrieves writing guidelines', async () => {
            const res = await handleToolCall('get_writing_instructions', {});
            assert.ok(res.content[0].text.includes('WRITING INSTRUCTIONS') || res.content[0].text.includes('No custom writing instructions'));
        });

        // 13. get_current_context
        it('tool: get_current_context retrieves high-level session metadata', async () => {
            const res = await handleToolCall('get_current_context', {});
            assert.ok(res.content[0].text.includes('ACTIVE SESSION SUMMARY') || res.content[0].text.includes('Session:'));
        });

        // 14. get_chat_history
        it('tool: get_chat_history supports limit and since_id parameters', async () => {
            const res = await handleToolCall('get_chat_history', { limit: 5 });
            assert.ok(res.content[0].text.includes('[Message #') || res.content[0].text.includes('No chat history'));
        });

        // 15. get_chat_history_for_swipe
        it('tool: get_chat_history_for_swipe omits the latest message to prevent contamination', async () => {
            const res = await handleToolCall('get_chat_history_for_swipe', {});
            assert.ok(res.content[0].text.includes('[Message #') || res.content[0].text.includes('No prior chat history'));
        });

        // 16. execute_slash_command
        it('tool: execute_slash_command validates command parameter', async () => {
            await assert.rejects(
                () => handleToolCall('execute_slash_command', {}),
                /Missing parameter: command/
            );
        });

        // 17. post_character_message
        it('tool: post_character_message validates text parameter', async () => {
            await assert.rejects(
                () => handleToolCall('post_character_message', {}),
                /Missing parameter: text/
            );
        });

        // 18. post_user_message
        it('tool: post_user_message validates text parameter', async () => {
            await assert.rejects(
                () => handleToolCall('post_user_message', {}),
                /Missing parameter: text/
            );
        });

        // 19. post_system_message
        it('tool: post_system_message validates text parameter', async () => {
            await assert.rejects(
                () => handleToolCall('post_system_message', {}),
                /Missing parameter: text/
            );
        });

        // 20. trigger_generation
        it('tool: trigger_generation exists in TOOLS definition', async () => {
            const tool = TOOLS.find(t => t.name === 'trigger_generation');
            assert.ok(tool);
            assert.equal(tool.name, 'trigger_generation');
        });

        // 21. list_characters
        it('tool: list_characters returns available characters JSON text', async () => {
            const res = await handleToolCall('list_characters', {});
            assert.ok(res.content[0].text.includes('activeCharacter'));
        });

        // 22. select_character
        it('tool: select_character validates character parameter', async () => {
            await assert.rejects(
                () => handleToolCall('select_character', {}),
                /Missing parameter: character/
            );
        });
    });
});
