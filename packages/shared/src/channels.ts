import { z } from 'zod';
import {
  acpLogEntrySchema,
  agentAvailabilitySchema,
  agentDefinitionSchema,
  attachmentSchema,
  contentBlockSchema,
  threadChangeSchema,
  threadSchema,
  threadStateSchema,
  threadSummarySchema,
} from './agent.js';
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
import { agentModeIncludeSchema, agentModeSelectionSchema, agentModeTargetSchema } from './inspector.js';
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
import { devServerStatusSchema, terminalInfoSchema, terminalKindSchema, terminalSizeSchema } from './terminal.js';

const terminalId = z.object({ id: z.string() });
const threadId = z.object({ threadId: z.string() });

export const contextMenuItemSchema = z.union([
  z.object({
    id: z.string(),
    label: z.string(),
    enabled: z.boolean().optional(),
    /** Display-only accelerator hint such as `Ctrl+Shift+C`. */
    accelerator: z.string().optional(),
  }),
  z.object({ type: z.literal('separator') }),
]);
export type ContextMenuItem = z.infer<typeof contextMenuItemSchema>;

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

  /**
   * Native popup menu at the cursor; resolves with the chosen item id, or null when dismissed.
   * Native because DOM menus cannot draw over the browser panel's `WebContentsView`.
   */
  'contextMenu.show': defineChannel(
    'contextMenu.show',
    z.object({ items: z.array(contextMenuItemSchema).min(1).max(50) }),
    z.object({ id: z.string().nullable() }),
  ),

  /** The system clipboard (text only), for terminal copy/paste without renderer permissions. */
  'clipboard.readText': defineChannel('clipboard.readText', none, z.string()),
  'clipboard.writeText': defineChannel('clipboard.writeText', z.object({ text: z.string().max(10_000_000) }), none),

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

  /** Starts a shell (or `command` through the shell) in the project folder. */
  'terminal.create': defineChannel(
    'terminal.create',
    terminalSizeSchema.extend({
      kind: terminalKindSchema.exclude(['agent']).optional(),
      title: z.string().min(1).max(100).optional(),
      command: z.string().min(1).optional(),
    }),
    terminalInfoSchema,
  ),
  'terminal.list': defineChannel('terminal.list', none, z.array(terminalInfoSchema)),
  /** Raw output kept in main (up to ~256 KB) so a reloaded renderer can redraw a terminal. */
  'terminal.scrollback': defineChannel('terminal.scrollback', terminalId, z.object({ data: z.string() })),
  'terminal.write': defineChannel('terminal.write', terminalId.extend({ data: z.string().max(1_000_000) }), none),
  'terminal.resize': defineChannel('terminal.resize', terminalId.extend(terminalSizeSchema.shape), none),
  'terminal.rename': defineChannel('terminal.rename', terminalId.extend({ title: z.string().min(1).max(100) }), none),
  /** Kills the process tree; the tab stays until `terminal.close`. */
  'terminal.kill': defineChannel('terminal.kill', terminalId, none),
  /** Kills the process tree and removes the terminal. */
  'terminal.close': defineChannel('terminal.close', terminalId, none),
  /** ANSI-stripped output lines (the buffer `devserver_logs` reads in Stage 5). */
  'terminal.lines': defineChannel(
    'terminal.lines',
    terminalId.extend({ count: z.number().int().min(1).max(10_000).optional() }),
    z.array(z.string()),
  ),

  /**
   * Runs the project's dev command in the dedicated `dev` terminal, inferring it from `package.json`
   * (and writing `.arbora/project.json`) the first time. Restarts it if it is already running.
   */
  'devServer.run': defineChannel(
    'devServer.run',
    terminalSizeSchema.partial(),
    z.object({ terminal: terminalInfoSchema.nullable(), error: z.string().optional() }),
  ),
  'devServer.stop': defineChannel('devServer.stop', none, none),
  'devServer.status': defineChannel('devServer.status', none, devServerStatusSchema),

  /** Built-in and custom agents with whether their executable resolves on the login-shell PATH. */
  'agent.listAgents': defineChannel(
    'agent.listAgents',
    none,
    z.object({ agents: z.array(agentDefinitionSchema), availability: z.array(agentAvailabilitySchema) }),
  ),
  'agent.listThreads': defineChannel('agent.listThreads', none, z.array(threadSummarySchema)),
  'agent.createThread': defineChannel('agent.createThread', z.object({ agentId: z.string() }), threadSummarySchema),
  'agent.getThread': defineChannel('agent.getThread', threadId, threadSchema.nullable()),
  'agent.deleteThread': defineChannel('agent.deleteThread', threadId, none),
  'agent.renameThread': defineChannel(
    'agent.renameThread',
    threadId.extend({ title: z.string().min(1).max(200) }),
    none,
  ),
  /**
   * Sends a prompt. Starts the agent (spawn, `initialize`, `session/new` or load) on the first
   * call. Resolves when the turn ends; progress arrives through `agent.threadEvents`.
   */
  'agent.prompt': defineChannel(
    'agent.prompt',
    threadId.extend({
      blocks: z.array(contentBlockSchema),
      /** Converted in main: images to `image` blocks when supported, other files to `resource_link`s. */
      attachments: z.array(attachmentSchema).default([]),
    }),
    z.object({ stopReason: z.string().nullable(), error: z.string().optional() }),
  ),
  'agent.cancel': defineChannel('agent.cancel', threadId, none),
  /**
   * Stops whatever the agent is doing: cancels the turn, and stops the agent process if it does
   * not end the turn within a few seconds or is still starting.
   */
  'agent.stop': defineChannel('agent.stop', threadId, none),
  /** Answers a pending permission card with one of the agent's own option ids. */
  'agent.respondPermission': defineChannel(
    'agent.respondPermission',
    threadId.extend({ requestId: z.string(), optionId: z.string() }),
    none,
  ),
  'agent.setMode': defineChannel('agent.setMode', threadId.extend({ modeId: z.string() }), none),
  'agent.setConfigOption': defineChannel(
    'agent.setConfigOption',
    threadId.extend({ configId: z.string(), value: z.union([z.string(), z.boolean()]) }),
    none,
  ),
  'agent.setAutoApproveEdits': defineChannel(
    'agent.setAutoApproveEdits',
    threadId.extend({ enabled: z.boolean() }),
    none,
  ),
  'agent.authenticate': defineChannel('agent.authenticate', threadId.extend({ methodId: z.string() }), none),
  /** Stops the agent process (if any) and starts it again on the next prompt. */
  'agent.restart': defineChannel('agent.restart', threadId, none),
  'agent.getLog': defineChannel('agent.getLog', threadId, z.array(acpLogEntrySchema)),
  /** Writes the redacted log as JSON; `path` is null when the save dialog was cancelled. */
  'agent.exportLog': defineChannel('agent.exportLog', threadId, z.object({ path: z.string().nullable() })),
  /** Native file picker for composer attachments. */
  'agent.pickAttachments': defineChannel('agent.pickAttachments', none, z.array(attachmentSchema)),
  /** Attachment metadata for dropped files (size, MIME type, image or file). */
  'agent.describeAttachments': defineChannel(
    'agent.describeAttachments',
    z.object({ paths: z.array(z.string()).max(50) }),
    z.array(attachmentSchema),
  ),
  /** Removes `agentId:toolKind` entries from remembered permissions (all when omitted). */
  'agent.forgetPermissions': defineChannel(
    'agent.forgetPermissions',
    z.object({ agentId: z.string().optional() }),
    none,
  ),

  /**
   * Agent mode (`Mod+K`): `true` (re)starts the page inspector's hover highlight, `false` removes
   * it and drops any pending selection.
   */
  'agentMode.setInspecting': defineChannel('agentMode.setInspecting', z.object({ active: z.boolean() }), none),
  /**
   * Builds the prompt for a selection (outlined screenshot, source links, context) and sends it to
   * an existing thread or a new one. Resolves once the turn has started, with the thread id.
   */
  'agentMode.submit': defineChannel(
    'agentMode.submit',
    z.object({
      selectionId: z.string(),
      targetIndex: z.number().int().min(0),
      text: z.string().min(1).max(20_000),
      include: agentModeIncludeSchema,
      target: agentModeTargetSchema,
    }),
    z.object({ threadId: z.string() }),
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
  /** Output from one terminal, batched per animation frame or so. */
  'terminal.data': defineEvent('terminal.data', z.object({ id: z.string(), data: z.string() })),
  /** The set of terminals or one terminal's title, pid or exit code changed. */
  'terminal.changed': defineEvent('terminal.changed', z.object({ terminals: z.array(terminalInfoSchema) })),
  /**
   * A terminal printed a local dev-server URL it had not printed before. `opened` is true when the
   * empty browser panel loaded it (`autoOpenDevUrl`).
   */
  'terminal.urlDetected': defineEvent(
    'terminal.urlDetected',
    z.object({ id: z.string(), url: z.string(), opened: z.boolean() }),
  ),
  /** The thread list or a thread's metadata/state changed. */
  'agent.threadsChanged': defineEvent('agent.threadsChanged', z.object({ threads: z.array(threadSummarySchema) })),
  /** Transcript updates for one thread, in order. */
  'agent.threadEvents': defineEvent(
    'agent.threadEvents',
    z.object({ threadId: z.string(), changes: z.array(threadChangeSchema).min(1) }),
  ),
  'agent.threadState': defineEvent('agent.threadState', z.object({ threadId: z.string(), state: threadStateSchema })),
  'agent.log': defineEvent('agent.log', z.object({ threadId: z.string(), entry: acpLogEntrySchema })),
  /** An agent wrote a file through `fs/write_text_file` (Stage 8's "Agent changes" group). */
  'agent.fileChanged': defineEvent('agent.fileChanged', z.object({ threadId: z.string(), path: z.string() })),
  /** Agent mode: the user clicked an element; main is taking the screenshot and resolving sources. */
  'agentMode.picked': defineEvent('agentMode.picked', z.object({})),
  'agentMode.selected': defineEvent('agentMode.selected', agentModeSelectionSchema),
  /** Agent mode ended from the page (`Esc` there, a navigation) or the selection could not be resolved. */
  'agentMode.ended': defineEvent('agentMode.ended', z.object({ error: z.string().optional() })),
} as const;

export type Channels = typeof channels;
export type Events = typeof events;

/** The object exposed to the renderer as `window.arbora`. */
export interface ArboraBridge extends IpcClient<Channels, Events> {
  readonly platform: z.infer<typeof platformSchema>;
  /** Resolves the filesystem path of a dropped `File` (Electron removed `File.path`). */
  getPathForFile(file: File): string;
}
