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
  agentNewThread: 'arbora.agent.newThread',
  agentFocusComposer: 'arbora.agent.focusComposer',
  agentCancel: 'arbora.agent.cancel',
  agentToggleLog: 'arbora.agent.toggleLog',
  agentShowThreads: 'arbora.agent.showThreads',
} as const;

export type CommandId = (typeof CommandId)[keyof typeof CommandId];

export const commandIdSchema = z.enum(Object.values(CommandId) as [CommandId, ...CommandId[]]);

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
  { id: CommandId.toggleSidebar, title: 'Toggle Sidebar', category: 'View', keybinding: 'mod+b' },
  { id: CommandId.toggleAgentPanel, title: 'Toggle Agent Panel', category: 'View', keybinding: 'mod+alt+b' },
  { id: CommandId.toggleBottomPanel, title: 'Toggle Bottom Panel', category: 'View', keybinding: 'mod+j' },
  { id: CommandId.resetLayout, title: 'Reset Layout', category: 'View' },
  { id: CommandId.openSettingsFile, title: 'Open Settings (JSON)', category: 'Preferences', keybinding: 'mod+,' },
  { id: CommandId.openProjectSettingsFile, title: 'Open Project Settings (JSON)', category: 'Preferences' },
  { id: CommandId.showFiles, title: 'Show Files', category: 'View', keybinding: 'mod+shift+e' },
  { id: CommandId.showGitSidebar, title: 'Show Source Control', category: 'View', keybinding: 'mod+shift+g' },
  { id: CommandId.showSearch, title: 'Show Search', category: 'View', keybinding: 'mod+shift+f' },
  { id: CommandId.showTerminal, title: 'Show Terminal', category: 'View', keybinding: 'ctrl+`' },
  { id: CommandId.showGitPanel, title: 'Show Git Panel', category: 'View' },
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
  // Terminal `path:line:col` links call this; the editor arrives in Stage 7.
  { id: CommandId.openFileAtLocation, title: 'Open File at Location', category: 'Files', hidden: true },
  { id: CommandId.agentNewThread, title: 'New Agent Thread', category: 'Agent', keybinding: 'mod+shift+n' },
  { id: CommandId.agentFocusComposer, title: 'Focus Agent Composer', category: 'Agent', keybinding: 'mod+shift+a' },
  { id: CommandId.agentCancel, title: 'Cancel Agent Turn', category: 'Agent' },
  { id: CommandId.agentToggleLog, title: 'Toggle ACP Log', category: 'Agent' },
  { id: CommandId.agentShowThreads, title: 'Show Agent Threads', category: 'Agent' },
];

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
    for (const layer of overrideLayers) {
      if (layer && Object.hasOwn(layer, command.id)) {
        binding = layer[command.id];
      }
    }
    if (binding) {
      specs.push({
        commandId: command.id,
        binding,
        when: command.when ?? 'always',
        intercept: command.intercept ?? false,
      });
    }
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
