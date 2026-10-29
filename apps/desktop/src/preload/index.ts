import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  channels,
  createClient,
  createSubscriber,
  events,
  type ArboraBridge,
} from '@arbora/shared';

const bridge: ArboraBridge = {
  invoke: createClient(channels, (channel, payload) => ipcRenderer.invoke(channel, payload)),
  on: createSubscriber(
    events,
    (event, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(event, handler);
      return () => {
        ipcRenderer.removeListener(event, handler);
      };
    },
    (error) => {
      console.error(error);
    },
  ),
  getPathForFile(file) {
    if (!(file instanceof File)) {
      throw new TypeError('getPathForFile expects a File');
    }
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('arbora', bridge);
