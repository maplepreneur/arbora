import { z } from 'zod';
import type { KeybindingSpec, KeybindingWhen } from './keybindings.js';

/**
 * Static description of a command, shared by main (which needs default bindings to intercept
 * chords) and the renderer (which implements `run`).
 */
export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  /** Default chord, e.g. `mod+k`. Users override it in settings or `.arbora/project.json`. */
  readonly keybinding?: string;
  /**
   * More default chords for the same command. A user or project override replaces the whole set
   * with that one chord. Labels show `keybinding`, not these.
   */
  readonly extraKeybindings?: readonly string[];
  readonly when?: KeybindingWhen;
  /** Handle in main via `before-input-event` so it wins over the embedded page and terminal. */
  readonly intercept?: boolean;
  /** Hidden from the command palette (e.g. `exitMode`, which only makes sense as a chord). */
  readonly hidden?: boolean;
}

export const CommandId = {
  commandPalette: 'arbora.commandPalette',
  agentMode: 'arbora.agentMode',
  designMode: 'arbora.designMode',
  exitMode: 'arbora.exitMode',
  quickOpen: 'arbora.quickOpen',
  openProject: 'arbora.openProject',
  closeProject: 'arbora.closeProject',
  toggleTheme: 'arbora.toggleTheme',
  toggleSidebar: 'arbora.toggleSidebar',
  toggleAgentPanel: 'arbora.toggleAgentPanel',
  toggleBottomPanel: 'arbora.toggleBottomPanel',
  resetLayout: 'arbora.resetLayout',
  openSettings: 'arbora.openSettings',
  openSettingsFile: 'arbora.openSettingsFile',
  openProjectSettingsFile: 'arbora.openProjectSettingsFile',
  showFiles: 'arbora.showFiles',
  showGitSidebar: 'arbora.showGitSidebar',
  showSearch: 'arbora.showSearch',
  showTerminal: 'arbora.showTerminal',
  showGitPanel: 'arbora.showGitPanel',
  showProblems: 'arbora.showProblems',
  reloadWindow: 'arbora.reloadWindow',
  toggleAppDevTools: 'arbora.toggleAppDevTools',
  browserFocusUrl: 'arbora.browser.focusUrl',
  browserOpenDevUrl: 'arbora.browser.openDevUrl',
  browserBack: 'arbora.browser.back',
  browserForward: 'arbora.browser.forward',
  browserReload: 'arbora.browser.reload',
  browserHardReload: 'arbora.browser.hardReload',
  browserOpenExternal: 'arbora.browser.openExternal',
  browserToggleDevTools: 'arbora.browser.toggleDevTools',
  browserZoomIn: 'arbora.browser.zoomIn',
  browserZoomOut: 'arbora.browser.zoomOut',
  browserZoomReset: 'arbora.browser.zoomReset',
  browserViewportResponsive: 'arbora.browser.viewport.responsive',
  browserViewportMobile: 'arbora.browser.viewport.mobile',
  browserViewportTablet: 'arbora.browser.viewport.tablet',
  browserViewportLaptop: 'arbora.browser.viewport.laptop',
  browserViewportDesktop: 'arbora.browser.viewport.desktop',
  browserScreenshot: 'arbora.browser.screenshot',
  browserFullPageScreenshot: 'arbora.browser.fullPageScreenshot',
  browserClearProblems: 'arbora.browser.clearProblems',
  terminalNew: 'arbora.terminal.new',
  terminalSplitRight: 'arbora.terminal.splitRight',
  terminalSplitDown: 'arbora.terminal.splitDown',
  terminalKill: 'arbora.terminal.kill',
  terminalClear: 'arbora.terminal.clear',
  terminalFind: 'arbora.terminal.find',
  terminalRename: 'arbora.terminal.rename',
  devServerRun: 'arbora.devServer.run',
  devServerRestart: 'arbora.devServer.restart',
  devServerStop: 'arbora.devServer.stop',
  openFileAtLocation: 'arbora.editor.openFileAtLocation',
  showBrowser: 'arbora.showBrowser',
  editorSave: 'arbora.editor.save',
  editorCloseTab: 'arbora.editor.closeTab',
  editorFormat: 'arbora.editor.format',
  editorCompareWithSaved: 'arbora.editor.compareWithSaved',
  filesNewFile: 'arbora.files.newFile',
  filesNewFolder: 'arbora.files.newFolder',
  filesRevealInOS: 'arbora.files.revealInOS',
  filesRefresh: 'arbora.files.refresh',
  agentNewThread: 'arbora.agent.newThread',
  agentFocusComposer: 'arbora.agent.focusComposer',
  agentCancel: 'arbora.agent.cancel',
  agentToggleLog: 'arbora.agent.toggleLog',
  agentShowThreads: 'arbora.agent.showThreads',
  agentCycleMode: 'arbora.agent.cycleMode',
  agentPickMode: 'arbora.agent.pickMode',
  agentPickModel: 'arbora.agent.pickModel',
  agentCycleThinking: 'arbora.agent.cycleThinking',
  designUndo: 'arbora.design.undo',
  designRedo: 'arbora.design.redo',
  designDuplicate: 'arbora.design.duplicate',
  designSave: 'arbora.design.save',
  designDiscard: 'arbora.design.discard',
  designResend: 'arbora.design.resend',
  switchProject: 'arbora.switchProject',
  showOnboarding: 'arbora.showOnboarding',
  checkForUpdates: 'arbora.checkForUpdates',
  exportDiagnostics: 'arbora.exportDiagnostics',
  openKeyboardShortcuts: 'arbora.openKeyboardShortcuts',
  showKeybindings: 'arbora.showKeybindings',
  toggleNotifications: 'arbora.toggleNotifications',
  toggleSounds: 'arbora.toggleSounds',
  focusSidebarPanel: 'arbora.focus.sidebar',
  focusCenterPanel: 'arbora.focus.center',
  focusBottomPanel: 'arbora.focus.bottom',
  focusAgentPanel: 'arbora.focus.agent',
  focusPanelLeft: 'arbora.focus.left',
  focusPanelRight: 'arbora.focus.right',
  focusPanelUp: 'arbora.focus.up',
  focusPanelDown: 'arbora.focus.down',
  focusNextPanel: 'arbora.focusNextPanel',
  focusPreviousPanel: 'arbora.focusPreviousPanel',
  browserResetData: 'arbora.browser.resetData',
  agentShowAttention: 'arbora.agent.showAttention',
  agentNewGroup: 'arbora.agent.newGroup',
  gitStageAll: 'arbora.git.stageAll',
  gitCommit: 'arbora.git.commit',
  gitPush: 'arbora.git.push',
  gitSync: 'arbora.git.sync',
  gitAiCommit: 'arbora.git.aiCommit',
  gitAiPullRequest: 'arbora.git.aiPullRequest',
  toggleMaximizeRight: 'arbora.toggleMaximizeRight',
  groveNewDefault: 'arbora.grove.newDefault',
  groveNewTerminal: 'arbora.grove.newTerminal',
  groveLaunch: 'arbora.grove.launch',
  groveFocusAgents: 'arbora.grove.focusAgents',
  groveNextSession: 'arbora.grove.nextSession',
  grovePreviousSession: 'arbora.grove.previousSession',
  groveSelectSession1: 'arbora.grove.selectSession1',
  groveSelectSession2: 'arbora.grove.selectSession2',
  groveSelectSession3: 'arbora.grove.selectSession3',
  groveSelectSession4: 'arbora.grove.selectSession4',
  groveSelectSession5: 'arbora.grove.selectSession5',
  groveSelectSession6: 'arbora.grove.selectSession6',
  groveSelectSession7: 'arbora.grove.selectSession7',
  groveSelectSession8: 'arbora.grove.selectSession8',
  groveSelectSession9: 'arbora.grove.selectSession9',
  groveArchiveSession: 'arbora.grove.archiveSession',
  groveStopSession: 'arbora.grove.stopSession',
  groveRestartSession: 'arbora.grove.restartSession',
  groveRenameSession: 'arbora.grove.renameSession',
  groveSetDefaultAgent: 'arbora.grove.setDefaultAgent',
  groveSearch: 'arbora.grove.search',
  groveNextProject: 'arbora.grove.nextProject',
  grovePreviousProject: 'arbora.grove.previousProject',
  groveSwitchProject: 'arbora.grove.switchProject',
  groveSwitchProjectBack: 'arbora.grove.switchProjectBack',
} as const;

