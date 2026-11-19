import { describe, expect, it } from 'vitest';
import type { ResolvedComponent } from '@arbora/shared';
import { composePrompt, type PromptInput } from './prompt.js';

const button: ResolvedComponent = {
  name: 'Button',
  minified: false,
  server: false,
  definedAt: { file: '/p/src/components/Button.tsx', line: 5, column: 5 },
  renderedAt: { file: '/p/src/components/Card.tsx', line: 19, column: 9 },
  rect: { x: 10, y: 20, width: 100, height: 40 },
  definedIn: { path: '/p/src/components/Button.tsx', relative: 'src/components/Button.tsx', line: 5, column: 5 },
  renderedIn: { path: '/p/src/components/Card.tsx', relative: 'src/components/Card.tsx', line: 19, column: 9 },
};
const card: ResolvedComponent = {
  ...button,
  name: 'Card',
  definedIn: { path: '/p/src/components/Card.tsx', relative: 'src/components/Card.tsx', line: 12, column: 5 },
  renderedIn: { path: '/p/src/App.tsx', relative: 'src/App.tsx', line: 13, column: 9 },
};
const app: ResolvedComponent = { ...card, name: 'App', definedIn: null, renderedIn: null };

function input(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    request: '  make this button red  ',
    url: 'http://localhost:5173/',
    framework: { id: 'react', react: true, vue: false, reactVersion: '18.3.1' },
    components: [button, card, app],
    targetIndex: 0,
    selector: '[data-testid="card-counter"] > div:nth-child(3) > button:nth-child(1)',
    element: {
      tag: 'button',
      html: '<button class="bg-emerald-600">Increment</button>',
      text: 'Increment',
      styles: { color: 'rgb(255, 255, 255)' },
    },
    candidates: [{ path: '/p/src/x.tsx', relative: 'src/x.tsx', matched: ['Button'] }],
    consoleErrors: ['boom (http://localhost:5173/src/App.tsx:3)'],
    notes: [],
    include: { screenshot: true, sources: true, context: true },
    screenshot: {
      path: '/p/.arbora/screenshots/a-agent-mode.png',
      relative: '.arbora/screenshots/a-agent-mode.png',
    },
    ...overrides,
  };
}

describe('composePrompt', () => {
  it('builds a tier 1 prompt with sections, the chain, file:line, the screenshot path and sources', () => {
    const result = composePrompt(input());
    expect(result.tier).toBe(1);
    const text = result.text;
    const order = ['## Request', '## Target', '## Context', '## Source files', '## Instructions'].map((h) =>
      text.indexOf(h),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(text).toContain('make this button red\n');
    expect(text).toContain('Framework: React 18.3.1');
    expect(text).toContain('tier 1');
    expect(text).toContain('Component chain (nearest first): Button ← Card ← App');
    expect(text).toContain('Rendered at: src/components/Card.tsx:19');
    expect(text).toContain('Defined in: src/components/Button.tsx:5');
    expect(text).toContain('```html\n<button class="bg-emerald-600">Increment</button>\n```');
    expect(text).toContain('color: rgb(255, 255, 255);');
    expect(text).toContain('- boom (http://localhost:5173/src/App.tsx:3)');
    expect(text).toContain('outlined in red');
    expect(text).toContain('.arbora/screenshots/a-agent-mode.png. Open it if you can read images.');
    expect(text).not.toContain('## Candidate files');
  });

  it('is deterministic', () => {
    expect(composePrompt(input())).toEqual(composePrompt(input()));
  });

  it('declares tier 3 and lists grep candidates when no source is known', () => {
    const result = composePrompt(
      input({ components: [app], framework: { id: 'next', react: true, vue: false, reactVersion: null } }),
    );
    expect(result.tier).toBe(3);
    const text = result.text;
    expect(text).toContain('Framework: Next.js (React)');
    expect(text).toContain('tier 3');
    expect(text).toContain('## Candidate files');
    expect(text).toContain('- src/x.tsx (matched: Button)');
    expect(text).toContain('Find the source of the selected element');
  });

  it('uses the breadcrumb target and tier 2 for files without lines', () => {
    const vueCard: ResolvedComponent = {
      ...card,
      definedIn: {
        path: '/p/app/components/CounterCard.vue',
        relative: 'app/components/CounterCard.vue',
        line: null,
        column: null,
      },
      renderedIn: null,
    };
    const result = composePrompt(input({ components: [button, vueCard], targetIndex: 1 }));
    expect(result.tier).toBe(2);
    expect(result.text).toContain('Selected component: Card');
    expect(result.text).toContain('Defined in: app/components/CounterCard.vue\n');
  });

  it('leaves out what the user unticked', () => {
    const result = composePrompt(input({ include: { screenshot: false, sources: false, context: false } }));
    const text = result.text;
    expect(text).not.toContain('## Context');
    expect(text).not.toContain('## Source files');
    expect(text).not.toContain('Screenshot');
    expect(text).toContain('## Instructions');
  });

  it('labels minified and server components', () => {
    const text = composePrompt(
      input({
        components: [
          { ...button, minified: true, name: 't' },
          { ...app, server: true, name: 'Page' },
        ],
      }),
    ).text;
    expect(text).toContain('anonymous component ← Page (server component)');
  });
});
