const CLI_AGENT: Readonly<Record<string, string>> = {
  'Claude Code': 'claude-code',
  Codex: 'codex',
  OpenCode: 'opencode',
  Kimi: 'kimi',
  Grok: 'grok',
  Gemini: 'gemini',
  Amp: 'amp',
  Copilot: 'copilot',
};

/** Two letters from the agent name. Used when the app has no logo file for that agent. */
export function agentMonogram(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  const text = `${first}${second}`.toUpperCase();
  return text.length > 0 ? text : '?';
}

export function agentIdForCliName(name: string): string | undefined {
  return CLI_AGENT[name];
}

/** Quiet monogram for an agent type. Grove has no bundled trademark art, so this is the shared mark. */
export function AgentMark({ name, agentId }: { name: string; agentId?: string | undefined }) {
  return (
    <span
      data-testid="agent-mark"
      data-agent={agentId}
      aria-hidden
      title={name}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-bg-muted text-[8px] font-semibold tracking-tight text-fg-subtle"
    >
      {agentMonogram(name)}
    </span>
  );
}
