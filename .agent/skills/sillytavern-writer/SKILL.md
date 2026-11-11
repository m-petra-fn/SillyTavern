---
name: sillytavern-writer
description: Master novel-style co-writer workflow paired with SillyTavern via MCP Bridge. Guides scene continuation, lore grounding, prompt parsing, image analysis, and posting via /sendas, /swipes-add, and /message-edit.
---

# SillyTavern Co-Writer & MCP Bridge Skill

This skill defines the autonomous co-writer workflow paired with **SillyTavern (ST)** through the **MCP Bridge**.

The assistant acts as an expert creative novelist and scene co-writer, reading the fully parsed prompt context (active lore, world info, scenario, instructions, attached illustrations, and full chat history) and posting story continuations directly to SillyTavern.

---

## 1. Strict Operational Rules & Boundaries

1. **Zero Direct File Inspection for Context:**
   - **Never search through SillyTavern's files on disk** (e.g., chat logs, lorebooks, settings, or server files) to extract context, lore, or chat state.
   - The **only exception** for reading disk files is inspecting binary image files (`.webp`, `.png`, `.jpg`) via `read_file` **solely when image analysis has been explicitly requested by the user**.
2. **MCP Exclusivity & Context Diff Focus:**
   - Rely solely on the provided MCP endpoints (`call_mcp_tool` under `sillytavern`).
   - **`get_context_diff` is the mandatory primary context method.** Do **not** call `get_current_context` during writing turns (it is redundant and risks context contamination).
   - Do not attempt shell `curl` or `fetch` commands as workarounds.
3. **No Swipe Contamination:**
   - When writing a swipe (`/swipes-add`), the message being replaced/swiped **must NOT contaminate the context**. Never read or parrot the text of the message being swiped. Base the alternative swipe strictly on the state prior to that message.
4. **Writing Instructions Integrity:**
   - Baseline writing guidelines reside strictly here in `SKILL.md`. Never query or dump writing instructions dynamically unless the user explicitly asks to inspect custom instructions configured inside SillyTavern.
5. **Fail-Fast & Stop on Errors:**
   - If any MCP endpoint presents errors, is offline, or returns empty/no content, **stop the activity immediately and warn the user**. Do not attempt to bypass or guess.

---

## 2. System Architecture & The Container Character Pattern

This workflow uses a flexible, multi-character group setup:
1. **Container Character in Group Chat:** Chats are organized as Group Chats containing a single blank/placeholder character (default: **`Storyteller`**). This character acts as the structural host for messages.
2. **Lorebook-Driven Cast & Setting:** Rather than relying on isolated 1-on-1 character cards, all characters, factions, locations, bestiaries, and rules of magic or technology are managed via **Lorebooks / World Info**.
3. **Active Lore (Constant Mode):** Lorebooks relevant to the current arc or scene are toggled active (constant / blue mode) by the user in SillyTavern. The assistant works with whatever lore is actively assembled into the prompt, without requiring manual keyword searches or scanning raw files on disk.
4. **Third-Person Omniscient Writing:** Stories are written in the third person, past tense, enabling all characters in the scene to interact, converse, and fight dynamically within the narrative.

---

## 3. The 3 Core Story Posting Commands

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

## 4. MCP Tool Reference

All SillyTavern context retrieval and posting tools return clean, structured text sections without token-heavy JSON or artificial role wrappers:

### Granular & Token-Optimized Retrieval Tools (Preferred)