export type CommandId = (typeof CommandId)[keyof typeof CommandId];

export const commandIdSchema = z.enum(Object.values(CommandId) as [CommandId, ...CommandId[]]);

/** `Mod+1`..`Mod+9` inside Grove, in row order. */
export const GROVE_SELECT_COMMANDS = [
  CommandId.groveSelectSession1,
  CommandId.groveSelectSession2,
  CommandId.groveSelectSession3,
  CommandId.groveSelectSession4,
  CommandId.groveSelectSession5,
  CommandId.groveSelectSession6,
  CommandId.groveSelectSession7,
  CommandId.groveSelectSession8,
  CommandId.groveSelectSession9,
] as const;

export const DEFAULT_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: CommandId.commandPalette,
    title: 'Show Command Palette',
    category: 'View',
    keybinding: 'mod+shift+p',
    intercept: true,
  },
  { id: CommandId.agentMode, title: 'Toggle Agent Mode', category: 'Modes', keybinding: 'mod+k', intercept: true },
  { id: CommandId.designMode, title: 'Toggle Design Mode', category: 'Modes', keybinding: 'mod+d', intercept: true },
  {
    id: CommandId.exitMode,
    title: 'Exit Mode',
    category: 'Modes',
    keybinding: 'escape',
    when: 'modeActive',
    intercept: true,
    hidden: true,
  },
  { id: CommandId.quickOpen, title: 'Quick Open File', category: 'Files', keybinding: 'mod+p' },
  { id: CommandId.openProject, title: 'Open Project…', category: 'Project', keybinding: 'mod+o' },
  { id: CommandId.closeProject, title: 'Close Project', category: 'Project' },
  { id: CommandId.toggleTheme, title: 'Toggle Theme (System / Light / Dark)', category: 'View' },
  { id: CommandId.toggleSidebar, title: 'Toggle Project Tree', category: 'View', keybinding: 'mod+b' },
  { id: CommandId.toggleAgentPanel, title: 'Toggle Chat', category: 'View', keybinding: 'mod+alt+b' },
  { id: CommandId.toggleBottomPanel, title: 'Toggle Right Column', category: 'View', keybinding: 'mod+j' },
  { id: CommandId.resetLayout, title: 'Reset Layout', category: 'View' },
  {
    id: CommandId.openSettings,
    title: 'Open Settings',
    category: 'Preferences',
    keybinding: 'mod+,',
    intercept: true,
  },
  { id: CommandId.openSettingsFile, title: 'Open Settings (JSON)', category: 'Preferences' },
  { id: CommandId.openProjectSettingsFile, title: 'Open Project Settings (JSON)', category: 'Preferences' },
  { id: CommandId.showFiles, title: 'Show Files', category: 'View', keybinding: 'mod+shift+e' },
  { id: CommandId.showGitSidebar, title: 'Show Source Control', category: 'View', keybinding: 'mod+shift+g' },
  { id: CommandId.showSearch, title: 'Show Search', category: 'View', keybinding: 'mod+shift+f' },
  { id: CommandId.showTerminal, title: 'Show Terminal', category: 'View', keybinding: 'ctrl+`' },
  { id: CommandId.showGitPanel, title: 'Show Changes', category: 'View' },
  { id: CommandId.showProblems, title: 'Show Problems', category: 'View', keybinding: 'mod+shift+m' },
  { id: CommandId.reloadWindow, title: 'Reload Window', category: 'Developer' },
  { id: CommandId.toggleAppDevTools, title: 'Toggle Arbora DevTools', category: 'Developer' },
  // Browser chords are intercepted so they also work while the embedded page has focus.
  { id: CommandId.browserFocusUrl, title: 'Focus URL Bar', category: 'Browser', keybinding: 'mod+l', intercept: true },
  { id: CommandId.browserOpenDevUrl, title: 'Open Dev Server URL', category: 'Browser' },
  { id: CommandId.browserBack, title: 'Back', category: 'Browser', keybinding: 'alt+left', intercept: true },
  { id: CommandId.browserForward, title: 'Forward', category: 'Browser', keybinding: 'alt+right', intercept: true },
  { id: CommandId.browserReload, title: 'Reload Page', category: 'Browser', keybinding: 'mod+r', intercept: true },
  {
    id: CommandId.browserHardReload,
    title: 'Hard Reload Page (Ignore Cache)',
    category: 'Browser',
    keybinding: 'mod+shift+r',
    intercept: true,
  },
  { id: CommandId.browserOpenExternal, title: 'Open Page in External Browser', category: 'Browser' },
  {
    id: CommandId.browserToggleDevTools,
    title: 'Toggle Page DevTools',
    category: 'Browser',
    keybinding: 'mod+alt+i',
    intercept: true,
  },
  { id: CommandId.browserZoomIn, title: 'Zoom In', category: 'Browser', keybinding: 'mod+=', intercept: true },
  { id: CommandId.browserZoomOut, title: 'Zoom Out', category: 'Browser', keybinding: 'mod+-', intercept: true },
  { id: CommandId.browserZoomReset, title: 'Reset Zoom', category: 'Browser', keybinding: 'mod+0', intercept: true },
  { id: CommandId.browserViewportResponsive, title: 'Viewport: Responsive', category: 'Browser' },
  { id: CommandId.browserViewportMobile, title: 'Viewport: Mobile', category: 'Browser' },
  { id: CommandId.browserViewportTablet, title: 'Viewport: Tablet', category: 'Browser' },
  { id: CommandId.browserViewportLaptop, title: 'Viewport: Laptop', category: 'Browser' },
  { id: CommandId.browserViewportDesktop, title: 'Viewport: Desktop', category: 'Browser' },
  { id: CommandId.browserScreenshot, title: 'Take Screenshot', category: 'Browser' },
  { id: CommandId.browserFullPageScreenshot, title: 'Take Full-Page Screenshot', category: 'Browser' },
  { id: CommandId.browserClearProblems, title: 'Clear Problems', category: 'Browser' },
  { id: CommandId.terminalNew, title: 'New Terminal', category: 'Terminal', keybinding: 'ctrl+shift+`' },
  { id: CommandId.terminalSplitRight, title: 'Split Terminal Right', category: 'Terminal', keybinding: 'ctrl+shift+5' },
  { id: CommandId.terminalSplitDown, title: 'Split Terminal Down', category: 'Terminal' },
  { id: CommandId.terminalKill, title: 'Kill Terminal Process', category: 'Terminal' },
  { id: CommandId.terminalClear, title: 'Clear Terminal', category: 'Terminal' },
  { id: CommandId.terminalFind, title: 'Find in Terminal', category: 'Terminal' },
  { id: CommandId.terminalRename, title: 'Rename Terminal…', category: 'Terminal' },
  { id: CommandId.devServerRun, title: 'Run Dev Server', category: 'Dev Server' },
  { id: CommandId.devServerRestart, title: 'Restart Dev Server', category: 'Dev Server' },
  { id: CommandId.devServerStop, title: 'Stop Dev Server', category: 'Dev Server' },
  // Terminal `path:line:col` links and agent tool-call locations call this.
  { id: CommandId.openFileAtLocation, title: 'Open File at Location', category: 'Files', hidden: true },
  { id: CommandId.showBrowser, title: 'Show Browser', category: 'View' },
  { id: CommandId.editorSave, title: 'Save File', category: 'Editor', keybinding: 'mod+s' },
  { id: CommandId.editorCloseTab, title: 'Close Editor Tab', category: 'Editor', keybinding: 'mod+w' },
  { id: CommandId.editorFormat, title: 'Format Document', category: 'Editor', keybinding: 'shift+alt+f' },
  { id: CommandId.editorCompareWithSaved, title: 'Compare with Saved', category: 'Editor' },
  { id: CommandId.filesNewFile, title: 'New File…', category: 'Files' },
  { id: CommandId.filesNewFolder, title: 'New Folder…', category: 'Files' },
  { id: CommandId.filesRevealInOS, title: 'Reveal Active File in File Manager', category: 'Files' },
  { id: CommandId.filesRefresh, title: 'Refresh Explorer', category: 'Files' },
  {
    id: CommandId.agentNewThread,
    title: 'New Agent Thread',
    category: 'Agent',
    keybinding: 'mod+shift+n',
    intercept: true,
  },
  { id: CommandId.agentFocusComposer, title: 'Focus Agent Composer', category: 'Agent', keybinding: 'mod+shift+a' },
  { id: CommandId.agentCancel, title: 'Stop Agent', category: 'Agent', keybinding: 'mod+.' },
  { id: CommandId.agentToggleLog, title: 'Toggle ACP Log', category: 'Agent' },
  { id: CommandId.agentShowThreads, title: 'Show Agent Threads', category: 'Agent' },
  // CLI-style thread keys (Claude Code's): they apply while the agent panel has focus.
  {
    id: CommandId.agentCycleMode,
    title: 'Agent: Next Mode',
    category: 'Agent',
    keybinding: 'shift+tab',
    when: 'agentPanel',
  },
  {
    id: CommandId.agentPickMode,
    title: 'Agent: Choose Mode…',
    category: 'Agent',
    keybinding: 'alt+m',
    when: 'agentPanel',
  },
  {
    id: CommandId.agentPickModel,
    title: 'Agent: Choose Model…',
    category: 'Agent',
    keybinding: 'alt+p',
    when: 'agentPanel',
  },
  {
    id: CommandId.agentCycleThinking,
    title: 'Agent: Next Thinking Level',
    category: 'Agent',
    keybinding: 'alt+t',
    when: 'agentPanel',
  },
  {
    id: CommandId.designUndo,
    title: 'Undo Design Edit',
    category: 'Design',
    keybinding: 'mod+z',
    when: 'design',
    intercept: true,
  },
  {
    id: CommandId.designRedo,
    title: 'Redo Design Edit',
    category: 'Design',
    keybinding: 'mod+shift+z',
    when: 'design',
    intercept: true,
  },
  {
    id: CommandId.designDuplicate,
    title: 'Duplicate Element',
    category: 'Design',
    keybinding: 'mod+shift+d',
    when: 'design',
    intercept: true,
  },
  { id: CommandId.designSave, title: 'Save Design Changes', category: 'Design' },
  { id: CommandId.designDiscard, title: 'Discard Design Changes', category: 'Design' },
  { id: CommandId.designResend, title: 'Resend Last Design Session', category: 'Design' },
  {
    id: CommandId.switchProject,
    title: 'Switch Project…',
    category: 'Project',
    keybinding: 'mod+alt+o',
    intercept: true,
  },
  { id: CommandId.showOnboarding, title: 'Getting Started…', category: 'Help' },
  { id: CommandId.checkForUpdates, title: 'Check for Updates…', category: 'Help' },
  { id: CommandId.exportDiagnostics, title: 'Export Diagnostics…', category: 'Help' },
  {
    id: CommandId.showKeybindings,
    title: 'Show Keybindings',
    category: 'Help',
    keybinding: 'mod+h',
    when: 'always',
    intercept: true,
  },
  { id: CommandId.openKeyboardShortcuts, title: 'Keyboard Shortcuts', category: 'Preferences' },
  { id: CommandId.toggleNotifications, title: 'Toggle Agent Notifications', category: 'Preferences' },
  { id: CommandId.toggleSounds, title: 'Toggle Agent Sounds', category: 'Preferences' },
  // F6 cycles landmarks (title bar, sidebar, centre, agent panel, bottom drawer), as in browsers and VS Code.
  // Mod+1..4 pick a panel and Mod+Alt+arrows move between neighbours, like a tiling window manager.
  {
    id: CommandId.focusSidebarPanel,
    title: 'Focus Sidebar',
    category: 'View',
    keybinding: 'mod+1',
    intercept: true,
  },
  {
    id: CommandId.focusCenterPanel,
    title: 'Focus Browser or Editor',
    category: 'View',
    keybinding: 'mod+2',
    intercept: true,
  },
  {
    id: CommandId.focusBottomPanel,
    title: 'Focus Bottom Panel',
    category: 'View',
    keybinding: 'mod+3',
    intercept: true,
  },
  { id: CommandId.focusAgentPanel, title: 'Focus Agent Panel', category: 'View', keybinding: 'mod+4', intercept: true },
  {
    id: CommandId.focusPanelLeft,
    title: 'Focus Panel to the Left',
    category: 'View',
    keybinding: 'mod+alt+left',
    intercept: true,
  },
  {
    id: CommandId.focusPanelRight,
    title: 'Focus Panel to the Right',
    category: 'View',
    keybinding: 'mod+alt+right',
    intercept: true,
  },
  {
    id: CommandId.focusPanelUp,
    title: 'Focus Panel Above',
    category: 'View',
    keybinding: 'mod+alt+up',
    intercept: true,
  },
  {
    id: CommandId.focusPanelDown,
    title: 'Focus Panel Below',
    category: 'View',
    keybinding: 'mod+alt+down',
    intercept: true,
  },
  { id: CommandId.focusNextPanel, title: 'Focus Next Panel', category: 'View', keybinding: 'f6', intercept: true },
  {
    id: CommandId.focusPreviousPanel,
    title: 'Focus Previous Panel',
    category: 'View',
    keybinding: 'shift+f6',
    intercept: true,
  },
  { id: CommandId.browserResetData, title: 'Reset Browser Data (Cookies, Storage, Cache)…', category: 'Browser' },
  {
    id: CommandId.agentShowAttention,
    title: 'Show Agent That Needs You',
    category: 'Agent',
    keybinding: 'mod+alt+a',
    intercept: true,
  },
  { id: CommandId.agentNewGroup, title: 'New Agent Group…', category: 'Agent' },
  // Git chords are intercepted so they work from the page and the terminal too.
  { id: CommandId.gitStageAll, title: 'Stage All Changes', category: 'Git', keybinding: 'mod+alt+s', intercept: true },
  {
    id: CommandId.gitCommit,
    title: 'Commit Staged Changes',
    category: 'Git',
    keybinding: 'mod+alt+c',
    intercept: true,
  },
  { id: CommandId.gitPush, title: 'Push', category: 'Git', keybinding: 'mod+alt+p', intercept: true },
  { id: CommandId.gitSync, title: 'Fetch and Pull Now', category: 'Git' },
  {
    id: CommandId.gitAiCommit,
    title: 'Stage All and Commit with AI',
    category: 'Git',
    keybinding: 'mod+alt+shift+c',
    intercept: true,
  },
  {
    id: CommandId.gitAiPullRequest,
    title: 'AI Commit, Push and Open Pull Request',
    category: 'Git',
    keybinding: 'mod+alt+shift+p',
    intercept: true,
  },
  {
    id: CommandId.toggleMaximizeRight,
    title: 'Maximize Right Column',
    category: 'View',
    keybinding: 'mod+alt+m',
    intercept: true,
  },
  // Grove chords apply in the Grove workspace, so they beat `always` bindings on the same keys
  // (Mod+1..9, Mod+Alt+Up/Down).
  {
    id: CommandId.groveNewDefault,
    title: 'New Agent',
    category: 'Grove',
    keybinding: 'mod+alt+n',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.groveNewTerminal,
    title: 'New Terminal',
    category: 'Grove',
    keybinding: 'mod+shift+t',
    when: 'grove',
    intercept: true,
  },
  { id: CommandId.groveLaunch, title: 'New Agent with a Task…', category: 'Grove', intercept: true },
  {
    id: CommandId.groveFocusAgents,
    title: 'Focus agents',
    category: 'Grove',
    keybinding: 'mod+shift+a',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.groveNextSession,
    title: 'Next Agent',
    category: 'Grove',
    keybinding: 'mod+alt+down',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.grovePreviousSession,
    title: 'Previous Agent',
    category: 'Grove',
    keybinding: 'mod+alt+up',
    when: 'grove',
    intercept: true,
  },
  ...GROVE_SELECT_COMMANDS.map((id, index): CommandDescriptor => ({
    id,
    title: `Agent ${index + 1}`,
    category: 'Grove',
    keybinding: `mod+${index + 1}`,
    when: 'grove',
    intercept: true,
    hidden: true,
  })),
  {
    id: CommandId.groveArchiveSession,
    title: 'Archive Agent',
    category: 'Grove',
    keybinding: 'alt+a',
    // The page and the editor share the window, so these keys only act with focus in the chat.
    when: 'agentPanel',
    intercept: false,
  },
  {
    id: CommandId.groveStopSession,
    title: 'Stop Agent Process',
    category: 'Grove',
    keybinding: 'alt+s',
    when: 'agentPanel',
    intercept: false,
  },
  { id: CommandId.groveRestartSession, title: 'Restart Agent', category: 'Grove', when: 'grove', intercept: true },
  { id: CommandId.groveRenameSession, title: 'Rename Agent…', category: 'Grove', when: 'grove', intercept: true },
  {
    id: CommandId.groveSetDefaultAgent,
    title: 'Set as Default Agent',
    category: 'Grove',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.groveSearch,
    title: 'Grove Search',
    category: 'Grove',
    // Both workspaces, so the browser can open it without clicking Grove first. Mod stays agent mode.
    keybinding: 'mod+shift+k',
    intercept: true,
  },
  {
    id: CommandId.groveNextProject,
    title: 'Next Project',
    category: 'Grove',
    keybinding: 'mod+alt+[',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.grovePreviousProject,
    title: 'Previous Project',
    category: 'Grove',
    keybinding: 'mod+alt+]',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.groveSwitchProject,
    title: 'Switch Project',
    category: 'Grove',
    keybinding: 'mod+tab',
    when: 'grove',
    intercept: true,
  },
  {
    id: CommandId.groveSwitchProjectBack,
    title: 'Switch Project Backward',
    category: 'Grove',
    keybinding: 'mod+shift+tab',
    when: 'grove',
    intercept: true,
  },
];

