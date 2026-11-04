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
      readonly kind: 'recent';
      readonly path: string;
      readonly parentId: string;
      readonly expanded: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'action';
      readonly action: SidebarAction;
      readonly path: string;
      readonly parentId: string;
    };

export type SidebarAction = 'new-agent' | 'new-terminal' | 'show-all-recent';

export interface SidebarNavLeaf {
  readonly kind: 'agent' | 'terminal' | 'command' | 'action';
  readonly id: string;
  readonly action?: SidebarAction;
}

export interface SidebarRecentNav {
  /** The header is listed. Children appear only while `expanded` is true. */
  readonly present: boolean;
  readonly expanded: boolean;
  readonly visibleIds: readonly string[];
  readonly showAll: boolean;
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

export function actionNavId(path: string, action: SidebarAction): string {
  return `action:${path}:${action}`;
}

export function recentNavId(path: string): string {
  return `recent:${path}`;
}

export function inboxNavId(path: string, threadId: string): string {
  return `inbox:${path}:${threadId}`;
}

export function buildSidebarNav(input: {
  readonly inbox: readonly { threadId: string; path: string }[];
  readonly projects: readonly {
    path: string;
    expanded: boolean;
    sections: readonly {
      section: SideSectionName;
      expanded: boolean;
      leaves: readonly SidebarNavLeaf[];
      recent?: SidebarRecentNav;
    }[];
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
      if (section.recent?.present) rows.push(...recentRows(project.path, parentId, section.recent));
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

function recentRows(path: string, parentId: string, recent: SidebarRecentNav): SidebarNavRow[] {
  const id = recentNavId(path);
  const rows: SidebarNavRow[] = [{ id, kind: 'recent', path, parentId, expanded: recent.expanded }];
  if (!recent.expanded) return rows;
  for (const threadId of recent.visibleIds) {
    rows.push({ id: agentNavId(threadId), kind: 'agent', threadId, path, parentId: id });
  }
  if (recent.showAll) {
    rows.push({
      id: actionNavId(path, 'show-all-recent'),
      kind: 'action',
      action: 'show-all-recent',
      path,
      parentId: id,
    });
  }
  return rows;
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
 * Right expands a collapsed category (project, Agents, Terminals, Commands, Recent).
 * Left collapses an open one, or moves to its parent when it is already closed.
 * On a leaf, Left moves to that row's category header and Right does nothing.
 */
export function sidebarHorizontal(
  rows: readonly SidebarNavRow[],
  id: string | null,
  direction: 'left' | 'right',
): SidebarHorizontal {
  const row = rows.find((item) => item.id === id);
  if (!row) return { type: 'none' };
  if (row.kind === 'project' || row.kind === 'section' || row.kind === 'recent') {
    if (direction === 'right') return row.expanded ? { type: 'none' } : { type: 'expand', id: row.id };
    if (row.expanded) return { type: 'collapse', id: row.id };
    const parent = categoryParent(row);
    return parent ? { type: 'focus', id: parent } : { type: 'none' };
  }
  const parentId = parentOf(row);
  if (direction === 'left' && parentId) return { type: 'focus', id: parentId };
  return { type: 'none' };
}

export type SidebarEnter =
  | { readonly type: 'focus-agent'; readonly threadId: string }
  | { readonly type: 'focus-terminal'; readonly path: string; readonly terminalId: string }
  | { readonly type: 'run-command'; readonly path: string; readonly commandId: string }
  | { readonly type: 'focus-project'; readonly path: string }
  | { readonly type: 'toggle-section'; readonly path: string; readonly section: SideSectionName }
  | { readonly type: 'toggle-recent' }
  | { readonly type: 'new-agent'; readonly path: string }
  | { readonly type: 'new-terminal'; readonly path: string }
  | { readonly type: 'show-all-recent' }
  | { readonly type: 'open-inbox'; readonly path: string; readonly threadId: string };

/** Enter on the highlighted row: open the agent or terminal, or run the command. */
export function sidebarEnter(row: SidebarNavRow): SidebarEnter {
  switch (row.kind) {
    case 'agent':
      return { type: 'focus-agent', threadId: row.threadId };
    case 'terminal':
      return { type: 'focus-terminal', path: row.path, terminalId: row.terminalId };
    case 'command':
      return { type: 'run-command', path: row.path, commandId: row.commandId };
    case 'project':
      return { type: 'focus-project', path: row.path };
    case 'section':
      return { type: 'toggle-section', path: row.path, section: row.section };
    case 'recent':
      return { type: 'toggle-recent' };
    case 'action':
      return actionEnter(row.action, row.path);
    case 'inbox':
      return { type: 'open-inbox', path: row.path, threadId: row.threadId };
    default: {
      const unreachable: never = row;
      return unreachable;
    }
  }
}

function actionEnter(action: SidebarAction, path: string): SidebarEnter {
  switch (action) {
    case 'new-agent':
      return { type: 'new-agent', path };
    case 'new-terminal':
      return { type: 'new-terminal', path };
    case 'show-all-recent':
      return { type: 'show-all-recent' };
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function categoryParent(row: SidebarNavRow): string | undefined {
  switch (row.kind) {
    case 'section':
      return projectNavId(row.path);
    case 'recent':
      return row.parentId;
    case 'inbox':
    case 'project':
    case 'agent':
    case 'terminal':
    case 'command':
    case 'action':
      return undefined;
    default: {
      const unreachable: never = row;
      return unreachable;
    }
  }
}

function parentOf(row: SidebarNavRow): string | undefined {
  switch (row.kind) {
    case 'agent':
    case 'terminal':
    case 'command':
    case 'action':
    case 'recent':
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
