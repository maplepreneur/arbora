import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initStore } from './store';
import './styles.css';

async function bootstrap(): Promise<void> {
  const { arbora } = window;
  const [info, settings, theme, project, windowState] = await Promise.all([
    arbora.invoke('app.getInfo'),
    arbora.invoke('settings.get'),
    arbora.invoke('theme.get'),
    arbora.invoke('project.getCurrent'),
    arbora.invoke('window.getState'),
  ]);
  initStore({ info, settings, theme, project, windowState });
  document.documentElement.classList.toggle('dark', theme.resolved === 'dark');
  document.documentElement.dataset['platform'] = info.platform;

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
