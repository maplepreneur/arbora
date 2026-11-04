import { z } from 'zod';
import {
  acpLogEntrySchema,
  agentAvailabilitySchema,
  agentDefinitionSchema,
  agentGroupSchema,
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
import { designCommandSchema, designSessionSummarySchema, designStateSchema } from './design.js';
import { agentModeIncludeSchema, agentModeSelectionSchema, agentModeTargetSchema } from './inspector.js';
import {
  generatedTextSchema,
  gitBranchSchema,
  gitCommitSchema,
  gitGenerateKindSchema,
  gitSyncResultSchema,
  gitHunkSchema,
  gitLineSchema,
  gitRemoteSchema,
  gitResultSchema,
  gitStashSchema,
  gitStatusSchema,
  githubAuthSchema,
  githubCheckSchema,
  githubPrSchema,
} from './git.js';
import {
  diagnosticSchema,
  diagnosticSourceSchema,
  eolSchema,
  fileChangeSchema,
  fileContentSchema,
  fileEntrySchema,
  fileKindSchema,
  relativePathSchema,
  saveResultSchema,
  searchMatchSchema,
  searchQuerySchema,
} from './files.js';
import { defineChannel, defineEvent, type IpcClient } from './ipc.js';
import { platformSchema } from './platform.js';
import { PROJECT_FRAMEWORKS } from './project-framework.js';
import { projectLibrarySchema, projectMetaPatchSchema } from './projects.js';
import {
  agentVerificationSchema,
  appSettingsPatchSchema,
  appSettingsSchema,
  attentionKindSchema,
  layoutStateSchema,
  projectSettingsPatchSchema,
  projectSettingsSchema,
  recentProjectSchema,
  themeModeSchema,
  workspaceKindSchema,
} from './settings.js';
import {
  skillLibrarySchema,
  skillNameSchema,
  skillSearchResultSchema,
  skillSourceSchema,
  skillTargetIdSchema,
} from './skills.js';
import { mcpServerConfigSchema } from './mcp-servers.js';
import { devServerStatusSchema, terminalInfoSchema, terminalKindSchema, terminalSizeSchema } from './terminal.js';
import { installKindSchema, updateStateSchema } from './updates.js';

const terminalId = z.object({ id: z.string() });
const filePath = z.object({ path: relativePathSchema });
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
  /** `ARBORA_SKIP_ONBOARDING=1` (e2e runs): never show the first-run wizard. */
  skipOnboarding: z.boolean().default(false),
  installKind: installKindSchema.default('dev'),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

export const windowStateSchema = z.object({
  maximized: z.boolean(),
  fullScreen: z.boolean(),
  focused: z.boolean(),
  /**
   * Set when this window opened into Grove with no browser project. Absent on the projects home
   * and once a project is open (that project's layout decides the workspace).
   */
  workspace: workspaceKindSchema.optional(),
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
  designActive: z.boolean().default(false),
  textEditing: z.boolean().default(false),
  /** The shortcut editor is recording a chord: main must let every key through to it. */
  recording: z.boolean().default(false),
  workspace: workspaceKindSchema.default('browser'),
});

/** Request/response channels. Keep this the single registry of IPC surface. */
export const channels = {
  'app.getInfo': defineChannel('app.getInfo', none, appInfoSchema),
  /**
   * Shows a desktop notification (skipped without a notification daemon). A click focuses the
   * window and sends `notification.clicked` with the same `threadId`.
   */
  'app.notify': defineChannel(
    'app.notify',
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(500),
      threadId: z.string().nullable(),
      kind: attentionKindSchema,
    }),
    none,
  ),
  /** This window's count of threads that need the user: dock badge, taskbar flash, Projects page. */
  'app.setAttention': defineChannel('app.setAttention', z.object({ count: z.number().int().min(0) }), none),
  /** Opens an http(s) URL in the OS browser. */
  'app.openExternal': defineChannel('app.openExternal', z.object({ url: z.url({ protocol: /^https?$/ }) }), none),

  /** Arbora's skill library (`~/.arbora/skills`) and which agents' skill folders link to each skill. */
  'skills.list': defineChannel('skills.list', none, skillLibrarySchema),
  /** Links the skill into exactly these agents' folders (symlinks) and unlinks it from the rest. */
  'skills.setTargets': defineChannel(
    'skills.setTargets',
    z.object({ name: skillNameSchema, targets: z.array(skillTargetIdSchema) }),
    skillLibrarySchema,
  ),
  /** Unlinks the skill everywhere and deletes it from the library. */
  'skills.remove': defineChannel('skills.remove', z.object({ name: skillNameSchema }), skillLibrarySchema),
  /** Moves a skill found in an agent folder into the library and links it back. */
  'skills.adopt': defineChannel('skills.adopt', z.object({ name: skillNameSchema }), skillLibrarySchema),
  'skills.reveal': defineChannel('skills.reveal', z.object({ name: skillNameSchema.nullable() }), none),
  /** skills.sh search. */
  'skills.search': defineChannel(
    'skills.search',
    z.object({ query: z.string().min(2).max(200) }),
    z.array(skillSearchResultSchema),
  ),
  /** Clones the skill's GitHub repository, copies the skill into the library and links it. */
  'skills.install': defineChannel(
    'skills.install',
    z.object({ source: skillSourceSchema, skillId: skillNameSchema, targets: z.array(skillTargetIdSchema) }),
    skillLibrarySchema,
  ),
  /** MCP servers in other tools' config files (Claude Code, Cursor, Gemini, the project's `.mcp.json`). */
  'mcp.importable': defineChannel(
    'mcp.importable',
    none,
    z.array(z.object({ origin: z.string(), path: z.string(), servers: z.array(mcpServerConfigSchema) })),
  ),

  /** Zips app info, redacted settings, logs and crash-dump names; `path` is null when cancelled. */
  'diagnostics.export': defineChannel('diagnostics.export', none, z.object({ path: z.string().nullable() })),
  'diagnostics.openCrashFolder': defineChannel('diagnostics.openCrashFolder', none, none),

  'updates.getState': defineChannel(
    'updates.getState',
    none,
    z.object({
      state: updateStateSchema,
      installKind: installKindSchema,
      version: z.string(),
      /** False for installs that only learn about new versions (deb, AUR, tarball, unsigned macOS). */
      selfUpdates: z.boolean(),
      /** Started by `scripts/arbora-local`, which moves the checkout to the channel's branch. */
      sourceLauncher: z.boolean(),
    }),
  ),
  'updates.check': defineChannel('updates.check', none, updateStateSchema),
  'updates.download': defineChannel('updates.download', none, none),
  /** Quits and installs a downloaded update. */
  'updates.install': defineChannel('updates.install', none, none),

  /** Every project worth listing (recent, pinned, grouped) with live window and attention counts. */
  'projects.library': defineChannel('projects.library', none, projectLibrarySchema),
  'projects.updateMeta': defineChannel(
    'projects.updateMeta',
    z.object({ path: z.string().min(1), patch: projectMetaPatchSchema }),
    projectLibrarySchema,
  ),
  /** Drops a project from the list: recents, pin and group. Its layout and browser state stay. */
  'projects.forget': defineChannel('projects.forget', z.object({ path: z.string().min(1) }), projectLibrarySchema),
  'projects.reveal': defineChannel('projects.reveal', z.object({ path: z.string().min(1) }), none),

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
  /**
   * Opens `path`, or shows the native folder dialog when omitted.
   * `onThisWindow` attaches that folder on the calling window (the shared runtime, not a second one).
   * A window that already has it is focused instead; `url` is then loaded in that window's browser.
   */
  'project.open': defineChannel(
    'project.open',
    z.object({
      path: z.string().min(1).optional(),
      onThisWindow: z.boolean().optional(),
      url: z.string().optional(),
    }),
    z.object({ opened: z.boolean(), error: z.string().optional(), focusedElsewhere: z.boolean().optional() }),
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
  /** Writes fields of `.arbora/project.json` (Settings → Project, onboarding). */
  'project.updateSettings': defineChannel('project.updateSettings', projectSettingsPatchSchema, projectInfoSchema),
  /** The dev command `package.json` scripts and the lockfile suggest, without saving it. */
  'project.detectDevCommand': defineChannel(
    'project.detectDevCommand',
    none,
    z.object({ command: z.string().nullable() }),
  ),
  'project.openScreenshots': defineChannel('project.openScreenshots', none, none),

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
  /** Clears cookies, storage and cache of this project's browser partition, then reloads the page. */
  'browser.resetData': defineChannel('browser.resetData', none, none),
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

  /** Points this window's Grove terminal and agent calls at a project, or back at the window's project. */
  'grove.focusProject': defineChannel('grove.focusProject', z.object({ path: z.string().nullable() }), none),
  /** Adds a folder to Grove. With no path, asks for one. The folder is not opened as this window's project. */
  'grove.addProject': defineChannel(
    'grove.addProject',
    z.object({ path: z.string().optional() }),
    z.object({ added: z.boolean(), path: z.string().optional(), error: z.string().optional() }),
  ),
  /**
   * Removes a folder from Grove. When something is running and `confirm` is not set, nothing is
   * removed and `running` is true so the renderer can ask first.
   */
  'grove.removeProject': defineChannel(
    'grove.removeProject',
    z.object({ path: z.string(), confirm: z.boolean().optional() }),
    z.object({ removed: z.boolean(), running: z.boolean().optional() }),
  ),
  'grove.setCollapsed': defineChannel(
    'grove.setCollapsed',
    z.object({ path: z.string(), collapsed: z.boolean() }),
    none,
  ),
  'grove.commands': defineChannel(
    'grove.commands',
    z.object({ path: z.string() }),
    z.object({
      commands: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          command: z.string(),
          source: z.enum(['package.json', 'rails', 'procfile', 'makefile', 'composer', 'cargo', 'go']),
          trusted: z.boolean(),
        }),
      ),
      framework: z.enum(PROJECT_FRAMEWORKS),
    }),
  ),
  'grove.trustCommand': defineChannel('grove.trustCommand', z.object({ path: z.string(), command: z.string() }), none),
  /**
   * Every runtime's terminals, so Grove can show a command's running count for a project that is
   * not the one this window is focused on.
   */
  'grove.terminals': defineChannel(
    'grove.terminals',
    none,
    z.object({
      projects: z.array(z.object({ path: z.string(), terminals: z.array(terminalInfoSchema) })),
    }),
  ),
  /**
   * Every runtime's threads, so Grove can list agents under projects that are not focused.
   * `waiting` is a permission or sign-in still open in the transcript. Finishes are not included:
   * those are live attention, cleared once the user looks.
   */
  'grove.agents': defineChannel(
    'grove.agents',
    none,
    z.object({
      projects: z.array(
        z.object({
          path: z.string(),
          threads: z.array(threadSummarySchema),
          waiting: z.array(
            z.object({
              threadId: z.string(),
              permissionIds: z.array(z.string()),
              permissionTitle: z.string().nullable(),
              auth: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  /**
   * Starts an agent in a new git worktree of `parentPath`. The worktree is registered as its own
   * Grove project only after `git worktree add` succeeds. A failure leaves the Grove list unchanged.
   */
  'grove.createWorktree': defineChannel(
    'grove.createWorktree',
    z.object({
      parentPath: z.string(),
      title: z.string().trim().min(1).max(200),
      agentId: z.string(),
      model: z.string().max(300).optional(),
    }),
    z.object({ path: z.string().optional(), threadId: z.string().optional(), error: z.string().optional() }),
  ),
  'grove.runCommand': defineChannel(
    'grove.runCommand',
    z
      .object({ path: z.string(), command: z.string(), title: z.string().optional() })
      .extend(terminalSizeSchema.partial().shape),
    terminalInfoSchema,
  ),

  /** Built-in and custom agents with whether their executable resolves on the login-shell PATH. */
  'agent.listAgents': defineChannel(
    'agent.listAgents',
    none,
    z.object({ agents: z.array(agentDefinitionSchema), availability: z.array(agentAvailabilitySchema) }),
  ),
  /**
   * Starts the agent once (`initialize`, `session/new`), records whether it is signed in and which
   * models it offers under `settings.agents.verified`, and stops it.
   */
  'agent.verify': defineChannel('agent.verify', z.object({ agentId: z.string() }), agentVerificationSchema),
  'agent.listThreads': defineChannel('agent.listThreads', none, z.array(threadSummarySchema)),
  /**
   * `model` is a value of the agent's `model` config option; it wins over the agent's default model.
   * `title` names the thread before its first prompt (Grove's launcher titles it with the task).
   */
  'agent.createThread': defineChannel(
    'agent.createThread',
    z.object({
      agentId: z.string(),
      model: z.string().max(300).optional(),
      groupId: z.string().nullable().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    }),
    threadSummarySchema,
  ),
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
  /**
   * Ends the agent process in any state (Grove's Stop). The thread shows as Stopped; the next
   * prompt starts the agent again and restores the session when it can.
   */
  'agent.stopProcess': defineChannel('agent.stopProcess', threadId, none),
  /** Moves a thread to Grove's Recent (stopping its process first) or back to the list. */
  'agent.archiveThread': defineChannel('agent.archiveThread', threadId.extend({ archived: z.boolean() }), none),
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
  /** Saves the clipboard image to `.arbora/pasted/` and describes it; null when there is none. */
  'agent.pasteImage': defineChannel('agent.pasteImage', none, attachmentSchema.nullable()),
  'agent.listGroups': defineChannel('agent.listGroups', none, z.array(agentGroupSchema)),
  /** Replaces the project's groups (order, names, colours). Threads of a removed group are ungrouped. */
  'agent.saveGroups': defineChannel(
    'agent.saveGroups',
    z.object({ groups: z.array(agentGroupSchema).max(100) }),
    z.array(agentGroupSchema),
  ),
  'agent.setThreadGroup': defineChannel(
    'agent.setThreadGroup',
    threadId.extend({ groupId: z.string().nullable() }),
    none,
  ),
  'agent.setThreadPinned': defineChannel('agent.setThreadPinned', threadId.extend({ pinned: z.boolean() }), none),
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

  /** Design mode (`Mod+D`): `true` takes the before screenshot and shows the overlay. */
  'design.setActive': defineChannel('design.setActive', z.object({ active: z.boolean() }), none),
  /** A properties-panel or chord edit. The page applies it and mirrors the op list back. */
  'design.command': defineChannel('design.command', designCommandSchema, none),
  /** After screenshot, change list and sources, sent to a thread. The live DOM is reverted first. */
  'design.save': defineChannel(
    'design.save',
    z.object({ target: agentModeTargetSchema }),
    z.object({ threadId: z.string() }),
  ),
  'design.discard': defineChannel('design.discard', none, none),
  'design.listSessions': defineChannel('design.listSessions', none, z.array(designSessionSummarySchema)),
  'design.resend': defineChannel(
    'design.resend',
    z.object({ id: z.string(), target: agentModeTargetSchema }),
    z.object({ threadId: z.string() }),
  ),

  /** Children of a project folder, folders first. The watcher covers folders listed here. */
  'files.readDir': defineChannel('files.readDir', filePath, z.array(fileEntrySchema)),
  'files.read': defineChannel('files.read', filePath, fileContentSchema),
  /**
   * Writes `content` (any line ends) with `eol`, after the project's Prettier when `format` is set
   * and enabled in settings. Diagnostics follow through `editor.diagnostics`.
   */
  'files.write': defineChannel(
    'files.write',
    filePath.extend({ content: z.string().max(100_000_000), eol: eolSchema, format: z.boolean().default(true) }),
    saveResultSchema,
  ),
  /** Fails when something already exists at `path`. */
  'files.create': defineChannel('files.create', filePath.extend({ kind: fileKindSchema }), none),
  /** Moves or renames; fails when `to` exists. */
  'files.rename': defineChannel('files.rename', z.object({ from: relativePathSchema, to: relativePathSchema }), none),
  /** Moves to the OS trash. */
  'files.delete': defineChannel('files.delete', filePath, none),
  'files.reveal': defineChannel('files.reveal', filePath, none),
  /** Every file not ignored, for quick open. Cached in main and refreshed by the watcher. */
  'files.list': defineChannel('files.list', none, z.object({ files: z.array(z.string()), truncated: z.boolean() })),

  /** Starts a project search; matches stream through `search.results`, then `search.done`. */
  'search.start': defineChannel('search.start', searchQuerySchema, z.object({ searchId: z.string() })),
  'search.cancel': defineChannel('search.cancel', z.object({ searchId: z.string() }), none),

  /** Formats text with the project's Prettier without saving; `content` is null when it has none. */
  'editor.format': defineChannel(
    'editor.format',
    filePath.extend({ content: z.string().max(100_000_000) }),
    z.object({ content: z.string().nullable(), error: z.string().optional() }),
  ),

  'git.status': defineChannel('git.status', none, gitStatusSchema),
  'git.diff': defineChannel(
    'git.diff',
    z.object({ path: relativePathSchema.optional(), staged: z.boolean() }),
    z.object({ text: z.string() }),
  ),
  'git.hunks': defineChannel('git.hunks', filePath.extend({ staged: z.boolean() }), z.array(gitHunkSchema)),
  'git.lines': defineChannel('git.lines', filePath, z.array(gitLineSchema)),
  'git.sides': defineChannel(
    'git.sides',
    filePath.extend({ staged: z.boolean() }),
    z.object({ left: z.string(), right: z.string() }),
  ),
  'git.stage': defineChannel('git.stage', z.object({ paths: z.array(relativePathSchema) }), none),
  'git.unstage': defineChannel('git.unstage', z.object({ paths: z.array(relativePathSchema) }), none),
  'git.stageHunk': defineChannel(
    'git.stageHunk',
    filePath.extend({ index: z.number().int().nonnegative(), staged: z.boolean() }),
    none,
  ),
  'git.discard': defineChannel('git.discard', z.object({ paths: z.array(relativePathSchema) }), none),
  'git.commit': defineChannel(
    'git.commit',
    z.object({ message: z.string().min(1).max(100_000), amend: z.boolean().default(false) }),
    gitResultSchema,
  ),
  'git.branches': defineChannel('git.branches', none, z.array(gitBranchSchema)),
  'git.checkout': defineChannel('git.checkout', z.object({ name: z.string().min(1).max(255) }), gitResultSchema),
  'git.createBranch': defineChannel(
    'git.createBranch',
    z.object({ name: z.string().min(1).max(255) }),
    gitResultSchema,
  ),
  'git.log': defineChannel('git.log', none, z.array(gitCommitSchema)),
  'git.push': defineChannel('git.push', none, gitResultSchema),
  'git.pull': defineChannel('git.pull', none, gitResultSchema),
  'git.fetch': defineChannel('git.fetch', none, gitResultSchema),
  'git.stash': defineChannel('git.stash', none, z.array(gitStashSchema)),
  /** How many `.arbora/` files are committed (ignored folders stay tracked until untracked). */
  'git.arboraTracked': defineChannel('git.arboraTracked', none, z.object({ count: z.number().int().nonnegative() })),
  /** `git rm -r --cached .arbora`: stop tracking it, keep the files. */
  'git.untrackArbora': defineChannel('git.untrackArbora', none, gitResultSchema),
  'git.stashApply': defineChannel(
    'git.stashApply',
    z.object({ index: z.number().int().nonnegative(), pop: z.boolean() }),
    gitResultSchema,
  ),
  'git.stashDrop': defineChannel('git.stashDrop', z.object({ index: z.number().int().nonnegative() }), gitResultSchema),
  'git.remotes': defineChannel('git.remotes', none, z.array(gitRemoteSchema)),
  'git.github': defineChannel('git.github', none, githubAuthSchema),
  'git.pullRequests': defineChannel('git.pullRequests', none, z.array(githubPrSchema)),
  'git.createPullRequest': defineChannel(
    'git.createPullRequest',
    z.object({ title: z.string().min(1).max(300), body: z.string().max(100_000) }),
    z.object({ url: z.string() }),
  ),
  'git.checks': defineChannel(
    'git.checks',
    z.object({ number: z.number().int().positive() }),
    z.array(githubCheckSchema),
  ),
  /** `git add -A`. */
  'git.stageAll': defineChannel('git.stageAll', none, none),
  /** The branch pull requests target (`origin/HEAD`, else `main`/`master`). */
  'git.defaultBranch': defineChannel('git.defaultBranch', none, z.string().nullable()),
  /**
   * A commit message for the staged changes, or pull request text for the current branch, from
   * the Git task agent (`settings.tasks.git`) in a hidden session: nothing appears in a thread.
   */
  'git.generate': defineChannel('git.generate', z.object({ kind: gitGenerateKindSchema }), generatedTextSchema),
  /** Runs the background sync now; null when sync is off or the repository has no remote. */
  'git.syncNow': defineChannel('git.syncNow', none, gitSyncResultSchema.nullable()),
} as const;

/** Main -> renderer events. */
export const events = {
  'settings.changed': defineEvent('settings.changed', appSettingsSchema),
  'theme.changed': defineEvent('theme.changed', themeStateSchema),
  'project.changed': defineEvent('project.changed', projectInfoSchema.nullable()),
  'window.stateChanged': defineEvent('window.stateChanged', windowStateSchema),
  /** The background git sync ran (`settings.git.autoSync`). */
  'git.synced': defineEvent('git.synced', gitSyncResultSchema),
  /** A chord intercepted in main (or a menu action) asks the renderer to run a command. */
  'command.invoke': defineEvent('command.invoke', z.object({ commandId: z.string() })),
  'browser.stateChanged': defineEvent('browser.stateChanged', navigationStateSchema),
  /** New console/exception/network entries since the last event, batched. */
  'browser.problemsAdded': defineEvent('browser.problemsAdded', z.object({ entries: z.array(problemEntrySchema) })),
  'browser.problemsCleared': defineEvent('browser.problemsCleared', z.object({})),
  'browser.urlSuggested': defineEvent('browser.urlSuggested', z.object({ url: z.string() })),
  /** Output from one terminal, batched per animation frame or so. */
  'terminal.data': defineEvent(
    'terminal.data',
    z.object({ projectPath: z.string(), id: z.string(), data: z.string() }),
  ),
  /** The set of terminals or one terminal's title, pid or exit code changed. */
  'terminal.changed': defineEvent(
    'terminal.changed',
    z.object({ projectPath: z.string(), terminals: z.array(terminalInfoSchema) }),
  ),
  /**
   * A terminal printed a local dev-server URL it had not printed before. `opened` is true when the
   * empty browser panel loaded it (`autoOpenDevUrl`).
   */
  'terminal.urlDetected': defineEvent(
    'terminal.urlDetected',
    z.object({ projectPath: z.string(), id: z.string(), url: z.string(), opened: z.boolean() }),
  ),
  /** The thread list or a thread's metadata/state changed. */
  'agent.threadsChanged': defineEvent(
    'agent.threadsChanged',
    z.object({ projectPath: z.string(), threads: z.array(threadSummarySchema) }),
  ),
  'agent.groupsChanged': defineEvent(
    'agent.groupsChanged',
    z.object({ projectPath: z.string(), groups: z.array(agentGroupSchema) }),
  ),
  /** A desktop notification from `app.notify` was clicked. */
  'notification.clicked': defineEvent('notification.clicked', z.object({ threadId: z.string().nullable() })),
  'updates.state': defineEvent('updates.state', updateStateSchema),
  /** Recent/pinned/grouped projects, open windows or their attention counts changed. */
  'projects.changed': defineEvent('projects.changed', projectLibrarySchema),
  /** Transcript updates for one thread, in order. */
  'agent.threadEvents': defineEvent(
    'agent.threadEvents',
    z.object({ projectPath: z.string(), threadId: z.string(), changes: z.array(threadChangeSchema).min(1) }),
  ),
  'agent.threadState': defineEvent(
    'agent.threadState',
    z.object({ projectPath: z.string(), threadId: z.string(), state: threadStateSchema }),
  ),
  'agent.log': defineEvent(
    'agent.log',
    z.object({ projectPath: z.string(), threadId: z.string(), entry: acpLogEntrySchema }),
  ),
  /** An agent wrote a file through `fs/write_text_file` (Stage 8's "Agent changes" group). */
  'agent.fileChanged': defineEvent(
    'agent.fileChanged',
    z.object({ projectPath: z.string(), threadId: z.string(), path: z.string() }),
  ),
  /** Memory and CPU of the agent and terminal process trees, while Grove is showing. */
  'grove.usage': defineEvent(
    'grove.usage',
    z.object({
      samples: z.array(
        z.object({
          projectPath: z.string(),
          kind: z.enum(['terminal', 'agent']),
          id: z.string(),
          rssKb: z.number(),
          cpuPercent: z.number(),
          agentCli: z.string().nullable(),
        }),
      ),
    }),
  ),
  /** Agent mode: the user clicked an element; main is taking the screenshot and resolving sources. */
  'agentMode.picked': defineEvent('agentMode.picked', z.object({})),
  'agentMode.selected': defineEvent('agentMode.selected', agentModeSelectionSchema),
  /** Agent mode ended from the page (`Esc` there, a navigation) or the selection could not be resolved. */
  'agentMode.ended': defineEvent('agentMode.ended', z.object({ error: z.string().optional() })),
  /** Design mode op list, selection and text-editing flag. */
  'design.state': defineEvent('design.state', designStateSchema),
  /** A navigation was blocked because design edits have not been saved. */
  'design.navigationBlocked': defineEvent('design.navigationBlocked', z.object({ url: z.string() })),
  /** Entering or leaving design mode failed (usually the before screenshot). */
  'design.failed': defineEvent('design.failed', z.object({ error: z.string() })),
  /** Files and folders that changed on disk, coalesced. */
  'files.changed': defineEvent('files.changed', z.object({ changes: z.array(fileChangeSchema) })),
  /** The watcher hit a limit (inotify) and fell back to polling the folders open in the explorer. */
  'files.watchWarning': defineEvent('files.watchWarning', z.object({ message: z.string() })),
  'search.results': defineEvent(
    'search.results',
    z.object({ searchId: z.string(), matches: z.array(searchMatchSchema) }),
  ),
  'search.done': defineEvent(
    'search.done',
    z.object({ searchId: z.string(), total: z.number().int(), truncated: z.boolean(), error: z.string().optional() }),
  ),
  /** The latest diagnostics for one file from one tool; an empty list clears them. */
  'editor.diagnostics': defineEvent(
    'editor.diagnostics',
    z.object({ path: z.string(), source: diagnosticSourceSchema, diagnostics: z.array(diagnosticSchema) }),
  ),
  /** A tool could not run (crash, timeout, bad config). Shown once per message. */
  'editor.toolError': defineEvent('editor.toolError', z.object({ source: z.string(), message: z.string() })),
} as const;

export type Channels = typeof channels;
export type Events = typeof events;

/** The object exposed to the renderer as `window.arbora`. */
export interface ArboraBridge extends IpcClient<Channels, Events> {
  readonly platform: z.infer<typeof platformSchema>;
  /** Resolves the filesystem path of a dropped `File` (Electron removed `File.path`). */
  getPathForFile(file: File): string;
}
