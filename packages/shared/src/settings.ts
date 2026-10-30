import { z } from 'zod';
import { customAgentSchema, rememberedPermissionsSchema } from './agent.js';
import { viewportPresetIdSchema } from './browser.js';

export const themeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const keybindingOverridesSchema = z.record(z.string(), z.string().nullable());

export const windowBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(200),
  height: z.number().int().min(200),
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

/** Map of panel id to percentage size (0..100), as produced by react-resizable-panels. */
export const panelGroupLayoutSchema = z.record(z.string(), z.number().min(0).max(100));
export type PanelGroupLayout = z.infer<typeof panelGroupLayoutSchema>;

export const sidebarViewSchema = z.enum(['files', 'git', 'search']);
export type SidebarView = z.infer<typeof sidebarViewSchema>;

export const bottomTabSchema = z.enum(['terminal', 'git', 'problems']);
export type BottomTab = z.infer<typeof bottomTabSchema>;

export const layoutStateSchema = z.object({
  groups: z.record(z.string(), panelGroupLayoutSchema).default({}),
  sidebarView: sidebarViewSchema.default('files'),
  bottomTab: bottomTabSchema.default('terminal'),
});
export type LayoutState = z.infer<typeof layoutStateSchema>;

export const recentProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  openedAt: z.number().int(),
});
export type RecentProject = z.infer<typeof recentProjectSchema>;

/** Browser panel state restored when the project reopens. */
export const projectBrowserStateSchema = z.object({
  lastUrl: z.string().optional(),
  preset: viewportPresetIdSchema.default('responsive'),
  zoomFactor: z.number().min(0.25).max(5).default(1),
});
export type ProjectBrowserState = z.infer<typeof projectBrowserStateSchema>;

/** Per-machine state for a project (not committed): window bounds, panel layout, browser state. */
export const projectStateSchema = z.object({
  bounds: windowBoundsSchema.optional(),
  layout: layoutStateSchema.optional(),
  browser: projectBrowserStateSchema.optional(),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export const MAX_RECENT_PROJECTS = 10;

export const SETTINGS_VERSION = 3;

export const browserSettingsSchema = z.object({
  /** Load the bundled React and Vue DevTools into the browser panel's session. */
  devToolsExtensions: z.boolean().default(true),
  /** Accept self-signed certificates from localhost dev servers (Vite `https: true`, mkcert, ...). */
  trustLocalhostCertificates: z.boolean().default(true),
});
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;

export const terminalSettingsSchema = z.object({
  /** Shell executable; defaults to `$SHELL` (macOS/Linux) or pwsh/PowerShell/cmd (Windows). */
  shell: z.string().min(1).optional(),
  fontSize: z.number().int().min(8).max(32).default(13),
});
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;

export const agentSettingsSchema = z.object({
  /** User-defined ACP agents, in addition to the built-ins. */
  custom: z.array(customAgentSchema).default([]),
  /** "Always allow/reject" answers to permission requests, keyed by `agentId:toolKind`. */
  permissions: rememberedPermissionsSchema.default({}),
  /** Agent for new threads when the project's `defaultAgent` is not set. */
  defaultAgent: z.string().min(1).optional(),
  /** Model applied to new threads, per agent id (a value of the agent's `model` config option). */
  defaultModels: z.record(z.string(), z.string()).default({}),
  /** Models pinned to the top of the model picker, per agent id. */
  favoriteModels: z.record(z.string(), z.array(z.string()).max(50)).default({}),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/** What `settings.update` may change under `agents`; `defaultAgent: null` clears it. */
export const agentSettingsPatchSchema = z
  .object({
    custom: z.array(customAgentSchema),
    permissions: rememberedPermissionsSchema,
    defaultAgent: z.string().min(1).nullable(),
    defaultModels: z.record(z.string(), z.string()),
    favoriteModels: z.record(z.string(), z.array(z.string()).max(50)),
  })
  .partial();
export type AgentSettingsPatch = z.infer<typeof agentSettingsPatchSchema>;

/** Applies an `agents` patch; omitted fields keep their value and `defaultAgent: null` clears it. */
export function mergeAgentSettings(current: AgentSettings, patch: AgentSettingsPatch): AgentSettings {
  const defaultAgent = patch.defaultAgent === null ? undefined : (patch.defaultAgent ?? current.defaultAgent);
  return {
    custom: patch.custom ?? current.custom,
    permissions: patch.permissions ?? current.permissions,
    defaultModels: patch.defaultModels ?? current.defaultModels,
    favoriteModels: patch.favoriteModels ?? current.favoriteModels,
    ...(defaultAgent !== undefined ? { defaultAgent } : {}),
  };
}

/** Project `defaultAgent`, then the app-wide default, if either names a known agent. */
export function resolveDefaultAgent(
  knownAgentIds: readonly string[],
  projectDefault: string | undefined,
  appDefault: string | undefined,
): string | undefined {
  return [projectDefault, appDefault].find((id) => id !== undefined && knownAgentIds.includes(id));
}

/**
 * User settings stored in `<userData>/settings.json`. Every field has a default so a partially
 * written or hand-edited file still loads.
 */
export const appSettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  theme: themeModeSchema.default('system'),
  /** Command id -> chord (`mod+k`) or `null` to unbind. */
  keybindings: keybindingOverridesSchema.default({}),
  /** When a terminal is focused, plain `Ctrl+<key>` chords go to the shell. */
  terminalPassthrough: z.boolean().default(true),
  browser: browserSettingsSchema.default(browserSettingsSchema.parse({})),
  terminal: terminalSettingsSchema.default(terminalSettingsSchema.parse({})),
  agents: agentSettingsSchema.default(agentSettingsSchema.parse({})),
  recentProjects: z.array(recentProjectSchema).max(MAX_RECENT_PROJECTS).default([]),
  projects: z.record(z.string(), projectStateSchema).default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Fields a renderer may change through `settings.update`. */
export const appSettingsPatchSchema = z
  .object({
    theme: themeModeSchema,
    keybindings: keybindingOverridesSchema,
    terminalPassthrough: z.boolean(),
    browser: browserSettingsSchema.partial(),
    terminal: terminalSettingsSchema.partial(),
    agents: agentSettingsPatchSchema,
  })
  .partial();
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export function defaultSettings(): AppSettings {
  return appSettingsSchema.parse({ version: SETTINGS_VERSION });
}

export type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade *from*. `0` is a file written before versioning
 * existed (no `version` field). Append new entries; never edit shipped ones.
 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (input) => ({ ...input, version: 1 }),
  // v2 added `browser` settings and per-project browser state; both are defaulted by the schema.
  1: (input) => ({ ...input, version: 2 }),
  // v3 added `agents` (custom agents and remembered permissions), defaulted by the schema.
  2: (input) => ({ ...input, version: 3 }),
};

export class SettingsMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsMigrationError';
  }
}

/** Runs migrations from the file's version up to `targetVersion`. Throws for files from a newer app. */
export function migrateSettings(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = SETTINGS_MIGRATIONS,
  targetVersion: number = SETTINGS_VERSION,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: targetVersion };
  }
  let current = { ...(raw as Record<string, unknown>) };
  const declared = current['version'];
  let version = typeof declared === 'number' && Number.isInteger(declared) ? declared : 0;
  if (version > targetVersion) {
    throw new SettingsMigrationError(`Settings version ${version} is newer than supported version ${targetVersion}`);
  }
  while (version < targetVersion) {
    const migrate = migrations[version];
    if (!migrate) {
      throw new SettingsMigrationError(`No settings migration from version ${version}`);
    }
    current = migrate(current);
    const next = current['version'];
    if (typeof next !== 'number' || next <= version) {
      throw new SettingsMigrationError(`Migration from version ${version} did not advance the version`);
    }
    version = next;
  }
  return current;
}

