import { describe, expect, it } from 'vitest';
import { firstPromptPreface } from './instructions.js';

describe('firstPromptPreface', () => {
  it('describes Arbora, the project folder and the dev URL', () => {
    const text = firstPromptPreface({ projectPath: '/home/me/app', devUrl: 'http://localhost:5173/' });
    expect(text).toContain('Arbora');
    expect(text).toContain('/home/me/app');
    expect(text).toContain('http://localhost:5173/');
    expect(text.split(/\s+/).length).toBeLessThan(200);
  });

  it('says when no dev server URL is known', () => {
    const text = firstPromptPreface({ projectPath: 'C:/work/app', devUrl: null });
    expect(text).toContain('C:/work/app');
    expect(text).not.toContain('http://');
    expect(text).toMatch(/not running|no dev server/i);
  });

  it('uses forward slashes for Windows paths', () => {
    expect(firstPromptPreface({ projectPath: 'C:\\work\\app', devUrl: null })).toContain('C:/work/app');
  });
});
