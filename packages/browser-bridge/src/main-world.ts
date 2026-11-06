import type { ComponentEntry, FrameworkInfo } from '@arbora/shared';
import { resolveComponents, resolveHostSource } from './components.js';
import { detectFramework } from './detect.js';

/** Global (non-enumerable) the installed script exposes in the page's main world. */
export const MAIN_WORLD_KEY = '__arboraInspector__';
export const REF_ATTRIBUTE = 'data-arbora-ref';
export const CHAIN_LIMIT = 12;

/** The API `mainWorldInstallScript` installs; every call returns structured-clonable data. */
export interface MainWorldApi {
  /** Cached per page load. */
  detect(): FrameworkInfo;
  /** Chain for the element under a viewport point (open shadow roots are entered). */
  atPoint(x: number, y: number, limit: number): ComponentEntry[];
  /** Chain for the element carrying `data-arbora-ref="<ref>"`. */
  forRef(ref: string, limit: number): ComponentEntry[];
  /** Host-fiber file and line for that element, when the dev build reports one. */
  hostSource(ref: string): { file: string; line: number | null } | null;
}

/**
 * Source text that installs `MainWorldApi` in the page's main world (run with
 * `webFrame.executeJavaScript`). The resolver functions are inlined with `Function.toString`,
 * which is why they are written without references outside their own bodies.
 */
export function mainWorldInstallScript(): string {
  const key = JSON.stringify(MAIN_WORLD_KEY);
  const refAttribute = JSON.stringify(REF_ATTRIBUTE);
  return `(() => {
  if (Object.prototype.hasOwnProperty.call(window, ${key})) return true;
  const detectFramework = ${detectFramework.toString()};
  const resolveComponents = ${resolveComponents.toString()};
  const resolveHostSource = ${resolveHostSource.toString()};
  let framework = null;
  const deepAtPoint = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  const deepQuery = (root, selector) => {
    const found = root.querySelector(selector);
    if (found) return found;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = deepQuery(el.shadowRoot, selector);
        if (inner) return inner;
      }
    }
    return null;
  };
  const api = Object.freeze({
    detect() {
      framework = framework || detectFramework(window);
      return framework;
    },
    atPoint(x, y, limit) {
      const el = deepAtPoint(x, y);
      return el ? resolveComponents(el, limit) : [];
    },
    forRef(ref, limit) {
      const el = deepQuery(document, '[' + ${refAttribute} + '="' + String(ref).replace(/["\\\\]/g, '') + '"]');
      return el ? resolveComponents(el, limit) : [];
    },
    hostSource(ref) {
      const el = deepQuery(document, '[' + ${refAttribute} + '="' + String(ref).replace(/["\\\\]/g, '') + '"]');
      return el ? resolveHostSource(el) : null;
    },
  });
  Object.defineProperty(window, ${key}, { value: api, enumerable: false, configurable: false, writable: false });
  return true;
})()`;
}

/** Source text calling one `MainWorldApi` method; evaluates to `null` when the script is missing. */
export function mainWorldCall<K extends keyof MainWorldApi>(method: K, ...args: Parameters<MainWorldApi[K]>): string {
  const target = `window[${JSON.stringify(MAIN_WORLD_KEY)}]`;
  return `(${target} ? ${target}.${method}(${args.map((a) => JSON.stringify(a)).join(', ')}) : null)`;
}