export interface LoadSettingsResult {
  readonly settings: AppSettings;
  /** Human-readable problems; non-empty means some values were reset to defaults. */
  readonly warnings: readonly string[];
}

/**
 * Migrates then validates. Invalid top-level fields fall back to their defaults individually so a
 * single bad hand edit does not wipe the whole file.
 */
export function loadSettings(raw: unknown): LoadSettingsResult {
  const warnings: string[] = [];
  const migrated = migrateSettings(raw);
  const parsed = appSettingsSchema.safeParse(migrated);
  if (parsed.success) {
    return { settings: parsed.data, warnings };
  }
  const badKeys = new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((k) => typeof k === 'string'));
  for (const key of badKeys) warnings.push(`settings.${key} is invalid and was reset to its default`);
  const repaired = Object.fromEntries(
    Object.entries({ ...migrated, version: SETTINGS_VERSION }).filter(([key]) => !badKeys.has(key)),
  );
  const second = appSettingsSchema.safeParse(repaired);
  if (second.success) {
    return { settings: second.data, warnings };
  }
  warnings.push('settings file is invalid and was reset to defaults');
  return { settings: defaultSettings(), warnings };
}

export const PROJECT_SETTINGS_VERSION = 1;

/** Committed per-project settings in `<project>/.arbora/project.json`. */
export const browserToolPolicySchema = z.enum(['ask', 'allow', 'deny']);
export type BrowserToolPolicy = z.infer<typeof browserToolPolicySchema>;

export const projectSettingsSchema = z.object({
  version: z.literal(PROJECT_SETTINGS_VERSION).default(PROJECT_SETTINGS_VERSION),
  /** Shell command for "Run Dev Server"; inferred from `package.json` scripts on first run. */
  devCommand: z.string().optional(),
  devUrl: z.string().optional(),
  /** Load a dev-server URL printed in a terminal when the browser panel is empty (default on). */
  autoOpenDevUrl: z.boolean().optional(),
  defaultAgent: z.string().optional(),
  keybindings: keybindingOverridesSchema.optional(),
  /**
   * Standing answers for the agent browser tools that can do more than look: `browser_evaluate`
   * and `terminal_run`. Unset means ask once per agent session.
   */
  browserTools: z
    .object({ evaluate: browserToolPolicySchema.optional(), terminalRun: browserToolPolicySchema.optional() })
    .optional(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export function addRecentProject(recents: readonly RecentProject[], entry: RecentProject): RecentProject[] {
  return [entry, ...recents.filter((r) => r.path !== entry.path)].slice(0, MAX_RECENT_PROJECTS);
}
