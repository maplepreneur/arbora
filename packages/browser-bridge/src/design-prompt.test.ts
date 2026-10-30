import { describe, expect, it } from 'vitest';
import { DESIGN_INSTRUCTION, type FrameworkInfo, type ResolvedSource } from '@arbora/shared';
import { composeDesignPrompt } from './design-prompt.js';
import type { PromptScreenshot } from './prompt.js';

const framework: FrameworkInfo = { id: 'react', react: true, vue: false, reactVersion: '18.3.1' };
const source: ResolvedSource = {
  path: '/p/src/components/Card.tsx',
  relative: 'src/components/Card.tsx',
  line: 12,
  column: null,
};

function shot(name: string): PromptScreenshot {
  return {
    path: `/p/.arbora/screenshots/${name}.png`,
    relative: `.arbora/screenshots/${name}.png`,
    uri: `file:///p/${name}.png`,
    mimeType: 'image/png',
    data: name,
  };
}

describe('composeDesignPrompt', () => {
  it('sends the change list, the instruction and two images, before then after', () => {
    const blocks = composeDesignPrompt({
      url: 'http://localhost:5173/',
      framework,
      approach: 'tailwind',
      changes: '- `padding-top`: 16px → 32px (suggested `pt-8`)\n- text: "Counter" → "Total"',
      sources: [source],
      before: shot('before'),
      after: shot('after'),
      imageSupported: true,
      toUri: (path) => `file://${path}`,
    });
    const text = blocks[0]?.type === 'text' ? blocks[0].text : '';
    expect(text).toContain(DESIGN_INSTRUCTION);
    expect(text).toContain('`padding-top`: 16px → 32px');
    expect(text).toContain('text: "Counter" → "Total"');
    expect(text).toContain('src/components/Card.tsx:12');
    expect(text).toContain('do not add inline styles');
    expect(blocks.slice(1, 3)).toEqual([
      { type: 'image', data: 'before', mimeType: 'image/png', uri: 'file:///p/before.png' },
      { type: 'image', data: 'after', mimeType: 'image/png', uri: 'file:///p/after.png' },
    ]);
    expect(blocks[3]).toMatchObject({ type: 'resource_link', name: 'src/components/Card.tsx' });
  });

  it('links the screenshots when the agent does not take images', () => {
    const blocks = composeDesignPrompt({
      url: 'http://localhost:5173/',
      framework,
      approach: 'plain-css',
      changes: '- text: "A" → "B"',
      sources: [],
      before: shot('before'),
      after: shot('after'),
      imageSupported: false,
      toUri: (path) => path,
    });
    expect(blocks[1]).toMatchObject({ type: 'resource_link', name: 'before.png' });
    expect(blocks[2]).toMatchObject({ type: 'resource_link', name: 'after.png' });
    expect(blocks.some((block) => block.type === 'image')).toBe(false);
  });
});
