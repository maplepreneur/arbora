import type { AgentAvailability, AgentDefinition, CustomAgent } from './agent.js';
import { stripAnsi } from './terminal.js';

/**
 * Terminal-based agents (the ACP replacement). Agents run as interactive CLIs in `node-pty`
 * terminals the user can see and type into; Arbora writes prompts into that terminal and derives
 * status, attention and notifications from the output.
 */

/** No output for this long after a prompt means the turn has ended (or is waiting for the user). */
export const TURN_QUIET_MS = 2500;
/** A process that has not printed anything within this long never started. */
export const START_TIMEOUT_MS = 30_000;
/** Lines of output kept per thread for rows, notifications and a restored terminal's tail. */
export const THREAD_TAIL_LINES = 80;

/**
 * Whether the tail of an agent's output looks like a question for the user: a yes/no prompt, an
 * "allow this?" request, a login or a "press enter". Matched against the last few stripped lines,
 * once output has gone quiet, so a mid-turn mention never triggers it.
 */
export function looksLikeInputRequest(tail: readonly string[]): boolean {
  const lines = tail
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.length > 0)
    .slice(-3);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1] ?? '';
  const patterns: RegExp[] = [
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /\[yes\/no\]/i,
    /yes\/no\?/i,
    /\(yes\/no\)/i,
    /\bproceed\?\s*$/i,
    /\ballow\b[^?]*\?\s*$/i,
    /\bapprove\b[^?]*\?\s*$/i,
    /\bconfirm\b[^?]*\?\s*$/i,
    /\bdeny\b[^?]*\?\s*$/i,
    /\bpress (enter|any key|esc)/i,
    /\bwaiting for (your|an)? ?(input|approval|confirmation)/i,
    /\blog ?in\b.*\?\s*$/i,
    /\bsign ?in\b.*\?\s*$/i,
    /password:/i,
    /enter .* to (continue|confirm)/i,
    /\b1\. .* yes\b/i,
  ];
  if (patterns.some((pattern) => pattern.test(last))) return true;
  // A numbered choice list ("1. Yes  2. No  3. Always") right before the cursor.
  return /\b[12]\.\s+(yes|no|always|allow|deny)\b/i.test(lines.slice(-2).join(' '));
}

/** The enable/disable sequences for xterm bracketed paste mode. */
const PASTE_ENABLE = '\u001b[?2004h';
const PASTE_DISABLE = '\u001b[?2004l';

/** Tracks whether an agent's terminal asked for bracketed paste (multi-line prompts stay one paste). */
export class BracketedPasteTracker {
  private enabled = false;
  /** Whether the CLI said anything about paste mode yet; a fresh TUI is assumed to support it. */
  private announced = false;

  /** Feed raw process output; returns the state after it. */
  push(data: string): boolean {
    if (data.includes(PASTE_ENABLE)) {
      this.enabled = true;
      this.announced = true;
    }
    if (data.includes(PASTE_DISABLE)) {
      this.enabled = false;
      this.announced = true;
    }
    return this.value;
  }

  get value(): boolean {
    // A CLI that has not said anything is given the benefit of the doubt: prompts sent before
    // its banner arrives still ride a bracketed paste, which every common TUI understands.
    return this.enabled || !this.announced;
  }
}

/** How a prompt reaches the agent: one paste the CLI treats as a single input, then Enter. */
export function encodeTerminalPrompt(text: string, bracketedPaste: boolean): string {
  const prompt = text.replace(/\r\n/g, '\n').trim();
  if (prompt.length === 0) return '';
  if (bracketedPaste && prompt.includes('\n')) {
    return `\u001b[200~${prompt}\u001b[201~\r`;
  }
  return `${prompt.replace(/\n+$/, '')}\n\r`;
}

/** Built-in agents, run as the interactive CLI in a terminal (the commands users run by hand). */
export interface BuiltInAgentInput {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  /** Interactive arguments (usually none: the bare CLI is the session). */
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly installHint: string;
  readonly docsUrl?: string;
  /** Args for `command ...args` that print a version and exit, for the sign-in probe. */
  readonly probe?: readonly string[];
  /** Args that run one prompt non-interactively (commit messages, PR text); the prompt is appended. */
  readonly task?: readonly string[];
}

export function builtInAgent(input: BuiltInAgentInput): {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  installHint: string;
  docsUrl?: string;
  builtIn: boolean;
  probe: string[];
  task: string[];
} {
  return {
    id: input.id,
    name: input.name,
    command: input.command,
    args: [...(input.args ?? [])],
    env: { ...(input.env ?? {}) },
    installHint: input.installHint,
    ...(input.docsUrl !== undefined ? { docsUrl: input.docsUrl } : {}),
    builtIn: true,
    probe: [...(input.probe ?? ['--version'])],
    task: [...(input.task ?? [])],
  };
}

