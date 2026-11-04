export type SideSectionName = 'agents' | 'terminals' | 'commands';

export type SidebarNavRow =
  | { readonly id: string; readonly kind: 'inbox'; readonly threadId: string; readonly path: string }
  | { readonly id: string; readonly kind: 'project'; readonly path: string; readonly expanded: boolean }
  | {
      readonly id: string;
      readonly kind: 'section';
      readonly path: string;
      readonly section: SideSectionName;
      readonly expanded: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'agent';
      readonly threadId: string;
      readonly path: string;
      readonly parentId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'terminal';
      readonly terminalId: string;
      readonly path: string;
      readonly parentId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'command';
      readonly commandId: string;
      readonly path: string;
      readonly parentId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'action';
      readonly action: 'new-agent' | 'new-terminal';
      readonly path: string;
      readonly parentId: string;
    };

export interface SidebarNavLeaf {
  readonly kind: 'agent' | 'terminal' | 'command' | 'action';
  readonly id: string;
  readonly action?: 'new-agent' | 'new-terminal';
}

export function projectNavId(path: string): string {
  return `project:${path}`;
}

export function sectionNavId(path: string, section: SideSectionName): string {
  return `section:${path}:${section}`;
}

export function agentNavId(threadId: string): string {
  return `agent:${threadId}`;
}

export function terminalNavId(terminalId: string): string {
  return `terminal:${terminalId}`;
}

export function commandNavId(path: string, commandId: string): string {
  return `command:${path}:${commandId}`;
}

export function actionNavId(path: string, action: 'new-agent' | 'new-terminal'): string {
  return `action:${path}:${action}`;
}

export function inboxNavId(path: string, threadId: string): string {
  return `inbox:${path}:${threadId}`;
}

export function buildSidebarNav(input: {
  readonly inbox: readonly { threadId: string; path: string }[];
  readonly projects: readonly {
    path: string;
    expanded: boolean;
    sections: readonly { section: SideSectionName; expanded: boolean; leaves: readonly SidebarNavLeaf[] }[];
  }[];
}): SidebarNavRow[] {
  const rows: SidebarNavRow[] = input.inbox.map((row) => ({
    id: inboxNavId(row.path, row.threadId),
    kind: 'inbox',
    threadId: row.threadId,
    path: row.path,
  }));
  for (const project of input.projects) {
    rows.push({ id: projectNavId(project.path), kind: 'project', path: project.path, expanded: project.expanded });
    if (!project.expanded) continue;
    for (const section of project.sections) {
      const parentId = sectionNavId(project.path, section.section);
      rows.push({
        id: parentId,
        kind: 'section',
        path: project.path,
        section: section.section,
        expanded: section.expanded,
      });
      if (!section.expanded) continue;
      for (const leaf of section.leaves) {
        rows.push(leafRow(project.path, parentId, leaf));
      }
    }
  }
  return rows;
}

function leafRow(path: string, parentId: string, leaf: SidebarNavLeaf): SidebarNavRow {
  switch (leaf.kind) {
    case 'agent':
      return { id: agentNavId(leaf.id), kind: 'agent', threadId: leaf.id, path, parentId };
    case 'terminal':
      return { id: terminalNavId(leaf.id), kind: 'terminal', terminalId: leaf.id, path, parentId };
    case 'command':
      return { id: commandNavId(path, leaf.id), kind: 'command', commandId: leaf.id, path, parentId };
    case 'action':
      return {
        id: actionNavId(path, leaf.action ?? 'new-agent'),
        kind: 'action',
        action: leaf.action ?? 'new-agent',
        path,
        parentId,
      };
    default: {
      const unreachable: never = leaf.kind;
      return unreachable;
    }
  }
}

/** Up/Down through the visible rows, wrapping. A missing focus starts at the end the arrow is leaving. */
export function moveSidebarFocus(rows: readonly { id: string }[], id: string | null, delta: 1 | -1): string | null {
  if (rows.length === 0) return null;
  const index = id == null ? -1 : rows.findIndex((row) => row.id === id);
  const start = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return rows[(start + delta + rows.length) % rows.length]?.id ?? null;
}

export type SidebarHorizontal =
  | { readonly type: 'none' }
  | { readonly type: 'focus'; readonly id: string }
  | { readonly type: 'expand'; readonly id: string }
  | { readonly type: 'collapse'; readonly id: string };

/**
 * Left expands a collapsed category and does nothing when it is already open.
 * Right collapses an open category and does nothing when it is already closed.
 * On a leaf, Left moves to that row's category header and Right does nothing.
 */
export function sidebarHorizontal(
  rows: readonly SidebarNavRow[],
  id: string | null,
  direction: 'left' | 'right',
): SidebarHorizontal {
  const row = rows.find((item) => item.id === id);
  if (!row) return { type: 'none' };
  if (row.kind === 'project' || row.kind === 'section') {
    if (direction === 'left') return row.expanded ? { type: 'none' } : { type: 'expand', id: row.id };
    return row.expanded ? { type: 'collapse', id: row.id } : { type: 'none' };
  }
  const parentId = parentOf(row);
  if (direction === 'left' && parentId) return { type: 'focus', id: parentId };
  return { type: 'none' };
}

function parentOf(row: SidebarNavRow): string | undefined {
  switch (row.kind) {
    case 'agent':
    case 'terminal':
    case 'command':
    case 'action':
      return row.parentId;
    case 'inbox':
    case 'project':
    case 'section':
      return undefined;
    default: {
      const unreachable: never = row;
      return unreachable;
    }
  }
}
