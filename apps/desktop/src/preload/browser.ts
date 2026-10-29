import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  pageEvents,
  pageIpcName,
  type PageEvent,
  type PageEventName,
  type PageMessage,
  type PageMessageName,
} from '@arbora/shared';

/**
 * Preload injected into the user's page inside the browser panel's `WebContentsView`. It runs in
 * Electron's isolated world and exposes nothing to the page (no `contextBridge`). It talks to main
 * over the private `arbora:page:` channel. Stages 4 and 6 add the inspector and design overlays.
 */

function send<K extends PageMessageName>(name: K, payload: PageMessage<K>): void {
  ipcRenderer.send(pageIpcName(name), payload);
}

function on<K extends PageEventName>(name: K, listener: (payload: PageEvent<K>) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, raw: unknown): void => {
    const parsed = pageEvents[name].safeParse(raw);
    if (parsed.success) listener(parsed.data);
  };
  ipcRenderer.on(pageIpcName(name), wrapped);
  return () => {
    ipcRenderer.off(pageIpcName(name), wrapped);
  };
}

declare global {
  interface Window {
    ELECTRON_DISABLE_SECURITY_WARNINGS?: boolean;
  }
}

// Electron's dev-build security warnings judge Arbora's view settings, not the user's page; read
// from this (isolated) world on page load.
window.ELECTRON_DISABLE_SECURITY_WARNINGS = true;

on('ping', ({ nonce }) => send('pong', { nonce }));

function reportReady(): void {
  send('ready', { url: location.href, title: document.title });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', reportReady, { once: true });
} else {
  reportReady();
}
