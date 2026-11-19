import { describe, expect, it } from 'vitest';
import { DEFAULT_THREAD_TITLE, idleThreadState, type AgentGroup, type ThreadState } from './agent.js';
import { NO_ATTENTION, type ThreadAttention } from './attention.js';
import {
  activityLine,
  deriveSessionStatus,
  displayNames,
  formatElapsed,
  groveRows,
  groveSummary,
  cycleListedProject,
  groveWebsiteAction,
  isSettledStatus,
  overlaps,
  shouldStartDefaultSession,
  taskTitle,
  terminalLines,
  visibleRows,
} from './grove.js';

const attention = (patch: Partial<ThreadAttention>): ThreadAttention => ({ ...NO_ATTENTION, ...patch });

function state(patch: Partial<ThreadState>): ThreadState {
  return { ...idleThreadState(), ...patch };
}

describe('deriveSessionStatus', () => {
  it('puts a wait on the user first, then failures, then what the process does', () => {
    expect(deriveSessionStatus('working', attention({ waiting: 'Allow?' }))).toBe('needsYou');
    expect(deriveSessionStatus('needs_input', undefined)).toBe('needsYou');
    expect(deriveSessionStatus('error', undefined)).toBe('failed');
    expect(deriveSessionStatus('ready', attention({ unread: 'failed' }))).toBe('failed');
    expect(deriveSessionStatus('working', undefined)).toBe('working');
    expect(deriveSessionStatus('starting', undefined)).toBe('starting');
    expect(deriveSessionStatus('ready', attention({ unread: 'finished' }))).toBe('done');
    expect(deriveSessionStatus('ready', NO_ATTENTION)).toBe('idle');
    expect(deriveSessionStatus('idle', undefined)).toBe('stopped');
  });

  it('keeps an unread finish as Done after the process is gone', () => {
    expect(deriveSessionStatus('idle', attention({ unread: 'finished' }))).toBe('done');
  });

  it('settles on everything but working and starting', () => {
    expect(isSettledStatus('working')).toBe(false);
    expect(isSettledStatus('starting')).toBe(false);
    for (const status of ['needsYou', 'failed', 'done', 'idle', 'stopped'] as const) {
      expect(isSettledStatus(status)).toBe(true);
    }
  });
});

describe('shouldStartDefaultSession', () => {
  const ok = {
    sessionCount: 0,
    defaultAgentId: 'claude-code',
    defaultAgentDetected: true,
    startDefaultOnOpen: true,
    alreadyTriedThisVisit: false,
  };

  it('starts only when every condition holds', () => {
    expect(shouldStartDefaultSession(ok)).toBe(true);
    expect(shouldStartDefaultSession({ ...ok, sessionCount: 1 })).toBe(false);
    expect(shouldStartDefaultSession({ ...ok, defaultAgentId: null })).toBe(false);
    expect(shouldStartDefaultSession({ ...ok, defaultAgentDetected: false })).toBe(false);
    expect(shouldStartDefaultSession({ ...ok, startDefaultOnOpen: false })).toBe(false);
    expect(shouldStartDefaultSession({ ...ok, alreadyTriedThisVisit: true })).toBe(false);
  });
});

describe('displayNames', () => {
  const t = (
    tid: string,
    agentId: string,
    createdAt: number,
    title = DEFAULT_THREAD_TITLE,
    archivedAt: number | null = null,
  ) => ({
    id: tid,
    agentId,
    title,
    createdAt,
    archivedAt,
  });
  const name = (agentId: string): string => ({ claude: 'Claude Code', codex: 'Codex' })[agentId] ?? agentId;

  it('uses titles, else the agent name numbered by creation order', () => {
    const names = displayNames(
      [
        t('c', 'claude', 3),
        t('a', 'claude', 1),
        t('x', 'codex', 2),
        t('b', 'claude', 2, 'fix the nav'),
        t('d', 'claude', 4),
      ],
      name,
    );
    expect(Object.fromEntries(names)).toEqual({
      a: 'Claude Code',
      b: 'fix the nav',
      c: 'Claude Code 2',
      d: 'Claude Code 3',
      x: 'Codex',
    });
  });

  it('numbers archived sessions apart from listed ones', () => {
    const names = displayNames([t('a', 'claude', 1, DEFAULT_THREAD_TITLE, 5), t('b', 'claude', 2)], name);
    expect(names.get('a')).toBe('Claude Code');
    expect(names.get('b')).toBe('Claude Code');
  });
});

