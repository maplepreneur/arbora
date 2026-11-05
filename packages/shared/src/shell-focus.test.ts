import { describe, expect, it } from 'vitest';
import { CommandId, DEFAULT_COMMANDS, resolveKeybindingSpecs } from './commands.js';
import { KeybindingTable, parseChord, type KeybindingContext } from './keybindings.js';
import { browserViewAcceptsFocus, nextContentPaneFocus, shellFocusPane } from './shell-focus.js';

const refused = {
  url: 'http://[::1]:3000/',
  error: { code: -102, description: 'ERR_CONNECTION_REFUSED', url: 'http://[::1]:3000/' },
};
const empty = { url: '', error: null };
const live = { url: 'http://localhost:3000/', error: null };

const grove: KeybindingContext = {
  modeActive: false,
  terminalFocused: false,
  terminalPassthrough: true,
  workspace: 'grove',
};

describe('browser focus target', () => {
  it('keeps an error or empty browser in the content pane instead of the parked view', () => {
    expect(browserViewAcceptsFocus(refused)).toBe(false);
    expect(browserViewAcceptsFocus(empty)).toBe(false);
    expect(browserViewAcceptsFocus(null)).toBe(false);
    expect(browserViewAcceptsFocus(undefined)).toBe(false);
    expect(browserViewAcceptsFocus(live)).toBe(true);
  });
});

describe('content pane focus', () => {
  it('counts an error or empty browser as the content pane, and matches Mod+1..9 only then', () => {
    // The error and empty UIs are renderer DOM inside the content pane.
    expect(
      nextContentPaneFocus({ landmark: 'center', terminalFocused: false, pageFocused: false, sticky: false }),
    ).toEqual({ contentFocused: true, sticky: true });

    // A loaded page is not a DOM node. The view having the keyboard still counts.
    expect(nextContentPaneFocus({ landmark: null, terminalFocused: false, pageFocused: true, sticky: false })).toEqual({
      contentFocused: true,
      sticky: true,
    });
    expect(shellFocusPane({ landmark: 'agent', terminalFocused: false, pageFocused: true })).toBe('center');
    // A click in the chat focuses the DOM before the page-blur event arrives.
    expect(
      shellFocusPane({ landmark: 'agent', terminalFocused: false, pageFocused: true, documentFocused: true }),
    ).toBe('agent');
    expect(
      nextContentPaneFocus({
        landmark: 'agent',
        terminalFocused: false,
        pageFocused: true,
        documentFocused: true,
        sticky: true,
      }).contentFocused,
    ).toBe(false);

    // The project tree and the chat do not, even while the browser tab is showing the error.
    expect(browserViewAcceptsFocus(refused)).toBe(false);
    expect(
      nextContentPaneFocus({ landmark: 'tree', terminalFocused: false, pageFocused: false, sticky: true }),
    ).toEqual({ contentFocused: false, sticky: false });
    expect(
      nextContentPaneFocus({ landmark: 'agent', terminalFocused: false, pageFocused: false, sticky: true })
        .contentFocused,
    ).toBe(false);
    expect(shellFocusPane({ landmark: 'tree', terminalFocused: false, pageFocused: false })).toBe('tree');
    expect(shellFocusPane({ landmark: 'sidebar', terminalFocused: false, pageFocused: false })).toBe('sidebar');

    const { table } = KeybindingTable.build(resolveKeybindingSpecs(DEFAULT_COMMANDS, {}, {}), 'linux');
    const ctrl1 = parseChord('ctrl+1', 'linux');
    const ctrl9 = parseChord('ctrl+9', 'linux');
    expect(table.match(ctrl1, { ...grove, contentFocused: true })?.commandId).toBe(CommandId.rightTab1);
    expect(table.match(ctrl9, { ...grove, contentFocused: true })?.commandId).toBe(CommandId.rightTab9);
    expect(table.match(ctrl1, { ...grove, contentFocused: false })?.commandId).toBe(CommandId.groveSelectSession1);
    expect(table.match(ctrl9, { ...grove, contentFocused: false })?.commandId).toBe(CommandId.groveSelectSession9);
  });
});
