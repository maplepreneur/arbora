import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, shell, type WebContents } from 'electron';
import { AgentRegistry } from '@arbora/acp-client';
import { toPlatform, type AppSettingsPatch } from '@arbora/shared';
import type { AgentService } from './agent/agent-service.js';
import { describeAttachment } from './agent/attachments.js';
import { BrowserSessions } from './browser/browser-sessions.js';
import type { BrowserService } from './browser/browser-service.js';
import { registerPageIpc } from './browser/page-ipc.js';
import { defineHandler, sendEvent } from './ipc.js';
import { buildMacMenu } from './menu.js';
import { ensureProjectSettingsFile } from './project-settings.js';
import { SettingsStore } from './settings-store.js';
import { detectTilingCompositor, parseProjectArg, startupSwitches } from './startup.js';
import type { DevServer } from './terminal/dev-server.js';
import { ShellEnvironment } from './terminal/shell-env.js';
import type { TerminalService } from './terminal/terminal-service.js';
import { ThemeService } from './theme-service.js';
import { ProjectWindowError, WindowManager, type ProjectWindow } from './window-manager.js';

const platform = toPlatform(process.platform);
const tilingCompositor = detectTilingCompositor(platform, process.env);

// Must run before `ready`: the app name drives the Wayland app_id / WM_CLASS and userData path.
app.setName('arbora');
const userDataOverride = process.env['ARBORA_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);
for (const flag of startupSwitches(platform, process.env['ARBORA_FLAGS'])) {
  if (flag.value === undefined) app.commandLine.appendSwitch(flag.name);
  else app.commandLine.appendSwitch(flag.name, flag.value);
}

// Typed as boolean but undefined in packaged builds; both falsy values mean "packaged".
const isDefaultApp: boolean = process.defaultApp;

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let windows: WindowManager | undefined;
  const pendingPaths: string[] = [];
  const initialProject = parseProjectArg(process.argv, process.cwd(), isDefaultApp);

  const openPath = (path: string): void => {
    if (!windows) {
      pendingPaths.push(path);
      return;
    }
    try {
      windows.openProject(path);
    } catch (error) {
      dialog.showErrorBox('Could not open project', (error as Error).message);
    }
  };

  app.on('second-instance', (_event, argv, cwd) => {
    const path = parseProjectArg(argv, cwd, isDefaultApp);
    if (path) {
      openPath(path);
      return;
    }
    const first = windows?.all()[0];
    if (first) {
      if (first.window.isMinimized()) first.window.restore();
      first.window.focus();
    } else {
      windows?.create(null);
    }
  });

  // macOS: folders dropped on the Dock icon or opened via Finder.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    openPath(path);
  });

  void app.whenReady().then(() => {
    const shellEnvironment = new ShellEnvironment(platform);
    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
    for (const warning of settings.warnings) console.warn(`[settings] ${warning}`);
    settings.watch();
    const theme = new ThemeService(settings.get().theme);
    const browserSessions = new BrowserSessions({
      extensionsDir: app.isPackaged
        ? join(process.resourcesPath, 'extensions')
        : join(import.meta.dirname, '../../resources/extensions'),
      settings: () => settings.get().browser,
    });

    const agentRegistry = new AgentRegistry(() => settings.get().agents.custom);
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    windows = new WindowManager({
      platform,
      tilingCompositor,
      settings,
      theme,
      agentRegistry,
      preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
      browserPreloadPath: join(import.meta.dirname, '../preload/browser.cjs'),
      browserSessions,
      shellEnvironment,
      userDataPath: app.getPath('userData'),
      renderer:
        !app.isPackaged && rendererUrl
          ? { url: rendererUrl }
          : { file: join(import.meta.dirname, '../renderer/index.html') },
    });
    const manager = windows;

    Menu.setApplicationMenu(
      platform === 'darwin'
        ? buildMacMenu((commandId) => {
            const focused = BrowserWindow.getFocusedWindow();
            const target = focused ? manager.all().find((w) => w.window === focused) : undefined;
            if (target) sendEvent(target.contents, 'command.invoke', { commandId });
          })
        : null,
    );

    const isTrusted = (sender: WebContents): boolean => manager.fromWebContents(sender) !== undefined;
    const windowFor = (sender: WebContents): ProjectWindow => {
      const w = manager.fromWebContents(sender);
      if (!w) throw new Error('No window for sender');
      return w;
    };

    const disposePageIpc = registerPageIpc((sender) => manager.browserFromPage(sender));

    settings.onChange((next) => {
      theme.setMode(next.theme);
      void browserSessions.applySettings();
      manager.rebuildKeybindings();
      for (const w of manager.all()) sendEvent(w.contents, 'settings.changed', next);
    });
    theme.onChange((state) => {
      for (const w of manager.all()) {
        w.window.setBackgroundColor(theme.background());
        sendEvent(w.contents, 'theme.changed', state);
      }
    });

    defineHandler('app.getInfo', isTrusted, () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform,
      isPackaged: app.isPackaged,
      tilingCompositor,
    }));

    defineHandler('window.getState', isTrusted, (_req, event) => windowFor(event.sender).state());
    defineHandler('window.control', isTrusted, ({ action }, event) => {
      const { window } = windowFor(event.sender);
      switch (action) {
        case 'minimize':
          window.minimize();
          break;
        case 'toggleMaximize':
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          break;
        case 'close':
          window.close();
          break;
        case 'reload':
          window.webContents.reload();
          break;
        case 'toggleDevTools':
          window.webContents.toggleDevTools();
          break;
        default: {
          const unreachable: never = action;
          throw new Error(`Unhandled window action ${String(unreachable)}`);
        }
      }
      return undefined;
    });

    defineHandler('settings.get', isTrusted, () => settings.get());
    defineHandler('settings.update', isTrusted, (patch: AppSettingsPatch) =>
      settings.update((s) => ({
        ...s,
        ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
        ...(patch.keybindings !== undefined ? { keybindings: patch.keybindings } : {}),
        ...(patch.terminalPassthrough !== undefined ? { terminalPassthrough: patch.terminalPassthrough } : {}),
        ...(patch.browser !== undefined
          ? {
              browser: {
                devToolsExtensions: patch.browser.devToolsExtensions ?? s.browser.devToolsExtensions,
                trustLocalhostCertificates:
                  patch.browser.trustLocalhostCertificates ?? s.browser.trustLocalhostCertificates,
              },
            }
          : {}),
        ...(patch.terminal !== undefined
          ? {
              terminal: {
                ...s.terminal,
                ...(patch.terminal.shell !== undefined ? { shell: patch.terminal.shell } : {}),
                fontSize: patch.terminal.fontSize ?? s.terminal.fontSize,
              },
            }
          : {}),
        ...(patch.agents !== undefined
          ? {
              agents: {
                custom: patch.agents.custom ?? s.agents.custom,
                permissions: patch.agents.permissions ?? s.agents.permissions,
              },
            }
          : {}),
      })),
    );
    defineHandler('settings.openFile', isTrusted, async () => {
      settings.ensureFile();
      await openInEditor(settings.filePath);
      return undefined;
    });

    defineHandler('theme.get', isTrusted, () => theme.state());
    defineHandler('theme.set', isTrusted, ({ mode }) => {
      settings.update((s) => ({ ...s, theme: mode }));
      return theme.setMode(mode);
    });

    defineHandler('keybindings.setContext', isTrusted, (context, event) => {
      windowFor(event.sender).setKeybindingContext(context);
      return undefined;
    });

    defineHandler('project.getCurrent', isTrusted, (_req, event) => windowFor(event.sender).info());
    defineHandler('project.open', isTrusted, async ({ path }, event) => {
      const from = windowFor(event.sender);
      let target = path;
      if (target === undefined) {
        const result = await dialog.showOpenDialog(from.window, {
          title: 'Open Project Folder',
          properties: ['openDirectory', 'createDirectory'],
        });
        target = result.canceled ? undefined : result.filePaths[0];
      }
      if (target === undefined) return { opened: false };
      try {
        manager.openProject(target, from);
        return { opened: true };
      } catch (error) {
        if (error instanceof ProjectWindowError) return { opened: false, error: error.message };
        throw error;
      }
    });
    defineHandler('project.close', isTrusted, (_req, event) => {
      windowFor(event.sender).closeProject();
      return undefined;
    });
    defineHandler('project.recents', isTrusted, () => settings.get().recentProjects);
    defineHandler(
      'project.removeRecent',
      isTrusted,
      ({ path }) =>
        settings.update((s) => ({ ...s, recentProjects: s.recentProjects.filter((r) => r.path !== path) }))
          .recentProjects,
    );
    defineHandler('project.saveLayout', isTrusted, ({ layout }, event) => {
      windowFor(event.sender).saveLayout(layout);
      return undefined;
    });
    defineHandler('project.openSettingsFile', isTrusted, async (_req, event) => {
      const project = windowFor(event.sender).project;
      if (!project) return undefined;
      await openInEditor(ensureProjectSettingsFile(project.path));
      return undefined;
    });

    const requireBrowser = (sender: WebContents): BrowserService => {
      const browser = windowFor(sender).browser;
      if (!browser) throw new Error('The browser panel is not ready (open a project first)');
      return browser;
    };
    defineHandler('browser.getState', isTrusted, (_req, event) => windowFor(event.sender).browser?.getState() ?? null);
    defineHandler('browser.setBounds', isTrusted, ({ rect, emulation }, event) => {
      windowFor(event.sender).setBrowserBounds(rect, emulation);
      return undefined;
    });
    defineHandler('browser.navigate', isTrusted, ({ url }, event) => {
      const browser = windowFor(event.sender).browser;
      return browser ? browser.navigate(url) : { ok: false, error: 'Open a project first' };
    });
    defineHandler('browser.action', isTrusted, ({ action }, event) => {
      windowFor(event.sender).browser?.action(action);
      return undefined;
    });
    defineHandler('browser.setPreset', isTrusted, ({ preset }, event) => {
      windowFor(event.sender).browser?.setPreset(preset);
      return undefined;
    });
    defineHandler('browser.history', isTrusted, (_req, event) => windowFor(event.sender).browserHistoryEntries());
    defineHandler(
      'browser.getConsole',
      isTrusted,
      (_req, event) => windowFor(event.sender).browser?.getConsole() ?? [],
    );
    defineHandler(
      'browser.getNetworkErrors',
      isTrusted,
      (_req, event) => windowFor(event.sender).browser?.getNetworkErrors() ?? [],
    );
    defineHandler('browser.clearProblems', isTrusted, (_req, event) => {
      windowFor(event.sender).browser?.clearProblems();
      return undefined;
    });
    defineHandler('browser.screenshot', isTrusted, (request, event) =>
      requireBrowser(event.sender).screenshot(request),
    );
    defineHandler('browser.pingPage', isTrusted, async (_req, event) => ({
      ok: (await windowFor(event.sender).browser?.ping()) ?? false,
    }));
    defineHandler('browser.suggestUrl', isTrusted, ({ url }, event) => ({
      navigated: windowFor(event.sender).browser?.suggestUrl(url) ?? false,
    }));

    defineHandler(
      'contextMenu.show',
      isTrusted,
      ({ items }, event) =>
        new Promise((resolveMenu) => {
          let chosen: string | null = null;
          const menu = Menu.buildFromTemplate(
            items.map((item) =>
              'type' in item
                ? { type: 'separator' as const }
                : {
                    label: item.label,
                    enabled: item.enabled ?? true,
                    ...(item.accelerator ? { accelerator: item.accelerator, registerAccelerator: false } : {}),
                    click: () => {
                      chosen = item.id;
                    },
                  },
            ),
          );
          menu.popup({
            window: windowFor(event.sender).window,
            // `callback` can run before `click`; let the click land first.
            callback: () => setTimeout(() => resolveMenu({ id: chosen }), 0),
          });
        }),
    );
    defineHandler('clipboard.readText', isTrusted, () => clipboard.readText());
    defineHandler('clipboard.writeText', isTrusted, async ({ text }) => {
      await clipboard.writeText(text);
      return undefined;
    });

    const requireTerminals = (sender: WebContents): TerminalService => {
      const terminals = windowFor(sender).terminals;
      if (!terminals) throw new Error('Open a project first');
      return terminals;
    };
    const requireDevServer = (sender: WebContents): DevServer => {
      const devServer = windowFor(sender).devServer;
      if (!devServer) throw new Error('Open a project first');
      return devServer;
    };
    defineHandler('terminal.create', isTrusted, ({ kind, title, command, cols, rows }, event) =>
      requireTerminals(event.sender).create({
        cols,
        rows,
        ...(kind !== undefined ? { kind } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(command !== undefined ? { command } : {}),
      }),
    );
    defineHandler('terminal.list', isTrusted, (_req, event) => windowFor(event.sender).terminals?.list() ?? []);
    defineHandler('terminal.scrollback', isTrusted, ({ id }, event) => ({
      data: windowFor(event.sender).terminals?.scrollback(id) ?? '',
    }));
    defineHandler('terminal.write', isTrusted, ({ id, data }, event) => {
      windowFor(event.sender).terminals?.write(id, data);
      return undefined;
    });
    defineHandler('terminal.resize', isTrusted, ({ id, cols, rows }, event) => {
      windowFor(event.sender).terminals?.resize(id, { cols, rows });
      return undefined;
    });
    defineHandler('terminal.rename', isTrusted, ({ id, title }, event) => {
      windowFor(event.sender).terminals?.rename(id, title);
      return undefined;
    });
    defineHandler('terminal.kill', isTrusted, async ({ id }, event) => {
      await windowFor(event.sender).terminals?.kill(id);
      return undefined;
    });
    defineHandler('terminal.close', isTrusted, async ({ id }, event) => {
      await windowFor(event.sender).terminals?.close(id);
      return undefined;
    });
    defineHandler('terminal.lines', isTrusted, ({ id, count }, event) =>
      requireTerminals(event.sender).lines(id, count),
    );
    defineHandler('devServer.run', isTrusted, ({ cols, rows }, event) =>
      requireDevServer(event.sender).run({
        ...(cols !== undefined ? { cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
      }),
    );
    defineHandler('devServer.stop', isTrusted, async (_req, event) => {
      await windowFor(event.sender).devServer?.stop();
      return undefined;
    });
    defineHandler('devServer.status', isTrusted, (_req, event) => requireDevServer(event.sender).status());

    const requireAgents = (sender: WebContents): AgentService => {
      const agents = windowFor(sender).agents;
      if (!agents) throw new Error('Open a project first');
      return agents;
    };
    defineHandler('agent.listAgents', isTrusted, async (_req, event) => {
      await shellEnvironment.ready;
      return requireAgents(event.sender).listAgents();
    });
    defineHandler('agent.listThreads', isTrusted, (_req, event) => windowFor(event.sender).agents?.listThreads() ?? []);
    defineHandler('agent.createThread', isTrusted, ({ agentId }, event) =>
      requireAgents(event.sender).createThread(agentId),
    );
    defineHandler('agent.getThread', isTrusted, ({ threadId }, event) =>
      requireAgents(event.sender).getThread(threadId),
    );
    defineHandler('agent.deleteThread', isTrusted, async ({ threadId }, event) => {
      await requireAgents(event.sender).deleteThread(threadId);
      return undefined;
    });
    defineHandler('agent.renameThread', isTrusted, ({ threadId, title }, event) => {
      requireAgents(event.sender).renameThread(threadId, title);
      return undefined;
    });
    defineHandler('agent.prompt', isTrusted, ({ threadId, blocks, attachments }, event) =>
      requireAgents(event.sender).prompt(threadId, blocks, attachments),
    );
    defineHandler('agent.cancel', isTrusted, async ({ threadId }, event) => {
      await requireAgents(event.sender).cancel(threadId);
      return undefined;
    });
    defineHandler('agent.respondPermission', isTrusted, ({ threadId, requestId, optionId }, event) => {
      requireAgents(event.sender).respondPermission(threadId, requestId, optionId);
      return undefined;
    });
    defineHandler('agent.setMode', isTrusted, async ({ threadId, modeId }, event) => {
      await requireAgents(event.sender).setMode(threadId, modeId);
      return undefined;
    });
    defineHandler('agent.setConfigOption', isTrusted, async ({ threadId, configId, value }, event) => {
      await requireAgents(event.sender).setConfigOption(threadId, configId, value);
      return undefined;
    });
    defineHandler('agent.setAutoApproveEdits', isTrusted, ({ threadId, enabled }, event) => {
      requireAgents(event.sender).setAutoApproveEdits(threadId, enabled);
      return undefined;
    });
    defineHandler('agent.authenticate', isTrusted, async ({ threadId, methodId }, event) => {
      await requireAgents(event.sender).authenticate(threadId, methodId);
      return undefined;
    });
    defineHandler('agent.restart', isTrusted, async ({ threadId }, event) => {
      await requireAgents(event.sender).restart(threadId);
      return undefined;
    });
    defineHandler('agent.getLog', isTrusted, ({ threadId }, event) => requireAgents(event.sender).getLog(threadId));
    defineHandler('agent.exportLog', isTrusted, async ({ threadId }, event) => {
      const projectWindow = windowFor(event.sender);
      const agents = requireAgents(event.sender);
      const result = await dialog.showSaveDialog(projectWindow.window, {
        title: 'Export ACP log',
        defaultPath: join(projectWindow.project?.path ?? app.getPath('home'), `acp-log-${threadId.slice(0, 8)}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { path: null };
      await agents.exportLog(threadId, result.filePath);
      return { path: result.filePath };
    });
    defineHandler('agent.pickAttachments', isTrusted, async (_req, event) => {
      const projectWindow = windowFor(event.sender);
      const result = await dialog.showOpenDialog(projectWindow.window, {
        title: 'Attach files',
        ...(projectWindow.project ? { defaultPath: projectWindow.project.path } : {}),
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled) return [];
      return result.filePaths.flatMap((path) => {
        const attachment = describeAttachment(path);
        return attachment ? [attachment] : [];
      });
    });
    defineHandler('agent.describeAttachments', isTrusted, ({ paths }) =>
      paths.flatMap((path) => {
        const attachment = describeAttachment(path);
        return attachment ? [attachment] : [];
      }),
    );
    defineHandler('agent.forgetPermissions', isTrusted, ({ agentId }) => {
      settings.update((s) => ({
        ...s,
        agents: {
          ...s.agents,
          permissions:
            agentId === undefined
              ? {}
              : Object.fromEntries(
                  Object.entries(s.agents.permissions).filter(([key]) => !key.startsWith(`${agentId}:`)),
                ),
        },
      }));
      return undefined;
    });

    defineHandler('agentMode.setInspecting', isTrusted, ({ active }, event) => {
      windowFor(event.sender).agentMode?.setInspecting(active);
      return undefined;
    });
    defineHandler('agentMode.submit', isTrusted, (request, event) => {
      const agentMode = windowFor(event.sender).agentMode;
      if (!agentMode) throw new Error('Open a project first');
      return agentMode.submit(request);
    });

    const queued = pendingPaths.splice(0);
    const first = initialProject ?? queued.shift() ?? null;
    try {
      manager.create(first);
    } catch (error) {
      dialog.showErrorBox('Could not open project', (error as Error).message);
      manager.create(null);
    }
    for (const path of queued) openPath(path);

    app.on('activate', () => {
      if (manager.all().length === 0) manager.create(null);
    });

    app.on('will-quit', () => {
      disposePageIpc();
      browserSessions.dispose();
      settings.dispose();
      theme.dispose();
    });
  });

  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit();
  });
}

async function openInEditor(file: string): Promise<void> {
  const error = await shell.openPath(file);
  if (error) {
    shell.showItemInFolder(file);
  }
}

main();
