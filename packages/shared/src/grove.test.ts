import { describe, expect, it } from 'vitest';
import { DEFAULT_THREAD_TITLE, type AgentGroup, type ThreadEvent } from './agent.js';
import { NO_ATTENTION, type ThreadAttention } from './attention.js';
import {
  activityFromEvents,
  activityLine,
  attentionFromTranscript,
  deriveSessionStatus,
  displayNames,
  formatElapsed,
  groveRows,
  groveSummary,
  isSettledStatus,
  NO_ACTIVITY,
  overlaps,
  reduceActivity,
  shouldStartDefaultSession,
  taskTitle,
  transcriptLines,
  visibleRows,
  workingDetail,
} from './grove.js';

const text = (t: string) => [{ type: 'text' as const, text: t }];
let counter = 0;
const id = (): string => `e${++counter}`;

const user = (at: number, t: string): ThreadEvent => ({ id: id(), at, kind: 'user_message', blocks: text(t) });
const agent = (at: number, t: string): ThreadEvent => ({ id: id(), at, kind: 'agent_message', blocks: text(t) });
const turnEnd = (at: number, stopReason: 'end_turn' | 'cancelled' = 'end_turn'): ThreadEvent => ({
  id: id(),
  at,
  kind: 'turn_end',
  stopReason,
});
const tool = (
  toolCallId: string,
  title: string,
  status: 'pending' | 'in_progress' | 'completed' | 'failed',
  diffs: { path: string; oldText?: string | null; newText: string }[] = [],
): ThreadEvent => ({
  id: id(),
  at: 0,
  kind: 'tool_call',
  toolCallId,
  title,
  toolKind: 'edit',
  status,
  content: diffs.map((d) => ({ type: 'diff' as const, ...d })),
  locations: [],
});
const permission = (requestId: string, title: string, outcome: null | { optionId: string; auto: boolean } = null) =>
  ({
    id: id(),
    at: 0,
    kind: 'permission',
    requestId,
    toolCallId: `tc-${requestId}`,
    title,
    toolKind: 'edit',
    options: [],
    locations: [],
    outcome,
  }) satisfies ThreadEvent;

const attention = (patch: Partial<ThreadAttention>): ThreadAttention => ({ ...NO_ATTENTION, ...patch });

