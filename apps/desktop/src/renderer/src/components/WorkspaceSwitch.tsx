import clsx from 'clsx';
import { AppWindow, Trees, type LucideIcon } from 'lucide-react';
import { CommandId, type WorkspaceKind } from '@arbora/shared';
import { executeCommand } from '../commands';
import { useAnySessionWorking } from '../grove-store';
import { useChordLabel } from '../keybindings';
import { useApp } from '../store';

const SEGMENTS: readonly { kind: WorkspaceKind; label: string; hint: string; icon: LucideIcon; command: string }[] = [
  {
    kind: 'browser',
    label: 'Browser',
    hint: 'the page, the editor, the terminal and one docked agent',
    icon: AppWindow,
    command: CommandId.showBrowserWorkspace,
  },
  {
    kind: 'grove',
    label: 'Grove',
    hint: 'every agent session in this project',
    icon: Trees,
    command: CommandId.showGrove,
  },
];

/** Browser / Grove, left of the attention bell. Agents keep running in the workspace that is not showing. */
export function WorkspaceSwitch() {
  const hasProject = useApp((s) => s.project !== null);
  const workspace = useApp((s) => s.layout.workspace);
  const working = useAnySessionWorking();
  const chord = useChordLabel(CommandId.toggleWorkspace);
  if (!hasProject) return null;
  return (
    <div
      role="group"
      aria-label="Workspace"
      data-testid="workspace-switch"
      data-workspace={workspace}
      className="app-no-drag mr-1 flex h-6 shrink-0 items-stretch overflow-hidden rounded border border-border bg-bg"
    >
      {SEGMENTS.map(({ kind, label, hint, icon: Icon, command }) => {
        const active = workspace === kind;
        const activity = kind === 'grove' && !active && working;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            aria-label={label}
            aria-description={activity ? 'Agents are working' : undefined}
            data-testid={`workspace-${kind}`}
            title={`${label}: ${hint}${chord ? ` (${chord} switches)` : ''}`}
            onClick={() => executeCommand(command)}
            className={clsx(
              'relative flex items-center gap-1 px-2 text-[11px] font-medium',
              kind === 'grove' && 'border-l border-border',
              active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
            )}
          >
            <Icon size={12} className="shrink-0" />
            <span className="hidden @[40rem]:inline">{label}</span>
            {activity && (
              <span
                data-testid="grove-activity"
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
