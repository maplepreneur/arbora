import { describe, expect, it } from 'vitest';
import { CommandId, DEFAULT_COMMANDS } from '@arbora/shared';
import { ADD_TABS, addTabCommand, placeTabMenu } from './add-tab-menu';

const menu = { width: 176, height: 180 };
const viewport = { width: 1200, height: 800 };

describe('placeTabMenu', () => {
  it('opens under the trigger and aligns to its right edge', () => {
    expect(placeTabMenu({ top: 40, right: 900, bottom: 68, left: 872 }, menu, viewport)).toEqual({
      top: 72,
      left: 724,
    });
  });

  it('stays inside the window when the trigger is near the left or bottom edge', () => {
    expect(placeTabMenu({ top: 700, right: 40, bottom: 728, left: 12 }, menu, viewport)).toEqual({
      top: 516,
      left: 6,
    });
  });
});

describe('add tab commands', () => {
  it('gives every row the command its shortcut runs', () => {
    expect(ADD_TABS.map((item) => [item.id, item.command, addTabCommand(item.id)])).toEqual([
      ['file', CommandId.quickOpen, CommandId.quickOpen],
      ['terminal', CommandId.showTerminal, CommandId.showTerminal],
      ['browser', CommandId.showBrowser, CommandId.showBrowser],
      ['changes', CommandId.showGitPanel, CommandId.showGitPanel],
      ['problems', CommandId.showProblems, CommandId.showProblems],
    ]);
    expect(ADD_TABS.map((item) => DEFAULT_COMMANDS.find((command) => command.id === item.command)?.keybinding)).toEqual(
      ['mod+p', 'ctrl+`', 'mod+shift+l', 'mod+alt+g', 'mod+shift+m'],
    );
    for (const item of ADD_TABS) {
      expect(DEFAULT_COMMANDS.find((command) => command.id === item.command)?.intercept).toBe(true);
    }
  });
});
