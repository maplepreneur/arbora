# Setting up agents

Arbora runs coding agents as their own interactive CLIs, each in a terminal tab inside the app — the same command you would run by hand. Each agent keeps its own login, models and billing; Arbora never asks for or stores a provider key. After installing an agent, open Settings → Agents (`Mod+,`) and press **Check**: Arbora runs the CLI's version check once and records that it is installed. Only checked agents appear in the pickers. Star one to make it the default for new threads.

| Agent | Terminal command | Install | Sign in (inside the terminal) |
| --- | --- | --- | --- |
| Claude Code | `claude` | [Claude Code CLI](https://code.claude.com/docs/cli-overview) | run `claude` once and log in, or set `ANTHROPIC_API_KEY` |
| Codex | `codex` | [OpenAI Codex CLI](https://developers.openai.com/codex/) | `codex login`, or set `CODEX_API_KEY` / `OPENAI_API_KEY` |
| Kimi Code | `kimi` | the Kimi Code CLI | run `kimi`, then `/login` |
| Grok Build | `grok` | `npx @xai-official/grok` or the Grok CLI | `grok login`, or set `XAI_API_KEY` |
| OpenCode | `opencode` | [opencode.ai](https://opencode.ai) | `opencode auth login` |
| Antigravity | `agy` | the Antigravity CLI | run `agy` once. A `GEMINI_API_KEY` also works |

Every thread is a real terminal: log in, switch models, use slash commands and answer the agent's own permission prompts by typing in it. Arbora's composer and the agent-mode and design-mode prompts are typed into that terminal for you, and the thread list shows a live status derived from what the CLI prints — Working while it prints after a prompt, Needs you when it asks a question, Failed if it exits with an error.

## API keys and other environment

An agent that reads a key from the environment can get it from your login shell (Arbora uses its PATH and environment), or from Settings → Agents → the gear on the agent's row → **Environment overrides**. Override values are passed to the agent terminal on its next start. They are never shown in diagnostics, and **Export Diagnostics** removes them.

## Custom agents

Settings → Agents → **Add custom agent** takes a name, a command and its arguments: any interactive CLI. You can also write it in `settings.json`:

```json
{
  "agents": {
    "custom": [{ "id": "my-agent", "name": "My agent", "command": "my-agent", "args": [], "env": {} }]
  }
}
```

A custom entry with a built-in id (for example `codex`) replaces the built-in.

## Browser tools

Every thread gets Arbora's browser tools MCP server, so the agent can screenshot, click and read the page to check its own work. The URL and bearer token travel as the `ARBORA_MCP_URL` and `ARBORA_MCP_TOKEN` environment variables (the first prompt and `.arbora/SKILL.md` describe the contract), and lead sessions also get the Grove orchestration tools. Configure the agent's own MCP from those variables if it supports MCP servers. Settings → Project sets whether `browser_evaluate` and `terminal_run` ask, are always allowed, or are never allowed in this project; Arbora asks with its own card above the composer.

## Troubleshooting

- **Not installed:** the command was not found on your login-shell PATH. See the [FAQ](./FAQ.md#an-agent-or-node-is-not-found-when-arbora-starts-from-the-dock-or-app-launcher).
- **Needs login:** type the agent's login command in its terminal (Arbora's own terminal works), then press **Check again**.
- **Failed to start:** the thread keeps the CLI's terminal visible; read its output there. If the CLI exited, the thread shows the exit code, and **Restart** (Grove's start button on the row) spawns a fresh terminal.