describe('taskTitle', () => {
  it('takes the first non-empty line, trimmed and capped', () => {
    expect(taskTitle('\n  fix the nav  \nthen run tests')).toBe('fix the nav');
    expect(taskTitle('   \n ')).toBeNull();
    expect(taskTitle('x'.repeat(100))).toHaveLength(60);
  });
});

describe('groveRows', () => {
  const groups: AgentGroup[] = [{ id: 'ui', name: 'UI', color: 'blue', collapsed: false }];
  const s = (
    tid: string,
    createdAt: number,
    patch: Partial<{
      parentThreadId: string | null;
      groupId: string | null;
      pinned: boolean;
      archivedAt: number | null;
    }> = {},
  ) => ({ id: tid, createdAt, parentThreadId: null, groupId: null, pinned: false, archivedAt: null, ...patch });

  it('keeps creation order inside sections and nests helpers under their lead', () => {
    const sections = groveRows(
      [
        s('late', 9),
        s('helper2', 6, { parentThreadId: 'lead' }),
        s('lead', 2),
        s('helper1', 4, { parentThreadId: 'lead' }),
        s('first', 1),
        s('archived', 0, { archivedAt: 10 }),
        s('pinned', 8, { pinned: true }),
        s('ui', 7, { groupId: 'ui' }),
      ],
      groups,
    );
    expect(sections.map((x) => [x.id, x.rows.map((r) => `${r.helper ? '↳' : ''}${r.thread.id}`)])).toEqual([
      ['pinned', ['pinned']],
      ['group:ui', ['ui']],
      ['threads', ['first', 'lead', '↳helper1', '↳helper2', 'late']],
    ]);
  });

  it('lists a helper on its own when its lead is archived or gone', () => {
    const sections = groveRows(
      [
        s('lead', 1, { archivedAt: 5 }),
        s('helper', 2, { parentThreadId: 'lead' }),
        s('orphan', 3, { parentThreadId: 'gone' }),
      ],
      [],
    );
    expect(sections.flatMap((x) => x.rows.map((r) => [r.thread.id, r.helper]))).toEqual([
      ['helper', false],
      ['orphan', false],
    ]);
  });

  it('survives a loop of leads', () => {
    const sections = groveRows([s('a', 1, { parentThreadId: 'b' }), s('b', 2, { parentThreadId: 'a' })], []);
    expect(sections.flatMap((x) => x.rows.map((r) => r.thread.id)).sort()).toEqual(['a', 'b']);
  });

  it('walks visible rows in screen order and skips collapsed groups', () => {
    const collapsed: AgentGroup[] = [{ id: 'ui', name: 'UI', color: 'blue', collapsed: true }];
    const sections = groveRows([s('a', 1), s('b', 2, { groupId: 'ui' }), s('c', 3, { pinned: true })], collapsed);
    expect(visibleRows(sections).map((t) => t.id)).toEqual(['c', 'a']);
  });
});

describe('groveSummary', () => {
  it('counts working, waiting and failed sessions', () => {
    expect(groveSummary(['working', 'starting', 'needsYou', 'idle'])).toBe('2 working · 1 needs you');
    expect(groveSummary(['failed'])).toBe('1 failed');
    expect(groveSummary(['idle', 'done', 'stopped'])).toBe('');
  });
});

