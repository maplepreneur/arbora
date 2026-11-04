import clsx from 'clsx';
import { AppWindow, ChevronDown, Trees, type LucideIcon } from 'lucide-react';
import { CommandId, type ContextMenuItem, type WorkspaceKind } from '@arbora/shared';
import { showBrowserForGroveSelection, showGroveForBrowserProject, useAnySessionWorking } from '../grove-store';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';
import { menuTriggerKeyDown, openTitleBarMenu } from './title-bar-menu';

const SEGMENTS: readonly { kind: WorkspaceKind; label: string; hint: string; icon: LucideIcon }[] = [
  {
    kind: 'browser',
    label: 'Browser',
    hint: 'the page, the editor, the terminal and one docked agent',
    icon: AppWindow,
  },
  {
    kind: 'grove',
    label: 'Grove',
    hint: 'every agent session in this project',
    icon: Trees,
  },
];

function isWorkspaceKind(id: string): id is WorkspaceKind {
  return id === 'browser' || id === 'grove';
}

function segment(kind: WorkspaceKind): (typeof SEGMENTS)[number] {
  const found = SEGMENTS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`Unknown workspace ${kind}`);
  return found;
}

/** Browser / Grove, left of the attention bell. Agents keep running in the workspace that is not showing. */
export function WorkspaceSwitch({ measured = false, collapsed = false }: { measured?: boolean; collapsed?: boolean }) {
  const hasProject = useApp((s) => s.project !== null);
  const workspace = useApp((s) => s.layout.workspace);
  const working = useAnySessionWorking();
  const chord = useChordLabel(CommandId.toggleWorkspace);
  if (!hasProject && workspace !== 'grove') return null;

  const choose = (kind: WorkspaceKind): void => {
    if (kind === workspace) return;
    if (kind === 'browser') void showBrowserForGroveSelection();
    else void showGroveForBrowserProject();
  };

  if (collapsed) {
    const active = segment(workspace);
    const Icon = active.icon;
    const activity = workspace !== 'grove' && working;
    const open = (): void => {
      if (measured) return;
      const items: ContextMenuItem[] = SEGMENTS.filter((segment) => segment.kind !== workspace).map((segment) => ({
        id: segment.kind,
        label: segment.label,
        ...(chord ? { accelerator: chord } : {}),
      }));
      void openTitleBarMenu(items).then((id) => {
        if (id && isWorkspaceKind(id)) choose(id);
      });
    };
    return (
      <div
        role="group"
        aria-label="Workspace"
        data-testid={measured ? undefined : 'workspace-switch'}
        data-workspace={workspace}
        data-collapsed="true"
        className="shrink-0"
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`${active.label}. Choose another workspace`}
          aria-description={activity ? 'Agents are working' : undefined}
          data-testid={measured ? undefined : 'workspace-menu'}
          title={`${active.label}: ${active.hint}${chord ? ` (${chord} switches)` : ''}`}
          onClick={open}
          onKeyDown={menuTriggerKeyDown(open)}
          className="app-no-drag relative flex h-6 items-center gap-1 rounded border border-border bg-accent-soft px-2 text-[11px] font-medium whitespace-nowrap text-accent"
        >
          <Icon size={12} className="shrink-0" />
          <span>{active.label}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
          {activity && (
            <span
              data-testid={measured ? undefined : 'grove-activity'}
              aria-hidden
              className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
            />
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Workspace"
      data-testid={measured ? undefined : 'workspace-switch'}
      data-workspace={workspace}
      data-collapsed="false"
      className="app-no-drag flex h-6 shrink-0 items-stretch overflow-hidden rounded border border-border bg-bg"
    >
      {SEGMENTS.map(({ kind, label, hint, icon: Icon }) => {
        const active = workspace === kind;
        const activity = kind === 'grove' && !active && working;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            aria-label={label}
            aria-description={activity ? 'Agents are working' : undefined}
            tabIndex={measured ? -1 : undefined}
            data-testid={measured ? undefined : `workspace-${kind}`}
            title={`${label}: ${hint}${chord ? ` (${chord} switches)` : ''}`}
            onClick={() => {
              if (!measured) choose(kind);
            }}
            className={clsx(
              'relative flex items-center gap-1 px-2 text-[11px] font-medium whitespace-nowrap',
              kind === 'grove' && 'border-l border-border',
              active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
            )}
          >
            <Icon size={12} className="shrink-0" />
            <span>{label}</span>
            {activity && (
              <span
                data-testid={measured ? undefined : 'grove-activity'}
                aria-hidden
                className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
