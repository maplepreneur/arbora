import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { events, toPlatform } from '@arbora/shared';
import { registerIpc } from './ipc';
import type { ProjectWindow } from './project-window';
import { SettingsService } from './settings-service';
import { computeChromiumSwitches, parseProjectArg } from './startup';
import { ThemeService } from './theme-service';
import { WindowManager } from './window-manager';

const platform = toPlatform(process.platform);
const isDev = !app.isPackaged;
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

// Must run before `ready`: the name drives the Wayland app_id / WM class and the userData folder.
app.setName('arbora');
const userDataOverride = process.env.ARBORA_USER_DATA_DIR;
if (userDataOverride !== undefined && userDataOverride !== '') {
  app.setPath('userData', userDataOverride);
}
for (const { name, value } of computeChromiumSwitches(platform, process.env.ARBORA_FLAGS)) {
  if (value === undefined) {
    app.commandLine.appendSwitch(name);
  } else {
    app.commandLine.appendSwitch(name, value);
  }
}

function isAppUrl(url: string): boolean {
  if (rendererDevUrl !== undefined) return url.startsWith(rendererDevUrl);
  return url.startsWith('file://');
}

// Deny-by-default for every webContents Arbora creates, including future browser views.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//u.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (contents.getType() === 'window' && !isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});

async function loadRenderer(entry: ProjectWindow): Promise<void> {
  if (rendererDevUrl !== undefined) {
    await entry.window.loadURL(rendererDevUrl);
  } else {
    await entry.window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

function start(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const settings = new SettingsService(app.getPath('userData'));
  const theme = new ThemeService(settings.settings.theme);
  const windows = new WindowManager({
    platform,
    preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
    settings,
    theme,
    loadRenderer,
  });

  settings.onDidChange((next) => {
    theme.setSource(next.theme);
    windows.broadcast(events.settingsChanged, next);
    windows.broadcast(events.themeChanged, theme.state);
  });
  theme.onDidChange((state) => {
    windows.broadcast(events.themeChanged, state);
  });

  const openFromArgv = async (argv: readonly string[], cwd: string): Promise<void> => {
    const projectPath = parseProjectArg(argv, process.defaultApp, cwd);
    if (projectPath === undefined) {
      windows.openWelcome();
      return;
    }
    const result = await windows.openProject(projectPath);
    if (result.status === 'error') {
      console.error(`[arbora] ${result.message}`);
      windows.openWelcome();
    }
  };

  app.on('second-instance', (_event, argv, workingDirectory) => {
    void openFromArgv(argv, workingDirectory);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.openWelcome();
  });

  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit();
  });

  let disposeIpc: (() => void) | undefined;
  app.on('will-quit', () => {
    disposeIpc?.();
    windows.dispose();
    theme.dispose();
    void settings.dispose();
  });

  void app.whenReady().then(async () => {
    disposeIpc = registerIpc({ windows, settings, theme, isDev });
    settings.watch();
    await openFromArgv(process.argv, process.cwd());
  });
}

start();