/** The zero-based Grove row a `groveSelectSession*` command selects, or `null` for any other command. */
export function groveSessionIndex(commandId: string): number | null {
  const index = (GROVE_SELECT_COMMANDS as readonly string[]).indexOf(commandId);
  return index === -1 ? null : index;
}

/** Overrides map a command id to a chord string, or `null` to unbind it. */
export type KeybindingOverrides = Readonly<Record<string, string | null>>;

/**
 * Merges default bindings with user overrides then project overrides (later wins).
 * Unknown command ids in overrides are ignored by callers that validate them separately.
 */
export function resolveKeybindingSpecs(
  commands: readonly CommandDescriptor[],
  ...overrideLayers: readonly (KeybindingOverrides | undefined)[]
): KeybindingSpec[] {
  const specs: KeybindingSpec[] = [];
  for (const command of commands) {
    let binding: string | null | undefined = command.keybinding;
    let extras: readonly string[] = command.extraKeybindings ?? [];
    for (const layer of overrideLayers) {
      if (layer && Object.hasOwn(layer, command.id)) {
        binding = layer[command.id];
        extras = [];
      }
    }
    const when = command.when ?? 'always';
    const intercept = command.intercept ?? false;
    if (binding) specs.push({ commandId: command.id, binding, when, intercept });
    for (const extra of extras) specs.push({ commandId: command.id, binding: extra, when, intercept });
  }
  return specs;
}

