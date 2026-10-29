import { useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { executeCommand, navigateBrowser, registerBuiltinCommands } from './commands';
import { useKeybindingContextSync, useKeybindingDispatch } from './keybindings';
import { addProblems, setProblems, setProject, showToast, useApp } from './store';
import { applyTerminalList, resetTerminals } from './terminal-store';

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
  useEffect(() => registerBuiltinCommands(), []);
  useMainEvents();
  useBrowserSnapshot();
  useTerminalSnapshot();
  useThemeClass();
  usePreventFileNavigation();
  useKeybindingDispatch();
  useKeybindingContextSync();

  return (
    <div className="flex h-full flex-col" data-testid="app">
      <TitleBar />
      {project ? <Workspace /> : <Welcome />}
      <CommandPalette />
      <Toasts />
    </div>
  );
}
