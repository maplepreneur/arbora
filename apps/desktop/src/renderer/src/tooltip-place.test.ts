import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltip-place';

const viewport = { width: 1200, height: 800 };
const page = { left: 600, right: 1000, top: 80, bottom: 800 };
const box = (left: number, top: number, width = 20, height = 20) => ({ left, top, width, bottom: top + height });

describe('placeTooltip', () => {
  it('centres below the anchor when the page is not in the way', () => {
    expect(placeTooltip(box(100, 40), 200, 30, page, viewport)).toEqual({ left: 10, top: 66 });
  });

  it('slides left of the page for an anchor in the column beside it', () => {
    const placed = placeTooltip(box(570, 40), 300, 30, page, viewport);
    expect(placed.left + 300).toBeLessThanOrEqual(page.left);
    expect(placed.top).toBe(66);
  });

  it('slides right of the page for an anchor on its far side', () => {
    expect(placeTooltip(box(1010, 300), 100, 30, page, viewport).left).toBeGreaterThanOrEqual(page.right);
  });

  it('goes above an anchor in the page toolbar', () => {
    expect(placeTooltip(box(800, 50), 200, 24, page, viewport).top).toBe(20);
  });

  it('ignores the page when none is shown', () => {
    expect(placeTooltip(box(570, 40), 300, 30, null, viewport).left).toBe(430);
  });
});
