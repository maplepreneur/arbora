import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { channels, createClient, events, toPlatform, type ArboraBridge } from '@arbora/shared';

// Sandboxed preload: only contextBridge + ipcRenderer. All logic lives in main.
const client = createClient(channels, events, {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
});

const bridge: ArboraBridge = {
  invoke: client.invoke,
  on: client.on,
  platform: toPlatform(process.platform),
  getPathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('arbora', bridge);
