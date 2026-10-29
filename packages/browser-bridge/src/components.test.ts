// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { resolveComponents } from './components.js';

interface FakeFiber {
  tag: number;
  type: unknown;
  return: FakeFiber | null;
  child: FakeFiber | null;
  sibling: FakeFiber | null;
  stateNode: unknown;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber: number } | null;
  _debugStack?: { stack: string } | null;
  _debugOwner?: FakeFiber | null;
  _debugInfo?: unknown[] | null;
}

const FIBER_KEY = '__reactFiber$test';

function fiber(tag: number, type: unknown, extra: Partial<FakeFiber> = {}): FakeFiber {
  return { tag, type, return: null, child: null, sibling: null, stateNode: null, ...extra };
}

function link(parent: FakeFiber, ...children: FakeFiber[]): void {
  parent.child = children[0] ?? null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] ?? null;
  });
}

function host(tag: string, owner: FakeFiber | null, extra: Partial<FakeFiber> = {}): { el: HTMLElement; f: FakeFiber } {
  const el = document.createElement(tag);
  const f = fiber(5, tag, { stateNode: el, _debugOwner: owner, ...extra });
  (el as unknown as Record<string, unknown>)[FIBER_KEY] = f;
  return { el, f };
}

function named(name: string): () => null {
  const fn = (): null => null;
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

const src = (fileName: string, lineNumber: number) => ({ fileName, lineNumber, columnNumber: 3 });

afterEach(() => {
  document.body.replaceChildren();
});

describe('resolveComponents (React <= 18)', () => {
  /** App > Card > section > Button > button, with `_debugSource` like a React 18 dev build. */
  function react18() {
    const app = fiber(0, named('App'), { _debugSource: src('/p/src/main.tsx', 10) });
    const card = fiber(0, named('Card'), { _debugSource: src('/p/src/App.tsx', 13), _debugOwner: app });
    const section = host('section', card, { _debugSource: src('/p/src/components/Card.tsx', 12) });
    const button = fiber(0, named('Button'), {
      _debugSource: src('/p/src/components/Card.tsx', 19),
      _debugOwner: card,
    });
    const el = host('button', button, { _debugSource: src('/p/src/components/Button.tsx', 5) });
    const appRoot = host('main', app, { _debugSource: src('/p/src/App.tsx', 7) });
    link(app, appRoot.f);
    link(appRoot.f, card);
    link(card, section.f);
    link(section.f, button);
    link(button, el.f);
    appRoot.el.append(section.el);
    section.el.append(el.el);
    document.body.append(appRoot.el);
    return el.el;
  }

  it('walks fibers to the chain with definition and usage sites', () => {
    const chain = resolveComponents(react18(), 12);
    expect(chain.map((c) => c.name)).toEqual(['Button', 'Card', 'App']);
    expect(chain[0]?.definedAt).toEqual({ file: '/p/src/components/Button.tsx', line: 5, column: 3 });
    expect(chain[0]?.renderedAt).toEqual({ file: '/p/src/components/Card.tsx', line: 19, column: 3 });
    expect(chain[1]?.definedAt?.file).toBe('/p/src/components/Card.tsx');
    expect(chain[2]?.renderedAt?.file).toBe('/p/src/main.tsx');
    expect(chain.every((c) => !c.server && !c.minified)).toBe(true);
  });

  it('starts from a text node or a nested element without its own fiber', () => {
    const button = react18();
    const span = document.createElement('span');
    button.append(span);
    expect(resolveComponents(span, 12).map((c) => c.name)).toEqual(['Button', 'Card', 'App']);
  });

  it('honours the limit', () => {
    expect(resolveComponents(react18(), 2).map((c) => c.name)).toEqual(['Button', 'Card']);
  });

  it('drops library components without source when the page has source information', () => {
    const app = fiber(0, named('App'), { _debugSource: src('/p/src/main.tsx', 1) });
    const router = fiber(0, named('RenderedRoute'), { _debugOwner: null });
    const el = host('div', app, { _debugSource: src('/p/src/App.tsx', 4) });
    link(app, router);
    link(router, el.f);
    expect(resolveComponents(el.el, 12).map((c) => c.name)).toEqual(['App']);
  });

  it('labels minified names and reads forwardRef/memo wrappers', () => {
    const memo = fiber(14, { $$typeof: Symbol.for('react.memo'), type: named('Fancy') });
    const minified = fiber(0, named('t'));
    const el = host('div', minified);
    link(memo, minified);
    link(minified, el.f);
    const chain = resolveComponents(el.el, 12);
    expect(chain.map((c) => [c.name, c.minified])).toEqual([
      ['t', true],
      ['Fancy', false],
    ]);
  });
});

describe('resolveComponents (React 19)', () => {
  const stack = (...frames: string[]) => ({ stack: ['Error: react-stack-top-frame', ...frames].join('\n') });

  it('takes file names from owner stacks, skips library frames and keeps server components', () => {
    const page = fiber(0, named('Counter'), {
      _debugStack: stack(
        '    at exports.jsxDEV (http://h/_next/static/chunks/1daa_next_dist_compiled_react-dom_x.js:1:1)',
        '    at Page (about://React/Server/file:///p/app/page.tsx?3:9:7)',
      ),
      _debugInfo: [
        { name: 'RootLayout', env: 'Server' },
        { name: 'Page', env: 'Server' },
      ],
    });
    const button = fiber(0, named('Button'), {
      _debugOwner: page,
      _debugStack: stack('    at Counter (http://h/src/Counter.tsx?t=1:20:5)'),
    });
    const el = host('button', button, { _debugStack: stack('    at Button (http://h/src/Button.tsx:5:9)') });
    const internal = fiber(0, named('InnerLayoutRouter'), {
      _debugStack: stack('    at x (http://h/_next/static/chunks/node_modules_next_dist_client_abc.js:1:1)'),
    });
    link(internal, page);
    link(page, button);
    link(button, el.f);
    const chain = resolveComponents(el.el, 12);
    expect(chain.map((c) => [c.name, c.server])).toEqual([
      ['Button', false],
      ['Counter', false],
      ['Page', true],
      ['RootLayout', true],
    ]);
    expect(chain[0]?.definedAt).toEqual({ file: 'http://h/src/Button.tsx', line: null, column: null });
    expect(chain[0]?.renderedAt?.file).toBe('http://h/src/Counter.tsx?t=1');
    expect(chain[1]?.renderedAt?.file).toBe('about://React/Server/file:///p/app/page.tsx?3');
  });
});

describe('resolveComponents (Vue)', () => {
  it('walks component instances with their SFC files', () => {
    const app = { type: { __name: 'app', __file: '/p/app/app.vue' }, parent: null, subTree: null };
    const card = {
      type: { __name: 'CounterCard', __file: '/p/app/components/CounterCard.vue' },
      parent: app,
      subTree: null,
    };
    const root = {
      type: { name: 'NuxtRoot', __file: '/p/node_modules/nuxt/dist/app/components/nuxt-root.vue' },
      parent: null,
      subTree: null,
    };
    app.parent = root as never;
    const buttonEl = document.createElement('button');
    const button = {
      type: { __file: '/p/app/components/AppButton.vue' },
      parent: card,
      subTree: { el: buttonEl },
    };
    (buttonEl as unknown as Record<string, unknown>)['__vueParentComponent'] = button;
    document.body.append(buttonEl);
    const chain = resolveComponents(buttonEl, 12);
    expect(chain.map((c) => c.name)).toEqual(['AppButton', 'CounterCard', 'app']);
    expect(chain[0]?.definedAt?.file).toBe('/p/app/components/AppButton.vue');
    expect(chain[0]?.renderedAt?.file).toBe('/p/app/components/CounterCard.vue');
    expect(chain[0]?.definedAt?.line).toBeNull();
  });
});

describe('resolveComponents (plain HTML)', () => {
  it('returns an empty chain', () => {
    const div = document.createElement('div');
    document.body.append(div);
    expect(resolveComponents(div, 12)).toEqual([]);
  });
});
