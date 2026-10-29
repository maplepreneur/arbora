import { useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { executeCommand, registerBuiltinCommands } from './commands';
import { useKeybindingContextSync, useKeybindingDispatch } from './keybindings';
import { setProject, useApp } from './store';

function useMainEvents(): void {
  useEffect(() => {
    const { arbora } = window;
    const offs = [
      arbora.on('settings.changed', (settings) => useApp.setState({ settings })),
      arbora.on('theme.changed', (theme) => useApp.setState({ theme })),
      arbora.on('project.changed', (project) => setProject(project)),
      arbora.on('window.stateChanged', (windowState) => useApp.setState({ windowState })),
      arbora.on('command.invoke', ({ commandId }) => executeCommand(commandId)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
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
