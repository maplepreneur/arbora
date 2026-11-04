import { beforeEach, describe, expect, it } from 'vitest';
import { closeRightPanel, DEFAULT_LAYOUT, showRightView, useApp } from './store';

describe('right column tabs', () => {
  beforeEach(() => {
    useApp.setState({ project: null, layout: DEFAULT_LAYOUT });
  });

  it('starts on the browser with no Changes or Problems tab', () => {
    expect(useApp.getState().layout.rightView).toBe('browser');
    expect(useApp.getState().layout.rightPanels).toEqual([]);
  });

  it('adds Changes and Problems to the strip the first time they show, once', () => {
    showRightView('problems');
    showRightView('changes');
    showRightView('problems');
    expect(useApp.getState().layout).toMatchObject({ rightView: 'problems', rightPanels: ['problems', 'changes'] });
    showRightView('terminal');
    expect(useApp.getState().layout).toMatchObject({ rightView: 'terminal', rightPanels: ['problems', 'changes'] });
  });

  it('shows the browser after closing the tab on screen, and leaves another view alone', () => {
    showRightView('changes');
    showRightView('problems');
    closeRightPanel('problems');
    expect(useApp.getState().layout).toMatchObject({ rightView: 'browser', rightPanels: ['changes'] });
    showRightView('terminal');
    closeRightPanel('changes');
    expect(useApp.getState().layout).toMatchObject({ rightView: 'terminal', rightPanels: [] });
  });
});
