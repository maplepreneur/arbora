import { lazy, Suspense, useEffect } from 'react';
import { appearanceCssVariables, groveWebsiteAction } from '@arbora/shared';
import { CommandPalette } from './components/CommandPalette';
import { KeybindingsCheatsheet } from './components/KeybindingsCheatsheet';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QuickOpen } from './components/QuickOpen';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Tooltips } from './components/Tooltips';
import { ProjectsHome } from './components/ProjectsHome';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { UpdateDialog } from './components/UpdateDialog';
import {
  appendLog,
  applyGroups,
  applyThreadChanges,
  applyThreadList,
  applyThreadState,
  loadAgentSnapshot,
  noteFileChanged,
  resetAgents,
  useAgents,
} from './agent-store';
import {
  initAttentionTracking,
  noteThreadChanges,
  noteThreadState,
  pruneAttention,
  resetAttention,
  useAttention,
} from './attention-store';
import { applyLibrary } from './projects-store';
import { applyUpdateState } from './update-store';
import {
  executeCommand,
  navigateBrowser,
  openGroveWebsite,
  reclaimFocusFromParkedPage,
  registerBuiltinCommands,
  revealThread,
} from './commands';
import { setBrowserPageFocused } from './shell-focus';
import { onFilesChanged, resetFiles, setDiagnostics } from './files-store';
import { noteAgentWatcherChanges, refreshGit, scheduleGitRefresh, useGit } from './git-client';
import {
  initGroveTracking,
  noteProjectTerminals,
  indexedThreadIds,
  noteProjectThreads,
  patchProjectThread,
  refreshGroveAgents,
  useGrove,
} from './grove-store';
import { useKeybindingContextSync, useKeybindingDispatch } from './keybindings';
import {
  addProblems,
  applyDesignState,
  dispatchMode,
  closeOverlay,
  openOverlay,
  setProblems,
  SHELL_GROUP,
  setProject,
  showToast,
  useApp,
} from './store';
import { applyTerminalList, resetTerminals } from './terminal-store';

const SettingsPage = lazy(() => import('./panels/settings/SettingsPage'));
const Onboarding = lazy(() => import('./panels/onboarding/Onboarding'));
const GroveWorkspace = lazy(() => import('./panels/grove/GroveWorkspace'));

/** The shell's tree column while its chunk loads, so the first paint is not an empty window. */
function ShellLoading() {
  const tree = useApp((s) => s.layout.groups[SHELL_GROUP]?.['tree'] ?? 18);
  return (
    <div className="flex min-h-0 min-w-0 flex-1" aria-busy="true">
      {tree > 0 && (
        <div
          className="h-full max-w-[40%] min-w-[180px] border-r border-border bg-bg-subtle"
          style={{ width: `${tree}%` }}
        />
      )}
      <div className="h-full min-w-0 flex-1 bg-bg" />
    </div>
  );
}

/** Tool failures repeat on every save; say each one once per session. */
const shownToolErrors = new Set<string>();

/** The project whose agent and terminal events this window is showing. */
function activeProjectPath(): string | null {
  const { project, layout } = useApp.getState();
  const focus = useGrove.getState().focusPath;
  if (layout.workspace === 'grove' && focus) return focus;
  return project?.path ?? null;
}

