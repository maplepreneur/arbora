import { describe, expect, it } from 'vitest';
import { browserSkill, firstPromptPreface, isPrefaceTitle } from './instructions.js';

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

  it('adds the verify loop only when the browser tools are attached', () => {
    const without = firstPromptPreface({ projectPath: '/p', devUrl: 'http://localhost:5173/' });
    expect(without).not.toContain('browser_screenshot');
    const withTools = firstPromptPreface({ projectPath: '/p', devUrl: 'http://localhost:5173/', browserTools: true });
    expect(withTools).toContain('arbora-browser');
    expect(withTools).toContain('browser_wait_for');
    expect(withTools).toContain('devserver_restart');
    expect(withTools).toContain('/p/.arbora/SKILL.md');
    expect(withTools.split(/\s+/).length).toBeLessThan(300);
  });

  it('describes the Grove tools only to a session that has them', () => {
    const base = { projectPath: '/p', devUrl: 'http://localhost:5173/', browserTools: true };
    expect(firstPromptPreface(base)).not.toContain('grove_');
    expect(firstPromptPreface({ ...base, browserTools: false, groveTools: true })).not.toContain('grove_');
    const lead = firstPromptPreface({ ...base, groveTools: true });
    expect(lead).toContain('grove_start_agent');
    expect(lead.split(/\s+/).length).toBeLessThan(300);
    // The fake agent acts on these words anywhere in a prompt, preface included.
    expect(lead).not.toMatch(
      /crash|stubborn|slow|plan|browser check|tool sweep|list mcp servers|restart dev|grove delegate|comment to|\bevaluate\b|\brun\b/i,
    );
  });
});

describe('browserSkill', () => {
  it('stays under 400 words and never mentions a token', () => {
    const skill = browserSkill({ projectPath: '/p', devUrl: 'http://localhost:5173/' });
    expect(skill.split(/\s+/).filter(Boolean).length).toBeLessThan(400);
    expect(skill).toContain('http://localhost:5173/');
    expect(skill).toContain('browser_snapshot');
    expect(skill).toContain('browser_compare');
    expect(skill).toContain('node-id');
    expect(skill).toContain('0.92');
    expect(skill).not.toMatch(/token|bearer/i);
    expect(skill).not.toContain('grove_');
  });

  it('adds the Grove section when orchestration is on', () => {
    const skill = browserSkill({ projectPath: '/p', devUrl: null, groveTools: true });
    expect(skill).toContain('## Grove helpers');
    expect(skill).toContain('grove_wait');
    expect(skill.split(/\s+/).filter(Boolean).length).toBeLessThan(400);
  });
});
