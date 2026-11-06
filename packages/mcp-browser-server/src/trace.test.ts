import { describe, expect, it } from 'vitest';
import { actionTraceTitle, compareSavedPath, compareScoreTitle, isTracedBrowserTool } from './trace.js';

describe('action traces', () => {
  it('names the action from the arguments', () => {
    expect(actionTraceTitle('browser_click', { ref: 'e2' })).toBe('Click e2');
    expect(actionTraceTitle('browser_click', { selector: 'button', double: true, button: 'right' })).toBe(
      'Click button twice (right)',
    );
    expect(actionTraceTitle('browser_navigate', { url: '/about' })).toBe('Navigate /about');
    expect(actionTraceTitle('browser_type', { text: 'Ada' })).toBe('Type Ada');
    expect(actionTraceTitle('browser_press_key', { key: 'Tab' })).toBe('Press Tab');
    expect(actionTraceTitle('browser_set_viewport', { preset: 'mobile' })).toBe('Viewport mobile');
    expect(actionTraceTitle('browser_set_viewport', { width: 500, height: 700 })).toBe('Viewport 500×700');
    expect(actionTraceTitle('browser_screenshot', {})).toBe('Screenshot viewport');
    expect(actionTraceTitle('browser_compare', {})).toBe('Compare tabs');
    expect(compareScoreTitle(JSON.stringify({ score: 0.84 }))).toBe('Matching design · 0.84');
    expect(compareScoreTitle('not json')).toBeNull();
    expect(compareSavedPath(JSON.stringify({ saved: '.arbora/screenshots/thread/round-1.png' }))).toBe(
      '.arbora/screenshots/thread/round-1.png',
    );
    expect(compareSavedPath(JSON.stringify({ saved: '/tmp/secret.png' }))).toBeNull();
  });

  it('traces page actions and skips reads', () => {
    expect(isTracedBrowserTool('browser_click')).toBe(true);
    expect(isTracedBrowserTool('browser_snapshot')).toBe(false);
    expect(isTracedBrowserTool('browser_console_logs')).toBe(false);
    expect(isTracedBrowserTool('terminal_run')).toBe(false);
  });
});