function useMainEvents(): void {
  useEffect(() => {
    const { arbora } = window;
    const offs = [
      arbora.on('settings.changed', (settings) => useApp.setState({ settings })),
      arbora.on('theme.changed', (theme) => useApp.setState({ theme })),
      arbora.on('project.changed', (project) => setProject(project)),
      arbora.on('window.stateChanged', (windowState) => useApp.setState({ windowState })),
      arbora.on('git.synced', (result) => {
        useGit.setState({ lastSync: result });
        void refreshGit();
      }),
      arbora.on('command.invoke', ({ commandId, fromPage }) => executeCommand(commandId, { fromPage })),
      arbora.on('browser.stateChanged', (browser) => useApp.setState({ browser })),
      arbora.on('browser.pageFocused', ({ focused }) => setBrowserPageFocused(focused)),
      arbora.on('browser.focusParked', () => reclaimFocusFromParkedPage()),
      arbora.on('browser.problemsAdded', ({ entries }) => addProblems(entries)),
      arbora.on('browser.problemsCleared', () => useApp.setState({ problems: [] })),
      arbora.on('browser.urlSuggested', ({ url }) => useApp.setState({ suggestedUrl: url })),
      arbora.on('terminal.changed', ({ projectPath, terminals }) => {
        noteProjectTerminals(projectPath, terminals);
        if (projectPath === activeProjectPath()) applyTerminalList(terminals, projectPath);
      }),
      arbora.on('terminal.urlDetected', ({ projectPath, url, opened }) => {
        if (projectPath !== activeProjectPath()) return;
        if (opened) {
          showToast(`Opened ${url} in the browser`);
          return;
        }
        const grove = groveWebsiteAction({ workspace: useApp.getState().layout.workspace, projectPath, url });
        showToast(`Dev server at ${url}`, {
          label: 'Open in browser',
          run: () => void (grove ? openGroveWebsite(grove) : navigateBrowser(url)),
        });
      }),
      arbora.on('agent.threadsChanged', ({ projectPath, threads }) => {
        noteProjectThreads(projectPath, threads);
        if (projectPath === activeProjectPath()) applyThreadList(threads);
        const live = useAgents.getState().threads.map((thread) => thread.id);
        pruneAttention([...new Set([...indexedThreadIds(), ...live])]);
      }),
      arbora.on('agent.groupsChanged', ({ projectPath, groups }) => {
        if (projectPath === activeProjectPath()) applyGroups(groups);
      }),
      arbora.on('agent.threadEvents', ({ projectPath, threadId, changes }) => {
        if (projectPath === activeProjectPath()) applyThreadChanges(threadId, changes);
        noteThreadChanges(threadId, changes);
      }),
      arbora.on('agent.threadState', ({ projectPath, threadId, state }) => {
        if (projectPath === activeProjectPath()) applyThreadState(threadId, state);
        else patchProjectThread(projectPath, threadId, state);
        noteThreadState(threadId, state);
      }),
      arbora.on('notification.clicked', ({ threadId }) => {
        if (threadId && useApp.getState().project) revealThread(threadId);
      }),
      arbora.on('updates.state', (state) => applyUpdateState(state)),
      arbora.on('projects.changed', (library) => applyLibrary(library)),
      arbora.on('agent.log', ({ projectPath, threadId, entry }) => {
        if (projectPath === activeProjectPath()) appendLog(threadId, entry);
      }),
      arbora.on('agent.fileChanged', ({ projectPath, threadId, path }) => {
        if (projectPath === activeProjectPath()) noteFileChanged(threadId, path);
      }),
      arbora.on('grove.usage', ({ samples }) => useGrove.setState({ usage: samples })),
      arbora.on('agentMode.picked', () => dispatchMode({ type: 'picked' })),
      arbora.on('agentMode.selected', (selection) => dispatchMode({ type: 'resolved', selection })),
      arbora.on('agentMode.ended', ({ error }) => {
        if (error) showToast(`Agent mode: ${error}`);
        dispatchMode({ type: error ? 'failed' : 'exit' });
      }),
      arbora.on('design.state', (state) => applyDesignState(state)),
      arbora.on('design.navigationBlocked', ({ url }) => {
        showToast(`Save or discard design edits before leaving ${url}`);
      }),
      arbora.on('design.failed', ({ error }) => {
        showToast(`Design mode: ${error}`);
        dispatchMode({ type: 'designLeave' });
      }),
      arbora.on('files.changed', ({ changes }) => {
        onFilesChanged(changes);
        noteAgentWatcherChanges(changes);
        scheduleGitRefresh();
      }),
      arbora.on('files.watchWarning', ({ message }) => showToast(message)),
      arbora.on('editor.diagnostics', ({ path, source, diagnostics }) => setDiagnostics(path, source, diagnostics)),
      arbora.on('editor.toolError', ({ source, message }) => {
        const text = `${source}: ${message}`;
        if (shownToolErrors.has(text)) return;
        shownToolErrors.add(text);
        showToast(text);
      }),
    ];
    // Main's focus event can fire before this listener exists. DOM focus alone is not the window's
    // (the embedded page takes it while the window stays focused), so ask main.
    const syncFocus = (): void => {
      void arbora.invoke('window.getState').then((windowState) => useApp.setState({ windowState }));
    };
    window.addEventListener('focus', syncFocus);
    window.addEventListener('blur', syncFocus);
    syncFocus();
    return () => {
      for (const off of offs) off();
      window.removeEventListener('focus', syncFocus);
      window.removeEventListener('blur', syncFocus);
    };
  }, []);
}

/** Loads the browser panel's state and buffered problems whenever the project changes. */
function useBrowserSnapshot(): void {
  const projectPath = useApp((s) => s.project?.path);
  useEffect(() => {
    if (!projectPath) return;
    let active = true;
    const { arbora } = window;
    void Promise.all([
      arbora.invoke('browser.getState'),
      arbora.invoke('browser.getConsole'),
      arbora.invoke('browser.getNetworkErrors'),
    ]).then(([browser, consoleEntries, network]) => {
      if (!active) return;
      // Events may have arrived first; never replace a live state with an older null.
      if (browser) useApp.setState({ browser });
      setProblems(consoleEntries, network);
    });
    return () => {
      active = false;
    };
  }, [projectPath]);
}

