import { describe, expect, it } from 'vitest';
import {
  actionNavId,
  agentNavId,
  buildSidebarNav,
  moveSidebarFocus,
  projectNavId,
  recentNavId,
  sectionNavId,
  sidebarEnter,
  sidebarHorizontal,
  terminalNavId,
} from './sidebar-nav.js';

const rows = buildSidebarNav({
  inbox: [],
  projects: [
    {
      path: '/a',
      expanded: true,
      sections: [
        {
          section: 'agents',
          expanded: true,
          leaves: [
            { kind: 'agent', id: 't1' },
            { kind: 'action', id: 'new', action: 'new-agent' },
          ],
        },
        { section: 'terminals', expanded: false, leaves: [{ kind: 'action', id: 'term', action: 'new-terminal' }] },
      ],
    },
    { path: '/b', expanded: false, sections: [] },
  ],
});

describe('sidebar navigation', () => {
  it('lists visible rows and skips children of a collapsed section or project', () => {
    expect(rows.map((row) => row.id)).toEqual([
      projectNavId('/a'),
      sectionNavId('/a', 'agents'),
      agentNavId('t1'),
      actionNavId('/a', 'new-agent'),
      sectionNavId('/a', 'terminals'),
      projectNavId('/b'),
    ]);
  });

  it('moves up and down through visible rows and wraps', () => {
    const ids = rows.map((row) => row.id);
    expect(moveSidebarFocus(rows, ids[0] ?? null, 1)).toBe(ids[1]);
    expect(moveSidebarFocus(rows, ids[ids.length - 1] ?? null, 1)).toBe(ids[0]);
    expect(moveSidebarFocus(rows, ids[0] ?? null, -1)).toBe(ids[ids.length - 1]);
  });

  it('expands on Right and collapses on Left, and does nothing at the limit', () => {
    const project = projectNavId('/a');
    const closed = sectionNavId('/a', 'terminals');
    expect(sidebarHorizontal(rows, project, 'right')).toEqual({ type: 'none' });
    expect(sidebarHorizontal(rows, project, 'left')).toEqual({ type: 'collapse', id: project });
    expect(sidebarHorizontal(rows, closed, 'left')).toEqual({ type: 'focus', id: projectNavId('/a') });
    expect(sidebarHorizontal(rows, closed, 'right')).toEqual({ type: 'expand', id: closed });
  });

  it('sends Left on a leaf to its category header and ignores Right', () => {
    const agent = agentNavId('t1');
    expect(sidebarHorizontal(rows, agent, 'left')).toEqual({ type: 'focus', id: sectionNavId('/a', 'agents') });
    expect(sidebarHorizontal(rows, agent, 'right')).toEqual({ type: 'none' });
  });

  it('puts Recent after New agent and hides its rows until it is expanded', () => {
    const closed = buildSidebarNav({
      inbox: [],
      projects: [
        {
          path: '/a',
          expanded: true,
          sections: [
            {
              section: 'agents',
              expanded: true,
              leaves: [{ kind: 'action', id: 'new', action: 'new-agent' }],
              recent: { present: true, expanded: false, visibleIds: ['old'], showAll: false },
            },
          ],
        },
      ],
    });
    expect(closed.map((row) => row.id)).toEqual([
      projectNavId('/a'),
      sectionNavId('/a', 'agents'),
      actionNavId('/a', 'new-agent'),
      recentNavId('/a'),
    ]);
    const open = buildSidebarNav({
      inbox: [],
      projects: [
        {
          path: '/a',
          expanded: true,
          sections: [
            {
              section: 'agents',
              expanded: true,
              leaves: [{ kind: 'action', id: 'new', action: 'new-agent' }],
              recent: { present: true, expanded: true, visibleIds: ['old', 'older'], showAll: true },
            },
          ],
        },
      ],
    });
    expect(open.map((row) => row.id)).toEqual([
      projectNavId('/a'),
      sectionNavId('/a', 'agents'),
      actionNavId('/a', 'new-agent'),
      recentNavId('/a'),
      agentNavId('old'),
      agentNavId('older'),
      actionNavId('/a', 'show-all-recent'),
    ]);
    expect(moveSidebarFocus(open, recentNavId('/a'), 1)).toBe(agentNavId('old'));
  });

  it('expands Recent on Right and collapses it on Left', () => {
    const open = buildSidebarNav({
      inbox: [],
      projects: [
        {
          path: '/a',
          expanded: true,
          sections: [
            {
              section: 'agents',
              expanded: true,
              leaves: [],
              recent: { present: true, expanded: false, visibleIds: ['old'], showAll: false },
            },
          ],
        },
      ],
    });
    const recent = recentNavId('/a');
    expect(sidebarHorizontal(open, recent, 'right')).toEqual({ type: 'expand', id: recent });
    expect(sidebarHorizontal(open, recent, 'left')).toEqual({ type: 'focus', id: sectionNavId('/a', 'agents') });
    const expanded = buildSidebarNav({
      inbox: [],
      projects: [
        {
          path: '/a',
          expanded: true,
          sections: [
            {
              section: 'agents',
              expanded: true,
              leaves: [],
              recent: { present: true, expanded: true, visibleIds: ['old'], showAll: false },
            },
          ],
        },
      ],
    });
    expect(sidebarHorizontal(expanded, recent, 'left')).toEqual({ type: 'collapse', id: recent });
    expect(sidebarHorizontal(expanded, agentNavId('old'), 'left')).toEqual({ type: 'focus', id: recent });
  });

  it('Enter focuses an agent or terminal, runs a command, and toggles Recent', () => {
    const listed = buildSidebarNav({
      inbox: [{ threadId: 'need', path: '/a' }],
      projects: [
        {
          path: '/a',
          expanded: true,
          sections: [
            {
              section: 'agents',
              expanded: true,
              leaves: [
                { kind: 'agent', id: 't1' },
                { kind: 'terminal', id: 'pty-agent' },
              ],
              recent: { present: true, expanded: true, visibleIds: ['old'], showAll: false },
            },
            {
              section: 'terminals',
              expanded: true,
              leaves: [
                { kind: 'terminal', id: 'pty' },
                { kind: 'action', id: 'term', action: 'new-terminal' },
              ],
            },
            {
              section: 'commands',
              expanded: true,
              leaves: [{ kind: 'command', id: 'dev' }],
            },
          ],
        },
      ],
    });
    const row = (id: string) => {
      const found = listed.find((item) => item.id === id);
      if (!found) throw new Error(`missing ${id}`);
      return found;
    };
    expect(sidebarEnter(row(agentNavId('t1')))).toEqual({ type: 'focus-agent', threadId: 't1' });
    expect(sidebarEnter(row(agentNavId('old')))).toEqual({ type: 'focus-agent', threadId: 'old' });
    expect(sidebarEnter(row(terminalNavId('pty')))).toEqual({
      type: 'focus-terminal',
      path: '/a',
      terminalId: 'pty',
    });
    expect(sidebarEnter(row(`command:/a:dev`))).toEqual({ type: 'run-command', path: '/a', commandId: 'dev' });
    expect(sidebarEnter(row(recentNavId('/a')))).toEqual({ type: 'toggle-recent' });
    expect(sidebarEnter(row(actionNavId('/a', 'new-terminal')))).toEqual({ type: 'new-terminal', path: '/a' });
    expect(sidebarEnter(row(`inbox:/a:need`))).toEqual({ type: 'open-inbox', path: '/a', threadId: 'need' });
  });
});
