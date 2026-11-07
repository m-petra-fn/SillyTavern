# SillyTavern MCP Bridge

This extension and server plugin bridges **SillyTavern** with the **Model Context Protocol (MCP)**, allowing AI assistants (Claude Desktop, Antigravity, Cursor, etc.) to:
1. **Read Live Context**: Current character card details (personality, description, scenario, greeting), user persona, and recent chat history.
2. **Post as Character**: Post dialogue and narrative actions into the active chat directly as the character.
3. **Post as User**: Post user messages and optionally trigger character response generation.
4. **Post System Notes / Injections**: Add narrator or system comments.
5. **Execute Slash Commands**: Run `/sys`, `/echo`, `/setvar`, `/roll`, etc.
6. **Switch & List Characters**: Browse and select characters in SillyTavern.

---

## Architecture

* **UI Extension** (`data/default-user/extensions/SillyTavern-MCP/`): Runs in the browser, accesses SillyTavern's `getContext()`, updates the DOM, and dispatches actions.
* **Server Plugin** (`plugins/SillyTavern-MCP/`): Express backend plugin running at `/api/plugins/mcp` to bridge the browser and MCP clients.
* **MCP Server** (`mcp-server.mjs` / `run-mcp.bat`): Zero-dependency Node.js MCP server communicating via stdio JSON-RPC.

---

## How to Connect to MCP Clients

### 1. Claude Desktop
Add this to your `claude_desktop_config.json` (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sillytavern": {
      "command": "node",
      "args": [
        "C:\\Petra\\Jogos\\SillyTavern\\plugins\\SillyTavern-MCP\\mcp-server.mjs"
      ]
    }
  }
}
```

Or using the `.bat` launcher:
```json
{
  "mcpServers": {
    "sillytavern": {
      "command": "C:\\Petra\\Jogos\\SillyTavern\\plugins\\SillyTavern-MCP\\run-mcp.bat"
    }
  }
}
```

### 2. Antigravity / Cursor / Other MCP Clients
Command: `node`
Arguments: `C:\Petra\Jogos\SillyTavern\plugins\SillyTavern-MCP\mcp-server.mjs`

---

## Available MCP Tools

| Tool | Description |
|---|---|
| `get_current_context` | Retrieves current character card details, user persona, and recent chat history. |
| `get_chat_history` | Retrieves recent chat messages from the active session with configurable limit. |
| `post_character_message` | Injects dialogue or actions as the currently opened character into the chat. |
| `post_user_message` | Sends a message as the user; can automatically trigger character reply. |
| `post_system_message` | Injects a system or narrator note. |
| `trigger_generation` | Requests SillyTavern to generate the next response. |
| `execute_slash_command` | Runs any SillyTavern slash command (e.g. `/sys`, `/roll 1d20`). |
| `list_characters` | Returns a list of all installed characters. |
| `select_character` | Switches the active character in the UI. |

---

## Requirements

1. SillyTavern must have `enableServerPlugins: true` in `config.yaml` (already enabled).
2. Restart SillyTavern if it was running while installing the server plugin.
3. Keep the SillyTavern browser tab open so the UI extension can interact with the active chat.