export const BUILT_IN_AGENTS: readonly AgentDefinition[] = [
  builtInAgent({
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    installHint: 'Install the Claude Code CLI, then log in with `claude` once.',
    docsUrl: 'https://code.claude.com/docs/cli-overview',
    task: ['-p'],
  }),
  builtInAgent({
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    installHint: 'Install the Codex CLI (`npm i -g @openai/codex`), then run `codex login` once.',
    docsUrl: 'https://developers.openai.com/codex/',
    task: ['exec'],
  }),
  builtInAgent({
    id: 'kimi',
    name: 'Kimi Code',
    command: 'kimi',
    installHint: 'Install the Kimi Code CLI, then run `kimi` and `/login` once.',
    docsUrl: 'https://www.kimi.com/code/docs/en/cli.html',
  }),
  builtInAgent({
    id: 'grok',
    name: 'Grok Build',
    command: 'grok',
    installHint: 'Install the Grok CLI (`npx @xai-official/grok`), then run `grok login`.',
    docsUrl: 'https://docs.x.ai/docs/grok-build',
  }),
  builtInAgent({
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    installHint: 'Install OpenCode (v2+), then run `opencode auth login` once.',
    docsUrl: 'https://opencode.ai/docs/cli/',
    task: ['run'],
  }),
  builtInAgent({
    id: 'antigravity',
    name: 'Antigravity',
    command: 'agy',
    installHint: 'Install the Antigravity CLI, then sign in with `agy` once.',
    docsUrl: 'https://antigravity.google/docs/cli/',
  }),
];

/** Resolves a command name (or absolute path) to an executable path, or undefined when missing. */
export type CommandLookup = (command: string) => string | undefined;

/** Settings layered over the definitions: extra env per agent. */
export interface AgentOverrides {
  readonly env: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const NO_OVERRIDES: AgentOverrides = { env: {} };

/**
 * Built-in terminal agents plus the user's custom entries. Custom agents are read on every access
 * so settings edits apply immediately; a custom entry with a built-in id replaces the built-in.
 */
export class AgentRegistry {
  constructor(
    private readonly custom: () => readonly CustomAgent[],
    private readonly overrides: () => AgentOverrides = () => NO_OVERRIDES,
  ) {}

  list(): AgentDefinition[] {
    const custom = this.custom().map((agent): AgentDefinition => ({
      ...agent,
      builtIn: false,
      probe: agent.probe ?? ['--version'],
      task: agent.task ?? [],
    }));
    const overridden = new Set(custom.map((a) => a.id));
    const { env } = this.overrides();
    return [...BUILT_IN_AGENTS.filter((a) => !overridden.has(a.id)), ...custom].map((agent) => {
      const extraEnv = env[agent.id];
      return extraEnv && Object.keys(extraEnv).length > 0 ? { ...agent, env: { ...agent.env, ...extraEnv } } : agent;
    });
  }

