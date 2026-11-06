// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentEntry, FrameworkInfo } from '@arbora/shared';
import { MAIN_WORLD_KEY, mainWorldCall, mainWorldInstallScript, REF_ATTRIBUTE } from './main-world.js';

/** Evaluates `code` as the page would, without access to this module's scope. */
function run(code: string): unknown {
  return (0, eval)(code);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('mainWorldInstallScript', () => {
  it('is self-contained: installs the API once and resolves elements by ref', () => {
    expect(run(mainWorldInstallScript())).toBe(true);
    const api: unknown = (window as unknown as Record<string, unknown>)[MAIN_WORLD_KEY];
    expect(api).toBeDefined();
    // A second install keeps the first (the property is not writable).
    expect(run(mainWorldInstallScript())).toBe(true);
    expect((window as unknown as Record<string, unknown>)[MAIN_WORLD_KEY]).toBe(api);
    expect(Object.keys(window)).not.toContain(MAIN_WORLD_KEY);

    const el = document.createElement('button');
    el.setAttribute(REF_ATTRIBUTE, '7');
    const owner = { tag: 0, type: function Widget() {}, return: null, child: null, sibling: null, stateNode: null };
    (el as unknown as Record<string, unknown>)['__reactFiber$x'] = {
      tag: 5,
      type: 'button',
      return: owner,
      child: null,
      sibling: null,
      stateNode: el,
      _debugSource: { fileName: '/p/src/Button.tsx', lineNumber: 5 },
    };
    document.body.append(el);
    const chain = run(mainWorldCall('forRef', '7', 5)) as ComponentEntry[];
    expect(chain.map((c) => c.name)).toEqual(['Widget']);
    expect(run(mainWorldCall('hostSource', '7'))).toEqual({ file: '/p/src/Button.tsx', line: 5 });
    expect(run(mainWorldCall('hostSource', 'missing'))).toBeNull();
    expect(run(mainWorldCall('forRef', 'missing', 5))).toEqual([]);
    expect((run(mainWorldCall('detect')) as FrameworkInfo).id).toBe('react');
  });

  it('strips quotes from refs so a ref cannot break out of the selector', () => {
    run(mainWorldInstallScript());
    expect(() => run(mainWorldCall('forRef', '7"], * , ["', 5))).not.toThrow();
    expect(run(mainWorldCall('forRef', '7"], * , ["', 5))).toEqual([]);
  });
});
