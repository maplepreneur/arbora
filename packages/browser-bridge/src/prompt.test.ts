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
      uri: 'file:///p/.arbora/screenshots/a-agent-mode.png',
      mimeType: 'image/png',
      data: 'AAAA',
    },
    imageSupported: true,
    toUri: (path) => `file://${path}`,
    ...overrides,
  };
}

function body(result: ReturnType<typeof composePrompt>): string {
  const first = result.blocks[0];
  if (first?.type !== 'text') throw new Error('first block is not text');
  return first.text;
}

describe('composePrompt', () => {
  it('builds a tier 1 prompt with sections, the chain, file:line, an image and source links', () => {
    const result = composePrompt(input());
    expect(result.tier).toBe(1);
    const text = body(result);
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
    expect(text).not.toContain('## Candidate files');
    expect(result.blocks.slice(1)).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/png', uri: 'file:///p/.arbora/screenshots/a-agent-mode.png' },
      { type: 'resource_link', uri: 'file:///p/src/components/Button.tsx', name: 'src/components/Button.tsx' },
      { type: 'resource_link', uri: 'file:///p/src/components/Card.tsx', name: 'src/components/Card.tsx' },
      { type: 'resource_link', uri: 'file:///p/src/App.tsx', name: 'src/App.tsx' },
    ]);
  });

  it('is deterministic', () => {
    expect(composePrompt(input())).toEqual(composePrompt(input()));
  });

  it('sends the screenshot as a file link with its path when the agent takes no images', () => {
    const result = composePrompt(input({ imageSupported: false }));
    expect(body(result)).toContain('.arbora/screenshots/a-agent-mode.png. Open it if you can read images.');
    expect(result.blocks.some((b) => b.type === 'image')).toBe(false);
    expect(result.blocks[1]).toEqual({
      type: 'resource_link',
      uri: 'file:///p/.arbora/screenshots/a-agent-mode.png',
      name: 'a-agent-mode.png',
      mimeType: 'image/png',
    });
  });

  it('declares tier 3 and lists grep candidates when no source is known', () => {
    const result = composePrompt(
      input({ components: [app], framework: { id: 'next', react: true, vue: false, reactVersion: null } }),
    );
    expect(result.tier).toBe(3);
    const text = body(result);
    expect(text).toContain('Framework: Next.js (React)');
    expect(text).toContain('tier 3');
    expect(text).toContain('## Candidate files');
    expect(text).toContain('- src/x.tsx (matched: Button)');
    expect(text).toContain('Find the source of the selected element');
    expect(result.blocks.at(-1)).toEqual({ type: 'resource_link', uri: 'file:///p/src/x.tsx', name: 'src/x.tsx' });
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
    expect(body(result)).toContain('Selected component: Card');
    expect(body(result)).toContain('Defined in: app/components/CounterCard.vue\n');
  });

  it('leaves out what the user unticked', () => {
    const result = composePrompt(input({ include: { screenshot: false, sources: false, context: false } }));
    const text = body(result);
    expect(result.blocks).toHaveLength(1);
    expect(text).not.toContain('## Context');
    expect(text).not.toContain('## Source files');
    expect(text).not.toContain('Screenshot');
    expect(text).toContain('## Instructions');
  });

  it('labels minified and server components', () => {
    const text = body(
      composePrompt(
        input({
          components: [
            { ...button, minified: true, name: 't' },
            { ...app, server: true, name: 'Page' },
          ],
        }),
      ),
    );
    expect(text).toContain('anonymous component ← Page (server component)');
  });
});
