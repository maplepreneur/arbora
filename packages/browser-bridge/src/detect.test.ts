// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { detectFramework } from './detect.js';

const globals = window as unknown as Record<string, unknown>;
const KEYS = ['__REACT_DEVTOOLS_GLOBAL_HOOK__', '__NEXT_DATA__', 'next', '__VUE__', '__NUXT__', '__svelte', 'ng'];

afterEach(() => {
  for (const key of KEYS) Reflect.deleteProperty(globals, key);
  document.body.replaceChildren();
});

function withFiber(): void {
  const div = document.createElement('div');
  (div as unknown as Record<string, unknown>)['__reactFiber$abc'] = {};
  document.body.append(div);
}

describe('detectFramework', () => {
  it('reports plain HTML when nothing is found', () => {
    expect(detectFramework(window)).toEqual({ id: 'html', react: false, vue: false, reactVersion: null });
  });

  it('finds React from fiber keys and reads the version from the DevTools hook', () => {
    withFiber();
    expect(detectFramework(window).id).toBe('react');
    globals['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = { renderers: new Map([[1, { version: '18.3.1' }]]) };
    expect(detectFramework(window)).toMatchObject({ id: 'react', reactVersion: '18.3.1' });
  });

  it('prefers Next over React and Nuxt over Vue', () => {
    withFiber();
    globals['next'] = { version: '16' };
    expect(detectFramework(window).id).toBe('next');
    document.body.replaceChildren();
    Reflect.deleteProperty(globals, 'next');
    globals['__VUE__'] = true;
    expect(detectFramework(window)).toMatchObject({ id: 'vue', vue: true, react: false });
    const nuxt = document.createElement('div');
    nuxt.id = '__nuxt';
    document.body.append(nuxt);
    expect(detectFramework(window).id).toBe('nuxt');
  });

  it('finds Vue from non-enumerable expandos', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, '__vueParentComponent', { value: {}, enumerable: false });
    document.body.append(el);
    expect(detectFramework(window)).toMatchObject({ id: 'vue', vue: true });
  });

  it('recognises Svelte and Angular', () => {
    globals['__svelte'] = { v: new Set(['5']) };
    expect(detectFramework(window).id).toBe('svelte');
    Reflect.deleteProperty(globals, '__svelte');
    const root = document.createElement('app-root');
    root.setAttribute('ng-version', '19.0.0');
    document.body.append(root);
    expect(detectFramework(window).id).toBe('angular');
  });
});
