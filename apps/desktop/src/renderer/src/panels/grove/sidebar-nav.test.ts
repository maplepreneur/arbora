import { describe, expect, it } from 'vitest';
import {
  actionNavId,
  agentNavId,
  buildSidebarNav,
  moveSidebarFocus,
  projectNavId,
  sectionNavId,
  sidebarHorizontal,
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

  it('expands on Left and collapses on Right, and does nothing at the limit', () => {
    const project = projectNavId('/a');
    const closed = sectionNavId('/a', 'terminals');
    expect(sidebarHorizontal(rows, project, 'left')).toEqual({ type: 'none' });
    expect(sidebarHorizontal(rows, project, 'right')).toEqual({ type: 'collapse', id: project });
    expect(sidebarHorizontal(rows, closed, 'right')).toEqual({ type: 'none' });
    expect(sidebarHorizontal(rows, closed, 'left')).toEqual({ type: 'expand', id: closed });
  });

  it('sends Left on a leaf to its category header and ignores Right', () => {
    const agent = agentNavId('t1');
    expect(sidebarHorizontal(rows, agent, 'left')).toEqual({ type: 'focus', id: sectionNavId('/a', 'agents') });
    expect(sidebarHorizontal(rows, agent, 'right')).toEqual({ type: 'none' });
  });
});
