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
  };
}

describe('composeDesignPrompt', () => {
  it('sends the change list, the instruction and both screenshot paths', () => {
    const text = composeDesignPrompt({
      url: 'http://localhost:5173/',
      framework,
      approach: 'tailwind',
      changes: '- `padding-top`: 16px → 32px (suggested `pt-8`)\n- text: "Counter" → "Total"',
      sources: [source],
      before: shot('before'),
      after: shot('after'),
    });
    expect(text).toContain(DESIGN_INSTRUCTION);
    expect(text).toContain('`padding-top`: 16px → 32px');
    expect(text).toContain('text: "Counter" → "Total"');
    expect(text).toContain('src/components/Card.tsx:12');
    expect(text).toContain('do not add inline styles');
    expect(text).toContain('- Before: .arbora/screenshots/before.png. After: .arbora/screenshots/after.png.');
  });

  it('is deterministic and skips the sources section when empty', () => {
    const input = {
      url: 'http://localhost:5173/',
      framework,
      approach: 'plain-css' as const,
      changes: '- text: "A" → "B"',
      sources: [] as readonly ResolvedSource[],
      before: shot('before'),
      after: shot('after'),
    };
    expect(composeDesignPrompt(input)).toEqual(composeDesignPrompt(input));
    expect(composeDesignPrompt(input)).not.toContain('## Sources');
  });
});
