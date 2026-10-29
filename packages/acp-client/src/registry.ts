import type { AgentAvailability, AgentDefinition, CustomAgent } from '@arbora/shared';

/** Adapter versions are pinned; "update adapters" bumps them here (see the Stage 3 gotchas). */
export const CLAUDE_CODE_ACP_VERSION = '0.16.2';
export const CODEX_ACP_VERSION = '2.5.0';

export const BUILT_IN_AGENTS: readonly AgentDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'npx',
    args: ['-y', `@zed-industries/claude-code-acp@${CLAUDE_CODE_ACP_VERSION}`],
    env: {},
    installHint: 'Needs Node.js (npx). Log in with `claude` once, or set ANTHROPIC_API_KEY.',
    docsUrl: 'https://github.com/zed-industries/claude-code-acp',
    builtIn: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'npx',
    args: ['-y', `@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}`],
    env: {},
    installHint: 'Needs Node.js (npx). Log in with `codex login`, or set CODEX_API_KEY / OPENAI_API_KEY.',
    docsUrl: 'https://github.com/agentclientprotocol/codex-acp',
    builtIn: true,
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    command: 'kimi',
    args: ['acp'],
    env: {},
    installHint: 'Install the Kimi Code CLI, then run `kimi` and `/login` once.',
    docsUrl: 'https://www.kimi.com/code/docs/en/acp.html',
    builtIn: true,
  },
  {
    id: 'grok',
    name: 'Grok Build',
    command: 'grok',
    args: ['agent', 'stdio'],
    env: {},
    installHint: 'Install the Grok CLI (`npx @xai-official/grok`), then run `grok login` or set XAI_API_KEY.',
    docsUrl: 'https://docs.x.ai/docs/grok-build',
    builtIn: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: {},
    installHint: 'Install OpenCode (v2+), then run `opencode auth login` or `opencode acp --login` once.',
    docsUrl: 'https://opencode.ai/docs/acp/',
    builtIn: true,
  },
];

/** Resolves a command name (or absolute path) to an executable path, or undefined when missing. */
export type CommandLookup = (command: string) => string | undefined;

/**
 * Built-in agents plus the user's custom entries. Custom agents are read on every access so
 * settings edits apply immediately; a custom entry with a built-in id replaces the built-in.
 */
export class AgentRegistry {
  constructor(private readonly custom: () => readonly CustomAgent[]) {}

  list(): AgentDefinition[] {
    const custom = this.custom().map((agent): AgentDefinition => ({ ...agent, builtIn: false }));
    const overridden = new Set(custom.map((a) => a.id));
    return [...BUILT_IN_AGENTS.filter((a) => !overridden.has(a.id)), ...custom];
  }

  get(id: string): AgentDefinition | undefined {
    return this.list().find((a) => a.id === id);
  }

  detect(lookup: CommandLookup): AgentAvailability[] {
    return this.list().map((agent) => {
      const resolved = lookup(agent.command);
      return resolved === undefined
        ? { id: agent.id, available: false }
        : { id: agent.id, available: true, resolvedCommand: resolved };
    });
  }
}
