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
        { role: 'close' },
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
