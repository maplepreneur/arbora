export interface PrefaceContext {
  readonly projectPath: string;
  /** The dev server URL loaded in Arbora's browser panel, if one is running. */
  readonly devUrl: string | null;
  /** Arbora's `arbora-browser` MCP server is attached to this session. */
  readonly browserTools?: boolean;
  /** That server also has the Grove orchestration tools (a session that is not a helper). */
  readonly groveTools?: boolean;
}

/** Agents read Windows paths fine either way, but prompts read better with forward slashes. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** First line of the preface; agents that title a thread after its first prompt echo it. */
export const PREFACE_OPENING = 'You are working inside Arbora';

/** Whether an agent-supplied thread title is just the preface read back. */
export function isPrefaceTitle(title: string): boolean {
  return title.trimStart().startsWith(PREFACE_OPENING);
}

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
 * Short preface sent with the first prompt of every thread. With the browser tools attached it
 * adds the verify loop, so agents check their own work in the running page.
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
      'You can see and drive that browser with the `arbora-browser` MCP tools (`browser_*`, `devserver_*`, `terminal_run`). The page is already open; do not start another browser. Verify your own work:',
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

Sessions the user starts also have \`grove_*\` tools on this server: \`grove_list_agents\` (agents and
sessions), \`grove_start_agent\` (a helper with a task that stands on its own; the first call asks the
user), \`grove_wait\` (until your helpers are done or need the user; call it again after a timeout),
\`grove_read\` (a helper's transcript), \`grove_send\` and \`grove_stop\`. Helpers do not get these
tools. When a helper needs the user, tell the user; you cannot answer for it.
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

## Rules

- Refs come from the latest snapshot. After a click, navigation or reload, take a new snapshot
  before using refs again.
- Hot reload is asynchronous: wait for \`networkIdle\` before judging a change.
- Leaving the dev server's origin, \`browser_evaluate\` and \`terminal_run\` ask the user first. If
  they decline, do not retry; explain what you needed instead.
- Prefer editing source over \`browser_evaluate\`; changes made in the page are lost on reload.
${grove}`;
}
