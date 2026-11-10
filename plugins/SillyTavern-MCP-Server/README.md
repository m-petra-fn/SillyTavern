# SillyTavern MCP Server Plugin

A native server plugin and Model Context Protocol (MCP) server for **SillyTavern**, enabling external AI coding assistants and agents (Claude Desktop, Antigravity, Cursor, etc.) to pair-program and co-write directly with your active SillyTavern sessions.

Companion UI Extension: 👉 **[Petra-SillyTavern-MCP-UI](https://github.com/m-petra-fn/Petra-SillyTavern-MCP-UI)**

---

## Architecture

This project consists of two tightly coupled components:
1. **SillyTavern Server Plugin (`index.mjs`)**: An Express middleware plugin loaded automatically by SillyTavern on startup (or running on port `8005`), serving as the state bridge between the browser UI and the MCP runtime.
2. **MCP Stdio Server (`mcp-server.mjs`)**: A standalone, zero-external-dependency Node.js server implementing the Model Context Protocol over `stdio`. It connects directly to MCP clients and translates tool requests into clean, formatted context or dispatched actions.

---

## Installation

### 1. Install the Server Plugin
Clone this repository directly into your SillyTavern `plugins/` directory:

```bash
cd SillyTavern/plugins
git clone https://github.com/m-petra-fn/Petra-SillyTavern-MCP-Server.git SillyTavern-MCP-Server
```

### 2. Enable Server Plugins in SillyTavern
Ensure `enableServerPlugins: true` is enabled in your SillyTavern configuration (`config.yaml`):

```yaml
enableServerPlugins: true
```

### 3. Install the Companion UI Extension
Install the [Petra-SillyTavern-MCP-UI](https://github.com/m-petra-fn/Petra-SillyTavern-MCP-UI) extension into SillyTavern via the in-app Extensions installer or manual clone:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/m-petra-fn/Petra-SillyTavern-MCP-UI.git SillyTavern-MCP-UI
```

---

## MCP Client Configuration

### Claude Desktop
Add the server definition to your `claude_desktop_config.json`:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sillytavern": {
      "command": "node",
      "args": [
        "<PATH_TO_SILLYTAVERN>/plugins/SillyTavern-MCP-Server/mcp-server.mjs"
      ]
    }
  }
}
```

### Antigravity / Cursor / Custom MCP Clients
Configure the MCP server using command `node` and pointing directly to `mcp-server.mjs`:
```json
{
  "mcpServers": {
    "sillytavern": {
      "command": "node",
      "args": [
        "C:\\Petra\\Jogos\\SillyTavern\\plugins\\SillyTavern-MCP-Server\\mcp-server.mjs"
      ]
    }
  }
}
```

---

## Available MCP Tools

All tools return clean, structured plain text formatted for natural agent reasoning without excessive JSON overhead.

### Lightweight Indexing & Token Optimization Tools (Recommended for Co-Writers)

| Tool | Type | Description |
| :--- | :--- | :--- |
| `get_chat_overview` | Index | Lightweight overview of all messages in the chat (~80–150 tokens) with session ID, container character, scenario hash, total messages, per-message hashes, word counts, swipe counts, and attached image counts. Filenames are excluded to avoid token bloat. |
| `get_message` | Context | Granular fetch of a single message's full text, sender name, and swipe info by `message_id` (without image filenames). |
| `get_last_message` | Context | Fetches solely the latest message in the active chat. Ideal for continuing/appending text (`/message-edit append=true`) with minimal token usage. |
| `list_active_lore` | Index | Lists all active lorebooks and constant entries with entry ID (`entry_id`), title, and content hash (~50–80 tokens). |
| `get_lore_entry` | Context | Granularly fetches a single lore entry by its `book` and `entry_id`. |
| `get_lore_entries` | Context | Batch-retrieves multiple lore entries across one or more lorebooks in a single call (e.g. `[{book: 'setting', uids: [1, 3]}, {book: 'cast', uids: [2]}]`). |
| `get_message_images` | Visual | Lists attached image filenames, labels, and local disk paths for messages in the active chat. Use only when visual analysis is requested. |

### Full Context & History Tools

| Tool | Type | Description |
| :--- | :--- | :--- |
| `get_full_context` | Context | Retrieves the complete assembled scene context (Writing Instructions, Active Lorebook entries, Scenario) excluding chat history. |
| `get_current_lore` | Context | Retrieves only the active World Info / Lorebook entries (blue / constant mode) for the active scene. |
| `get_chat_scenario` | Context | Retrieves only the active Scenario section for the current chat, prefixed with `[Scenario Hash: ...]`. |
| `get_writing_instructions` | Context | Retrieves only the system writing instructions and style guidelines. |
| `get_chat_history` | History | Fetches chat messages with sender names, swipe info, timestamps, and message text (without image filenames). Supports `limit` (default: 30) and `since_id` (returns only messages logged after the given ID for delta fetching). |
| `get_chat_history_for_swipe` | History | Fetches chat messages **excluding the very last message**, designed specifically for drafting alternative swipes (`/swipes-add`). |
| `get_current_context` | Context | High-level status check: returns chat ID, group name, container character, scenario hash, active lore titles with hashes, and latest message preview. |

### Chat Action & Utility Tools

| Tool | Type | Description |
| :--- | :--- | :--- |
| `post_character_message` | Action | Injects narrative text into the chat. Supports `swipe: true` (`/swipes-add`) or `append: true` (`/message-edit append=true`). |
| `post_user_message` | Action | Sends a message attributed to the user with optional automated character reply trigger (`triggerReply: true`). |
| `post_system_message` | Action | Injects a narrator or system instruction note into the chat. |
| `trigger_generation` | Action | Prompts SillyTavern to generate the next response. |
| `execute_slash_command` | Action | Executes any SillyTavern slash command directly (e.g. `/sys`, `/setvar`, `/roll`). |
| `list_characters` | Utility | Returns a list of all installed characters in SillyTavern. |
| `select_character` | Utility | Switches the active character in the UI. |

---

## License

MIT License.
