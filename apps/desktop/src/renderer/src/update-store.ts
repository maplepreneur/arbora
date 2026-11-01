import { create } from 'zustand';
import type { UpdateState } from '@arbora/shared';
import { openOverlay, showToast, useApp } from './store';

export const useUpdates = create<{ state: UpdateState; version: string; selfUpdates: boolean }>()(() => ({
  state: { status: 'idle' },
  version: '',
  selfUpdates: false,
}));

let announced: string | null = null;

export function applyUpdateState(state: UpdateState, fromUser = false): void {
  useUpdates.setState({ state });
  switch (state.status) {
    case 'available':
    case 'ready':
      // Background checks say so once per version; the dialog has the notes and the actions.
      if (!fromUser && announced !== `${state.status}:${state.version}`) {
        announced = `${state.status}:${state.version}`;
        showToast(
          state.status === 'ready'
            ? `Arbora ${state.version} is ready to install`
            : `Arbora ${state.version} is available`,
          { label: 'Details', run: () => openOverlay('update') },
        );
      }
      return;
    case 'idle':
    case 'checking':
    case 'current':
    case 'downloading':
    case 'error':
      return;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export async function loadUpdateState(): Promise<void> {
  const { state, version, selfUpdates } = await window.arbora.invoke('updates.getState');
  useUpdates.setState({ state, version, selfUpdates });
}

/** **Check for Updates…**: checks now and shows the result in the update dialog. */
export async function checkForUpdates(): Promise<void> {
  if (useApp.getState().info.installKind === 'dev') {
    showToast('Updates are off in development builds');
    return;
  }
  openOverlay('update');
  applyUpdateState(await window.arbora.invoke('updates.check'), true);
}
