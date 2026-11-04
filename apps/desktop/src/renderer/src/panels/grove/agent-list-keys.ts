import { neighbourSession } from '../../grove-model';
import { selectSession } from '../../grove-store';

/** The fields both a React key event and a DOM key event provide. */
interface AgentListKeyEvent {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
}

export interface AgentListKeyOptions {
  readonly order: readonly { id: string }[];
  readonly selectedId: string | null;
  /** Listed row, or the rail's row. The wide list also treats its ⋯ button as the row. */
  readonly rowTestId: 'grove-row' | 'grove-rail-row';
}

function rowSelector(rowTestId: AgentListKeyOptions['rowTestId']): string {
  return rowTestId === 'grove-row'
    ? '[data-testid="grove-row"], [data-testid="grove-row-menu"]'
    : '[data-testid="grove-rail-row"]';
}

/**
 * Arrow keys (and Home/End) while the agent list or one of its rows has focus: select the
 * neighbour in screen order, wrapping, and move DOM focus with it. Modifier chords and keys
 * from anywhere else are left alone, so this is not an app-wide binding.
 */
export function onAgentListKeyDown(event: AgentListKeyEvent, options: AgentListKeyOptions): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const { key } = event;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
  const target = event.target;
  const root = event.currentTarget;
  if (!(target instanceof HTMLElement) || !(root instanceof HTMLElement)) return;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const onRow = target.closest(rowSelector(options.rowTestId)) !== null;
  if (target !== root && !onRow) return;
  const { order, selectedId } = options;
  if (order.length === 0) return;
  const nextId =
    key === 'Home'
      ? order[0]?.id
      : key === 'End'
        ? order[order.length - 1]?.id
        : neighbourSession(order, selectedId, key === 'ArrowDown' ? 1 : -1);
  if (!nextId) return;
  event.preventDefault();
  if (nextId !== selectedId) selectSession(nextId, { focus: false });
  root
    .querySelector<HTMLElement>(`[data-testid="${options.rowTestId}"][data-thread-id="${CSS.escape(nextId)}"]`)
    ?.focus();
}