export interface Command extends CommandDescriptor {
  run(): void | Promise<void>;
}

type Listener = () => void;

/** Runtime registry of runnable commands. Every feature registers its commands here. */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<Listener>();

  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.commands.set(command.id, command);
    this.emit();
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id);
        this.emit();
      }
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  async execute(id: string): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command) return false;
    await command.run();
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The four workspace panels `Mod+1`..`Mod+4` focus, in that order. */
export const WORKSPACE_PANELS = ['sidebar', 'center', 'bottom', 'agent'] as const;
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number];
export type PanelDirection = 'left' | 'right' | 'up' | 'down';

/**
 * The panel next to `from` in the default layout: the sidebar on the left, the browser/editor above
 * the bottom panel in the middle, the agent on the right. `null` at an edge.
 */
export function neighbourPanel(from: WorkspacePanel, direction: PanelDirection): WorkspacePanel | null {
  switch (direction) {
    case 'left':
      return from === 'agent' ? 'center' : from === 'sidebar' ? null : 'sidebar';
    case 'right':
      return from === 'sidebar' ? 'center' : from === 'agent' ? null : 'agent';
    case 'up':
      return from === 'bottom' ? 'center' : null;
    case 'down':
      return from === 'center' ? 'bottom' : null;
    default: {
      const unreachable: never = direction;
      throw new Error(`Unknown direction ${String(unreachable)}`);
    }
  }
}
