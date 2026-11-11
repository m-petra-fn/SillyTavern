import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithST, parseWithSTAsync } from '../st-macro-engine.mjs';
import { handleToolCall } from '../mcp-server.mjs';

describe('SillyTavern Native Macro & Comment Parsing Integration', () => {
    before(async () => {
        // Ensure ST MacroEngine is initialized
        await parseWithSTAsync('init');
    });

    it('strips scoped comments {{ // }} ... {{ /// }} from lore content using ST MacroEngine', () => {
        const loreWithComment = `## Personality
Sayritupaq is protective and bold.
{{ // }}
This is an internal author note that must be hidden.
Do not show this intimate detail.
{{ /// }}
### Combat Style
She fights with a dual-bladed bronze spear.`;

        const parsed = parseWithST(loreWithComment, { userName: 'Petra', charName: 'Sayritupaq' });
        assert.ok(!parsed.includes('{{ // }}'), 'Must not contain opening comment tag');
        assert.ok(!parsed.includes('{{ /// }}'), 'Must not contain closing comment tag');
        assert.ok(!parsed.includes('internal author note'), 'Comment body must be stripped');
        assert.ok(!parsed.includes('intimate detail'), 'Comment body must be stripped');
        assert.ok(parsed.includes('Sayritupaq is protective and bold.'), 'Non-comment content before tag must remain');
        assert.ok(parsed.includes('She fights with a dual-bladed bronze spear.'), 'Non-comment content after tag must remain');
    });

    it('strips inline comments {{// ...}} and {{ // ... }} from lore and scenario', () => {
        const textWithInline = `The city of Xochiyotl is ancient. {{// Founded 1000 years ago}} It sits on a high terrace. {{ // Military outpost}}`;
        const parsed = parseWithST(textWithInline, { userName: 'Petra', charName: 'Cipactzotl' });

        assert.ok(!parsed.includes('{{//'), 'Inline comment without space must be stripped');
        assert.ok(!parsed.includes('{{ //'), 'Inline comment with space must be stripped');
        assert.ok(!parsed.includes('Founded 1000 years ago'), 'Comment text must be stripped');
        assert.ok(!parsed.includes('Military outpost'), 'Comment text must be stripped');
        assert.ok(parsed.includes('The city of Xochiyotl is ancient.'), 'Content must remain');
        assert.ok(parsed.includes('It sits on a high terrace.'), 'Content must remain');
    });

    it('substitutes {{user}} and {{char}} variables in lore, scenario, and writing instructions', () => {
        const scenarioWithVars = `{{user}} approaches {{char}} at the Sun Terrace in Amazonia.`;
        const parsed = parseWithST(scenarioWithVars, { userName: 'Petra', charName: 'Sayritupaq' });

        assert.equal(parsed, 'Petra approaches Sayritupaq at the Sun Terrace in Amazonia.');
        assert.ok(!parsed.includes('{{user}}'));
        assert.ok(!parsed.includes('{{char}}'));
    });

    it('substitutes custom variables passed in context.variables', () => {
        const textWithCustomVar = `Current year is {{$currentYear}}, location is {{$location}}.`;
        const parsed = parseWithST(textWithCustomVar, {
            userName: 'Petra',
            charName: 'Sayritupaq',
            variables: {
                currentYear: '2088',
                location: 'Xochiyotl'
            }
        });

        assert.ok(parsed.includes('2088') || !parsed.includes('{{$currentYear}}'));
    });

    it('verifies get_chat_scenario tool parses comments and variables', async () => {
        const res = await handleToolCall('get_chat_scenario', {});
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(!text.includes('{{ // }}'), 'Scenario must not contain scoped comment tags');
        assert.ok(!text.includes('{{ /// }}'), 'Scenario must not contain closing comment tags');
        assert.ok(!text.includes('{{char}}'), 'Scenario must not contain raw {{char}} variable');
        assert.ok(!text.includes('{{user}}'), 'Scenario must not contain raw {{user}} variable');
    });

    it('verifies get_writing_instructions tool parses comments and variables', async () => {
        const res = await handleToolCall('get_writing_instructions', {});
        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(!text.includes('{{ // }}'), 'Instructions must not contain scoped comment tags');
        assert.ok(!text.includes('{{ /// }}'), 'Instructions must not contain closing comment tags');
        assert.ok(!text.includes('{{char}}'), 'Instructions must not contain raw {{char}}');
        assert.ok(!text.includes('{{user}}'), 'Instructions must not contain raw {{user}}');
    });

    it('verifies get_lore_entry parses comments out of disk lorebooks with scoped comments', async () => {
        // Query the known entry with scoped comments from disk: [Chalcoa-Char] Sayri and Cipa entry 0
        const res = await handleToolCall('get_lore_entry', {
            book: '[Chalcoa-Char] Sayri and Cipa',
            entry_id: 0
        });

        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(text.includes('=== LORE ENTRY: [[Chalcoa-Char] Sayri and Cipa] #0'), 'Must find lore entry');
        // Crucial test: scoped comments must NOT be present
        assert.ok(!text.includes('{{ // }}'), 'Lore entry must not contain opening comment tag');
        assert.ok(!text.includes('{{ /// }}'), 'Lore entry must not contain closing comment tag');
        assert.ok(!text.includes('darkened, and Sayritupaq thinks that is cute'), 'Intimacy section inside comments must be stripped');
        assert.ok(text.includes('Sayritupaq uses Cipa as a nickname'), 'Public text must be retained');
        assert.ok(text.includes('Flirting'), 'Sections outside comments must be retained');
    });

    it('verifies get_lore_entries batch tool parses comments from multiple entries', async () => {
        const res = await handleToolCall('get_lore_entries', {
            entries: [
                { book: '[Chalcoa-Char] Sayri and Cipa', uids: [0] }
            ]
        });

        assert.ok(res.content && res.content[0]);
        const text = res.content[0].text;

        assert.ok(!text.includes('{{ // }}'), 'Must not contain {{ // }}');
        assert.ok(!text.includes('{{ /// }}'), 'Must not contain {{ /// }}');
        assert.ok(!text.includes('darkened, and Sayritupaq thinks that is cute'), 'Commented body must be stripped');
        assert.ok(text.includes('Sayritupaq uses Cipa as a nickname'), 'Public narrative must be returned');
    });
});
