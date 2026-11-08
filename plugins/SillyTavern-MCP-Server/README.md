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

| Tool | Type | Description |
| :--- | :--- | :--- |
| `get_full_context` | Context | Retrieves the complete assembled scene context (Writing Instructions, Active Lorebook entries, Scenario) excluding chat history. |
| `get_current_lore` | Context | Retrieves only the active World Info / Lorebook entries (blue / constant mode) for the active scene. |
| `get_chat_scenario` | Context | Retrieves only the active Scenario section for the current chat. |
| `get_writing_instructions` | Context | Retrieves only the system writing instructions and style guidelines. |
| `get_chat_history` | History | Fetches chat messages with sender names, swipe info, and **attached image filenames and disk paths**. Supports querying full history or a custom `limit`. |
| `get_chat_history_for_swipe` | History | Fetches all chat messages **excluding the very last message**, designed specifically for drafting alternative swipes (`/swipes-add`). |
| `get_current_context` | Context | High-level status check: returns chat ID, group name, container character, active lore titles, and latest message preview. |
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
