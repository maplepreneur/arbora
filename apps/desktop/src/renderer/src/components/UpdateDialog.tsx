import { useEffect } from 'react';
import { CheckCircle2, Download, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { updatesOffText } from '@arbora/shared';
import { checkForUpdates, loadUpdateState, useUpdates } from '../update-store';
import { closeOverlay, showToast, useApp } from '../store';
import { Dialog } from './Dialog';

/** Release notes and the next step for an update: download, restart, or what to run by hand. */
export function UpdateDialog() {
  const open = useApp((s) => s.overlay === 'update');
  const state = useUpdates((s) => s.state);
  const version = useUpdates((s) => s.version);
  const installKind = useApp((s) => s.info.installKind);
  useEffect(() => {
    if (open) void loadUpdateState();
  }, [open]);
  if (!open) return null;
  const close = (): void => closeOverlay('update');

  let body;
  switch (state.status) {
    case 'idle':
    case 'checking':
      body = (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <LoaderCircle size={14} className="animate-spin" /> Checking GitHub Releases…
        </p>
      );
      break;
    case 'off':
      body = (
        <p className="text-sm text-fg-muted" data-testid="update-off">
          {updatesOffText(state.reason)}
        </p>
      );
      break;
    case 'current':
      body = (
        <p className="flex items-center gap-2 text-sm" data-testid="update-current">
          <CheckCircle2 size={14} className="text-accent" /> Arbora {version} is the newest version on this channel.
        </p>
      );
      break;
    case 'available':
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Arbora <strong>{state.version}</strong> is available. You have {version}.
          </p>
          {state.notes && (
            <pre className="max-h-64 overflow-auto rounded border border-border bg-bg-subtle p-3 font-sans text-xs whitespace-pre-wrap select-text">
              {state.notes}
            </pre>
          )}
          {state.manualHint && (
            <div className="rounded border border-border bg-bg-subtle p-3 text-xs">
              <p className="font-medium">This install ({installKind}) does not update itself.</p>
              <p className="mt-1 text-fg-muted select-text">{state.manualHint}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void window.arbora.invoke('app.openExternal', { url: state.releaseUrl })}
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-bg-muted"
            >
              <ExternalLink size={12} /> Release page
            </button>
            {!state.manualHint && (
              <button
                type="button"
                onClick={() =>
                  void window.arbora
                    .invoke('updates.download')
                    .catch((error: unknown) => showToast((error as Error).message))
                }
                className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
              >
                <Download size={12} /> Download
              </button>
            )}
          </div>
        </div>
      );
      break;
    case 'downloading':
      body = (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Downloading Arbora {state.version}… {state.percent}%
          </p>
          <div className="h-1.5 overflow-hidden rounded bg-bg-muted" role="progressbar" aria-valuenow={state.percent}>
            <div className="h-full bg-accent" style={{ width: `${state.percent}%` }} />
          </div>
        </div>
      );
      break;
    case 'ready':
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Arbora {state.version} is downloaded. It installs when you restart.</p>
          {state.notes && (
            <pre className="max-h-64 overflow-auto rounded border border-border bg-bg-subtle p-3 font-sans text-xs whitespace-pre-wrap select-text">
              {state.notes}
            </pre>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded border border-border px-3 py-1.5 text-xs">
              Later
            </button>
            <button
              type="button"
              onClick={() => void window.arbora.invoke('updates.install')}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
            >
              Restart and install
            </button>
          </div>
        </div>
      );
      break;
    case 'error':
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-danger" data-testid="update-error">
            Could not check for updates: {state.message}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void checkForUpdates()}
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-bg-muted"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        </div>
      );
      break;
    default: {
      const unreachable: never = state;
      body = unreachable;
    }
  }

  return (
    <Dialog label="Updates" testId="update-dialog" onClose={close} width={520}>
      <header className="flex items-center border-b border-border px-5 py-3">
        <h2 className="flex-1 text-base font-semibold">Updates</h2>
        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-fg-subtle hover:text-fg">
          <X size={16} />
        </button>
      </header>
      <div className="px-5 py-4">{body}</div>
    </Dialog>
  );
}
