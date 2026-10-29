import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSISTED_TOOL_TEXT_LIMIT, THREAD_FILE_BYTE_LIMIT, type Thread, type ThreadEvent } from '@arbora/shared';
import { capThreadFile, ThreadStore, truncateEventForPersistence } from './thread-store.js';

function thread(events: ThreadEvent[] = []): Thread {
  return {
    id: 't1',
    agentId: 'fake',
    title: 'Hello',
    createdAt: 1,
    updatedAt: 2,
    sessionId: 'fake-1',
    autoApproveEdits: false,
    state: {
      status: 'ready',
      error: null,
      authMethods: [],
      modes: null,
      configOptions: [],
      availableCommands: [],
      capabilities: null,
      contextLost: false,
    },
    events,
  };
}

function message(id: string, text: string): ThreadEvent {
  return { id, at: 1, kind: 'agent_message', blocks: [{ type: 'text', text }] };
}

describe('ThreadStore', () => {
  it('round-trips threads through .arbora/threads and lists them newest first', () => {
    const project = mkdtempSync(join(tmpdir(), 'arbora-threads-'));
    const store = new ThreadStore(project);
    store.save(thread([message('e1', 'hi')]));
    store.save({ ...thread(), id: 't2', updatedAt: 5 });
    expect(readdirSync(join(project, '.arbora', 'threads')).sort()).toEqual(['t1.json', 't2.json']);
    expect(store.list().map((t) => t.id)).toEqual(['t2', 't1']);
    const loaded = store.load('t1');
    expect(loaded?.events).toEqual([message('e1', 'hi')]);
    expect(loaded?.state.status).toBe('idle');
    expect(store.load('missing')).toBeNull();
    store.delete('t1');
    expect(store.list().map((t) => t.id)).toEqual(['t2']);
  });

  it('ignores files that are not valid thread files', () => {
    const project = mkdtempSync(join(tmpdir(), 'arbora-threads-'));
    const store = new ThreadStore(project);
    store.save(thread());
    const file = join(project, '.arbora', 'threads', 'broken.json');
    writeFileSync(file, '{not json');
    expect(store.list().map((t) => t.id)).toEqual(['t1']);
    const raw: unknown = JSON.parse(readFileSync(join(project, '.arbora', 'threads', 't1.json'), 'utf8'));
    expect(raw).toMatchObject({ version: 1 });
  });

  it('truncates long tool content and raw IO before persisting', () => {
    const long = 'x'.repeat(PERSISTED_TOOL_TEXT_LIMIT + 10);
    const event: ThreadEvent = {
      id: 'tool',
      at: 1,
      kind: 'tool_call',
      toolCallId: 'c1',
      title: 'Edit',
      toolKind: 'edit',
      status: 'completed',
      content: [
        { type: 'diff', path: '/p/a.ts', oldText: long, newText: long },
        { type: 'content', content: { type: 'text', text: long } },
      ],
      locations: [],
      rawInput: { text: long },
      rawOutput: long,
    };
    const persisted = truncateEventForPersistence(event);
    if (persisted.kind !== 'tool_call') throw new Error('kind changed');
    const diff = persisted.content[0];
    expect(diff?.type === 'diff' && diff.newText.length).toBeLessThanOrEqual(PERSISTED_TOOL_TEXT_LIMIT + 20);
    expect(diff?.type === 'diff' && diff.newText.endsWith('…[truncated]')).toBe(true);
    expect(JSON.stringify(persisted.rawInput).length).toBeLessThan(PERSISTED_TOOL_TEXT_LIMIT + 100);
    expect(typeof persisted.rawOutput).toBe('string');
    expect(message('m', 'short')).toEqual(truncateEventForPersistence(message('m', 'short')));
  });

  it('drops the oldest events to stay under the file byte limit', () => {
    const big = 'y'.repeat(THREAD_FILE_BYTE_LIMIT / 4);
    const events = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => message(id, big));
    const file = capThreadFile(thread(events));
    expect(JSON.stringify(file).length).toBeLessThanOrEqual(THREAD_FILE_BYTE_LIMIT);
    expect(file.events.length).toBeGreaterThan(0);
    expect(file.events.length).toBeLessThan(events.length);
    expect(file.events[file.events.length - 1]?.id).toBe('f');
  });
});
