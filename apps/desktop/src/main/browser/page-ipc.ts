import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { pageIpcName, pageMessages, type PageMessageEnvelope, type PageMessageName } from '@arbora/shared';

export interface PageMessageTarget {
  handlePageMessage(message: PageMessageEnvelope): void;
}

/**
 * Listens for the browser preload's private `arbora:page:` messages. Only the main frame of a
 * browser-panel webContents is accepted; payloads are validated before they reach the service.
 */
export function registerPageIpc(lookup: (sender: WebContents) => PageMessageTarget | undefined): () => void {
  const disposers = (Object.keys(pageMessages) as PageMessageName[]).map((name) => {
    const channel = pageIpcName(name);
    const listener = (event: IpcMainEvent, raw: unknown): void => {
      const target = lookup(event.sender);
      if (!target || event.senderFrame !== event.sender.mainFrame) return;
      const parsed = pageMessages[name].safeParse(raw);
      if (!parsed.success) return;
      // `name` and the schema it selected agree, which the mapped envelope type cannot express.
      target.handlePageMessage({ name, payload: parsed.data } as PageMessageEnvelope);
    };
    ipcMain.on(channel, listener);
    return () => ipcMain.off(channel, listener);
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}
