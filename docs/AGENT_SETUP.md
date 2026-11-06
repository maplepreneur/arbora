# Setting up agents

Arbora talks to coding agents over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP). Each agent keeps its own login, models and billing; Arbora never asks for or stores a provider key. After installing an agent, open Settings → Agents (`Mod+,`) and press **Check**: Arbora starts the agent once, runs `initialize` and `session/new`, and records whether you are signed in and which models it offers. Only signed-in agents appear in the pickers. Star one to make it the default for new threads.

| Agent | Command Arbora runs | Install | Sign in |
| --- | --- | --- | --- |
| Claude Code | `npx -y @zed-industries/claude-code-acp@<pinned>` | Node.js 22+ (for `npx`) | run `claude` once and log in, or set `ANTHROPIC_API_KEY` |
| Codex | `npx -y @agentclientprotocol/codex-acp@<pinned>` | Node.js 22+ | `codex login`, or set `CODEX_API_KEY` / `OPENAI_API_KEY` |
| Kimi Code | `kimi acp` | the Kimi Code CLI | run `kimi`, then `/login` |
| Grok Build | `grok agent stdio` | `npx @xai-official/grok` or the Grok CLI | `grok login`, or set `XAI_API_KEY` |
| OpenCode | `opencode acp` (v2+) | [opencode.ai](https://opencode.ai) | `opencode auth login` |
| Antigravity | `agy acp` | the Antigravity CLI | run `agy` once, or `agy acp --login`. A `GEMINI_API_KEY` also works |

## API keys and other environment

An agent that reads a key from the environment can get it from your login shell (Arbora uses its PATH and environment), or from Settings → Agents → the gear on the agent's row → **Environment overrides**. Override values are passed to the agent process on its next start. They are never shown in the ACP log viewer, and **Export Diagnostics** removes them.

## Adapter versions

Claude Code and Codex run through npm adapters that Arbora pins to a tested version, because agent CLIs change weekly. The gear on the row shows the pinned package. **Update to latest** runs the newest adapter instead; **Back to the pinned version** undoes it. Kimi Code, Grok Build, OpenCode and Antigravity run the CLI you installed, so update those with their own updater.

## Custom agents

Settings → Agents → **Add custom agent** takes a name, a command and its arguments: anything that speaks ACP over stdio. It is the same shape as Zed's `agent_servers`, and you can also write it in `settings.json`:

```json
{
  "agents": {
    "custom": [{ "id": "my-agent", "name": "My agent", "command": "my-agent", "args": ["acp"], "env": {} }]
  }
}
```

A custom entry with a built-in id (for example `codex`) replaces the built-in.

## Browser tools

Every thread gets Arbora's browser tools as an MCP server, so the agent can screenshot, click and read the page to check its own work. Agents that do not support HTTP MCP get a stdio shim automatically. If a thread shows "The agent has not loaded Arbora's browser tools", the agent's sandbox may block localhost; see that agent's sandbox settings. Settings → Project sets whether `browser_evaluate` and `terminal_run` ask, are always allowed, or are never allowed in this project.

## Troubleshooting

- **Not installed:** the command was not found on your login-shell PATH. See the [FAQ](./FAQ.md#an-agent-or-node-is-not-found-when-arbora-starts-from-the-dock-or-app-launcher).
- **Needs login:** run the agent's login command in a terminal (Arbora's own terminal works), then press **Check again**.
- **Failed to start:** open the thread's ACP log (**Toggle ACP Log**) to see the agent's stderr and the JSON-RPC traffic, redacted.
