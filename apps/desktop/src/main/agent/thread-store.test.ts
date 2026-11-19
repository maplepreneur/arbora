import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THREAD_FILE_VERSION, type Thread } from '@arbora/shared';
import { ThreadStore, threadsDir } from './thread-store.js';

function thread(patch: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    agentId: 'kimi',
    title: 'fix the nav',
    createdAt: 1,
    updatedAt: 2,
    groupId: null,
    pinned: false,
    archivedAt: null,
    parentThreadId: null,
    state: {
      status: 'idle',
      error: null,
      terminalId: null,
      lastLine: null,
      turnStartedAt: null,
      lastOutputAt: null,
      lastTurnMs: null,
    },
    lastLines: [],
    ...patch,
  };
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'arbora-threads-'));
}

describe('ThreadStore', () => {
  it('saves a v2 file and reloads it stopped, keeping the terminal tail', () => {
    const project = tempProject();
    try {
      const store = new ThreadStore(project);
      store.save(thread({ lastLines: ['banner', 'Done: fixed the nav'] }));
      expect(store.load('t1')).toMatchObject({
        id: 't1',
        title: 'fix the nav',
        lastLines: ['banner', 'Done: fixed the nav'],
        state: { status: 'idle' },
      });
      expect(store.list()[0]).toMatchObject({ id: 't1', title: 'fix the nav' });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('caps the persisted tail at 200 lines', () => {
    const project = tempProject();
    try {
      const store = new ThreadStore(project);
      store.save(thread({ lastLines: Array.from({ length: 260 }, (_, i) => `line ${i}`) }));
      const file = JSON.parse(readFileSync(join(threadsDir(project), 't1.json'), 'utf8')) as {
        version: number;
        lastLines: string[];
      };
      expect(file.version).toBe(THREAD_FILE_VERSION);
      expect(file.lastLines).toHaveLength(200);
      expect(file.lastLines.at(-1)).toBe('line 259');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('migrates a v1 (ACP-era) file: metadata stays, the protocol transcript is dropped', () => {
    const project = tempProject();
    try {
      mkdirSync(join(project, '.arbora', 'threads'), { recursive: true });
      writeFileSync(
        join(threadsDir(project), 'old.json'),
        JSON.stringify({
          version: 1,
          id: 'old',
          agentId: 'claude-code',
          title: 'old work',
          createdAt: 10,
          updatedAt: 20,
          sessionId: 's',
          autoApproveEdits: true,
          groupId: 'ui',
          pinned: true,
          archivedAt: null,
          parentThreadId: null,
          events: [{ id: 'e1', at: 1, kind: 'user_message', blocks: [] }],
        }),
      );
      const store = new ThreadStore(project);
      expect(store.load('old')).toMatchObject({ id: 'old', agentId: 'claude-code', groupId: 'ui', pinned: true });
      expect(store.load('old')?.lastLines).toEqual([]);
      expect(store.load('old')?.state.status).toBe('idle');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('ignores an unreadable file and one that is missing required fields', () => {
    const project = tempProject();
    try {
      mkdirSync(join(project, '.arbora', 'threads'), { recursive: true });
      writeFileSync(join(threadsDir(project), 'bad.json'), '{nope');
      writeFileSync(
        join(threadsDir(project), 'wrong.json'),
        JSON.stringify({ version: 2, id: 'wrong', title: 'x', createdAt: 1, updatedAt: 1, lastLines: [] }),
      );
      const store = new ThreadStore(project);
      expect(store.load('bad')).toBeNull();
      expect(store.load('wrong')).toBeNull();
      expect(store.list()).toHaveLength(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