  /** The built-in definition before any override, for "reset" buttons. */
  builtIn(id: string): AgentDefinition | undefined {
    return BUILT_IN_AGENTS.find((a) => a.id === id);
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

// --- First-prompt preface and the browser-tools skill --------------------------------------------

export interface PrefaceContext {
  readonly projectPath: string;
  /** The dev server URL loaded in Arbora's browser panel, if one is running. */
  readonly devUrl: string | null;
  /** Arbora's `arbora-browser` MCP server is reachable through `ARBORA_MCP_URL`. */
  readonly browserTools?: boolean;
  /** That server also has the Grove orchestration tools (a session that is not a helper). */
  readonly groveTools?: boolean;
}

/** Agents read Windows paths fine either way, but prompts read better with forward slashes. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** First line of the preface; it doubles as the first line of the composed prompt. */
export const PREFACE_OPENING = 'You are working inside Arbora';

/** Where the browser-tools guide is written in the project. */
export const SKILL_FILE = '.arbora/SKILL.md';

/** The verify loop, shared by the first-prompt preface and `.arbora/SKILL.md`. */
const VERIFY_LOOP = [
  '1. Edit the source files.',
  '2. Wait for hot reload: `browser_wait_for` with `networkIdle: true`. If the change needs a restart (config, dependencies) or `devserver_logs` shows the server is stuck, call `devserver_restart`.',
  '3. Look: `browser_snapshot` for text and structure (cheap), `browser_screenshot` for visual changes.',
  '4. Compare with the request. Check `browser_console_logs` and `browser_network_errors` for new errors. Iterate until it matches.',
  '5. Finish with a short summary of what changed (files) and a final `browser_screenshot`.',
];

/**
 * Short preface written into the terminal with the first prompt of every thread. With the browser
 * tools reachable it adds the verify loop, so agents check their own work in the running page.
 */
export function firstPromptPreface(context: PrefaceContext): string {
  const project = toPosixPath(context.projectPath);
  const dev = context.devUrl
    ? `The project's dev server is running and Arbora's embedded browser shows ${context.devUrl}.`
    : 'No dev server is running yet; the user can start one from the Terminal panel.';
  const lines = [
    `${PREFACE_OPENING}, a desktop app for building web apps by pointing at the running page.`,
    `The project folder (your working directory) is ${project}. Use absolute paths.`,
    dev,
    'Edit source files directly; the dev server hot-reloads. Keep replies concise and mention which files you changed.',
  ];
  if (context.browserTools) {
    lines.push(
      '',
      `You can see and drive that browser with the \`arbora-browser\` MCP tools (\`browser_*\`, \`devserver_*\`, \`terminal_run\`) at the URL in your \`ARBORA_MCP_URL\` environment variable (bearer token \`ARBORA_MCP_TOKEN\`, Streamable HTTP). The page is already open; do not start another browser. Verify your own work:`,
      ...VERIFY_LOOP,
      `Interaction tools take a \`ref\` from the latest \`browser_snapshot\`. The full guide is in ${project}/${SKILL_FILE}.`,
    );
  }
  if (context.browserTools && context.groveTools) {
    lines.push(
      '',
      'You can hand separate parts of a task to other agents with the Grove tools (`grove_list_agents`, `grove_start_agent`, `grove_wait`, `grove_read`, `grove_send`, `grove_stop`). Each helper is a new session that works next to you; the user can open and answer it in Grove. A helper cannot see this conversation, so give it a task that stands on its own. Delegate only independent work, wait for it, and read what it did before you report back.',
    );
  }
  return lines.join('\n');
}

const GROVE_SKILL = `
## Grove helpers

A lead also has \`grove_list_agents\`, \`grove_start_agent\` (a helper with a task that stands alone;
the first call asks the user), \`grove_wait\`, \`grove_read\`, \`grove_send\` and \`grove_stop\`.
Helpers do not get these tools. When a helper needs the user, tell the user.
`;

/** `.arbora/SKILL.md`: how an agent uses Arbora's browser tools (kept under 400 words). */
export function browserSkill(context: PrefaceContext): string {
  const dev = context.devUrl ?? 'the URL shown in the browser panel (`devserver_status` has it)';
  const grove = context.groveTools ? GROVE_SKILL : '';
  return `# Arbora browser tools

You are working inside Arbora, a desktop app that shows this project's running dev server
(${dev}) in an embedded browser next to you. The \`arbora-browser\` MCP server lets you see and
drive that browser, so you can check your own changes without asking the user. The page is
already open: do not launch another browser, and do not ask the user for screenshots.

Your environment has \`ARBORA_MCP_URL\` (Streamable HTTP) and \`ARBORA_MCP_TOKEN\` (bearer). Add
that server to your MCP config with both, or call it directly.

## Verify loop

${VERIFY_LOOP.join('\n')}

## Tools

- Look: \`browser_snapshot\` (accessibility tree with \`ref=eN\` ids, cheapest), \`browser_screenshot\`
  (\`mode\`: viewport, full or element with a \`ref\`), \`browser_get_url\`.
- Debug: \`browser_console_logs\` (current page by default; \`level: "error"\`),
  \`browser_network_errors\`, \`browser_get_element_source\` (component chain and source files for a
  \`ref\`), \`devserver_status\`, \`devserver_logs\`.
- Act: \`browser_click\`, \`browser_hover\`, \`browser_type\` (\`submit: true\` presses Enter),
  \`browser_press_key\`, \`browser_scroll\`, \`browser_select_option\`, \`browser_wait_for\`
  (\`selector\`, \`text\`, \`textGone\`, \`networkIdle\`).
- Navigate: \`browser_navigate\` (paths like \`/about\` resolve against the dev server),
  \`browser_reload\`, \`browser_back\`, \`browser_forward\`, \`browser_set_viewport\` (mobile, tablet,
  laptop, desktop or a size).
- Run: \`devserver_restart\`, \`terminal_run\` (short commands with captured output).
- Tabs: omit \`target\` for the app tab. A reference tab needs a grant, or the tool says "tab not granted". \`browser_compare\` scores tabs \`a\` and \`b\` and returns one image.

## Rules

- Refs come from the latest snapshot. After a click, navigation or reload, take a new snapshot
  before using refs again.
- Hot reload is asynchronous: wait for \`networkIdle\` before judging a change.
- Leaving the dev server's origin, \`browser_evaluate\` and \`terminal_run\` ask the user first. If
  they decline, do not retry; explain what you needed instead.
- Prefer editing source over \`browser_evaluate\`; changes made in the page are lost on reload.
${grove}`;
}
