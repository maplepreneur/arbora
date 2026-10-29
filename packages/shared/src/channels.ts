import { z } from 'zod';
import { defineChannel, defineEvent, type IpcClient } from './ipc.js';
import { platformSchema } from './platform.js';
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  layoutStateSchema,
  projectSettingsSchema,
  recentProjectSchema,
  themeModeSchema,
} from './settings.js';

const none = z.undefined();

export const resolvedThemeSchema = z.enum(['light', 'dark']);
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;

export const themeStateSchema = z.object({
  mode: themeModeSchema,
  resolved: resolvedThemeSchema,
});
export type ThemeState = z.infer<typeof themeStateSchema>;

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: platformSchema,
  isPackaged: z.boolean(),
  /** Hyprland, Sway and other tiling compositors manage window geometry themselves. */
  tilingCompositor: z.string().nullable(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const windowStateSchema = z.object({
  maximized: z.boolean(),
  fullScreen: z.boolean(),
  focused: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

export const projectInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  settings: projectSettingsSchema,
  /** Problems reading `.arbora/project.json`; the defaults are used instead. */
  settingsWarnings: z.array(z.string()),
  layout: layoutStateSchema.optional(),
});
export type ProjectInfo = z.infer<typeof projectInfoSchema>;

export const keybindingContextSchema = z.object({
  modeActive: z.boolean(),
  terminalFocused: z.boolean(),
});

/** Request/response channels. Keep this the single registry of IPC surface. */
export const channels = {
  'app.getInfo': defineChannel('app.getInfo', none, appInfoSchema),

  'window.getState': defineChannel('window.getState', none, windowStateSchema),
  'window.control': defineChannel(
    'window.control',
    z.object({ action: z.enum(['minimize', 'toggleMaximize', 'close', 'reload', 'toggleDevTools']) }),
    none,
  ),

  'settings.get': defineChannel('settings.get', none, appSettingsSchema),
  'settings.update': defineChannel('settings.update', appSettingsPatchSchema, appSettingsSchema),
  'settings.openFile': defineChannel('settings.openFile', none, none),

  'theme.get': defineChannel('theme.get', none, themeStateSchema),
  'theme.set': defineChannel('theme.set', z.object({ mode: themeModeSchema }), themeStateSchema),

  'keybindings.setContext': defineChannel('keybindings.setContext', keybindingContextSchema, none),

  'project.getCurrent': defineChannel('project.getCurrent', none, projectInfoSchema.nullable()),
  /** Opens `path`, or shows the native folder dialog when omitted. */
  'project.open': defineChannel(
    'project.open',
    z.object({ path: z.string().min(1).optional() }),
    z.object({ opened: z.boolean(), error: z.string().optional() }),
  ),
  'project.close': defineChannel('project.close', none, none),
  'project.recents': defineChannel('project.recents', none, z.array(recentProjectSchema)),
  'project.removeRecent': defineChannel('project.removeRecent', z.object({ path: z.string() }), z.array(recentProjectSchema)),
  'project.saveLayout': defineChannel('project.saveLayout', z.object({ layout: layoutStateSchema }), none),
  'project.openSettingsFile': defineChannel('project.openSettingsFile', none, none),
} as const;

/** Main -> renderer events. */
export const events = {
  'settings.changed': defineEvent('settings.changed', appSettingsSchema),
  'theme.changed': defineEvent('theme.changed', themeStateSchema),
  'project.changed': defineEvent('project.changed', projectInfoSchema.nullable()),
  'window.stateChanged': defineEvent('window.stateChanged', windowStateSchema),
  /** A chord intercepted in main (or a menu action) asks the renderer to run a command. */
  'command.invoke': defineEvent('command.invoke', z.object({ commandId: z.string() })),
} as const;

export type Channels = typeof channels;
export type Events = typeof events;

/** The object exposed to the renderer as `window.arbora`. */
export interface ArboraBridge extends IpcClient<Channels, Events> {
  readonly platform: z.infer<typeof platformSchema>;
  /** Resolves the filesystem path of a dropped `File` (Electron removed `File.path`). */
  getPathForFile(file: File): string;
}