/** Terminals belong to the project; reload the list (after a renderer reload too) when it changes. */
function useTerminalSnapshot(): void {
  const projectPath = useApp((s) => s.project?.path);
  const workspace = useApp((s) => s.layout.workspace);
  const focusPath = useGrove((s) => s.focusPath);
  const scope = workspace === 'grove' && focusPath ? focusPath : projectPath;
  useEffect(() => {
    resetTerminals();
    if (!scope) return;
    let active = true;
    void window.arbora.invoke('terminal.list').then((terminals) => {
      if (active) applyTerminalList(terminals, scope);
    });
    return () => {
      active = false;
    };
  }, [scope]);
}

/** Open files, the tree and diagnostics belong to the project. */
function useFilesReset(): void {
  const projectPath = useApp((s) => s.project?.path);
  useEffect(() => {
    resetFiles();
    shownToolErrors.clear();
    if (projectPath) void refreshGit();
  }, [projectPath]);
}

/** Agents and threads belong to the project; reload them when it changes (and after a renderer reload). */
function useAgentSnapshot(): void {
  const projectPath = useApp((s) => s.project?.path);
  const workspace = useApp((s) => s.layout.workspace);
  const focusPath = useGrove((s) => s.focusPath);
  const scope = workspace === 'grove' && focusPath ? focusPath : projectPath;
  useEffect(() => {
    const indexed = indexedThreadIds();
    if (indexed.length === 0) resetAttention();
    else pruneAttention(indexed);
  }, [projectPath]);
  useEffect(() => {
    resetAgents();
    if (!scope) return;
    void loadAgentSnapshot()
      .then(() => {
        noteProjectThreads(scope, useAgents.getState().threads);
        pruneAttention([
          ...new Set([...indexedThreadIds(), ...useAgents.getState().threads.map((thread) => thread.id)]),
        ]);
      })
      .catch((error: unknown) => showToast(`Could not load agents: ${(error as Error).message}`));
  }, [scope]);
  useEffect(() => {
    if (workspace !== 'grove') return;
    refreshGroveAgents();
  }, [workspace]);
}

function useThemeClass(): void {
  const resolved = useApp((s) => s.theme.resolved);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);
}

function useAppearanceVariables(): void {
  const appearance = useApp((s) => s.settings.appearance);
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(appearanceCssVariables(appearance))) style.setProperty(name, value);
  }, [appearance]);
}

/** Without this, dropping a file anywhere outside the drop zone navigates the window to it. */
function usePreventFileNavigation(): void {
  useEffect(() => {
    const prevent = (event: DragEvent): void => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);
}

/** Opens the first-run wizard once settings say it was never finished. */
function useFirstRun(): void {
  useEffect(() => {
    const { settings, info } = useApp.getState();
    if (!settings.onboarding.completed && !info.skipOnboarding) openOverlay('onboarding');
  }, []);
}

export function App() {
  const project = useApp((s) => s.project);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const overlay = useApp((s) => s.overlay);
  const groveListed = useApp((s) => s.settings.grove.projects.length > 0);
  const lastCue = useAttention((s) => s.lastCue);
  useEffect(() => registerBuiltinCommands(), []);
  useEffect(() => initAttentionTracking(), []);
  useEffect(() => initGroveTracking(), []);
  useFirstRun();
  useMainEvents();
  useBrowserSnapshot();
  useTerminalSnapshot();
  useAgentSnapshot();
  useFilesReset();
  useThemeClass();
  useAppearanceVariables();
  usePreventFileNavigation();
  useKeybindingDispatch();
  useKeybindingContextSync();

  return (
    <div
      className="flex h-full flex-col"
      data-testid="app"
      data-last-cue={lastCue ? `${lastCue.kind}:${lastCue.sound ? 'sound' : 'silent'}` : undefined}
    >
      <TitleBar />
      {project || groveListed ? (
        <ErrorBoundary label="Grove">
          <Suspense fallback={<ShellLoading />}>
            <GroveWorkspace />
          </Suspense>
        </ErrorBoundary>
      ) : settingsOpen ? (
        <ErrorBoundary label="Settings">
          <Suspense fallback={null}>
            <SettingsPage />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <ProjectsHome />
      )}
      <CommandPalette />
      <KeybindingsCheatsheet />
      <ProjectSwitcher />
      <UpdateDialog />
      {overlay === 'onboarding' && (
        <ErrorBoundary label="Getting started" onClose={() => closeOverlay('onboarding')}>
          <Suspense fallback={null}>
            <Onboarding />
          </Suspense>
        </ErrorBoundary>
      )}
      {project && <QuickOpen />}
      <Toasts />
      <Tooltips />
    </div>
  );
}
