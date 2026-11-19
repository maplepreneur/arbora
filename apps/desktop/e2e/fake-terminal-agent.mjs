#!/usr/bin/env node
/**
 * A fake terminal agent for e2e tests: the shape of a real coding-agent CLI (raw mode, bracketed
 * paste, banner), with a hand-rolled MCP client that reaches Arbora's browser-tools server
 * through the ARBORA_MCP_URL / ARBORA_MCP_TOKEN environment variables, exactly as the preface
 * tells a real agent to.
 *
 * The prompt's last non-empty line drives the behaviour:
 * - (default):      answers `Done: <line>`, then goes quiet (the turn ends).
 * - `echo <text>`:  prints the text.
 * - `ask`:          prints `Allow edit to App.tsx? (y/n) ` and waits (needs_input).
 * - `crash`:        exits with code 3 (the thread shows Failed).
 * - `stream <n>`:   prints n lines, 30 ms apart.
 * - `mcp list`:     lists the server's tools.
 * - `mcp <tool> <json>`: calls one tool and prints its first text line.
 * - `browser check`: snapshot -> click "Increment" -> wait for the network to settle ->
 *                    screenshot, reporting each step (the Stage 5 loop, from a terminal).
 * - `grove delegate`: starts a helper with the task "say hello from the helper", waits for it,
 *                    reads its terminal and reports what it said (the Stage 10 orchestration).
 * - `tabs <id>`:    screenshots the reference tab `<id>` and the app tab, reporting which is
 *                   granted (the Stage 12 tab grants).
 * - a paste whose last line is `run all`: every earlier line runs as its own command, in order.
 *
 * A multi-line prompt (the first prompt carries Arbora's preface) is echoed as
 * `Received: <first line> (<n> lines)` so the tests can assert the paste arrived intact. With
 * FAKE_TERMINAL_ECHO=1 every pasted line is echoed as well, for content-level assertions.
 */
import { appendFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const VERSION = 'FakeAgent v1.0.0';

// `node fake-terminal-agent.mjs --version`: answer the sign-in probe and leave.
if (process.argv.includes('--version')) {
  stdout.write(`${VERSION}\n`);
  process.exit(0);
}

stdout.write(`${VERSION}\n`);
stdout.write(`mcp url: ${process.env.ARBORA_MCP_URL ?? 'none'}\n`);
if (process.env.ARBORA_MCP_GROVE) stdout.write('grove tools: available\n');
stdout.write('\u001b[?2004h'); // bracketed paste on, as real TUIs do

stdin.setRawMode(true);
stdin.setEncoding('utf8');

let buffer = '';
let inPaste = false;
let id = 0;
let mcpReady = null;
let timer = null;
const startedAt = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function say(text) {
  stdout.write(`${text}\n`);
}

// --- A minimal Streamable-HTTP MCP client (the server answers JSON; see server.ts) -------------
async function mcpFetch(body) {
  const response = await fetch(process.env.ARBORA_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${process.env.ARBORA_MCP_TOKEN ?? ''}`,
      ...(mcpReady ? { 'mcp-protocol-version': mcpReady } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`MCP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (type.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
    }
    return null;
  }
  return text ? JSON.parse(text) : null;
}

async function mcpCall(method, params) {
  const request = { jsonrpc: '2.0', id: ++id, method, ...(params !== undefined ? { params } : {}) };
  const response = await mcpFetch(request);
  if (response?.error) throw new Error(response.error.message ?? 'MCP error');
  return response?.result;
}

async function mcp() {
  if (!process.env.ARBORA_MCP_URL) throw new Error('no ARBORA_MCP_URL in the environment');
  if (mcpReady) return;
  const result = await mcpCall('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'arbora-fake-terminal-agent', version: '1.0.0' },
  });
  mcpReady = result?.protocolVersion ?? '2025-06-18';
  await mcpFetch({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
}

async function tool(name, args) {
  await mcp();
  const result = await mcpCall('tools/call', { name, arguments: args });
  const text = (result?.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  if (result?.isError) throw new Error(text || `tool ${name} failed`);
  return text;
}

/** Prints a keepalive while a long tool call runs, so the thread stays Working. */
async function withKeepalive(promise) {
  const beat = setInterval(() => say('working…'), 1500);
  try {
    return await promise;
  } finally {
    clearInterval(beat);
  }
}

// --- Commands ------------------------------------------------------------------------------------
function refOfButton(snapshotText, label) {
  // Playwright-MCP-style lines: `- button "Increment" [ref=e5]`.
  const pattern = new RegExp(`${label}[^\\n]*\\[ref=(e\\d+)\\]`);
  const match = pattern.exec(snapshotText);
  return match?.[1] ?? null;
}

async function browserCheck() {
  const snapshot = await withKeepalive(tool('browser_snapshot', {}));
  say(`mcp snapshot ok (${String(snapshot).length} chars)`);
  const ref = refOfButton(String(snapshot), 'Increment');
  if (!ref) throw new Error('no Increment button in the snapshot');
  await withKeepalive(tool('browser_click', { ref }));
  say(`mcp click ok (${ref})`);
  await withKeepalive(tool('browser_wait_for', { networkIdle: true }));
  say('mcp wait ok');
  const shot = await withKeepalive(tool('browser_screenshot', { mode: 'viewport' }));
  say(`mcp screenshot ok (${String(shot).length} chars)`);
  say('browser check done');
}

async function tabsCheck(refId) {
  try {
    await withKeepalive(tool('browser_screenshot', { mode: 'viewport', target: refId }));
    say('tabs: reference ok');
  } catch (error) {
    say(`tabs: reference refused: ${error.message}`);
  }
  const url = await withKeepalive(tool('browser_get_url', {}));
  const clean = String(url).split('\n')[0]?.replace('Page URL: ', '').slice(0, 100) ?? '';
  say(`tabs: default url: ${clean}`);
}

async function groveDelegate() {
  const agents = await withKeepalive(tool('grove_list_agents', {}));
  say(`mcp grove_list_agents ok (${String(agents).length} chars)`);
  const started = await withKeepalive(tool('grove_start_agent', { task: 'say hello from the helper' }));
  const helperId = /Started helper (\S+)/.exec(String(started))?.[1];
  if (!helperId) throw new Error(`no helper id in ${started}`);
  say(`mcp grove_start_agent ok (${helperId})`);
  const waited = await withKeepalive(tool('grove_wait', { sessionIds: [helperId], timeoutSeconds: 60 }));
  say(`mcp grove_wait ok (${String(waited).replace(/\n/g, ' | ').slice(0, 120)})`);
  const read = await withKeepalive(tool('grove_read', { sessionId: helperId, limit: 10 }));
  say(`mcp grove_read ok (${String(read).replace(/\n/g, ' | ').slice(0, 200)})`);
  say(`helper says: ${/Done: (.*)/.exec(String(read))?.[1] ?? 'nothing yet'}`);
}

async function run(line) {
  if (line === 'crash') {
    stdout.write('crashing…\n');
    process.exit(3);
  }
  if (line === 'uptime') {
    say(`up ${Math.round((Date.now() - startedAt) / 1000)}s`);
    return;
  }
  if (line === 'ask') {
    stdout.write('Allow edit to src/App.tsx? (y/n) ');
    return;
  }
  if (line.startsWith('stream')) {
    const n = Number(line.split(' ')[1] ?? 3) || 3;
    let i = 0;
    timer = setInterval(() => {
      i += 1;
      say(`line ${i}`);
      if (i >= n) {
        clearInterval(timer);
        timer = null;
      }
    }, 30);
    return;
  }
  if (line.startsWith('echo ')) {
    say(line.slice('echo '.length));
    return;
  }
  if (line === 'mcp list') {
    await mcp();
    const result = await mcpCall('tools/list', {});
    const names = (result?.tools ?? []).map((t) => t.name).join(', ');
    say(`mcp tools from arbora-browser: ${names}`);
    return;
  }
  if (line.startsWith('mcp ')) {
    const rest = line.slice('mcp '.length);
    const space = rest.indexOf(' ');
    const name = space === -1 ? rest : rest.slice(0, space);
    const argsText = space === -1 ? '{}' : rest.slice(space + 1);
    try {
      const text = await withKeepalive(tool(name, JSON.parse(argsText)));
      say(`mcp ${name} ok: ${String(text).split('\n')[0]?.slice(0, 160)}`);
    } catch (error) {
      say(`mcp ${name} failed: ${error.message}`);
    }
    return;
  }
  if (line.startsWith('tabs ')) {
    await tabsCheck(line.slice('tabs '.length).trim());
    return;
  }
  if (line === 'browser check') {
    await browserCheck();
    return;
  }
  if (line === 'grove delegate') {
    await groveDelegate();
    return;
  }
  if (line.startsWith('edit ')) {
    const path = line.slice('edit '.length).trim();
    appendFileSync(path, '// Arbora fake agent was here\n');
    say(`edited ${path}`);
    return;
  }
  if (line === 'hello') {
    say(`hello from the fake agent (up ${Math.round((Date.now() - startedAt) / 1000)}s)`);
    return;
  }
  say(`Done: ${line}`);
}

// --- Input engine: raw mode, bracketed paste, Ctrl+C ---------------------------------------------
function interrupt() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  say('^C interrupted');
}

async function submit(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  if (lines.length > 1) {
    say(`Received: ${lines[0] ?? ''} (${lines.length} lines)`);
    if (process.env.FAKE_TERMINAL_ECHO === '1') for (const line of lines) say(`| ${line}`);
  }
  if (lines[lines.length - 1] === 'run all') {
    for (const line of lines.slice(0, -1)) {
      try {
        await run(line);
      } catch (error) {
        say(`error: ${error.message}`);
      }
    }
    return;
  }
  try {
    await run(lines[lines.length - 1] ?? '');
  } catch (error) {
    say(`error: ${error.message}`);
  }
}

stdin.on('data', (chunk) => {
  for (const ch of chunk) {
    if (inPaste) {
      buffer += ch;
      if (buffer.endsWith('\u001b[201~')) {
        inPaste = false;
        const text = buffer.slice(0, -6);
        buffer = '';
        void submit(text);
      }
      continue;
    }
    if (ch === '\u0003') {
      interrupt();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      const line = buffer;
      buffer = '';
      if (line.trim()) void submit(line);
      continue;
    }
    buffer += ch;
    if (buffer.endsWith('\u001b[200~')) {
      buffer = buffer.slice(0, -6);
      inPaste = true;
      if (buffer.trim()) void submit(buffer);
      buffer = '';
    }
  }
});
