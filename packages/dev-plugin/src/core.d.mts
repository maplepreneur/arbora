export const ARBORA_SRC_ATTRIBUTE: 'data-arbora-src';

export function injectArboraSrc(code: string, file: string): string;

export interface ArboraVitePlugin {
  readonly name: 'arbora-dev-plugin';
  readonly apply: 'serve';
  readonly enforce: 'pre';
  configResolved(config: { root: string; command: string }): void;
  transform(code: string, id: string): { code: string; map: null } | null;
}

export function arboraDevPlugin(options?: { root?: string }): ArboraVitePlugin;

export interface ArboraWebpackHook {
  (
    webpackConfig: { module?: { rules?: unknown[] } },
    options: { dev?: boolean },
  ): { module: { rules: { loader?: string }[] } };
}

export interface WrappedNextConfig {
  readonly webpack: ArboraWebpackHook;
}

export function withArbora(nextConfig?: unknown): (phase: string, defaults: unknown) => WrappedNextConfig;
