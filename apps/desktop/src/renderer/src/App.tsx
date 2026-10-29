import { useEffect } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { useAppState } from './context';
import { useKeyboardDispatch } from './keyboard';

export function App() {
  useKeyboardDispatch();
  const project = useAppState((state) => state.project);
  const resolvedTheme = useAppState((state) => state.theme.resolved);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  useEffect(() => {
    // Without this, dropping a file anywhere navigates the window to it.
    const prevent = (event: DragEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="min-h-0 flex-1">
        {project ? <Workspace key={project.path} /> : <Welcome />}
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
