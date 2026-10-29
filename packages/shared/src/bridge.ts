import type { Channels, Events } from './channels';
import type { IpcClient, IpcSubscriber } from './ipc';

/** API the app preload exposes to the renderer as `window.arbora`. */
export interface ArboraBridge {
  readonly invoke: IpcClient<Channels>;
  readonly on: IpcSubscriber<Events>;
  /** Absolute path of a file or folder dropped onto the window (a DOM `File`). */
  getPathForFile(file: object): string;
}
