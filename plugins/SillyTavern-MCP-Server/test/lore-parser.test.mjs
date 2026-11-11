import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeHash,
    countWords,
    extractContextSections,
    getActiveLoreEntries
} from '../mcp-server.mjs';

describe('Lore Parser & Hash Utilities', () => {
    describe('computeHash()', () => {
        it('returns "00000000" for empty string or non-string inputs', () => {
            assert.equal(computeHash(''), '00000000');
            assert.equal(computeHash(null), '00000000');
            assert.equal(computeHash(undefined), '00000000');
            assert.equal(computeHash('   \r\n   '), '00000000');
        });

        it('returns consistent 8-character hex slice for valid strings', () => {
            const h1 = computeHash('Chalcoa fantasy setting');
            assert.equal(typeof h1, 'string');
            assert.equal(h1.length, 8);
            assert.match(h1, /^[0-9a-f]{8}$/);

            // Consistency
            const h2 = computeHash('Chalcoa fantasy setting');
            assert.equal(h1, h2);
        });

        it('generates different hashes for different texts', () => {
            const h1 = computeHash('Lore entry A');
            const h2 = computeHash('Lore entry B');
            assert.notEqual(h1, h2);
        });
    });

    describe('countWords()', () => {
        it('returns 0 for empty or whitespace strings', () => {
            assert.equal(countWords(''), 0);
            assert.equal(countWords(null), 0);
            assert.equal(countWords('   \n\t  '), 0);
        });

        it('counts words accurately across mixed spaces and linebreaks', () => {
            assert.equal(countWords('Three simple words'), 3);
            assert.equal(countWords('Line one\nLine two\r\nLine three'), 6);
        });
    });

    describe('extractContextSections()', () => {
        it('extracts world_info, writing_instructions, and scenario from messages array', () => {
            const promptObj = {
                type: 'chat_completion',
                messages: [
                    { role: 'system', content: '<writing_instructions>\nAlways write in third-person.\n</writing_instructions>' },
                    { role: 'system', content: '<world_info>\n# Multiverse\nPlanes of existence.\n</world_info>' },
                    { role: 'system', content: '<scenario>\nA battle in the arena.\n</scenario>' }
                ]
            };

            const sections = extractContextSections(promptObj, {});
            assert.equal(sections.instructions, 'Always write in third-person.');
            assert.equal(sections.lore, '# Multiverse\nPlanes of existence.');
            assert.equal(sections.scenario, 'A battle in the arena.');
        });

        it('handles Windows CRLF linebreaks without losing content', () => {
            const promptObj = {
                type: 'chat_completion',
                messages: [
                    { role: 'system', content: '<world_info>\r\n# Multiverse\r\nPlanes of existence.\r\n</world_info>' }
                ]
            };

            const sections = extractContextSections(promptObj, {});
            assert.ok(sections.lore.includes('Multiverse'));
            assert.ok(sections.lore.includes('Planes of existence.'));
        });

        it('falls back to string prompt matching if not chat_completion', () => {
            const promptObj = {
                prompt: '<scenario>Old style string prompt</scenario>'
            };

            const sections = extractContextSections(promptObj, {});
            assert.equal(sections.scenario, 'Old style string prompt');
        });
    });

    describe('getActiveLoreEntries()', () => {
        it('parses multiple lore entries preserving content and calculating non-zero hashes', () => {
            const promptObj = {
                type: 'chat_completion',
                messages: [
                    {
                        role: 'system',
                        content: `<world_info>\r\n# Multiverse\r\nThe universe of Chalcoa is made up of eight planes.\r\n\r\n# Chalcoa\r\nThe story takes place in a fantasy medieval world.\r\n## Qi\r\nInner soma and outer palla.\r\n</world_info>`
                    }
                ]
            };

            const entries = getActiveLoreEntries({}, promptObj);
            assert.equal(entries.length, 2);

            const multiverse = entries.find(e => e.title.includes('Multiverse'));
            assert.ok(multiverse, 'Multiverse entry must exist');
            assert.ok(multiverse.content.length > 0, 'Content must not be empty');
            assert.ok(multiverse.content.includes('eight planes'));
            assert.notEqual(multiverse.hash, '00000000', 'Hash must be valid MD5 slice');

            const chalcoa = entries.find(e => e.title.includes('Chalcoa'));
            assert.ok(chalcoa, 'Chalcoa entry must exist');
            assert.ok(chalcoa.content.includes('fantasy medieval world'));
            assert.ok(chalcoa.content.includes('## Qi'), 'Subheadings must be preserved inside content');
            assert.notEqual(chalcoa.hash, '00000000');
        });

        it('correctly associates entries with disk lorebooks if matching', () => {
            // "Multiverse" matches [Chalcoa] Summaries on disk
            const promptObj = {
                type: 'chat_completion',
                messages: [
                    {
                        role: 'system',
                        content: `<world_info>\n# Multiverse\nPlanes of existence.\n</world_info>`
                    }
                ]
            };

            const entries = getActiveLoreEntries({}, promptObj);
            assert.ok(entries.length > 0);
            const entry = entries[0];
            // If disk match was found, book name reflects the real lorebook file
            assert.ok(entry.book.length > 0);
            assert.ok(entry.entry_id !== undefined);
        });
    });
});
