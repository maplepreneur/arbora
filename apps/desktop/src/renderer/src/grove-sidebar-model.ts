import {
  groveInbox,
  type AgentDefinition,
  type AgentGroup,
  type GroveInboxItem,
  type InboxReason,
  type SessionStatus,
  type ThreadAttention,
  type ThreadEvent,
  type ThreadSummary,
} from '@arbora/shared';
import { buildGroveModel, type GroveModel, type GroveSession } from './grove-model';

export interface SidebarProjectInput {
  readonly path: string;
  readonly threads: readonly ThreadSummary[];
  readonly groups: readonly AgentGroup[];
  readonly events: Readonly<Record<string, readonly ThreadEvent[]>>;
}

export interface SidebarAgent {
  readonly id: string;
  readonly projectPath: string;
  readonly session: GroveSession;
  readonly helper: boolean;
}

export interface SidebarInboxRow extends GroveInboxItem {
  readonly name: string;
  readonly projectName: string;
  readonly status: SessionStatus;
}

export interface GroveSidebarModel {
  /** Needs-input and just-finished agents from every project, including collapsed ones. */
  readonly inbox: readonly SidebarInboxRow[];
  /** Unarchived agents in sidebar order: expanded projects only, so arrow keys can cross them. */
  readonly order: readonly SidebarAgent[];
  /** Every project's sessions, collapsed or not. Search and the inbox read these. */
  readonly byPath: ReadonlyMap<string, GroveModel>;
  /** Listed agents in every project, for the palette. */
  readonly agents: readonly SidebarAgent[];
  /** Projects in list order, including a lone open project when Grove's list is empty. */
  readonly paths: readonly string[];
}

/**
 * Agents under their project, plus the cross-project inbox. `expandedPaths` is the visual order of
 * projects whose agent rows are on screen. Collapsed projects still contribute to the inbox.
 */
export function buildGroveSidebar(input: {
  readonly projects: readonly SidebarProjectInput[];
  readonly expandedPaths: readonly string[];
  readonly agents: readonly AgentDefinition[];
  readonly attention: Readonly<Record<string, ThreadAttention>>;
  readonly projectName: (path: string) => string;
}): GroveSidebarModel {
  const byPath = new Map<string, GroveModel>();
  for (const project of input.projects) {
    byPath.set(
      project.path,
      buildGroveModel({
        threads: project.threads,
        groups: project.groups,
        agents: input.agents,
        events: project.events,
        attention: input.attention,
      }),
    );
  }
  const rowsOf = (path: string): SidebarAgent[] => {
    const model = byPath.get(path);
    if (!model) return [];
    const helpers = new Set(
      model.sections.flatMap((section) => section.rows.filter((row) => row.helper).map((row) => row.thread.id)),
    );
    return model.order.map((session) => ({
      id: session.id,
      projectPath: path,
      session,
      helper: helpers.has(session.id),
    }));
  };
  const inbox = groveInbox(
    input.projects.flatMap((project) =>
      project.threads.map((thread) => ({
        id: thread.id,
        projectPath: project.path,
        archivedAt: thread.archivedAt,
        parentThreadId: thread.parentThreadId,
        attention: input.attention[thread.id],
      })),
    ),
  ).map((item): SidebarInboxRow => {
    const session = byPath.get(item.projectPath)?.byId.get(item.threadId);
    return {
      ...item,
      name: session?.name ?? item.threadId,
      projectName: input.projectName(item.projectPath),
      status: session?.status ?? statusFor(item.reason),
    };
  });
  return {
    inbox,
    order: input.expandedPaths.flatMap(rowsOf),
    byPath,
    paths: input.projects.map((project) => project.path),
    agents: input.projects.flatMap((project) => {
      const model = byPath.get(project.path);
      if (!model) return [];
      return model.sections.flatMap((section) =>
        section.rows.map((row) => ({
          id: row.thread.id,
          projectPath: project.path,
          session: row.thread,
          helper: row.helper,
        })),
      );
    }),
  };
}

function statusFor(reason: InboxReason): SessionStatus {
  switch (reason) {
    case 'needsInput':
      return 'needsYou';
    case 'finished':
      return 'done';
    case 'failed':
      return 'failed';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