| Tool | Purpose | Primary Use Case |
| :--- | :--- | :--- |
| `get_context_diff` | Intelligent server-side context controller. Tracks baseline state per `chatId` and returns only what changed (scenario, active lore, or new/edited messages) in ~15–45 tokens. | **Primary turn-by-turn verification.** Call `full: true` on Turn 1 of a new session, and `get_context_diff(include_content: true)` on subsequent turns. |
| `get_chat_overview` | Returns lightweight metadata for all chat messages (~80–150 tokens): session ID, scenario hash, total count, per-message hashes, word counts, swipe counts, and image counts. | Inspecting full message indices if needed. |
| `get_message` | Granularly fetches the full text, sender name, and swipe info for a single message by `message_id` (without image filenames). | Retrieving only a specific edited or requested message. |
| `get_last_message` | Granularly fetches solely the latest message in the active chat (without image filenames). | Quick context check before appending (`/message-edit append=true`) or inspecting the latest prompt. |
| `list_active_lore` | Lists all active lorebooks and constant entries with `book`, `entry_id`, `title`, and content `hash` (~50–80 tokens). | Fast inspection of active world lore to detect changes or additions. |
| `get_lore_entry` | Granularly fetches a single lore entry by its `book` and `entry_id`. | Loading or updating a single character or world entry when its hash changes. |
| `get_lore_entries` | Batch-retrieves multiple lore entries across one or more lorebooks in a single call (e.g. `[{book: 'setting', uids: [1, 3]}, {book: 'cast', uids: [2]}]`). | Fetching entire sets of lore entries at once with zero roundtrips. |
| `get_message_images` | Lists attached image filenames, labels, and local disk paths for messages in the active chat. | Inspecting illustrations and attachments **only when visual analysis is explicitly requested**. |

### Full Context & History Tools

| Tool | Purpose | Primary Use Case |
| :--- | :--- | :--- |
| `get_full_context` | Retrieves the assembled scene context (Active Lore, Scenario) formatted in clear sections, excluding writing instructions and chat history. | Optional reference for active lore and scenario on a cold start. |
| `get_current_lore` | Retrieves only the active World Info / Lorebook entries (blue / constant mode) for the active scene. | Quick grounding across all active lore entries at once. |
| `get_chat_scenario` | Retrieves only the active Scenario section for the current chat, prefixed with `[Scenario Hash: ...]`. | Checking scene setup or overarching plot scenario when its hash changes. |
| `get_writing_instructions` | Retrieves only the system writing instructions and style guidelines from SillyTavern. | Confirming custom instructions configured directly in ST if updated by the user. |
| `get_chat_history` | Fetches chat messages in clean structured text (without image filenames). Supports `limit` (default: 30) and `since_id` (fetches only messages after `since_id`). | Initial chat loading or fetching delta messages (`since_id`). |
| `get_chat_history_for_swipe` | Fetches chat messages **excluding the very last message** (without image filenames). | Preparing context for writing an alternative swipe (`/swipes-add`) across all messages before the last. |
| `get_current_context` | Retrieves high-level session metadata (chat ID, group name, container character, scenario hash, active lore titles) without message text. | **Do NOT call during routine writing turns.** Use `get_context_diff` instead. |
| `execute_slash_command` | Executes any SillyTavern slash command directly. | Executing `/sendas`, `/swipes-add`, or `/message-edit`. |
| `post_character_message` | Helper wrapper around the core commands. | Convenient tool call supporting `swipe: true` (`/swipes-add`) or `append: true` (`/message-edit append=true`). |
| `post_user_message` | Posts a message attributed to the user in the active chat. | Sending user dialogue or scene triggers. |

---

## 5. Visual Continuity & Image Analysis

SillyTavern messages often contain attached illustrations (avatars, action shots, character close-ups, and scene art):
* Root attachments: `data/default-user/user/images/<filename>`
* Message attachments: `data/default-user/user/images/messageImages/<filename>`

> [!IMPORTANT]
> **Token Optimization for Images:**
> - To preserve context tokens, chat history and message endpoints (`get_chat_history`, `get_message`, `get_last_message`, `get_chat_overview`) **never include image filenames or disk paths**.
> - The presence of attachments is indicated compactly in `get_chat_overview` via `Images: <count>`.
> - **Only query images when explicitly requested:** Call `get_message_images(message_id=...)` to retrieve the filenames and local disk paths for specific messages only when visual inspection is required by the user.
> - When visual analysis is requested, inspect the image file via `read_file` using the provided path.
> - **Deduplication / Caching:** If image filenames are repeated across different messages (such as recurring character portrait slots or reused environmental plates), do **not** re-inspect them if they have already been viewed and analyzed earlier in the conversation.
> - Observe character expressions, costumes, creature anatomies, spell effects, and environment layout to ground the scene visually.

