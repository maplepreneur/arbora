import { z } from 'zod';
import { defineChannel, defineEvent } from './ipc';
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  panelLayoutSchema,
  projectSettingsPatchSchema,
  projectSettingsSchema,
  recentProjectSchema,
  resolvedThemeSchema,
  themeSourceSchema,
} from './settings';

export const platformSchema = z.enum(['darwin', 'linux', 'win32']);

export const appInfoSchema = z.object({
  platform: platformSchema,
  version: z.string(),
  isDev: z.boolean(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const projectInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  settings: projectSettingsSchema,
});
export type ProjectInfo = z.infer<typeof projectInfoSchema>;

export const openProjectResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened'), path: z.string() }),
  z.object({ status: z.literal('focused'), path: z.string() }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type OpenProjectResult = z.infer<typeof openProjectResultSchema>;

export const keyContextSchema = z.object({
  modeActive: z.boolean(),
  terminalFocused: z.boolean(),
});
export type KeyContextUpdate = z.infer<typeof keyContextSchema>;

export const keybindingEntrySchema = z.object({
  command: z.string(),
  chord: z.string(),
  intercept: z.boolean(),
  when: z.enum(['always', 'modeActive']),
});
export type KeybindingEntry = z.infer<typeof keybindingEntrySchema>;

export const keybindingsStateSchema = z.object({
  bindings: z.array(keybindingEntrySchema),
  problems: z.array(z.object({ command: z.string(), chord: z.string(), message: z.string() })),
  terminalPassthrough: z.boolean(),
});
export type KeybindingsState = z.infer<typeof keybindingsStateSchema>;

export const themeStateSchema = z.object({
  source: themeSourceSchema,
  resolved: resolvedThemeSchema,
});
export type ThemeState = z.infer<typeof themeStateSchema>;

export const windowStateSchema = z.object({
  maximized: z.boolean(),
  fullscreen: z.boolean(),
  focused: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

const none = z.undefined();
const ok = z.object({ ok: z.literal(true) });

/** Every request/response channel between renderer and main. */
export const channels = {
  getAppInfo: defineChannel('app:getInfo', none, appInfoSchema),

  getSettings: defineChannel('settings:get', none, appSettingsSchema),
  updateSettings: defineChannel('settings:update', appSettingsPatchSchema, appSettingsSchema),
  openSettingsFile: defineChannel('settings:openFile', none, ok),

  getTheme: defineChannel('theme:get', none, themeStateSchema),

  getCurrentProject: defineChannel('project:current', none, projectInfoSchema.nullable()),
  openProjectDialog: defineChannel('project:openDialog', none, openProjectResultSchema),
  openProject: defineChannel(
    'project:open',
    z.object({ path: z.string().min(1) }),
    openProjectResultSchema,
  ),
  listRecentProjects: defineChannel('project:recents', none, z.array(recentProjectSchema)),
  removeRecentProject: defineChannel(
    'project:removeRecent',
    z.object({ path: z.string() }),
    z.array(recentProjectSchema),
  ),
  updateProjectSettings: defineChannel(
    'project:updateSettings',
    projectSettingsPatchSchema,
    projectSettingsSchema,
  ),

  getLayout: defineChannel('layout:get', none, panelLayoutSchema.nullable()),
  setLayout: defineChannel('layout:set', panelLayoutSchema, ok),

  getWindowState: defineChannel('window:getState', none, windowStateSchema),
  windowControl: defineChannel(
    'window:control',
    z.object({ action: z.enum(['minimize', 'toggleMaximize', 'close']) }),
    ok,
  ),

  getKeybindings: defineChannel('keybindings:get', none, keybindingsStateSchema),
  setKeyContext: defineChannel('keybindings:setContext', keyContextSchema, ok),
} as const;

export type Channels = typeof channels;

/** Every event pushed from main to a renderer. */
export const events = {
  commandInvoked: defineEvent('command:invoke', z.object({ command: z.string() })),
  settingsChanged: defineEvent('settings:changed', appSettingsSchema),
  themeChanged: defineEvent('theme:changed', themeStateSchema),
  keybindingsChanged: defineEvent('keybindings:changed', keybindingsStateSchema),
  projectChanged: defineEvent('project:changed', projectInfoSchema.nullable()),
  windowStateChanged: defineEvent('window:stateChanged', windowStateSchema),
} as const;

export type Events = typeof events;
