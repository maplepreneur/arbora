import { arboraDevPlugin } from './core.mjs';

/**
 * Nuxt module. Registers the Vite plugin (and the webpack loader, for a webpack builder)
 * while `nuxt dev` is running.
 *
 * @param {unknown} _options
 * @param {{ options?: { dev?: boolean }, hook: (name: string, fn: (...args: unknown[]) => void) => void }} nuxt
 */
export default function arboraNuxtModule(_options, nuxt) {
  if (nuxt.options?.dev === false) return;
  nuxt.hook('vite:extendConfig', (...args) => {
    const config = /** @type {{ plugins?: unknown[] }} */ (args[0]);
    config.plugins = config.plugins ?? [];
    config.plugins.push(arboraDevPlugin());
  });
  nuxt.hook('webpack:config', (...args) => {
    const configs = /** @type {{ module?: { rules?: unknown[] } }[]} */ (args[0]);
    for (const config of configs) {
      config.module = config.module ?? {};
      config.module.rules = config.module.rules ?? [];
      config.module.rules.push({
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: '@arbora/dev-plugin/webpack' }],
      });
    }
  });
}
