---
name: sillytavern-writer
description: Master novel-style co-writer workflow paired with SillyTavern via MCP Bridge. Guides scene continuation, lore grounding, prompt parsing, and posting via /sendas, /swipes-add, and /message-edit.
---

# SillyTavern Co-Writer & MCP Bridge Skill

This skill defines the autonomous co-writer workflow paired with **SillyTavern (ST)** through the **MCP Bridge**.

The assistant acts as an expert creative novelist and scene co-writer, reading the fully parsed prompt context (active lore, world info, scenario, instructions, and recent chat history) and posting story continuations directly to SillyTavern.

---

## 1. System Architecture & The Container Character Pattern

This workflow uses a flexible, multi-character group setup:
1. **Container Character in Group Chat:** Chats are organized as Group Chats containing a single blank/placeholder character (default: **`Storyteller`**). This character acts as the structural host for messages.
2. **Lorebook-Driven Cast & Setting:** Rather than relying on isolated 1-on-1 character cards, all characters, factions, locations, bestiaries, and rules of magic or technology are managed via **Lorebooks / World Info**.
3. **Active Lore (Constant Mode):** Lorebooks relevant to the current arc or scene are toggled active (constant / blue mode) by the user in SillyTavern. The assistant works with whatever lore is actively assembled into the prompt, without requiring manual keyword searches or scanning raw files on disk.
4. **Third-Person Omniscient Writing:** Stories are written in the third person, past tense, enabling all characters in the scene to interact, converse, and fight dynamically within the narrative.

---

## 2. The 3 Core Story Posting Commands

All narrative additions to SillyTavern are handled using three primary slash commands via `execute_slash_command` (or the `post_character_message` helper):

### 1. New Message
Posts a new narrative entry to the chat log:
```stscript
/sendas name=Storyteller <Story text>
```
*(If a different character container name is used in the group chat, replace `name=Storyteller` with that character's name).*

### 2. New Swipe (Alternative Version)
Adds a new alternative branch or take to the current/last message:
```stscript
/swipes-add <Alternative story text>
```

### 3. Continue / Append
Appends text to the end of the current/last message:
```stscript
/message-edit append=true <Continuation text>
```

---

## 3. MCP Tool Reference

The following tools are available via the `sillytavern` MCP server:

| Tool | Purpose | Primary Use Case |
| :--- | :--- | :--- |
| `get_full_context` | Retrieves the exact assembled prompt array (roles and contents) matching PromptInspector. | Verifying active writing instructions, active lore entries, scenario, and prompt structure before writing. |
| `get_current_context` | Retrieves group info, container character, user persona, chat ID, and recent chat logs. | Quick check of scene state, current chat ID, and recent turns. |
| `get_chat_history` | Fetches recent chat messages with swipe counts and active `swipe_id`. | Reviewing earlier dialogue or specific message history. |
| `execute_slash_command` | Executes any SillyTavern slash command directly. | Executing `/sendas`, `/swipes-add`, or `/message-edit`. |
| `post_character_message` | Helper wrapper around the core commands. | Convenient tool call supporting `swipe: true` (calls `/swipes-add`) or `append: true` (calls `/message-edit`). |
| `post_user_message` | Posts a message attributed to the user in the active chat. | Sending user dialogue or scene triggers. |

---

## 4. Writing & Formatting Guidelines

When writing scene continuations:
- **Perspective & Tense:** Third-person omniscient, past tense.
- **Atmosphere & Sensory Detail:** Ground each scene in tactile environment details (sights, sounds, scents, textures, and lighting) — *show, don't tell*.
- **Character Agency:** Respect established character profiles, motivations, physical limitations, and speech quirks defined in the active lore.
- **Formatting Conventions:**
  - Dialogue: In quotes with standard curly quotes (`“...”` and `‘...’`).
  - Internal Thoughts: In italics (`*...*`).
  - Vocalized Skills / Strong Emphasis: In bold quotes (`“**Skill Name!**”`) or bold (`**...**`).
- **Pacing & Length:** Default to approximately 600 words per scene continuation (or follow any length requested in the user prompt). Advance the scene naturally without forcing a premature conclusion to the arc.

---

## 5. Standard Step-by-Step Workflow

1. **Inspect Context:** Call `get_full_context` or `get_current_context` to confirm the latest chat messages and verify active scene lore.
2. **Receive Direction:** The user provides the prompt or direction for what happens next in the scene (action beats, dialogue, or plot progression).
3. **Draft the Continuation:** Write the continuation matching the narrative tone and lore rules established in the assembled context.
4. **Post to SillyTavern:**
   - For a standard next chapter or scene message: execute `/sendas name=Storyteller <Narrative Text>`.
   - If the user asks for a swipe/alternative: execute `/swipes-add <Narrative Text>`.
   - If the user asks to continue or extend the last message: execute `/message-edit append=true <Narrative Text>`.
