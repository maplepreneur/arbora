import type { FrameworkInfo } from '@arbora/shared';

/**
 * Detects the page's UI framework. Runs in the page's main world: the preload's isolated world
 * cannot see page globals or the expando properties frameworks put on DOM nodes. It is injected
 * as source text (see `main-world.ts`), so it must not reference anything outside its own body.
 */
export function detectFramework(win: Window): FrameworkInfo {
  const globals = win as unknown as Record<string, unknown>;
  const doc = win.document;
  const sample: Element[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, 1);
  for (let node = walker.currentNode; sample.length < 400;) {
    sample.push(node as Element);
    const next = walker.nextNode();
    if (!next) break;
    node = next;
  }
  // React's keys carry a random suffix (`__reactFiber$x1y2`), so they are matched by prefix.
  const hasKey = (prefixes: readonly string[]): boolean =>
    sample.some((el) => Object.keys(el).some((key) => prefixes.some((prefix) => key.startsWith(prefix))));
  // Vue defines its expandos as non-enumerable properties, which `Object.keys` skips.
  const hasProperty = (names: readonly string[]): boolean => sample.some((el) => names.some((name) => name in el));

  let reactVersion: string | null = null;
  const hook = globals['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as
    { renderers?: Map<unknown, { version?: unknown }> } | undefined;
  if (hook?.renderers instanceof Map) {
    for (const renderer of hook.renderers.values()) {
      if (typeof renderer.version === 'string') {
        reactVersion = renderer.version;
        break;
      }
    }
  }
  const react =
    (hook?.renderers instanceof Map && hook.renderers.size > 0) ||
    hasKey(['__reactFiber$', '__reactContainer$', '__reactInternalInstance$']);
  const vue = Boolean(globals['__VUE__']) || hasProperty(['__vue_app__', '__vueParentComponent', '__vnode']);
  const next =
    react &&
    Boolean(globals['__NEXT_DATA__'] ?? globals['next'] ?? globals['__next_f'] ?? doc.getElementById('__NEXT_DATA__'));
  const nuxt =
    vue && Boolean(globals['__NUXT__'] ?? doc.getElementById('__NUXT_DATA__') ?? doc.getElementById('__nuxt'));
  const svelte = Boolean(globals['__svelte']) || hasProperty(['__svelte_meta']);
  const ng = globals['ng'] as { getComponent?: unknown } | undefined;
  const angular = typeof ng?.getComponent === 'function' || doc.querySelector('[ng-version]') !== null;

  const id: FrameworkInfo['id'] = next
    ? 'next'
    : nuxt
      ? 'nuxt'
      : react
        ? 'react'
        : vue
          ? 'vue'
          : svelte
            ? 'svelte'
            : angular
              ? 'angular'
              : 'html';
  return { id, react, vue, reactVersion };
}
