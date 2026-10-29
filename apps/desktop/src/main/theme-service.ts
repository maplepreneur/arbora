import { nativeTheme } from 'electron';
import type { ThemeSource, ThemeState } from '@arbora/shared';

/** Mirrors the theme setting into `nativeTheme` and reports the resolved light/dark theme. */
export class ThemeService {
  readonly #listeners = new Set<(state: ThemeState) => void>();
  readonly #onNativeUpdate = (): void => {
    const state = this.state;
    for (const listener of this.#listeners) listener(state);
  };

  constructor(source: ThemeSource) {
    nativeTheme.themeSource = source;
    nativeTheme.on('updated', this.#onNativeUpdate);
  }

  get state(): ThemeState {
    return {
      source: nativeTheme.themeSource,
      resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    };
  }

  setSource(source: ThemeSource): void {
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  }

  onDidChange(listener: (state: ThemeState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    nativeTheme.removeListener('updated', this.#onNativeUpdate);
    this.#listeners.clear();
  }
}