describe('activityLine', () => {
  it('writes line two from the terminal state and the attention', () => {
    expect(activityLine('working', state({ lastLine: 'Running pnpm test…' }), undefined)).toBe('Running pnpm test…');
    expect(activityLine('working', state({}), undefined)).toBe('Working…');
    expect(activityLine('needsYou', state({ lastLine: 'Allow edit to src/App.tsx? (y/n)' }), undefined)).toBe(
      'Allow edit to src/App.tsx? (y/n)',
    );
    expect(activityLine('needsYou', state({}), attention({ waiting: 'Proceed? (y/n)' }))).toBe('Proceed? (y/n)');
    expect(activityLine('starting', state({}), undefined)).toBe('Starting…');
    expect(activityLine('done', state({ lastLine: 'All set' }), undefined)).toBe('All set');
    expect(activityLine('idle', state({}), undefined)).toBe('Idle');
    expect(activityLine('failed', state({}), attention({ failure: 'exit 1' }))).toBe('exit 1');
    expect(activityLine('failed', state({ error: 'spawn failed' }), undefined)).toBe('spawn failed');
    expect(activityLine('stopped', state({}), undefined)).toBe('Stopped');
  });
});

describe('overlaps', () => {
  it('flags files two live sessions edited, naming the other session', () => {
    const result = overlaps({ a: ['/p/x.ts', '/p/y.ts'], b: ['/p/x.ts'], c: ['/p/y.ts'] }, new Set(['a', 'b']));
    expect(result.get('a')).toEqual([{ path: '/p/x.ts', otherThreadId: 'b' }]);
    expect(result.get('b')).toEqual([{ path: '/p/x.ts', otherThreadId: 'a' }]);
    expect(result.has('c')).toBe(false);
  });
});

describe('terminalLines', () => {
  it('tails the terminal and repeats the question when it waits for the user', () => {
    const lines = ['banner', 'Working…', 'Done: hello from the helper'];
    expect(terminalLines(state({ status: 'ready' }), lines, 2)).toEqual(['Working…', 'Done: hello from the helper']);
    const waiting = terminalLines(state({ status: 'needs_input', lastLine: 'Proceed? (y/n)' }), ['banner'], 5);
    expect(waiting).toEqual(['banner', 'Proceed? (y/n)']);
  });

  it('clips very long lines', () => {
    const long = 'x'.repeat(5000);
    expect(terminalLines(state({}), [long], 5)[0]).toHaveLength(4001);
  });
});

describe('groveWebsiteAction', () => {
  it('switches to the browser workspace, opens that project, and navigates to the url', () => {
    expect(groveWebsiteAction({ workspace: 'grove', projectPath: '/app', url: 'http://localhost:3000/' })).toEqual({
      switchWorkspace: 'browser',
      openProject: '/app',
      navigate: 'http://localhost:3000/',
    });
  });

  it('keeps the window project when the terminal has no project path', () => {
    expect(groveWebsiteAction({ workspace: 'grove', projectPath: null, url: 'http://localhost:3000/' })).toEqual({
      switchWorkspace: 'browser',
      openProject: null,
      navigate: 'http://localhost:3000/',
    });
  });

  it('leaves a browser-workspace link on its current path', () => {
    expect(groveWebsiteAction({ workspace: 'browser', projectPath: '/app', url: 'http://localhost:3000/' })).toBeNull();
  });
});

describe('cycleListedProject', () => {
  it('skips the current project, wraps, and does nothing with fewer than two', () => {
    expect(cycleListedProject(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(cycleListedProject(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(cycleListedProject(['a', 'b', 'c'], 'b', -1)).toBe('a');
    expect(cycleListedProject(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(cycleListedProject(['only'], 'only', 1)).toBeNull();
    expect(cycleListedProject([], null, 1)).toBeNull();
  });
});

describe('formatElapsed', () => {
  it('prints seconds, minutes and hours', () => {
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(40_000)).toBe('40s');
    expect(formatElapsed(120_000)).toBe('2m');
    expect(formatElapsed(3_600_000)).toBe('1h');
    expect(formatElapsed(3_900_000)).toBe('1h 5m');
  });
});
