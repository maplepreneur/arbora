import { describe, expect, it } from 'vitest';
import { arboraDevPlugin, injectArboraSrc, withArbora } from './core.mjs';
import arboraNuxtModule from './nuxt.mjs';
import arboraWebpackLoader from './webpack.mjs';

describe('injectArboraSrc', () => {
  it('tags host elements with file, line and column and skips components and fragments', () => {
    const code = [
      'export function Card() {',
      '  return (',
      '    <>',
      '      <Button>',
      '        <div className="card">',
      '          <span>Hi</span>',
      '        </div>',
      '      </Button>',
      '    </>',
      '  );',
      '}',
      '',
    ].join('\n');
    const next = injectArboraSrc(code, 'src/Card.tsx');
    expect(next).toContain('<div className="card" data-arbora-src="src/Card.tsx:5:9">');
    expect(next).toContain('<span data-arbora-src="src/Card.tsx:6:11">Hi</span>');
    expect(next).not.toContain('<Button data-arbora-src');
    expect(next).not.toContain('<> data-arbora-src');
    expect(next.match(/data-arbora-src/g)).toHaveLength(2);
  });

  it('tags self-closing host elements and leaves an existing attribute', () => {
    const code = '<img src="/a.png" />\n<br data-arbora-src="already:1:1" />\n';
    const next = injectArboraSrc(code, 'src/App.tsx');
    expect(next).toContain('<img src="/a.png" data-arbora-src="src/App.tsx:1:1" />');
    expect(next.match(/data-arbora-src/g)).toHaveLength(2);
  });

  it('does not rewrite strings, comments, generics or comparisons', () => {
    const code = [
      'const label = "<div>nope</div>";',
      '/** <span>nope</span> */',
      'const id = useState<string>("");',
      'const ok = a < b && c > d;',
      'return <section title={"a > b"}>x</section>;',
      '',
    ].join('\n');
    const next = injectArboraSrc(code, 'src/App.tsx');
    expect(next).toContain('const label = "<div>nope</div>";');
    expect(next).toContain('/** <span>nope</span> */');
    expect(next).toContain('useState<string>("");');
    expect(next).toContain('const ok = a < b && c > d;');
    expect(next).toContain('<section title={"a > b"} data-arbora-src="src/App.tsx:5:8">');
  });

  it('tags a Vue template and leaves the script block', () => {
    const code = [
      '<script setup lang="ts">',
      'const n = 1;',
      'const html = "<div></div>";',
      '</script>',
      '<template>',
      "  <button :title=\"n > 0 ? 'on' : 'off'\">{{ n }}</button>",
      '  <CounterCard />',
      '</template>',
      '',
    ].join('\n');
    const next = injectArboraSrc(code, 'app/components/Card.vue');
    expect(next).toContain('<button :title="n > 0 ? \'on\' : \'off\'" data-arbora-src="app/components/Card.vue:6:3">');
    expect(next).not.toContain('<CounterCard data-arbora-src');
    expect(next).toContain('const html = "<div></div>";');
    expect(next.match(/data-arbora-src/g)).toHaveLength(1);
  });

  it('tags a camelCase SVG intrinsic', () => {
    const next = injectArboraSrc('<clipPath id="c" />', 'src/Icon.tsx');
    expect(next).toBe('<clipPath id="c" data-arbora-src="src/Icon.tsx:1:1" />');
  });
});

describe('arboraDevPlugin', () => {
  it('transforms a tsx module in serve and skips node_modules, style queries and builds', () => {
    const plugin = arboraDevPlugin();
    plugin.configResolved({ root: '/proj', command: 'serve' });
    const served = plugin.transform('export const View = () => <main />;\n', '/proj/src/View.tsx');
    expect(served?.code).toContain('data-arbora-src="src/View.tsx:1:27"');
    expect(plugin.transform('<div />', '/proj/node_modules/pkg/index.jsx')).toBeNull();
    expect(plugin.transform('.x { color: red }', '/proj/src/App.vue?vue&type=style&index=0')).toBeNull();
    plugin.configResolved({ root: '/proj', command: 'build' });
    expect(plugin.transform('export const View = () => <main />;\n', '/proj/src/View.tsx')).toBeNull();
  });
});

describe('withArbora', () => {
  it('adds the loader only when webpack is compiling a dev build', () => {
    const config = withArbora({ reactStrictMode: true })('phase-development-server', {});
    const dev = config.webpack({ module: { rules: [] } }, { dev: true });
    expect(dev.module.rules.some((rule) => rule.loader === '@arbora/dev-plugin/webpack')).toBe(true);
    const prod = config.webpack({ module: { rules: [] } }, { dev: false });
    expect(prod.module.rules).toEqual([]);
  });
});

describe('arboraNuxtModule', () => {
  it('pushes the Vite plugin in dev and does nothing for a production build', () => {
    const hooks = new Map<string, ((...args: unknown[]) => void)[]>();
    arboraNuxtModule(undefined, {
      options: { dev: true },
      hook(name, fn) {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
    });
    const config: { plugins?: { name: string }[] } = {};
    for (const fn of hooks.get('vite:extendConfig') ?? []) fn(config);
    expect(config.plugins?.map((plugin) => plugin.name)).toEqual(['arbora-dev-plugin']);

    const quiet = new Map<string, unknown>();
    arboraNuxtModule(undefined, {
      options: { dev: false },
      hook(name) {
        quiet.set(name, true);
      },
    });
    expect(quiet.size).toBe(0);
  });
});

describe('arboraWebpackLoader', () => {
  it('injects in development and returns the source unchanged in production', () => {
    const context = { mode: 'development', rootContext: '/proj', resourcePath: '/proj/src/App.tsx' };
    const dev = arboraWebpackLoader.call(context, 'export const App = () => <div />;\n');
    expect(dev).toContain('data-arbora-src="src/App.tsx:1:26"');
    const prod = arboraWebpackLoader.call({ ...context, mode: 'production' }, 'export const App = () => <div />;\n');
    expect(prod).toBe('export const App = () => <div />;\n');
  });
});
