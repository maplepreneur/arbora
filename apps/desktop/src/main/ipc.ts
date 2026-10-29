import { app, dialog, ipcMain, shell } from 'electron';
import { channels, defineHandler, toPlatform, type RegisteredHandler } from '@arbora/shared';
import type { ProjectWindow } from './project-window';
import type { SettingsService } from './settings-service';
import type { ThemeService } from './theme-service';
import type { WindowManager } from './window-manager';

interface HandlerContext {
  readonly window: ProjectWindow;
}

export interface IpcDependencies {
  readonly windows: WindowManager;
  readonly settings: SettingsService;
  readonly theme: ThemeService;
  readonly isDev: boolean;
}

const OK = { ok: true } as const;

function createHandlers({
  windows,
  settings,
  theme,
  isDev,
}: IpcDependencies): RegisteredHandler<HandlerContext>[] {
  return [
    defineHandler(channels.getAppInfo, () => ({
      platform: toPlatform(process.platform),
      version: app.getVersion(),
      isDev,
    })),

    defineHandler(channels.getSettings, () => settings.settings),
    defineHandler(channels.updateSettings, (patch) => settings.update(patch)),
    defineHandler(channels.openSettingsFile, async () => {
      const error = await shell.openPath(await settings.ensureSettingsFile());
      if (error !== '') throw new Error(error);
      return OK;
    }),

    defineHandler(channels.getTheme, () => theme.state),

    defineHandler(channels.getCurrentProject, (_request, { window }) => window.projectInfo),
    defineHandler(channels.openProjectDialog, async (_request, { window }) => {
      const result = await dialog.showOpenDialog(window.window, {
        title: 'Open Project',
        properties: ['openDirectory', 'createDirectory'],
      });
      const [path] = result.filePaths;
      if (result.canceled || path === undefined) return { status: 'cancelled' as const };
      return windows.openProject(path, window);
    }),
    defineHandler(channels.openProject, ({ path }, { window }) =>
      windows.openProject(path, window),
    ),
    defineHandler(channels.listRecentProjects, () => [...settings.recentProjects]),
    defineHandler(channels.removeRecentProject, async ({ path }) => [
      ...(await settings.removeRecentProject(path)),
    ]),
    defineHandler(channels.updateProjectSettings, async (patch, { window }) => {
      const project = window.project;
      if (!project) throw new Error('No project is open in this window');
      const next = await project.store.update(patch);
      window.refreshKeybindings();
      return next;
    }),

    defineHandler(channels.getLayout, (_request, { window }) => {
      const project = window.project;
      return project ? (settings.projectUiState(project.path).layout ?? null) : null;
    }),
    defineHandler(channels.setLayout, async (layout, { window }) => {
      const project = window.project;
      if (project) await settings.setProjectLayout(project.path, layout);
      return OK;
    }),

    defineHandler(channels.getWindowState, (_request, { window }) => window.windowState),
    defineHandler(channels.windowControl, ({ action }, { window }) => {
      const browserWindow = window.window;
      switch (action) {
        case 'minimize':
          browserWindow.minimize();
          break;
        case 'toggleMaximize':
          if (browserWindow.isMaximized()) {
            browserWindow.unmaximize();
          } else {
            browserWindow.maximize();
          }
          break;
        case 'close':
          browserWindow.close();
          break;
        default: {
          const exhaustive: never = action;
          throw new Error(`Unknown window action ${String(exhaustive)}`);
        }
      }
      return OK;
    }),

    defineHandler(channels.getKeybindings, (_request, { window }) => window.keybindingsState),
    defineHandler(channels.setKeyContext, (context, { window }) => {
      window.setKeyContext(context);
      return OK;
    }),
  ];
}

/** Registers every channel. Requests from anything but an Arbora app window are rejected. */
export function registerIpc(dependencies: IpcDependencies): () => void {
  const handlers = createHandlers(dependencies);
  for (const handler of handlers) {
    ipcMain.handle(handler.name, (event, raw: unknown) => {
      const window = dependencies.windows.fromWebContents(event.sender);
      if (!window || event.senderFrame !== event.sender.mainFrame) {
        throw new Error(`Rejected IPC "${handler.name}" from an unknown sender`);
      }
      return handler.handle(raw, { window });
    });
  }
  return () => {
    for (const handler of handlers) ipcMain.removeHandler(handler.name);
  };
}
