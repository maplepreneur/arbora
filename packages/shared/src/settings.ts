import { z } from 'zod';
import { customAgentSchema, rememberedPermissionsSchema } from './agent.js';
import { viewportPresetIdSchema } from './browser.js';

export const themeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const keybindingOverridesSchema = z.record(z.string(), z.string().nullable());

/** `latest`, or a semver such as `0.17.0` / `1.2.3-beta.1`. */
export const ADAPTER_VERSION_PATTERN = /^(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

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

/**
 * Per-machine state for a project (not committed): window bounds, panel layout, browser state, and
 * where it sits on the Projects page.
 */
export const projectStateSchema = z.object({
  bounds: windowBoundsSchema.optional(),
  layout: layoutStateSchema.optional(),
  browser: projectBrowserStateSchema.optional(),
  /** Pinned projects are listed first on the Projects page and in the project switcher. */
  pinned: z.boolean().optional(),
  /** Id of a `projectGroups` entry; unknown ids count as ungrouped. */
  groupId: z.string().optional(),
  /** Display name instead of the folder name. */
  alias: z.string().min(1).max(100).optional(),
  /** Last time the project was opened, kept after it drops out of the recent list. */
  openedAt: z.number().int().optional(),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export const PROJECT_GROUP_COLORS = ['green', 'blue', 'purple', 'pink', 'orange', 'yellow', 'gray'] as const;
export const groupColorSchema = z.enum(PROJECT_GROUP_COLORS);
export type GroupColor = z.infer<typeof groupColorSchema>;

/** A user-made folder on the Projects page ("Work", "Client X"). */
export const projectGroupSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  color: groupColorSchema.default('gray'),
  collapsed: z.boolean().default(false),
});
export type ProjectGroup = z.infer<typeof projectGroupSchema>;

export const attentionKindSchema = z.enum(['permission', 'auth', 'finished', 'failed']);
export type AttentionKind = z.infer<typeof attentionKindSchema>;

export const notificationSettingsSchema = z.object({
  /** Desktop notifications when an agent needs you, finishes or fails. */
  enabled: z.boolean().default(true),
  /** Also notify while the Arbora window has focus (the thread is not the one showing). */
  whenFocused: z.boolean().default(false),
  permission: z.boolean().default(true),
  finished: z.boolean().default(true),
  failed: z.boolean().default(true),
  /** Flash the taskbar entry and set the dock/launcher badge to the attention count. */
  badge: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Nature cues (the tree in the logo) first, then the original synth cues. */
export const NATURE_SOUND_IDS = ['chickadee', 'robin', 'songbird', 'woodpecker', 'owl', 'droplet', 'leaves'] as const;
export const CLASSIC_SOUND_IDS = ['chime', 'ping', 'pop', 'knock', 'bell'] as const;
export const SOUND_IDS = ['none', ...NATURE_SOUND_IDS, ...CLASSIC_SOUND_IDS] as const;
export const soundIdSchema = z.enum(SOUND_IDS);
export type SoundId = z.infer<typeof soundIdSchema>;

export const soundSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** 0..100 */
  volume: z.number().int().min(0).max(100).default(60),
  /** Play while the thread is already on screen in a focused window. */
  whenFocused: z.boolean().default(false),
  permission: soundIdSchema.default('chickadee'),
  finished: soundIdSchema.default('robin'),
  failed: soundIdSchema.default('woodpecker'),
});
export type SoundSettings = z.infer<typeof soundSettingsSchema>;

export const updateChannelSchema = z.enum(['latest', 'beta']);
export type UpdateChannel = z.infer<typeof updateChannelSchema>;

export const updateSettingsSchema = z.object({
  channel: updateChannelSchema.default('latest'),
  /** Check GitHub Releases on startup (packaged builds only). */
  autoCheck: z.boolean().default(true),
  /** Download in the background where the install can update itself (macOS, Windows, AppImage). */
  autoDownload: z.boolean().default(true),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const diagnosticsSettingsSchema = z.object({
  /** Keep a local `main.log` (warnings and errors from the main process) for diagnostics export. */
  logToFile: z.boolean().default(true),
  /** Write Chromium crash dumps locally. Nothing is ever uploaded. */
  crashDumps: z.boolean().default(true),
});
export type DiagnosticsSettings = z.infer<typeof diagnosticsSettingsSchema>;

export const onboardingSettingsSchema = z.object({
  completed: z.boolean().default(false),
  /** The chords the user pressed during onboarding, as proof the keys reach Arbora. */
  checkedChords: z.array(z.string()).max(20).default([]),
});
export type OnboardingSettings = z.infer<typeof onboardingSettingsSchema>;

export const MAX_RECENT_PROJECTS = 10;

export const SETTINGS_VERSION = 4;

export const browserSettingsSchema = z.object({
  /** Load the bundled React and Vue DevTools into the browser panel's session. */
  devToolsExtensions: z.boolean().default(true),
  /**
   * `onDemand` loads them the first time page DevTools opens (the page reloads once so React
   * DevTools can install its hook); `startup` loads them before the first page. Each extension's
   * service worker keeps a ~22 MB renderer process alive, so on demand is the default.
   */
  devToolsExtensionsLoad: z.enum(['onDemand', 'startup']).default('onDemand'),
  /** Accept self-signed certificates from localhost dev servers (Vite `https: true`, mkcert, ...). */
  trustLocalhostCertificates: z.boolean().default(true),
});
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;

export const SANS_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Ubuntu, Cantarell, 'Noto Sans', sans-serif";
/**
 * Dank Mono is the preferred code font. Its licence does not allow Arbora to bundle it, so it
 * is used when installed and the stack falls back to the platform's monospace fonts.
 */
export const MONO_FONT_STACK =
  "'Dank Mono', ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";

export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 150;

export const appearanceSettingsSchema = z.object({
  /** Interface zoom in percent: everything in the app window grows, not the page in the browser. */
  uiScale: z.number().int().min(UI_SCALE_MIN).max(UI_SCALE_MAX).default(100),
  /** CSS font families; empty uses the default stack (`SANS_FONT_STACK`, `MONO_FONT_STACK`). */
  interfaceFont: z.string().max(300).default(''),
  /** Editor, terminal and code blocks. */
  codeFont: z.string().max(300).default(''),
  /** Agent messages and the composer; empty follows the interface font. */
  agentFont: z.string().max(300).default(''),
  agentFontSize: z.number().int().min(10).max(24).default(14),
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

/** A font setting as a CSS `font-family` value: the user's choice first, then the fallback stack. */
export function fontFamily(choice: string, fallback: string): string {
  const trimmed = choice.trim();
  if (!trimmed) return fallback;
  const families = trimmed.split(',').map((family) => {
    const name = family.trim();
    return /^['"]|^[\w-]+$/.test(name) ? name : `'${name.replace(/'/g, '')}'`;
  });
  return [...families, fallback].join(', ');
}

/** The renderer's font variables (`styles.css`) for the appearance settings. */
export function appearanceCssVariables(appearance: AppearanceSettings): Record<string, string> {
  const sans = fontFamily(appearance.interfaceFont, SANS_FONT_STACK);
  return {
    '--font-sans': sans,
    '--font-mono': fontFamily(appearance.codeFont, MONO_FONT_STACK),
    '--font-agent': fontFamily(appearance.agentFont, sans),
    '--agent-font-size': `${appearance.agentFontSize}px`,
  };
}

export const terminalSettingsSchema = z.object({
  /** Shell executable; defaults to `$SHELL` (macOS/Linux) or pwsh/PowerShell/cmd (Windows). */
  shell: z.string().min(1).optional(),
  fontSize: z.number().int().min(8).max(32).default(14),
});
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;

export const editorSettingsSchema = z.object({
  /** Run the project's own Prettier (from its `node_modules`) on save. Skipped when it has none. */
  formatOnSave: z.boolean().default(true),
  /** Run the project's ESLint on the saved file. */
  eslintOnSave: z.boolean().default(true),
  /** Run `tsc --noEmit` after saving a TypeScript file. Off by default: slow on large projects. */
  tscOnSave: z.boolean().default(false),
  fontSize: z.number().int().min(8).max(32).default(14),
});
export type EditorSettings = z.infer<typeof editorSettingsSchema>;

/** Applies an `editor` patch; omitted (or `undefined`) fields keep their value. */
export function mergeEditorSettings(
  current: EditorSettings,
  patch: Partial<{ [K in keyof EditorSettings]: EditorSettings[K] | undefined }>,
): EditorSettings {
  return {
    formatOnSave: patch.formatOnSave ?? current.formatOnSave,
    eslintOnSave: patch.eslintOnSave ?? current.eslintOnSave,
    tscOnSave: patch.tscOnSave ?? current.tscOnSave,
    fontSize: patch.fontSize ?? current.fontSize,
  };
}

export const agentModelSchema = z.object({ value: z.string().max(300), name: z.string().max(300) });
export type AgentModel = z.infer<typeof agentModelSchema>;

/**
 * The last sign-in check: Arbora started the agent, ran `initialize` and `session/new`, and
 * stopped it. `ready` means it opened a session without asking for a login.
 */
export const agentVerificationSchema = z.object({
  status: z.enum(['ready', 'auth_required', 'missing', 'error']),
  checkedAt: z.number().int(),
  /** Choices of the session's `model` config option (or legacy `models`), in the agent's order. */
  models: z.array(agentModelSchema).max(500).default([]),
  /** The agent's own name and version from `initialize`. */
  version: z.string().max(200).optional(),
  error: z.string().max(2000).optional(),
});
export type AgentVerification = z.infer<typeof agentVerificationSchema>;

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
  /** Agents left out of agent pickers even when signed in. */
  hidden: z.array(z.string()).max(100).default([]),
  /** Model values left out of model pickers, per agent id. */
  hiddenModels: z.record(z.string(), z.array(z.string()).max(500)).default({}),
  /** Last sign-in check per agent id. */
  verified: z.record(z.string(), agentVerificationSchema).default({}),
  /** Check installed agents that were never checked when a picker or Settings opens. */
  autoVerify: z.boolean().default(true),
  /** Extra environment per agent id, merged over the agent's own `env` (values never logged). */
  env: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /** npm adapter version per built-in agent id (`latest` or `x.y.z`), replacing the pinned one. */
  adapterVersions: z.record(z.string(), z.string().regex(ADAPTER_VERSION_PATTERN)).default({}),
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
    hidden: z.array(z.string()).max(100),
    hiddenModels: z.record(z.string(), z.array(z.string()).max(500)),
    verified: z.record(z.string(), agentVerificationSchema),
    autoVerify: z.boolean(),
    env: z.record(z.string(), z.record(z.string(), z.string())),
    adapterVersions: z.record(z.string(), z.string().regex(ADAPTER_VERSION_PATTERN)),
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
    hidden: patch.hidden ?? current.hidden,
    hiddenModels: patch.hiddenModels ?? current.hiddenModels,
    verified: patch.verified ?? current.verified,
    autoVerify: patch.autoVerify ?? current.autoVerify,
    env: patch.env ?? current.env,
    adapterVersions: patch.adapterVersions ?? current.adapterVersions,
    ...(defaultAgent !== undefined ? { defaultAgent } : {}),
  };
}

/** Signed in (last check `ready`) and not hidden: the agents a picker may offer. */
export function isPickableAgent(settings: Pick<AgentSettings, 'hidden' | 'verified'>, agentId: string): boolean {
  return settings.verified[agentId]?.status === 'ready' && !settings.hidden.includes(agentId);
}

/**
 * The agent's checked models minus the hidden ones, in picker order: its default model, then its
 * favourites (in the order they were starred), then the rest in the agent's own order.
 */
export function visibleModels(
  settings: Pick<AgentSettings, 'hiddenModels' | 'verified' | 'defaultModels' | 'favoriteModels'>,
  agentId: string,
): AgentModel[] {
  const hidden = new Set(settings.hiddenModels[agentId] ?? []);
  const models = (settings.verified[agentId]?.models ?? []).filter((model) => !hidden.has(model.value));
  const rank = new Map<string, number>();
  const preferred = settings.defaultModels[agentId];
  if (preferred !== undefined) rank.set(preferred, 0);
  for (const [i, value] of (settings.favoriteModels[agentId] ?? []).entries()) {
    if (!rank.has(value)) rank.set(value, 1 + i);
  }
  const last = rank.size + 1;
  return models
    .map((model, i) => ({ model, i }))
    .sort((a, b) => (rank.get(a.model.value) ?? last) - (rank.get(b.model.value) ?? last) || a.i - b.i)
    .map((entry) => entry.model);
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
  /**
   * macOS only: quit when the last window closes, which also stops dev servers and agents. Off
   * keeps Arbora in the dock with no window, as most Mac apps do. Other platforms always quit.
   */
  quitOnLastWindowClose: z.boolean().default(true),
  appearance: appearanceSettingsSchema.default(appearanceSettingsSchema.parse({})),
  browser: browserSettingsSchema.default(browserSettingsSchema.parse({})),
  terminal: terminalSettingsSchema.default(terminalSettingsSchema.parse({})),
  editor: editorSettingsSchema.default(editorSettingsSchema.parse({})),
  agents: agentSettingsSchema.default(agentSettingsSchema.parse({})),
  notifications: notificationSettingsSchema.default(notificationSettingsSchema.parse({})),
  sounds: soundSettingsSchema.default(soundSettingsSchema.parse({})),
  updates: updateSettingsSchema.default(updateSettingsSchema.parse({})),
  diagnostics: diagnosticsSettingsSchema.default(diagnosticsSettingsSchema.parse({})),
  onboarding: onboardingSettingsSchema.default(onboardingSettingsSchema.parse({})),
  recentProjects: z.array(recentProjectSchema).max(MAX_RECENT_PROJECTS).default([]),
  projectGroups: z.array(projectGroupSchema).max(100).default([]),
  projects: z.record(z.string(), projectStateSchema).default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/**
 * A patch schema for a settings object: every field optional and without its default. Zod 4 fills
 * defaults even inside `.partial()`, which would reset every field a patch leaves out.
 */
export function patchSchema<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodType<{ [K in keyof z.infer<z.ZodObject<T>>]?: z.infer<z.ZodObject<T>>[K] | undefined }> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      (field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : (field as z.ZodType)).optional(),
    ]),
  );
  return z.object(shape) as unknown as z.ZodType<{
    [K in keyof z.infer<z.ZodObject<T>>]?: z.infer<z.ZodObject<T>>[K] | undefined;
  }>;
}

/** Fields a renderer may change through `settings.update`. */
export const appSettingsPatchSchema = z
  .object({
    theme: themeModeSchema,
    keybindings: keybindingOverridesSchema,
    terminalPassthrough: z.boolean(),
    quitOnLastWindowClose: z.boolean(),
    appearance: patchSchema(appearanceSettingsSchema),
    browser: patchSchema(browserSettingsSchema),
    terminal: patchSchema(terminalSettingsSchema),
    editor: patchSchema(editorSettingsSchema),
    agents: agentSettingsPatchSchema,
    notifications: patchSchema(notificationSettingsSchema),
    sounds: patchSchema(soundSettingsSchema),
    updates: patchSchema(updateSettingsSchema),
    diagnostics: patchSchema(diagnosticsSettingsSchema),
    onboarding: patchSchema(onboardingSettingsSchema),
    projectGroups: z.array(projectGroupSchema).max(100),
  })
  .partial();
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

/** Fills `current` with the defined fields of `patch`; `undefined` keeps the current value. */
export function mergeDefined<T extends object>(current: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  const next = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** Applies a validated `settings.update` patch. */
export function applySettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    ...current,
    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    ...(patch.keybindings !== undefined ? { keybindings: patch.keybindings } : {}),
    ...(patch.terminalPassthrough !== undefined ? { terminalPassthrough: patch.terminalPassthrough } : {}),
    ...(patch.quitOnLastWindowClose !== undefined ? { quitOnLastWindowClose: patch.quitOnLastWindowClose } : {}),
    ...(patch.appearance !== undefined ? { appearance: mergeDefined(current.appearance, patch.appearance) } : {}),
    ...(patch.browser !== undefined ? { browser: mergeDefined(current.browser, patch.browser) } : {}),
    ...(patch.terminal !== undefined ? { terminal: mergeDefined(current.terminal, patch.terminal) } : {}),
    ...(patch.editor !== undefined ? { editor: mergeEditorSettings(current.editor, patch.editor) } : {}),
    ...(patch.agents !== undefined ? { agents: mergeAgentSettings(current.agents, patch.agents) } : {}),
    ...(patch.notifications !== undefined
      ? { notifications: mergeDefined(current.notifications, patch.notifications) }
      : {}),
    ...(patch.sounds !== undefined ? { sounds: mergeDefined(current.sounds, patch.sounds) } : {}),
    ...(patch.updates !== undefined ? { updates: mergeDefined(current.updates, patch.updates) } : {}),
    ...(patch.diagnostics !== undefined ? { diagnostics: mergeDefined(current.diagnostics, patch.diagnostics) } : {}),
    ...(patch.onboarding !== undefined ? { onboarding: mergeDefined(current.onboarding, patch.onboarding) } : {}),
    ...(patch.projectGroups !== undefined ? { projectGroups: patch.projectGroups } : {}),
  };
}

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
  // v4 made nature sounds the default and code text 14px; settings still on the v3 defaults move.
  3: (input) => {
    const next: Record<string, unknown> = { ...input, version: 4 };
    const sounds = objectField(input, 'sounds');
    if (sounds?.['permission'] === 'ping' && sounds['finished'] === 'chime' && sounds['failed'] === 'knock') {
      next['sounds'] = { ...sounds, permission: 'chickadee', finished: 'robin', failed: 'woodpecker' };
    }
    for (const key of ['editor', 'terminal']) {
      const section = objectField(input, key);
      if (section?.['fontSize'] === 13) next[key] = { ...section, fontSize: 14 };
    }
    return next;
  },
};

function objectField(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = input[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

/**
 * Per-project settings in `<project>/.arbora/project.json`. `.arbora/.gitignore` keeps them local
 * unless the team un-ignores `project.json`.
 */
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

/** What Settings → Project may write to `.arbora/project.json`; `null` removes the field. */
export const projectSettingsPatchSchema = z
  .object({
    devCommand: z.string().min(1).max(1000).nullable(),
    devUrl: z.string().min(1).max(2000).nullable(),
    autoOpenDevUrl: z.boolean().nullable(),
    defaultAgent: z.string().min(1).nullable(),
    browserTools: z
      .object({ evaluate: browserToolPolicySchema.optional(), terminalRun: browserToolPolicySchema.optional() })
      .nullable(),
  })
  .partial();
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>;

/** Patch fields to write (`undefined` for the ones to delete), for `updateProjectSettingsFile`. */
export function projectSettingsUpdates(patch: ProjectSettingsPatch): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]));
}

export function addRecentProject(recents: readonly RecentProject[], entry: RecentProject): RecentProject[] {
  return [entry, ...recents.filter((r) => r.path !== entry.path)].slice(0, MAX_RECENT_PROJECTS);
}
