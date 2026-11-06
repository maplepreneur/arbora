import { Menu } from 'electron';
import { CommandId } from '@arbora/shared';

/**
 * macOS needs an application menu for Cmd+Q and the Edit roles (copy/paste/undo) to work.
 * Mode chords are deliberately not menu accelerators: main intercepts them via
 * `before-input-event` so they stay configurable and work while the embedded page has focus.
 */
export function buildMacMenu(dispatch: (commandId: string) => void): Menu {
  return Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', click: () => dispatch(CommandId.openSettings) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open Project…', click: () => dispatch(CommandId.openProject) },
        { label: 'Close Project', click: () => dispatch(CommandId.closeProject) },
        { type: 'separator' },
        // The chord is not a menu accelerator: the page intercepts it and closes a browser tab.
        // Close Window stays on Shift+Cmd+W so Electron's default Cmd+W does not close the window.
        {
          label: 'Close Tab',
          accelerator: 'Cmd+W',
          registerAccelerator: false,
          click: () => dispatch(CommandId.browserCloseTab),
        },
        { role: 'close', accelerator: 'Shift+Cmd+W' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', click: () => dispatch(CommandId.commandPalette) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}
