import { lazy, Suspense, useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import {
  appendLog,
  applyThreadChanges,
  applyThreadList,
  applyThreadState,
  loadAgentSnapshot,
  noteFileChanged,
  resetAgents,
} from './agent-store';
import { executeCommand, navigateBrowser, registerBuiltinCommands } from './commands';
import { onFilesChanged, resetFiles, setDiagnostics } from './files-store';
import { noteAgentWatcherChanges, refreshGit, scheduleGitRefresh } from './git-client';
import { useKeybindingContextSync, useKeybindingDispatch } from './keybindings';
import { addProblems, applyDesignState, dispatchMode, setProblems, setProject, showToast, useApp } from './store';
import { applyTerminalList, resetTerminals } from './terminal-store';

const SettingsPage = lazy(() => import('./panels/settings/SettingsPage'));

/** Tool failures repeat on every save; say each one once per session. */
const shownToolErrors = new Set<string>();

function useMainEvents(): void {
  useEffect(() => {
    const { arbora } = window;
    const offs = [
      arbora.on('settings.changed', (settings) => useApp.setState({ settings })),
      arbora.on('theme.changed', (theme) => useApp.setState({ theme })),
      arbora.on('project.changed', (project) => setProject(project)),
      arbora.on('window.stateChanged', (windowState) => useApp.setState({ windowState })),
      arbora.on('command.invoke', ({ commandId }) => executeCommand(commandId)),
      arbora.on('browser.stateChanged', (browser) => useApp.setState({ browser })),
      arbora.on('browser.problemsAdded', ({ entries }) => addProblems(entries)),
      arbora.on('browser.problemsCleared', () => useApp.setState({ problems: [] })),
      arbora.on('browser.urlSuggested', ({ url }) => useApp.setState({ suggestedUrl: url })),
      arbora.on('terminal.changed', ({ terminals }) => applyTerminalList(terminals)),
      arbora.on('terminal.urlDetected', ({ url, opened }) => {
        if (opened) showToast(`Opened ${url} in the browser`);
        else showToast(`Dev server at ${url}`, { label: 'Open in browser', run: () => void navigateBrowser(url) });
      }),
      arbora.on('agent.threadsChanged', ({ threads }) => applyThreadList(threads)),
      arbora.on('agent.threadEvents', ({ threadId, changes }) => applyThreadChanges(threadId, changes)),
      arbora.on('agent.threadState', ({ threadId, state }) => applyThreadState(threadId, state)),
      arbora.on('agent.log', ({ threadId, entry }) => appendLog(threadId, entry)),
      arbora.on('agent.fileChanged', ({ threadId, path }) => noteFileChanged(threadId, path)),
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
    return () => {
      for (const off of offs) off();
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
  useEffect(() => {
    resetTerminals();
    if (!projectPath) return;
    let active = true;
    void window.arbora.invoke('terminal.list').then((terminals) => {
      if (active) applyTerminalList(terminals);
    });
    return () => {
      active = false;
    };
  }, [projectPath]);
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
  useEffect(() => {
    resetAgents();
    if (!projectPath) return;
    void loadAgentSnapshot().catch((error: unknown) => showToast(`Could not load agents: ${(error as Error).message}`));
  }, [projectPath]);
}

function useThemeClass(): void {
  const resolved = useApp((s) => s.theme.resolved);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);
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

export function App() {
  const project = useApp((s) => s.project);
  const settingsOpen = useApp((s) => s.settingsOpen);
  useEffect(() => registerBuiltinCommands(), []);
  useMainEvents();
  useBrowserSnapshot();
  useTerminalSnapshot();
  useAgentSnapshot();
  useFilesReset();
  useThemeClass();
  usePreventFileNavigation();
  useKeybindingDispatch();
  useKeybindingContextSync();

  return (
    <div className="flex h-full flex-col" data-testid="app">
      <TitleBar />
      {project ? (
        <Workspace />
      ) : settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPage />
        </Suspense>
      ) : (
        <Welcome />
      )}
      <CommandPalette />
      {project && <QuickOpen />}
      <Toasts />
    </div>
  );
}
