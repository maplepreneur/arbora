import { describe, expect, it } from 'vitest';
import {
  colorName,
  describeOp,
  detectStyling,
  parseConfigColors,
  renderChangeList,
  suggestTailwind,
  type DesignOp,
  type DesignTarget,
} from './design.js';

const target: DesignTarget = {
  ref: '1',
  selector: '[data-testid="card-counter"]',
  componentChain: ['Card', 'App'],
  sourceFile: '/p/src/components/Card.tsx',
  sourceLine: 12,
};

function style(partial: Partial<Extract<DesignOp, { kind: 'style' }>> = {}): DesignOp {
  return {
    id: 'op-1',
    kind: 'style',
    target,
    property: 'padding-top',
    before: '16px',
    after: '32px',
    computedAfter: '32px',
    inlineBefore: '',
    inlinePriority: '',
    stale: false,
    ...partial,
  };
}

describe('suggestTailwind', () => {
  it('maps spacing on the default scale and uses arbitrary values off it', () => {
    expect(suggestTailwind('padding-top', '16px')).toBe('pt-4');
    expect(suggestTailwind('padding-top', '13px')).toBe('pt-[13px]');
    expect(suggestTailwind('margin-left', '-8px')).toBe('-ml-2');
    expect(suggestTailwind('gap', '24px')).toBe('gap-6');
  });

  it('maps layout, type, radius and opacity', () => {
    expect(suggestTailwind('display', 'flex')).toBe('flex');
    expect(suggestTailwind('display', 'none')).toBe('hidden');
    expect(suggestTailwind('flex-direction', 'column')).toBe('flex-col');
    expect(suggestTailwind('align-items', 'center')).toBe('items-center');
    expect(suggestTailwind('justify-content', 'space-between')).toBe('justify-between');
    expect(suggestTailwind('font-size', '14px')).toBe('text-sm');
    expect(suggestTailwind('font-size', '15px')).toBe('text-[15px]');
    expect(suggestTailwind('font-weight', '700')).toBe('font-bold');
    expect(suggestTailwind('border-radius', '12px')).toBe('rounded-xl');
    expect(suggestTailwind('opacity', '0.5')).toBe('opacity-50');
    expect(suggestTailwind('width', '100%')).toBe('w-full');
  });

  it('maps colours from the default palette, a config, rgb() and arbitrary hex', () => {
    expect(suggestTailwind('background-color', '#ef4444')).toBe('bg-red-500');
    expect(suggestTailwind('color', 'rgb(15, 23, 42)')).toBe('text-slate-900');
    expect(suggestTailwind('background-color', '#112233')).toBe('bg-[#112233]');
    const config = parseConfigColors(`colors: {\n  brand: { 500: '#aabbcc' },\n}`);
    expect(colorName('#aabbcc', config)).toBe('brand-500');
    expect(suggestTailwind('background-color', '#aabbcc', config)).toBe('bg-brand-500');
  });

  it('returns null for properties it does not translate', () => {
    expect(suggestTailwind('box-shadow', '0 1px 2px #000')).toBeNull();
    expect(suggestTailwind('display', 'table')).toBeNull();
  });
});

describe('renderChangeList', () => {
  it('groups ops by component and includes the typed value, the computed value and the suggestion', () => {
    const text: DesignOp = {
      id: 'op-2',
      kind: 'text',
      target,
      before: 'Counter',
      after: 'Total',
      stale: false,
    };
    const typed = style({ id: 'op-3', after: '2rem', computedAfter: '32px' });
    const list = renderChangeList([style(), text, typed], 'tailwind');
    expect(list).toContain('### Card ← App');
    expect(list).toContain('`padding-top`: 16px → 32px (suggested `pt-8`)');
    expect(list).toContain('`padding-top`: 16px → 2rem (computed 32px) (suggested `pt-8`)');
    expect(list).toContain('text: "Counter" → "Total"');
  });

  it('omits suggestions when the project is not Tailwind and marks stale ops', () => {
    const list = renderChangeList([style({ stale: true })], 'plain-css');
    expect(list).not.toContain('suggested');
    expect(list).toContain('stale: the element was not on the page after a re-render');
  });
});

describe('describeOp', () => {
  it('summarises each change for the Changes list', () => {
    expect(describeOp(style())).toEqual({ title: 'padding-top', before: '16px', after: '32px' });
    expect(describeOp({ id: 'op-2', kind: 'text', target, before: 'Counter', after: 'Total', stale: false })).toEqual({
      title: 'Text',
      before: '“Counter”',
      after: '“Total”',
    });
  });
});

describe('detectStyling', () => {
  const files = new Map<string, string>();

  function detect(paths: string[], packageJson: string | null = null) {
    return detectStyling({
      packageJson,
      paths,
      read: (path) => files.get(path) ?? null,
    });
  }

  it('prefers Tailwind from a config, then an import, then CSS modules, then CSS-in-JS', () => {
    files.set('tailwind.config.ts', "export default { theme: { colors: { brand: { 500: '#aabbcc' } } } }");
    expect(detect(['tailwind.config.ts']).approach).toBe('tailwind');
    expect(detect(['tailwind.config.ts']).colors.get('#aabbcc')).toBe('brand-500');

    files.set('src/app.css', '@import "tailwindcss";');
    expect(detect(['src/app.css']).approach).toBe('tailwind');

    expect(detect(['src/Button.module.css']).approach).toBe('css-modules');
    expect(detect(['src/App.tsx'], JSON.stringify({ dependencies: { 'styled-components': '6.0.0' } })).approach).toBe(
      'styled-components',
    );
    expect(detect(['src/App.tsx'], JSON.stringify({ dependencies: { '@emotion/styled': '11.0.0' } })).approach).toBe(
      'emotion',
    );
    expect(detect(['src/App.css']).approach).toBe('plain-css');
  });
});
