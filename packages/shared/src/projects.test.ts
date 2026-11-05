import { describe, expect, it } from 'vitest';
import {
  applyProjectMeta,
  buildProjectLibrary,
  folderName,
  groveProjectSections,
  newGroupId,
  projectSections,
} from './projects.js';
import { defaultSettings } from './settings.js';

function settings() {
  return {
    ...defaultSettings(),
    recentProjects: [
      { path: '/code/shop', name: 'shop', openedAt: 30 },
      { path: '/code/blog', name: 'blog', openedAt: 20 },
    ],
    projectGroups: [{ id: 'work', name: 'Work', color: 'blue' as const, collapsed: false }],
    projects: {
      '/code/old-client': { groupId: 'work', openedAt: 5 },
      '/code/blog': { pinned: true, alias: 'My blog' },
      '/code/layout-only': {},
      '/code/ghost': { groupId: 'deleted' },
    },
  };
}

describe('buildProjectLibrary', () => {
  it('lists recents plus pinned and grouped projects, newest first', () => {
    const library = buildProjectLibrary(settings(), new Map([['/code/shop', 2]]));
    expect(library.entries.map((e) => e.path)).toEqual(['/code/shop', '/code/blog', '/code/old-client']);
    const shop = library.entries[0];
    expect(shop).toMatchObject({ open: true, attention: 2, recent: true, name: 'shop' });
    expect(library.entries[1]).toMatchObject({ name: 'My blog', alias: 'My blog', pinned: true });
    expect(library.entries[2]).toMatchObject({ groupId: 'work', recent: false, folder: 'old-client' });
  });

  it('includes a project that is open but not recent', () => {
    const library = buildProjectLibrary(settings(), new Map([['/tmp/scratch', 0]]));
    expect(library.entries.some((e) => e.path === '/tmp/scratch' && e.open)).toBe(true);
  });
});

describe('projectSections', () => {
  it('orders Pinned, groups, then Recent and filters by query', () => {
    const library = buildProjectLibrary(settings());
    expect(projectSections(library).map((s) => [s.id, s.entries.map((e) => e.path)])).toEqual([
      ['pinned', ['/code/blog']],
      ['group:work', ['/code/old-client']],
      ['recent', ['/code/shop']],
    ]);
    expect(projectSections(library, 'blog').map((s) => s.id)).toEqual(['pinned']);
  });

  it('keeps empty groups so projects can be moved into them', () => {
    const library = buildProjectLibrary({ ...settings(), projects: {} });
    expect(projectSections(library).find((s) => s.id === 'group:work')?.entries).toEqual([]);
  });
});

describe('applyProjectMeta', () => {
  it('sets and clears fields without touching layout state', () => {
    const layout = {
      groups: {},
      sidebarView: 'files' as const,
      bottomTab: 'terminal' as const,
      workspace: 'browser' as const,
      rightView: 'browser' as const,
      rightPanels: [],
      contentHidden: false,
      groveThreadId: null,
    };
    const next = applyProjectMeta({ layout, alias: 'x' }, { pinned: true, groupId: 'work', alias: null });
    expect(next).toEqual({ layout, pinned: true, groupId: 'work' });
    expect(applyProjectMeta(next, { pinned: false, groupId: null })).toEqual({ layout });
  });
});

describe('groveProjectSections', () => {
  const groups = [
    { id: 'work', name: 'Work', color: 'blue' as const, collapsed: false },
    { id: 'client', name: 'Client', color: 'pink' as const, collapsed: true },
  ];

  it('stays a flat list when nothing is grouped', () => {
    expect(groveProjectSections(['/a', '/b'], groups, {})).toEqual([
      { id: 'all', title: null, color: null, collapsed: false, paths: ['/a', '/b'] },
    ]);
  });

  it('sections by the existing groups and leaves unknown ids ungrouped', () => {
    const sections = groveProjectSections(['/a', '/b', '/c'], groups, {
      '/a': { groupId: 'client' },
      '/b': { groupId: 'missing' },
      '/c': { groupId: 'work' },
    });
    expect(sections.map((section) => [section.id, section.collapsed, section.paths])).toEqual([
      ['work', false, ['/c']],
      ['client', true, ['/a']],
      ['ungrouped', false, ['/b']],
    ]);
  });
});

describe('helpers', () => {
  it('derives readable unique group ids', () => {
    expect(newGroupId('Client X!', [])).toBe('client-x');
    expect(newGroupId('Work', [{ id: 'work' }, { id: 'work-2' }])).toBe('work-3');
    expect(newGroupId('???', [])).toBe('group');
  });

  it('takes the folder name on both separators', () => {
    expect(folderName('/a/b/shop/')).toBe('shop');
    expect(folderName('C:\\code\\site')).toBe('site');
  });
});
