import type { ComponentEntry } from '@arbora/shared';
import { resolveComponents } from './components.js';
import { CHAIN_LIMIT } from './main-world.js';

/** What `elementSourceFunction()` returns for an element. */
export interface ElementSourceFacts {
  readonly components: ComponentEntry[];
  readonly tag: string;
  readonly id: string | null;
  readonly classes: string[];
  readonly uniqueClasses: string[];
  readonly text: string;
}

/**
 * A `Runtime.callFunctionOn` declaration, run with an element as `this` in the page's main world:
 * the element's component chain (Stage 4's resolver, inlined with `Function.toString`) plus the
 * class names the source search greps for. Used by the `browser_get_element_source` tool.
 */
export function elementSourceFunction(): string {
  return `function () {
  const resolveComponents = ${resolveComponents.toString()};
  const classes = Array.from(this.classList || []).slice(0, 50);
  const uniqueClasses = classes.filter((c) => document.getElementsByClassName(c).length === 1);
  return {
    components: resolveComponents(this, ${CHAIN_LIMIT}),
    tag: String(this.tagName || '').toLowerCase(),
    id: this.id || null,
    classes,
    uniqueClasses,
    text: String(this.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
  };
}`;
}
