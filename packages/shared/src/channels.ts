import { z } from 'zod';
import {
  browserActionSchema,
  browserHistoryEntrySchema,
  navigationStateSchema,
  problemEntrySchema,
  rectSchema,
  screenshotRequestSchema,
  screenshotResultSchema,
  viewportEmulationSchema,
  viewportPresetIdSchema,
} from './browser.js';
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
  'project.removeRecent': defineChannel(
    'project.removeRecent',
    z.object({ path: z.string() }),
    z.array(recentProjectSchema),
  ),
  'project.saveLayout': defineChannel('project.saveLayout', z.object({ layout: layoutStateSchema }), none),
  'project.openSettingsFile': defineChannel('project.openSettingsFile', none, none),

  'browser.getState': defineChannel('browser.getState', none, navigationStateSchema.nullable()),
  /**
   * Where the browser view goes (window CSS px) and the device emulation for the current preset.
   * `null` hides the view, e.g. while a full-screen modal or the empty/error state is shown.
   */
  'browser.setBounds': defineChannel(
    'browser.setBounds',
    z.object({ rect: rectSchema.nullable(), emulation: viewportEmulationSchema.nullable() }),
    none,
  ),
  'browser.navigate': defineChannel(
    'browser.navigate',
    z.object({ url: z.string() }),
    z.object({ ok: z.boolean(), url: z.string().optional(), error: z.string().optional() }),
  ),
  'browser.action': defineChannel('browser.action', z.object({ action: browserActionSchema }), none),
  'browser.setPreset': defineChannel('browser.setPreset', z.object({ preset: viewportPresetIdSchema }), none),
  'browser.history': defineChannel('browser.history', none, z.array(browserHistoryEntrySchema)),
  'browser.getConsole': defineChannel('browser.getConsole', none, z.array(problemEntrySchema)),
  'browser.getNetworkErrors': defineChannel('browser.getNetworkErrors', none, z.array(problemEntrySchema)),
  'browser.clearProblems': defineChannel('browser.clearProblems', none, none),
  'browser.screenshot': defineChannel('browser.screenshot', screenshotRequestSchema, screenshotResultSchema),
  /** Round trip over the page's private channel; `ok: false` means the browser preload is not running. */
  'browser.pingPage': defineChannel('browser.pingPage', none, z.object({ ok: z.boolean() })),
  /** Dev-server URL detected elsewhere (the terminal in Stage 2). Loads it if the browser is empty. */
  'browser.suggestUrl': defineChannel(
    'browser.suggestUrl',
    z.object({ url: z.string() }),
    z.object({ navigated: z.boolean() }),
  ),
} as const;

/** Main -> renderer events. */
export const events = {
  'settings.changed': defineEvent('settings.changed', appSettingsSchema),
  'theme.changed': defineEvent('theme.changed', themeStateSchema),
  'project.changed': defineEvent('project.changed', projectInfoSchema.nullable()),
  'window.stateChanged': defineEvent('window.stateChanged', windowStateSchema),
  /** A chord intercepted in main (or a menu action) asks the renderer to run a command. */
  'command.invoke': defineEvent('command.invoke', z.object({ commandId: z.string() })),
  'browser.stateChanged': defineEvent('browser.stateChanged', navigationStateSchema),
  /** New console/exception/network entries since the last event, batched. */
  'browser.problemsAdded': defineEvent('browser.problemsAdded', z.object({ entries: z.array(problemEntrySchema) })),
  'browser.problemsCleared': defineEvent('browser.problemsCleared', z.object({})),
  'browser.urlSuggested': defineEvent('browser.urlSuggested', z.object({ url: z.string() })),
} as const;

export type Channels = typeof channels;
export type Events = typeof events;

/** The object exposed to the renderer as `window.arbora`. */
export interface ArboraBridge extends IpcClient<Channels, Events> {
  readonly platform: z.infer<typeof platformSchema>;
  /** Resolves the filesystem path of a dropped `File` (Electron removed `File.path`). */
  getPathForFile(file: File): string;
}
