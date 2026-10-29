import { describe, expect, it } from 'vitest';
import { firstPromptPreface, isPrefaceTitle } from './instructions.js';

describe('isPrefaceTitle', () => {
  it('recognises the preface read back as a thread title', () => {
    expect(isPrefaceTitle(firstPromptPreface({ projectPath: '/p', devUrl: null }).split('\n')[0] ?? '')).toBe(true);
    expect(isPrefaceTitle('  You are working inside Arbora, a desktop app…')).toBe(true);
    expect(isPrefaceTitle('Add comment to App.tsx')).toBe(false);
  });
});

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