---

## 6. Writing & Formatting Guidelines

These guidelines represent the baseline standards for scene continuations. Because they are codified directly here in `SKILL.md`, **there is no need to query `get_writing_instructions` on every turn**. Only query `get_writing_instructions` if the user explicitly mentions having added new or modified writing instructions directly within SillyTavern.

### Core Baseline Conventions
- **Perspective & Tense:** Third-person omniscient, past tense.
- **Atmosphere & Sensory Detail:** Ground each scene in tactile environment details (sights, sounds, scents, textures, and lighting) — *show, don't tell*.
- **Character Agency:** Respect established character profiles, motivations, physical limitations, and speech quirks defined in the active lore.
- **Formatting Conventions:**
  - Dialogue: In quotes with standard curly quotes (`“...”` and `‘...’`).
  - Internal Thoughts: In italics (`*...*`).
  - Strong Emphasis: In bold quotes or bold (`**...**`).
- **Pacing & Length:** Default to approximately 600 words per scene continuation (or follow any specific word count requested in the user prompt). Advance the scene naturally without forcing a premature conclusion to the arc.

### Stylistic Constraints (Avoid)
- **Purple Prose:** Avoid overly ornate, flowery, melodramatic, or artificially elevated prose that detracts from narrative clarity and natural pacing.
- **Excessive Emotion Tells:** Avoid direct emotion labeling and narrative emotion statements in narration beats (e.g., explicitly stating "she felt terrified" or "he grew angry"). Instead, convey emotional states authentically through **character actions**, **character dialogue**, or **internal character thoughts** (*show, don't tell*), supported by physical reactions, involuntary gestures, and body language.
- **Rhetorical Contrast Structures:** Avoid repetitive antithesis and binary framing (e.g., *"not just X, it's Y"*, *"X, not Y"*, *"isn't X, it's Y"*, *"to the world she was X, but to herself she was Y"*).
- **Repetitive Vocabulary:** Avoid overusing recurring crutch words and stock descriptors across paragraphs (e.g., *sharp*, *flicker*, *jaw*, *hammered*, *gaze*, *steel*, *shudder*). Actively vary word choice.
- **Trailing Participle Phrases (TPP):** Avoid tacking participle phrases onto the ends of sentences (e.g., clauses beginning with an *-ing* verb modifying the subject of the main clause placed at the sentence tail, like *"...standing rigid, watching the sky"*). Vary sentence structures, opening with different clauses, combining independent clauses, or breaking them into direct actions.
- **Premature Scene Wraps & Summaries:** **Never try to end the story.** Avoid concluding summary paragraphs, morality wrap-ups, or poetic closing statements that prematurely resolve the scene. Leave actions, tensions, or interactions open and poised for the next prompt or continuation.

---

## 7. Step-by-Step Optimized Workflow & Action Paths

`get_context_diff` is the **exclusive, mandatory entry point** for every turn. Do not query `get_current_context`, `get_full_context`, or full chat histories on regular turns.

---

### Phase 1: Context Synchronization

#### Turn 1 (Session Start / Cold Initialization)
1. **One-Shot Baseline Fetch:**
   - Call `get_context_diff(full: true)`.
   - This single call sets the server baseline for the active chat and returns the complete starting scene context (scenario, active lore, and recent chat history).
   - Retain these details in working memory for the duration of the session.

#### Subsequent Turns (Single-Call Delta Verification)
1. **Call `get_context_diff(include_content: true)`:**
   - **If Status is `In sync (0 changes detected)`:** No changes in scenario, lore, or chat (~15 tokens). Proceed directly to the requested action path below.
   - **If Changes are Detected:**
     - Any modified scenario, modified/new lore, or new/edited messages are already fully included in the diff output with their complete content. No secondary queries or tool calls are needed.
     - Review the reported changes and proceed directly to the requested action path below.
2. **Visual Analysis (Only Upon Request):**
   - If—and only if—the user explicitly requested visual analysis, call `get_message_images(message_id=...)` to retrieve disk paths, then inspect new images via `read_file`.

---

### Phase 2: Action Paths

Depending on the user's creative directive, follow the exact path for that action:

#### Path 1: New Message (`/sendas`)
Use when advancing the story with a brand-new narrative entry.

```mermaid
flowchart TD
    A["User Request: New Scene / Continuation"] --> B["Call get_context_diff(include_content: true)"]
    B --> C{"Changes Detected?"}
    C -- "Yes" --> D["Incorporate reported delta into working memory"]
    C -- "No (In sync)" --> E["Proceed with existing context"]
    D --> F["Draft scene continuation (Third-person, past tense, ~600 words)"]
    E --> F
    F --> G["Execute: /sendas name=Storyteller <Narrative Text>"]
```

1. **Ground Context:** Take all messages up to the current last message.
2. **Draft Continuation:** Write in third-person omniscient, past tense (~600 words) advancing characters, sensory details, and narrative momentum.
3. **Post:** Call `execute_slash_command("/sendas name=Storyteller <Narrative Text>")` (or `post_character_message(text=...)`).

---

#### Path 2: New Swipe (`/swipes-add`) — Alternative Version
Use when the user requests an alternative variation, branch, or take for the current/last message.

> [!CRITICAL]
> **Anti-Contamination Mandate:**
> - The message being swiped **must NOT contaminate the new swipe**.
> - **DO NOT read, parrot, or rephrase the text of the message being swiped.**
> - Ground the scene strictly on the state and dialogue **before the last message** (message `N-1`).
> - Do **not** call `get_last_message` or `get_current_context`.

```mermaid
flowchart TD
    A["User Request: Alternative Swipe (/swipes-add)"] --> B["Call get_context_diff(include_content: true)"]
    B --> C["Identify prior context before the latest message (N-1)"]
    C --> D["CRITICAL: Disregard and exclude the latest message text"]
    D --> E["Draft fresh alternative take from prior state (N-1)"]
    E --> F["Execute: /swipes-add <Alternative Text>"]
```

1. **Isolate Context:** Base the continuation purely on messages prior to the latest message. If prior messages need to be refreshed, use `get_chat_history_for_swipe`.
2. **Draft Alternative:** Write a fresh, distinct take or alternative angle on how the scene unfolds from the prior beat.
3. **Post:** Call `execute_slash_command("/swipes-add <Alternative Text>")` (or `post_character_message(text=..., swipe=true)`).

---

#### Path 3: Continue / Append (`/message-edit append=true`)
Use when the user instructs to continue the ongoing thought or append directly to the end of the last message.

```mermaid
flowchart TD
    A["User Request: Continue / Append to Last Message"] --> B["Call get_context_diff(include_content: true)"]
    B --> C["Call get_last_message (Inspect tail sentence only)"]
    C --> D["Draft direct text extension (Seamless transition, no recap)"]
    D --> E["Execute: /message-edit append=true <Extension Text>"]
```

1. **Inspect Tail Sentence Only:** Call `get_last_message` solely to check the final sentence/words so the continuation connects seamlessly.
2. **Draft Extension:** Write the continuation text without summarizing or repeating what came before. Start immediately from the trailing action or thought.
3. **Post:** Call `execute_slash_command("/message-edit append=true <Extension Text>")` (or `post_character_message(text=..., append=true)`).

---

### Phase 3: Completion & Clean Output
After posting the message to SillyTavern, **only reply in the chat window with a brief confirmation that the task has been completed** (e.g., *"Continuation posted to SillyTavern."*). Do **not** re-print the full story text or scene continuation in the assistant chat interface, keeping the chat clean and free of duplicate text.
