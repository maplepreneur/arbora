import { describe, expect, it } from 'vitest';
import { renderSessionMarkdown } from './design-session.js';

describe('renderSessionMarkdown', () => {
  it('includes the page, the sources, the change list and the screenshot paths', () => {
    const markdown = renderSessionMarkdown({
      createdAt: '2026-11-06T13:00:00.000Z',
      url: 'http://127.0.0.1:5173/',
      approach: 'tailwind',
      opCount: 2,
      framework: 'vite',
      changes: '### Card\n\n- `padding-top`: 24px → 40px (suggested `pt-10`)',
      sources: [{ relative: 'src/components/Card.tsx', line: 12 }],
      beforeRelative: '.arbora/screenshots/before.png',
      afterRelative: '.arbora/screenshots/after.png',
    });
    expect(markdown).toContain('# Design session');
    expect(markdown).toContain('- Page: http://127.0.0.1:5173/');
    expect(markdown).toContain('- Styling: tailwind');
    expect(markdown).toContain('- Framework: vite');
    expect(markdown).toContain('- `src/components/Card.tsx:12`');
    expect(markdown).toContain('suggested `pt-10`');
    expect(markdown).toContain('- Before: `.arbora/screenshots/before.png`');
    expect(markdown).toContain('- After: `.arbora/screenshots/after.png`');
  });

  it('says when a source or a screenshot was not recorded', () => {
    const markdown = renderSessionMarkdown({
      createdAt: '2026-11-06T13:00:00.000Z',
      url: 'http://127.0.0.1:5173/',
      approach: 'plain-css',
      opCount: 0,
      framework: null,
      changes: '',
      sources: [{ relative: 'src/App.tsx', line: null }],
      beforeRelative: null,
      afterRelative: null,
    });
    expect(markdown).toContain('- `src/App.tsx`');
    expect(markdown).not.toContain('src/App.tsx:');
    expect(markdown).toContain('_No changes._');
    expect(markdown).toContain('- none recorded');
    expect(markdown).not.toContain('Framework:');
  });
});
