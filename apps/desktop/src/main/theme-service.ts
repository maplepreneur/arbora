import { nativeTheme } from 'electron';
import type { ThemeMode, ThemeState } from '@arbora/shared';

type Listener = (state: ThemeState) => void;

export const BACKGROUND = { light: '#ffffff', dark: '#0b0d10' } as const;

/** Follows the OS theme via `nativeTheme` unless the user picks light or dark explicitly. */
export class ThemeService {
  private readonly listeners = new Set<Listener>();
  private readonly onUpdated = (): void => {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  };

  constructor(mode: ThemeMode) {
    nativeTheme.themeSource = mode;
    nativeTheme.on('updated', this.onUpdated);
  }

  state(): ThemeState {
    return { mode: nativeTheme.themeSource, resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
  }

  setMode(mode: ThemeMode): ThemeState {
    if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
    return this.state();
  }

  background(): string {
    return BACKGROUND[this.state().resolved];
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    nativeTheme.off('updated', this.onUpdated);
    this.listeners.clear();
  }
}
