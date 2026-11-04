import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, clipboard, crashReporter, dialog, Menu, shell, type WebContents } from 'electron';
import { AgentRegistry } from '@arbora/acp-client';
import {
  applyProjectMeta,
  applySettingsPatch,
  buildProjectLibrary,
  commitMessagePrompt,
  detectInstallKind,
  parseGeneratedText,
  projectSettingsUpdates,
  pullRequestPrompt,
  resolveTaskAgent,
  toPlatform,
  type AgentVerification,
  type ProjectLibrary,
} from '@arbora/shared';
import { probeAgent } from './agent/agent-probe.js';
import { AttentionService } from './attention-service.js';
import { buildDiagnosticsZip, MainLog } from './diagnostics.js';
import { UpdateService } from './update-service.js';
import type { AgentService } from './agent/agent-service.js';
import { describeAttachment, pastedImagePath, pickPastedImageType } from './agent/attachments.js';
import { BrowserSessions } from './browser/browser-sessions.js';
import type { BrowserService } from './browser/browser-service.js';
import { registerPageIpc } from './browser/page-ipc.js';
import { defineHandler, sendEvent } from './ipc.js';
import { buildMacMenu } from './menu.js';
import { ensureArboraGitignore, ensureProjectSettingsFile, updateProjectSettingsFile } from './project-settings.js';
import { SettingsStore } from './settings-store.js';
import { detectTilingCompositor, parseProjectArg, shouldQuitWhenAllWindowsClosed, startupSwitches } from './startup.js';
import { inferProjectDevCommand } from './terminal/dev-command.js';
import type { DevServer } from './terminal/dev-server.js';
import { findExecutable, ShellEnvironment } from './terminal/shell-env.js';
import type { TerminalService } from './terminal/terminal-service.js';
import { createPullRequest, githubAuth, listPullRequests, pullRequestChecks } from './git/github.js';
import type { GitService } from './git/git-service.js';
import type { WorkspaceService } from './workspace/workspace-service.js';
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
  let quitOnLastWindowClose = (): boolean => true;
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
    quitOnLastWindowClose = () => settings.get().quitOnLastWindowClose;
    const mainLog = new MainLog(join(app.getPath('userData'), 'logs'));
    mainLog.setEnabled(settings.get().diagnostics.logToFile);
    mainLog.install();
    // Local dumps only: Arbora has no telemetry and never uploads a crash.
    if (settings.get().diagnostics.crashDumps) crashReporter.start({ uploadToServer: false, compress: true });
    for (const warning of settings.warnings) console.warn(`[settings] ${warning}`);
    settings.watch();
    const theme = new ThemeService(settings.get().theme);
    const installKind = detectInstallKind({
      platform,
      packaged: app.isPackaged,
      appImage: process.env['APPIMAGE'],
      packageType: readPackageType(),
      execPath: process.execPath,
    });
    const skipOnboarding = process.env['ARBORA_SKIP_ONBOARDING'] === '1';
    const browserSessions = new BrowserSessions({
      extensionsDir: app.isPackaged
        ? join(process.resourcesPath, 'extensions')
        : join(import.meta.dirname, '../../resources/extensions'),
      settings: () => settings.get().browser,
    });

    const agentRegistry = new AgentRegistry(
      () => settings.get().agents.custom,
      () => settings.get().agents,
    );
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
      // Arbora's own executable runs the shim as Node; inside a packaged build the script is in app.asar.
      mcpShim: { command: process.execPath, script: join(import.meta.dirname, 'mcp-shim.js') },
      toolingWorkerPath: join(import.meta.dirname, 'tooling-worker.js'),
      appVersion: app.getVersion(),
      renderer:
        !app.isPackaged && rendererUrl
          ? { url: rendererUrl }
          : { file: join(import.meta.dirname, '../renderer/index.html') },
    });
    const manager = windows;

    const projectLibrary = (): ProjectLibrary => {
      const live = new Map<string, number>();
      for (const w of manager.all()) {
        if (w.project) live.set(w.project.path, attention.count(w.window));
      }
      return buildProjectLibrary(settings.get(), live);
    };
    let libraryTimer: NodeJS.Timeout | undefined;
    const broadcastLibrary = (): void => {
      clearTimeout(libraryTimer);
      libraryTimer = setTimeout(() => {
        const library = projectLibrary();
        for (const w of manager.all()) sendEvent(w.contents, 'projects.changed', library);
      }, 50);
    };
    manager.onProjectsChanged(broadcastLibrary);
    manager.onWindowClosed((w) => attention.forget(w.window));

    const attention = new AttentionService({
      platform,
      settings: () => settings.get().notifications,
      onClick: (target, threadId) => {
        const w = manager.all().find((candidate) => candidate.window === target.window);
        if (!w) return;
        if (w.window.isMinimized()) w.window.restore();
        w.window.show();
        w.window.focus();
        sendEvent(w.contents, 'notification.clicked', { threadId });
      },
      onCountsChanged: broadcastLibrary,
    });

    const updates = new UpdateService({
      kind: installKind,
      macSigned: platform === 'darwin' && installKind === 'dmg' && macSignedWithTeam(),
      version: app.getVersion(),
      settings: () => settings.get().updates,
      emit: (state) => {
        for (const w of manager.all()) sendEvent(w.contents, 'updates.state', state);
      },
    });
    updates.start();

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
      manager.settingsChanged();
      mainLog.setEnabled(next.diagnostics.logToFile);
      attention.applyBadge();
      for (const w of manager.all()) sendEvent(w.contents, 'settings.changed', next);
      broadcastLibrary();
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
      skipOnboarding,
      installKind,
    }));

    defineHandler('app.notify', isTrusted, (request, event) => {
      const w = windowFor(event.sender);
      attention.notify({ window: w.window, projectPath: w.project?.path ?? null }, request);
      return undefined;
    });
    defineHandler('app.setAttention', isTrusted, ({ count }, event) => {
      attention.setCount(windowFor(event.sender).window, count);
      return undefined;
    });
    defineHandler('app.openExternal', isTrusted, async ({ url }) => {
      await shell.openExternal(url);
      return undefined;
    });

    defineHandler('diagnostics.export', isTrusted, async (_req, event) => {
      const w = windowFor(event.sender);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const result = await dialog.showSaveDialog(w.window, {
        title: 'Export diagnostics',
        defaultPath: join(app.getPath('downloads'), `arbora-diagnostics-${stamp}.zip`),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { path: null };
      const zip = buildDiagnosticsZip({
        info: {
          version: app.getVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          platform,
          arch: process.arch,
          osRelease: process.getSystemVersion(),
          packaged: app.isPackaged,
          installKind,
          tilingCompositor,
          wayland: process.env['WAYLAND_DISPLAY'] !== undefined,
          openProjects: manager.all().filter((x) => x.project).length,
        },
        settings: settings.get(),
        logDir: mainLog.dir,
        crashDir: app.getPath('crashDumps'),
        projects: manager
          .all()
          .flatMap((x) => (x.project ? [{ name: x.project.name, settings: x.project.settings }] : [])),
        metrics: app
          .getAppMetrics()
          .map((m) => ({ type: m.type, memoryKb: m.memory.workingSetSize, cpu: m.cpu.percentCPUUsage })),
      });
      await writeFile(result.filePath, zip);
      return { path: result.filePath };
    });
    defineHandler('diagnostics.openCrashFolder', isTrusted, async () => {
      await shell.openPath(app.getPath('crashDumps'));
      return undefined;
    });

    defineHandler('updates.getState', isTrusted, () => ({
      state: updates.current(),
      installKind,
      version: app.getVersion(),
      selfUpdates: updates.selfUpdates,
    }));
    defineHandler('updates.check', isTrusted, () => updates.check());
    defineHandler('updates.download', isTrusted, async () => {
      await updates.download();
      return undefined;
    });
    defineHandler('updates.install', isTrusted, () => {
      updates.install();
      return undefined;
    });

    defineHandler('projects.library', isTrusted, () => projectLibrary());
    defineHandler('projects.updateMeta', isTrusted, ({ path, patch }) => {
      if (patch.groupId && !settings.get().projectGroups.some((g) => g.id === patch.groupId)) {
        throw new Error(`Unknown project group ${patch.groupId}`);
      }
      settings.update((s) => {
        const recent = s.recentProjects.find((r) => r.path === path);
        const state = applyProjectMeta(s.projects[path], patch);
        // Keep when it was last opened so a pinned project that leaves the recents still sorts.
        if (recent && state.openedAt === undefined) state.openedAt = recent.openedAt;
        return { ...s, projects: { ...s.projects, [path]: state } };
      });
      return projectLibrary();
    });
    defineHandler('projects.forget', isTrusted, ({ path }) => {
      settings.update((s) => ({
        ...s,
        recentProjects: s.recentProjects.filter((r) => r.path !== path),
        projects: { ...s.projects, [path]: applyProjectMeta(s.projects[path], { pinned: false, groupId: null }) },
      }));
      return projectLibrary();
    });
    defineHandler('projects.reveal', isTrusted, ({ path }) => {
      shell.showItemInFolder(path);
      return undefined;
    });

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
    defineHandler('settings.update', isTrusted, (patch) => settings.update((s) => applySettingsPatch(s, patch)));
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
    defineHandler('project.updateSettings', isTrusted, (patch, event) => {
      const w = windowFor(event.sender);
      if (!w.project) throw new Error('Open a project first');
      updateProjectSettingsFile(w.project.path, projectSettingsUpdates(patch));
      w.reloadProjectSettings();
      const info = w.info();
      if (!info) throw new Error('Open a project first');
      return info;
    });
    defineHandler('project.detectDevCommand', isTrusted, (_req, event) => {
      const project = windowFor(event.sender).project;
      return { command: project ? inferProjectDevCommand(project.path) : null };
    });
    defineHandler('project.openScreenshots', isTrusted, async (_req, event) => {
      const project = windowFor(event.sender).project;
      if (!project) throw new Error('Open a project first');
      const dir = join(project.path, '.arbora', 'screenshots');
      mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
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
    defineHandler('browser.resetData', isTrusted, async (_req, event) => {
      await windowFor(event.sender).resetBrowserData();
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
    const probes = new Map<string, Promise<AgentVerification>>();
    defineHandler('agent.verify', isTrusted, ({ agentId }, event) => {
      const running = probes.get(agentId);
      if (running) return running;
      const agent = agentRegistry.get(agentId);
      if (!agent) throw new Error(`Unknown agent ${agentId}`);
      const cwd = windowFor(event.sender).project?.path ?? homedir();
      const probe = (async () => {
        await shellEnvironment.ready;
        const env = shellEnvironment.env();
        const result = await probeAgent({
          agent,
          platform,
          cwd,
          env,
          lookup: (command) => findExecutable(command, env, platform),
          now: () => Date.now(),
        });
        settings.update((s) => ({
          ...s,
          agents: { ...s.agents, verified: { ...s.agents.verified, [agentId]: result } },
        }));
        return result;
      })().finally(() => probes.delete(agentId));
      probes.set(agentId, probe);
      return probe;
    });
    defineHandler('agent.listThreads', isTrusted, (_req, event) => windowFor(event.sender).agents?.listThreads() ?? []);
    defineHandler('agent.createThread', isTrusted, ({ agentId, model, groupId }, event) =>
      requireAgents(event.sender).createThread(agentId, model, groupId),
    );
    defineHandler('agent.listGroups', isTrusted, (_req, event) => windowFor(event.sender).agents?.listGroups() ?? []);
    defineHandler('agent.saveGroups', isTrusted, ({ groups }, event) => requireAgents(event.sender).saveGroups(groups));
    defineHandler('agent.setThreadGroup', isTrusted, ({ threadId, groupId }, event) => {
      requireAgents(event.sender).setThreadGroup(threadId, groupId);
      return undefined;
    });
    defineHandler('agent.setThreadPinned', isTrusted, ({ threadId, pinned }, event) => {
      requireAgents(event.sender).setThreadPinned(threadId, pinned);
      return undefined;
    });
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
    defineHandler('agent.stop', isTrusted, async ({ threadId }, event) => {
      await requireAgents(event.sender).stop(threadId);
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
    defineHandler('agent.pasteImage', isTrusted, async (_req, event) => {
      const project = windowFor(event.sender).project;
      if (!project) throw new Error('Open a project first');
      for (const item of await clipboard.read()) {
        const type = pickPastedImageType(item.types);
        if (!type) continue;
        const blob = await item.getType(type);
        if (!(blob instanceof Blob)) continue;
        const file = pastedImagePath(project.path, new Date(), type);
        mkdirSync(dirname(file), { recursive: true });
        ensureArboraGitignore(project.path);
        await writeFile(file, Buffer.from(await blob.arrayBuffer()));
        return describeAttachment(file);
      }
      return null;
    });
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

    defineHandler('design.setActive', isTrusted, ({ active }, event) => {
      windowFor(event.sender).designMode?.setActive(active);
      return undefined;
    });
    defineHandler('design.command', isTrusted, (command, event) => {
      const design = windowFor(event.sender).designMode;
      if (!design) throw new Error('Open a project first');
      design.command(command);
      return undefined;
    });
    defineHandler('design.save', isTrusted, (request, event) => {
      const design = windowFor(event.sender).designMode;
      if (!design) throw new Error('Open a project first');
      return design.save(request.target);
    });
    defineHandler('design.discard', isTrusted, (_request, event) => {
      windowFor(event.sender).designMode?.discard();
      return undefined;
    });
    defineHandler('design.listSessions', isTrusted, (_request, event) => {
      return windowFor(event.sender).designMode?.listSessions() ?? [];
    });
    defineHandler('design.resend', isTrusted, (request, event) => {
      const design = windowFor(event.sender).designMode;
      if (!design) throw new Error('Open a project first');
      return design.resend(request.id, request.target);
    });

    const requireWorkspace = (sender: WebContents): WorkspaceService => {
      const workspace = windowFor(sender).workspace;
      if (!workspace) throw new Error('Open a project first');
      return workspace;
    };
    defineHandler('files.readDir', isTrusted, ({ path }, event) => requireWorkspace(event.sender).readDir(path));
    defineHandler('files.read', isTrusted, ({ path }, event) => requireWorkspace(event.sender).read(path));
    defineHandler('files.write', isTrusted, ({ path, content, eol, format }, event) =>
      requireWorkspace(event.sender).save(path, content, eol, format),
    );
    defineHandler('files.create', isTrusted, async ({ path, kind }, event) => {
      await requireWorkspace(event.sender).create(path, kind);
      return undefined;
    });
    defineHandler('files.rename', isTrusted, async ({ from, to }, event) => {
      await requireWorkspace(event.sender).rename(from, to);
      return undefined;
    });
    defineHandler('files.delete', isTrusted, async ({ path }, event) => {
      await requireWorkspace(event.sender).delete(path);
      return undefined;
    });
    defineHandler('files.reveal', isTrusted, ({ path }, event) => {
      requireWorkspace(event.sender).reveal(path);
      return undefined;
    });
    defineHandler('files.list', isTrusted, (_req, event) => requireWorkspace(event.sender).listFiles());
    defineHandler('search.start', isTrusted, async (query, event) => ({
      searchId: await requireWorkspace(event.sender).search(query),
    }));
    defineHandler('search.cancel', isTrusted, ({ searchId }, event) => {
      windowFor(event.sender).workspace?.cancelSearch(searchId);
      return undefined;
    });
    defineHandler('editor.format', isTrusted, ({ path, content }, event) =>
      requireWorkspace(event.sender).format(path, content),
    );

    const requireGit = (sender: WebContents): GitService => {
      const git = windowFor(sender).git;
      if (!git) throw new Error('Open a project first');
      return git;
    };
    const gitEnv = async (): Promise<NodeJS.ProcessEnv> => {
      await shellEnvironment.ready;
      return shellEnvironment.env();
    };
    defineHandler('git.status', isTrusted, (_req, event) => requireGit(event.sender).status());
    defineHandler('git.diff', isTrusted, ({ path, staged }, event) =>
      requireGit(event.sender)
        .diff(path, staged)
        .then((text) => ({ text })),
    );
    defineHandler('git.hunks', isTrusted, ({ path, staged }, event) => requireGit(event.sender).hunks(path, staged));
    defineHandler('git.lines', isTrusted, ({ path }, event) => requireGit(event.sender).lines(path));
    defineHandler('git.sides', isTrusted, ({ path, staged }, event) => requireGit(event.sender).sides(path, staged));
    defineHandler('git.stage', isTrusted, async ({ paths }, event) => {
      await requireGit(event.sender).stage(paths);
      return undefined;
    });
    defineHandler('git.unstage', isTrusted, async ({ paths }, event) => {
      await requireGit(event.sender).unstage(paths);
      return undefined;
    });
    defineHandler('git.stageHunk', isTrusted, async ({ path, index, staged }, event) => {
      await requireGit(event.sender).stageHunk(path, index, staged);
      return undefined;
    });
    defineHandler('git.discard', isTrusted, async ({ paths }, event) => {
      await requireGit(event.sender).discard(paths);
      return undefined;
    });
    defineHandler('git.commit', isTrusted, ({ message, amend }, event) =>
      requireGit(event.sender).commit(message, amend),
    );
    defineHandler('git.branches', isTrusted, (_req, event) => requireGit(event.sender).branches());
    defineHandler('git.checkout', isTrusted, ({ name }, event) => requireGit(event.sender).checkout(name));
    defineHandler('git.createBranch', isTrusted, ({ name }, event) => requireGit(event.sender).createBranch(name));
    defineHandler('git.log', isTrusted, (_req, event) => requireGit(event.sender).log());
    defineHandler('git.push', isTrusted, (_req, event) => requireGit(event.sender).push());
    defineHandler('git.pull', isTrusted, (_req, event) => requireGit(event.sender).pull());
    defineHandler('git.fetch', isTrusted, (_req, event) => requireGit(event.sender).fetch());
    defineHandler('git.stash', isTrusted, (_req, event) => requireGit(event.sender).stash());
    defineHandler('git.stashApply', isTrusted, ({ index, pop }, event) =>
      requireGit(event.sender).stashApply(index, pop),
    );
    defineHandler('git.stashDrop', isTrusted, ({ index }, event) => requireGit(event.sender).stashDrop(index));
    defineHandler('git.arboraTracked', isTrusted, async (_req, event) => ({
      count: await requireGit(event.sender).trackedArboraFiles(),
    }));
    defineHandler('git.untrackArbora', isTrusted, (_req, event) => requireGit(event.sender).untrackArbora());
    defineHandler('git.remotes', isTrusted, (_req, event) => requireGit(event.sender).remotes());
    defineHandler('git.github', isTrusted, async () => githubAuth(await gitEnv()));
    defineHandler('git.pullRequests', isTrusted, async (_req, event) => {
      const project = windowFor(event.sender).project;
      if (!project) throw new Error('Open a project first');
      return listPullRequests(project.path, await gitEnv());
    });
    defineHandler('git.createPullRequest', isTrusted, async ({ title, body }, event) => {
      const project = windowFor(event.sender).project;
      if (!project) throw new Error('Open a project first');
      return { url: await createPullRequest(project.path, await gitEnv(), title, body) };
    });
    defineHandler('git.stageAll', isTrusted, async (_req, event) => {
      await requireGit(event.sender).stageAll();
      return undefined;
    });
    defineHandler('git.defaultBranch', isTrusted, (_req, event) => requireGit(event.sender).defaultBranch());
    defineHandler('git.syncNow', isTrusted, async (_req, event) => {
      const sync = windowFor(event.sender).gitSync;
      if (!sync) throw new Error('Open a project first');
      return sync.sync();
    });
    defineHandler('git.generate', isTrusted, async ({ kind }, event) => {
      const w = windowFor(event.sender);
      const git = requireGit(event.sender);
      if (!w.project || !w.agents) throw new Error('Open a project first');
      const current = settings.get();
      const known = w.agents.listAgents().agents.map((agent) => agent.id);
      const task = resolveTaskAgent(current.tasks, 'git', known, current.agents, w.project.settings.defaultAgent);
      if (!task) throw new Error('Choose an agent for Git in Settings → Agents.');
      let prompt: string;
      if (kind === 'commit') {
        const { stat, diff } = await git.stagedSummary();
        if (diff.trim() === '') throw new Error('Stage changes before generating a message.');
        prompt = commitMessagePrompt(stat, diff);
      } else {
        const status = await git.status();
        const base = (await git.defaultBranch()) ?? 'main';
        const summary = await git.branchSummary(base);
        prompt = pullRequestPrompt(status.branch ?? 'HEAD', base, summary.log, summary.stat, summary.diff);
      }
      const text = parseGeneratedText(await w.agents.runTask(task.agentId, task.model, prompt));
      if (text.title === '') throw new Error('The agent did not return any text.');
      return text;
    });
    defineHandler('git.checks', isTrusted, async ({ number }, event) => {
      const project = windowFor(event.sender).project;
      if (!project) throw new Error('Open a project first');
      return pullRequestChecks(project.path, await gitEnv(), number);
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
      updates.dispose();
      attention.dispose();
      settings.dispose();
      theme.dispose();
      mainLog.dispose();
    });
  });

  app.on('window-all-closed', () => {
    if (shouldQuitWhenAllWindowsClosed(platform, quitOnLastWindowClose())) app.quit();
  });
}

/**
 * Whether the running macOS app is signed with a Developer ID team. Unsigned and ad-hoc builds
 * report `TeamIdentifier=not set` (or no signature at all).
 */
function macSignedWithTeam(): boolean {
  const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
  // codesign prints its report on stderr, also when it succeeds.
  const result = spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8' });
  return /TeamIdentifier=(?!not set)\S+/.test(`${result.stdout}${result.stderr}`);
}

/** electron-builder writes `resources/package-type` (`deb`, `rpm`, ...) into Linux packages. */
function readPackageType(): string | undefined {
  if (!app.isPackaged) return undefined;
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8');
  } catch {
    return undefined;
  }
}

async function openInEditor(file: string): Promise<void> {
  const error = await shell.openPath(file);
  if (error) {
    shell.showItemInFolder(file);
  }
}

main();
