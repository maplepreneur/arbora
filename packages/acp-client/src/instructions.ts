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
      `Interaction tools take a \`ref\` from the latest \`browser_snapshot\`. The default browser target is \`app\`. A reference tab works only after the user sends it (\`tab not granted\` otherwise). Match a design tab with \`browser_compare\`. The full guide is in ${project}/${SKILL_FILE}.`,
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

Lead sessions also have \`grove_*\` tools: \`grove_list_agents\`, \`grove_start_agent\` (a helper with
its own task; the first call asks the user), \`grove_wait\` (call again after a timeout),
\`grove_read\`, \`grove_send\` and \`grove_stop\`. Helpers do not get these tools. When a helper needs
the user, tell the user.
`;

/** `.arbora/SKILL.md`: how an agent uses Arbora's browser tools (kept under 400 words). */
export function browserSkill(context: PrefaceContext): string {
  const dev = context.devUrl ?? 'the URL shown in the browser panel (`devserver_status` has it)';
  const grove = context.groveTools ? GROVE_SKILL : '';
  return `# Arbora browser tools

Arbora shows this project's dev server (${dev}) in an embedded browser. The \`arbora-browser\`
tools let you see and drive it. The page is already open: do not launch another browser.

## Verify loop

${VERIFY_LOOP.join('\n')}

## Tools

- Look: \`browser_snapshot\` (\`ref=eN\`, cheapest), \`browser_screenshot\` (viewport, full, element),
  \`browser_get_url\`.
- Debug: \`browser_console_logs\`, \`browser_network_errors\`, \`browser_get_element_source\`,
  \`devserver_status\`, \`devserver_logs\`.
- Act: \`browser_click\`, \`browser_hover\`, \`browser_type\` (\`submit: true\`), \`browser_press_key\`,
  \`browser_scroll\`, \`browser_select_option\`, \`browser_wait_for\` (\`selector\`, \`text\`,
  \`textGone\`, \`networkIdle\`).
- Move: \`browser_navigate\` (\`/about\` uses the dev server), \`browser_reload\`, \`browser_back\`,
  \`browser_forward\`, \`browser_set_viewport\`. Run: \`devserver_restart\`, \`terminal_run\`.

## Rules

- Refs come from the latest snapshot. After a click, navigation or reload, snapshot again.
- Wait for \`networkIdle\` before judging a hot reload.
- Leaving the dev origin, \`browser_evaluate\` and \`terminal_run\` ask first. If declined, stop and
  say what you needed.
- Edit source; page-only changes vanish on reload.
- \`browser_login\` signs in. The password never appears in the result.

## Matching a design

\`browser_tabs\`: target \`app\` is this project. A reference tab works only after the user sends it; otherwise \`tab not granted\`.

Figma is a canvas, so snapshot shows chrome, not layers. Screenshot the frame. A \`node-id\` in the URL opens it. Dev Mode text is in the page. Set \`app\` to that width with \`browser_set_viewport\`, edit source, wait for reload, then \`browser_compare\` (\`side_by_side\`, \`overlay\` or \`diff\`). Fix the highest differences. Stop at 0.92, after 5 rounds, or when the user stops. Finish with the score, what still differs, and the saved side-by-side. Do not call a design tool's API.
${grove}`;
}