describe('deriveSessionStatus', () => {
  it('puts a wait on the user first, then failures, then what the process does', () => {
    expect(deriveSessionStatus('prompting', attention({ pendingPermissions: ['r'] }))).toBe('needsYou');
    expect(deriveSessionStatus('auth_required', undefined)).toBe('needsYou');
    expect(deriveSessionStatus('error', undefined)).toBe('failed');
    expect(deriveSessionStatus('ready', attention({ unread: 'failed' }))).toBe('failed');
    expect(deriveSessionStatus('prompting', undefined)).toBe('working');
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

describe('attentionFromTranscript', () => {
  it('reads a pending permission, a finished turn and a failure without a renderer', () => {
    const waiting = attentionFromTranscript([user(1, 'go'), permission('r1', 'Edit a.ts')], {
      status: 'prompting',
      error: null,
    });
    expect(deriveSessionStatus('prompting', waiting)).toBe('needsYou');
    const finished = attentionFromTranscript([user(1, 'go'), agent(2, 'hello from the helper'), turnEnd(3)], {
      status: 'ready',
      error: null,
    });
    expect(deriveSessionStatus('ready', finished)).toBe('done');
    expect(finished.lastMessage).toBe('hello from the helper');
    const cancelled = attentionFromTranscript([user(1, 'go'), turnEnd(2, 'cancelled')], {
      status: 'ready',
      error: null,
    });
    expect(deriveSessionStatus('ready', cancelled)).toBe('idle');
    const crashed = attentionFromTranscript([user(1, 'go')], { status: 'error', error: 'exit 1' });
    expect(deriveSessionStatus('error', crashed)).toBe('failed');
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

describe('activity', () => {
  it('follows the running tool, the plan, the last message and the turn timer', () => {
    let activity = reduceActivity(NO_ACTIVITY, user(1000, 'fix the nav'));
    expect(activity.turnStartedAt).toBe(1000);
    activity = reduceActivity(activity, {
      id: id(),
      at: 1001,
      kind: 'plan',
      entries: [
        { content: 'a', priority: 'medium', status: 'completed' },
        { content: 'b', priority: 'medium', status: 'in_progress' },
      ],
    });
    expect(workingDetail(activity)).toBe('Plan 1/2');
    activity = reduceActivity(activity, tool('t1', 'Edit src/Nav.tsx', 'in_progress'));
    expect(workingDetail(activity)).toBe('Edit src/Nav.tsx');
    activity = reduceActivity(activity, tool('t1', 'Edit src/Nav.tsx', 'completed'));
    expect(workingDetail(activity)).toBe('Plan 1/2');
    activity = reduceActivity(activity, agent(1500, '\nDone: the nav wraps now.\nMore detail'));
    activity = reduceActivity(activity, turnEnd(5000));
    expect(activity).toMatchObject({ lastMessage: 'Done: the nav wraps now.', turnStartedAt: null, lastTurnMs: 4000 });
  });

  it('ends the turn on an error too', () => {
    const activity = activityFromEvents([
      user(10, 'go'),
      tool('t', 'Run tests', 'pending'),
      { id: id(), at: 70, kind: 'error', message: 'boom' },
    ]);
    expect(activity).toMatchObject({ turnStartedAt: null, lastTurnMs: 60, runningTools: [] });
  });

  it('keeps the first oldText and the last newText per file', () => {
    const activity = activityFromEvents([
      tool('t1', 'Edit a', 'completed', [{ path: '/p/a.ts', oldText: 'one\n', newText: 'two\n' }]),
      tool('t2', 'Edit a', 'completed', [{ path: '/p/a.ts', oldText: 'two\n', newText: 'three\n' }]),
      tool('t3', 'Create b', 'completed', [{ path: '/p/b.ts', newText: 'new\n' }]),
      // A replaced event (status change) carries the same diff again.
      tool('t3', 'Create b', 'completed', [{ path: '/p/b.ts', newText: 'new\n' }]),
    ]);
    expect(activity.files).toEqual({
      '/p/a.ts': { oldText: 'one\n', newText: 'three\n' },
      '/p/b.ts': { oldText: null, newText: 'new\n' },
    });
    expect(Object.keys(activity.files)).toEqual(['/p/a.ts', '/p/b.ts']);
  });

  it('writes line two for each status', () => {
    const busy = activityFromEvents([user(1, 'go'), tool('t', 'Run pnpm test', 'in_progress')]);
    expect(activityLine('working', busy, undefined, null)).toBe('Run pnpm test');
    expect(activityLine('working', NO_ACTIVITY, undefined, null)).toBe('Thinking…');
    expect(
      activityLine(
        'needsYou',
        NO_ACTIVITY,
        attention({ pendingPermissions: ['r'], permissionTitle: 'Allow edit?' }),
        null,
      ),
    ).toBe('Allow edit?');
    expect(activityLine('needsYou', NO_ACTIVITY, attention({ auth: true }), null)).toBe('Log in');
    const done = activityFromEvents([agent(1, 'All set')]);
    expect(activityLine('done', done, undefined, null)).toBe('All set');
    expect(activityLine('idle', NO_ACTIVITY, undefined, null)).toBe('Idle');
    expect(activityLine('failed', NO_ACTIVITY, attention({ failure: 'exit 1' }), 'other')).toBe('exit 1');
    expect(activityLine('failed', NO_ACTIVITY, undefined, 'spawn failed')).toBe('spawn failed');
    expect(activityLine('stopped', done, undefined, null)).toBe('Stopped');
    expect(activityLine('starting', NO_ACTIVITY, undefined, null)).toBe('Starting…');
  });
});

describe('overlaps', () => {
  it('flags files two live sessions edited, naming the other session', () => {
    const edit = { oldText: 'a', newText: 'b' };
    const result = overlaps(
      { a: { '/p/x.ts': edit, '/p/y.ts': edit }, b: { '/p/x.ts': edit }, c: { '/p/y.ts': edit } },
      new Set(['a', 'b']),
    );
    expect(result.get('a')).toEqual([{ path: '/p/x.ts', otherThreadId: 'b' }]);
    expect(result.get('b')).toEqual([{ path: '/p/x.ts', otherThreadId: 'a' }]);
    expect(result.has('c')).toBe(false);
  });
});

describe('transcriptLines', () => {
  const options = [
    { optionId: 'yes', name: 'Allow', kind: 'allow_once' as const },
    { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
  ];

  it('writes messages, tool titles, permissions and turn ends, and skips thoughts', () => {
    const lines = transcriptLines(
      [
        user(1, 'say hello from the helper'),
        { id: id(), at: 2, kind: 'agent_thought', text: 'thinking hard' },
        {
          id: id(),
          at: 2,
          kind: 'tool_call',
          toolCallId: 't1',
          title: 'Run pnpm test',
          toolKind: 'execute',
          status: 'completed',
          content: [],
          locations: [],
          rawInput: { command: 'pnpm test', env: { TOKEN: 'secret' } },
        },
        { ...permission('r1', 'Edit a.ts'), options, rawInput: { path: '/p/a.ts' } },
        { ...permission('r2', 'Edit b.ts', { optionId: 'yes', auto: false }), options },
        { ...permission('r3', 'Edit c.ts', { optionId: 'no', auto: false }), options },
        { ...permission('r4', 'Edit d.ts'), outcome: 'cancelled' as const },
        agent(3, 'hello from the helper'),
        agent(4, '   '),
        { id: id(), at: 5, kind: 'plan', entries: [{ content: 'a', priority: 'medium', status: 'completed' }] },
        { id: id(), at: 6, kind: 'notice', severity: 'info', title: 'Agent restarted' },
        turnEnd(7),
      ],
      50,
    );
    expect(lines).toEqual([
      'User: say hello from the helper',
      'Tool: Run pnpm test (completed)',
      'Permission: Edit a.ts (waiting for the user)',
      'Permission: Edit b.ts (allowed)',
      'Permission: Edit c.ts (rejected)',
      'Permission: Edit d.ts (withdrawn)',
      'Agent: hello from the helper',
      'Plan: 1 of 1 done',
      'Notice: Agent restarted',
      'Turn ended (end_turn)',
    ]);
    expect(lines.join('\n')).not.toMatch(/secret|pnpm test"|\/p\/a\.ts|thinking/);
  });

  it('keeps the latest lines and clips long messages', () => {
    const events = [user(1, 'one'), agent(2, 'x'.repeat(5000)), user(3, 'two')];
    expect(transcriptLines(events, 1)).toEqual(['User: two']);
    expect(transcriptLines(events, 0)).toEqual(['User: two']);
    expect(transcriptLines(events, 2)[0]).toHaveLength('Agent: '.length + 4000 + 1);
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
