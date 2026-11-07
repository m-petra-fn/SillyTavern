---
name: sillytavern-writer
description: Master novel-style co-writer workflow paired with SillyTavern via MCP Bridge. Guides scene continuation, lore grounding, prompt parsing, image analysis, and posting via /sendas, /swipes-add, and /message-edit.
---

# SillyTavern Co-Writer & MCP Bridge Skill

This skill defines the autonomous co-writer workflow paired with **SillyTavern (ST)** through the **MCP Bridge**.

The assistant acts as an expert creative novelist and scene co-writer, reading the fully parsed prompt context (active lore, world info, scenario, instructions, attached illustrations, and recent chat history) and posting story continuations directly to SillyTavern.

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

> **Helper Shortcut:** `post_character_message` can also be used directly:
> - Pass `text` to send a new message as `Storyteller`.
> - Pass `swipe: true` to invoke `/swipes-add`.
> - Pass `append: true` to invoke `/message-edit append=true`.

---

## 3. MCP Tool Reference

All SillyTavern context retrieval and posting tools return clean, structured text sections without token-heavy JSON or artificial role wrappers:

| Tool | Purpose | Primary Use Case |
| :--- | :--- | :--- |
| `get_full_context` | Retrieves the complete assembled scene context (Writing Instructions, Active Lore, Scenario) formatted in clear sections, excluding chat history. | Comprehensive scene preparation before writing. |
| `get_current_lore` | Retrieves only the active World Info / Lorebook entries (blue / constant mode) for the active scene. | Quick grounding in character sheets, factions, creatures, or world mechanics. |
| `get_chat_scenario` | Retrieves only the active Scenario section for the current chat. | Checking scene setup or overarching plot scenario. |
| `get_writing_instructions` | Retrieves only the system writing instructions and style guidelines. | Confirming perspective, dialogue formatting, and word count targets. |
| `get_chat_history` | Fetches recent chat messages in clean structured text, including message numbers, sender names, swipe info, and **attached image filenames and disk paths**. | Reviewing dialogue, narrative continuity, and visual attachments. |
| `get_chat_history_for_swipe` | Fetches recent chat messages **excluding the very last message**. | Preparing context for writing an alternative swipe (/swipes-add) without including the message being swiped. |
| `get_current_context` | Retrieves chat ID, group name, container character, active lore titles, and latest message preview. | Fast status check of the active chat. |
| `execute_slash_command` | Executes any SillyTavern slash command directly. | Executing `/sendas`, `/swipes-add`, or `/message-edit`. |
| `post_character_message` | Helper wrapper around the core commands. | Convenient tool call supporting `swipe: true` (`/swipes-add`) or `append: true` (`/message-edit append=true`). |
| `post_user_message` | Posts a message attributed to the user in the active chat. | Sending user dialogue or scene triggers. |

---

## 4. Visual Continuity & Image Analysis

SillyTavern messages often contain attached illustrations (avatars, action shots, character close-ups, and scene art):
* Root attachments: `data/default-user/user/images/<filename>`
* Message attachments: `data/default-user/user/images/messageImages/<filename>`

`get_chat_history` automatically parses and outputs image attachments for each message:
```text
Images:
  - Example_Battle_Art.webp (Path: C:\Petra\Jogos\SillyTavern\data\default-user\user\images\messageImages\Example_Battle_Art.webp)
```

The assistant possesses **native multimodal vision**. When attached images are present:
1. Inspect the image file directly via `read_file` using the provided absolute path.
2. Observe character expressions, costumes, creature anatomies, spell effects, and environment layout.
3. Integrate visual details directly into the narrative prose to maintain seamless visual continuity with the artwork.

---

## 5. Writing & Formatting Guidelines

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

## 6. Standard Step-by-Step Workflow

1. **Inspect Context:** Call `get_full_context` (or granular endpoints `get_current_lore`, `get_writing_instructions`, `get_chat_scenario`) and `get_chat_history`.
2. **Review Visuals:** If recent messages have attached images, inspect them with `read_file` to ground visual details.
3. **Receive Direction:** The user provides the prompt or direction for what happens next in the scene.
4. **Draft the Continuation:** Write the continuation matching the narrative tone, active lore, and visual elements.
5. **Post to SillyTavern:**
   - Standard continuation: `/sendas name=Storyteller <Narrative Text>`
   - Alternative swipe: `/swipes-add <Narrative Text>`
   - Continue existing message: `/message-edit append=true <Narrative Text>`
