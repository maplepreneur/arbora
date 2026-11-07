import { CommandId, type AgentGroup, type ContextMenuItem } from '@arbora/shared';
import { setThreadGroup, setThreadPinned } from '../../agent-store';
import { executeCommand } from '../../commands';
import {
  archiveSession,
  deleteSession,
  renameSession,
  restartSession,
  restoreSession,
  powerSession,
  setProjectDefaultAgent,
  stopSession,
} from '../../grove-store';
import type { GroveSession } from '../../grove-model';
import { ipcError } from '../../ipc-error';
import { showToast } from '../../store';
import { showMenu } from '../agent/ThreadList';

/** The agent process is up or coming up, so Stop applies; otherwise Restart does. */
export function hasProcess(session: Pick<GroveSession, 'state'>): boolean {
  const { status } = session.state;
  return status !== 'idle' && status !== 'error';
}

async function run(session: GroveSession, choice: string | null): Promise<void> {
  if (!choice) return;
  try {
    if (choice === 'pin') await setThreadPinned(session.id, !session.pinned);
    else if (choice === 'rename') renameSession(session.id);
    else if (choice === 'default') await setProjectDefaultAgent(session.agentId);
    else if (choice === 'stop') await stopSession(session.id);
    else if (choice === 'power') await powerSession(session.id);
    else if (choice === 'restart') await restartSession(session.id);
    else if (choice === 'archive') archiveSession(session.id);
    else if (choice === 'restore') await restoreSession(session.id);
    else if (choice === 'delete') await deleteSession(session.id);
    else if (choice === 'log') executeCommand(CommandId.agentToggleLog);
    else if (choice === 'ungroup') await setThreadGroup(session.id, null);
    else if (choice.startsWith('group:')) await setThreadGroup(session.id, choice.slice('group:'.length));
  } catch (error) {
    showToast(ipcError(error));
  }
}

const ARCHIVED_MENU: ContextMenuItem[] = [
  { id: 'restore', label: 'Restore' },
  { type: 'separator' },
  { id: 'delete', label: 'Delete' },
];

/** Right-click or `⋯` on a row: Pin, Rename, Move to group, Set as default agent, Stop or Restart, Archive. */
export async function openRowMenu(session: GroveSession, groups: readonly AgentGroup[]): Promise<void> {
  if (session.archivedAt !== null) {
    await run(session, await showMenu(ARCHIVED_MENU));
    return;
  }
  const moves: ContextMenuItem[] = [
    ...groups.map((group) => ({
      id: `group:${group.id}`,
      label: `Move to ${group.name}`,
      enabled: session.groupId !== group.id,
    })),
    ...(session.groupId !== null ? [{ id: 'ungroup', label: 'Remove from group' }] : []),
  ];
  const choice = await showMenu([
    { id: 'pin', label: session.pinned ? 'Unpin' : 'Pin to top' },
    { id: 'rename', label: 'Rename…' },
    ...(moves.length > 0 ? [{ type: 'separator' as const }, ...moves] : []),
    { type: 'separator' },
    { id: 'default', label: 'Set as default agent' },
    hasProcess(session) ? { id: 'stop', label: 'Stop work' } : { id: 'restart', label: 'Start the agent' },
    { id: 'power', label: hasProcess(session) ? 'Power off (end process)' : 'Power on (start process)' },
    { id: 'archive', label: 'Archive' },
  ]);
  await run(session, choice);
}

/** The pane header's overflow menu. */
export async function openPaneMenu(session: GroveSession, logOpen: boolean): Promise<void> {
  if (session.archivedAt !== null) {
    await run(session, await showMenu(ARCHIVED_MENU));
    return;
  }
  const choice = await showMenu([
    { id: 'pin', label: session.pinned ? 'Unpin' : 'Pin to top' },
    { id: 'rename', label: 'Rename…' },
    { id: 'default', label: 'Set as default agent' },
    { id: 'log', label: logOpen ? 'Hide ACP log' : 'Show ACP log' },
    { type: 'separator' },
    { id: 'delete', label: 'Delete' },
  ]);
  await run(session, choice);
}
