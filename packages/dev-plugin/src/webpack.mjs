import { relative, sep } from 'node:path';
import { injectArboraSrc } from './core.mjs';

/**
 * Webpack loader for `next dev`. Production builds are unchanged.
 *
 * @this {{ mode?: string, rootContext?: string, resourcePath: string }}
 * @param {string} source
 */
export default function arboraWebpackLoader(source) {
  if (this.mode === 'production' || process.env.NODE_ENV === 'production') return source;
  const root = this.rootContext ?? process.cwd();
  const rel = relative(root, this.resourcePath).split(sep).join('/');
  return injectArboraSrc(source, rel);
}
