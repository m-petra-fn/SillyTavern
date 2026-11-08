# SillyTavern MCP Bridge (UI Extension)

A lightweight client-side extension for **SillyTavern** that connects your web UI session with the **Model Context Protocol (MCP)** server plugin ([Petra-SillyTavern-MCP-Server](https://github.com/m-petra-fn/Petra-SillyTavern-MCP-Server)).

This extension monitors your active chat session, synchronizes prompts, active Lorebook / World Info entries, scenarios, and character context in real-time, and dispatches actions initiated by external AI assistants (Claude Desktop, Antigravity, Cursor, etc.).

---

## Features

- **Live Context Sync:** Automatically synchronizes character details, user persona, group chat metadata, and recent chat history with the MCP server.
- **Assembled Prompt Interception:** Hooks into SillyTavern's prompt generation events (via `dryRun` assembly) to capture active Lorebook entries, system instructions, and scenario sections without cluttering token limits.
- **Bi-directional Action Dispatch:** Polls and executes actions requested by MCP clients directly in the browser interface:
  - Send messages as character (`/sendas`)
  - Add alternative swipe variations (`/swipes-add`)
  - Append to existing messages (`/message-edit append=true`)
  - Post user messages and trigger response generations
  - Post system/narrator injections
  - Execute arbitrary slash commands (`/sys`, `/roll`, etc.)
- **Multi-Slot Image Attachment Tracking:** Extracts all image slots attached to messages, providing clean disk paths for multimodal AI inspection.
- **In-App Status & Control Panel:** Adds an extension settings panel in SillyTavern's **Extensions** menu to monitor connection status, toggle auto-sync, test pings, and force immediate syncs.

---

## Installation

### Method 1: In-App Extension Installer (Recommended)
1. Open **SillyTavern** in your browser.
2. Click the **Extensions** icon (puzzle piece) in the top navigation bar.
3. Open **Install Extension**.
4. In the **Git Repository URL** field, paste:
   ```text
   https://github.com/m-petra-fn/Petra-SillyTavern-MCP-UI.git
   ```
5. Click **Save** / **Install**.
6. Refresh or restart SillyTavern.

### Method 2: Manual Git Clone
Clone this repository directly into your SillyTavern third-party extensions directory:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/m-petra-fn/Petra-SillyTavern-MCP-UI.git SillyTavern-MCP-UI
```
*(Or inside `data/default-user/extensions/SillyTavern-MCP-UI` if using SillyTavern multi-user mode).*

---

## Companion Server Plugin

This UI extension requires the companion server plugin to bridge with MCP clients:
👉 **[Petra-SillyTavern-MCP-Server](https://github.com/m-petra-fn/Petra-SillyTavern-MCP-Server)**

Install the server plugin into your SillyTavern `plugins/` directory:
```bash
cd SillyTavern/plugins
git clone https://github.com/m-petra-fn/Petra-SillyTavern-MCP-Server.git SillyTavern-MCP-Server
```

---

## License

MIT License.
