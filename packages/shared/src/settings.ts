import { z } from 'zod';
import type { MigrationTable } from './migrations';

export const themeSourceSchema = z.enum(['system', 'light', 'dark']);
export type ThemeSource = z.infer<typeof themeSourceSchema>;

export const resolvedThemeSchema = z.enum(['light', 'dark']);
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;

/** Command id -> chord (`"mod+k"`) or `null` to unbind. */
export const keybindingOverridesSchema = z.record(z.string(), z.string().nullable());
export type KeybindingOverrides = z.infer<typeof keybindingOverridesSchema>;

export const APP_SETTINGS_VERSION = 1;

/**
 * User preferences, stored as `settings.json` under the app's userData directory and meant to be
 * edited by hand. Each field falls back to its default on its own so one typo does not reset the
 * whole file.
 */
export const appSettingsSchema = z.object({
  version: z.literal(APP_SETTINGS_VERSION).catch(APP_SETTINGS_VERSION),
  theme: themeSourceSchema.catch('system'),
  keybindings: keybindingOverridesSchema.catch({}),
  /** When a terminal is focused, plain `Ctrl+K` / `Ctrl+D` go to the shell instead of Arbora. */
  terminalPassthrough: z.boolean().catch(true),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsPatchSchema = appSettingsSchema.omit({ version: true }).partial();
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export const appSettingsMigrations: MigrationTable = {
  // Unversioned files share the v1 shape; stamping the version is enough.
  0: (doc) => doc,
};

export const MAX_RECENT_PROJECTS = 10;

export const recentProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  lastOpenedAt: z.number(),
});
export type RecentProject = z.infer<typeof recentProjectSchema>;

export const panelLayoutSchema = z.object({
  /** Panel group id -> panel id -> size in percent. */
  sizes: z.record(z.string(), z.record(z.string(), z.number())),
  collapsed: z.record(z.string(), z.boolean()),
});
export type PanelLayout = z.infer<typeof panelLayoutSchema>;

export const windowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

export const projectUiStateSchema = z.object({
  layout: panelLayoutSchema.optional(),
  windowBounds: windowBoundsSchema.optional(),
});
export type ProjectUiState = z.infer<typeof projectUiStateSchema>;

export const APP_STATE_VERSION = 1;

/** Machine-managed state (recents, per-project layout and bounds), stored as `state.json`. */
export const appStateSchema = z.object({
  version: z.literal(APP_STATE_VERSION).catch(APP_STATE_VERSION),
  recentProjects: z.array(recentProjectSchema).max(MAX_RECENT_PROJECTS).catch([]),
  projects: z.record(z.string(), projectUiStateSchema).catch({}),
});
export type AppState = z.infer<typeof appStateSchema>;

export const appStateMigrations: MigrationTable = {
  0: (doc) => doc,
};

export const PROJECT_SETTINGS_VERSION = 1;

/** Committed per-project settings, stored at `<project>/.arbora/project.json`. */
export const projectSettingsSchema = z.object({
  version: z.literal(PROJECT_SETTINGS_VERSION).catch(PROJECT_SETTINGS_VERSION),
  devCommand: z.string().optional().catch(undefined),
  devUrl: z.string().optional().catch(undefined),
  defaultAgent: z.string().optional().catch(undefined),
  keybindings: keybindingOverridesSchema.catch({}),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSettingsPatchSchema = projectSettingsSchema.omit({ version: true }).partial();
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>;

export const projectSettingsMigrations: MigrationTable = {
  0: (doc) => doc,
};

export function addRecentProject(
  recents: readonly RecentProject[],
  entry: RecentProject,
): RecentProject[] {
  return [entry, ...recents.filter((recent) => recent.path !== entry.path)].slice(
    0,
    MAX_RECENT_PROJECTS,
  );
}
