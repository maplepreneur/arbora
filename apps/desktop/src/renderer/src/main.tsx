import { CommandRegistry } from '@arbora/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerBuiltinCommands } from './app-commands';
import { ServicesProvider, type AppServices } from './context';
import { createAppStore } from './store';
import './styles.css';

async function bootstrap(): Promise<void> {
  const bridge = window.arbora;
  const [appInfo, settings, theme, keybindings, project, windowState] = await Promise.all([
    bridge.invoke.getAppInfo(),
    bridge.invoke.getSettings(),
    bridge.invoke.getTheme(),
    bridge.invoke.getKeybindings(),
    bridge.invoke.getCurrentProject(),
    bridge.invoke.getWindowState(),
  ]);
  const store = createAppStore({ appInfo, settings, theme, keybindings, project, windowState });
  const services: AppServices = { store, bridge, commands: new CommandRegistry() };
  registerBuiltinCommands(services);

  bridge.on.settingsChanged((next) => store.setState({ settings: next }));
  bridge.on.themeChanged((next) => store.setState({ theme: next }));
  bridge.on.keybindingsChanged((next) => store.setState({ keybindings: next }));
  bridge.on.windowStateChanged((next) => store.setState({ windowState: next }));
  bridge.on.projectChanged((next) =>
    store.setState({ project: next, mode: 'idle', paletteOpen: false }),
  );

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');
  document.documentElement.dataset.platform = appInfo.platform;
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <App />
      </ServicesProvider>
    </StrictMode>,
  );
}

void bootstrap();
