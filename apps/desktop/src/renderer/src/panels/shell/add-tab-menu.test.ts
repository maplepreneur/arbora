import { describe, expect, it } from 'vitest';
import { menuContentInset, placeTabMenu } from './add-tab-menu';

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

describe('menuContentInset', () => {
  it('is the part of the menu that hangs below the tab strip', () => {
    expect(menuContentInset(72, 252)).toBe(180);
    expect(menuContentInset(72, 40)).toBe(0);
  });
});
