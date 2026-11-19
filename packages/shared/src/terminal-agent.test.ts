import { describe, expect, it } from 'vitest';
import type { CustomAgent } from './agent.js';
import {
  BracketedPasteTracker,
  BUILT_IN_AGENTS,
  builtInAgent,
  encodeTerminalPrompt,
  firstPromptPreface,
  looksLikeInputRequest,
  AgentRegistry,
  toPosixPath,
} from './terminal-agent.js';

describe('looksLikeInputRequest', () => {
  it('spots yes/no, allow and login prompts on the last line', () => {
    expect(looksLikeInputRequest(['working…', 'Edit src/App.tsx? (y/n)'])).toBe(true);
    expect(looksLikeInputRequest(['working…', 'Edit src/App.tsx? [y/N]'])).toBe(true);
    expect(looksLikeInputRequest(['Do you want to proceed?'])).toBe(true);
    expect(looksLikeInputRequest(['Allow this command?'])).toBe(true);
    expect(looksLikeInputRequest(['Please log in first: run `kimi login`, then continue?'])).toBe(true);
    expect(looksLikeInputRequest(['Enter your password:'])).toBe(true);
    expect(looksLikeInputRequest(['Press Enter to continue'])).toBe(true);
  });

  it('spots a numbered choice list', () => {
    expect(looksLikeInputRequest(['1. Yes, allow always', '2. No, deny'])).toBe(true);
  });

  it('ignores ordinary output, even when it mentions questions', () => {
    expect(looksLikeInputRequest(['Running pnpm test…', '3 passed'])).toBe(false);
    expect(looksLikeInputRequest([])).toBe(false);
    expect(looksLikeInputRequest(['the user asked: should we proceed? Not yet.'])).toBe(false);
  });

  it('works on raw ANSI output', () => {
    expect(looksLikeInputRequest(['\u001b[1mEdit src/App.tsx?\u001b[0m (y/n)'])).toBe(true);
  });
});

describe('BracketedPasteTracker + encodeTerminalPrompt', () => {
  it('tracks the terminal turning bracketed paste on and off', () => {
    const tracker = new BracketedPasteTracker();
    expect(tracker.push('banner\r\n')).toBe(true); // not announced yet: assumed on
    expect(tracker.push('\u001b[?2004h')).toBe(true);
    expect(tracker.value).toBe(true);
    expect(tracker.push('\u001b[?2004l')).toBe(false);
    expect(tracker.value).toBe(false);
  });

  it('a CLI that announced nothing gets the paste treatment', () => {
    const tracker = new BracketedPasteTracker();
    expect(tracker.value).toBe(true);
    expect(tracker.push('\u001b[?2004l')).toBe(false);
    expect(tracker.value).toBe(false);
  });

  it('sends a single-line prompt as itself plus Enter', () => {
    expect(encodeTerminalPrompt('fix the nav', false)).toBe('fix the nav\n\r');
  });

  it('wraps a multi-line prompt in bracketed paste when the terminal asked for it', () => {
    expect(encodeTerminalPrompt('line one\nline two', true)).toBe('\u001b[200~line one\nline two\u001b[201~\r');
  });

  it('falls back to raw lines when the terminal cannot bracket a paste', () => {
    expect(encodeTerminalPrompt('line one\nline two', false)).toBe('line one\nline two\n\r');
  });

  it('refuses to send an empty prompt', () => {
    expect(encodeTerminalPrompt('  \n ', true)).toBe('');
  });
});

describe('AgentRegistry', () => {
  const custom = (): CustomAgent[] => [
    { id: 'fake', name: 'Fake agent', command: 'node', args: [], env: {}, probe: [], task: [] },
  ];

  it('lists the built-ins as bare CLIs with probe and task args', () => {
    const claude = BUILT_IN_AGENTS.find((a) => a.id === 'claude-code');
    expect(claude).toMatchObject({ command: 'claude', args: [], probe: ['--version'], task: ['-p'] });
    const codex = BUILT_IN_AGENTS.find((a) => a.id === 'codex');
    expect(codex).toMatchObject({ command: 'codex', task: ['exec'] });
    const kimi = BUILT_IN_AGENTS.find((a) => a.id === 'kimi');
    expect(kimi).toMatchObject({ command: 'kimi', task: [] });
  });

  it('layers custom agents and env overrides over the built-ins', () => {
    const registry = new AgentRegistry(custom, () => ({ env: { kimi: { LOG: 'debug' } } }));
    expect(registry.get('fake')).toMatchObject({ builtIn: false, command: 'node', probe: [], task: [] });
    expect(registry.get('kimi')?.env).toEqual({ LOG: 'debug' });
    expect(registry.builtIn('kimi')?.env).toEqual({});
  });

  it('detects which commands resolve', () => {
    const registry = new AgentRegistry(custom);
    const availability = registry.detect((command) => (command === 'node' ? '/usr/bin/node' : undefined));
    expect(availability.find((a) => a.id === 'fake')).toEqual({
      id: 'fake',
      available: true,
      resolvedCommand: '/usr/bin/node',
    });
    expect(availability.find((a) => a.id === 'claude-code')?.available).toBe(false);
  });

  it('defaults probe args for custom agents that do not say', () => {
    const registry = new AgentRegistry(() => [{ id: 'mine', name: 'Mine', command: 'mine', args: [], env: {} }]);
    expect(registry.get('mine')).toMatchObject({ probe: ['--version'], task: [] });
  });
});

describe('builtInAgent', () => {
  it('fills args, env, probe and task from their defaults', () => {
    expect(builtInAgent({ id: 'x', name: 'X', command: 'x', installHint: 'hint' })).toMatchObject({
      args: [],
      env: {},
      probe: ['--version'],
      task: [],
      builtIn: true,
    });
  });
});

describe('firstPromptPreface', () => {
  it('names the project, the dev url and the verify loop', () => {
    const text = firstPromptPreface({
      projectPath: '/home/u/app',
      devUrl: 'http://localhost:5173/',
      browserTools: true,
      groveTools: false,
    });
    expect(text).toContain('You are working inside Arbora');
    expect(text).toContain('/home/u/app');
    expect(text).toContain('http://localhost:5173/');
    expect(text).toContain('ARBORA_MCP_URL');
    expect(text).toContain('browser_wait_for');
    expect(text).not.toContain('grove_start_agent');
  });

  it('adds the Grove tools only for a lead', () => {
    const text = firstPromptPreface({
      projectPath: '/p',
      devUrl: null,
      browserTools: true,
      groveTools: true,
    });
    expect(text).toContain('grove_start_agent');
    expect(text).toContain('No dev server is running yet');
  });
});

describe('toPosixPath', () => {
  it('converts windows separators', () => {
    expect(toPosixPath('C:\\Users\\u\\app')).toBe('C:/Users/u/app');
  });
});
