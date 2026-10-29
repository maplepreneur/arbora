import { describe, expect, it } from 'vitest';
import {
  clipRect,
  formatSource,
  pageRectToWindow,
  placePopover,
  sourceTier,
  targetComponent,
  type ResolvedComponent,
} from './inspector.js';

describe('pageRectToWindow', () => {
  const rect = { x: 100, y: 50, width: 40, height: 20 };

  it('offsets by the view position at 100% zoom', () => {
    expect(
      pageRectToWindow(rect, {
        viewport: { innerWidth: 800, innerHeight: 600 },
        view: { x: 300, y: 80, width: 800, height: 600 },
      }),
    ).toEqual({ x: 400, y: 130, width: 40, height: 20 });
  });

  it('folds in page zoom (150%: the page sees fewer CSS pixels)', () => {
    expect(
      pageRectToWindow(rect, {
        viewport: { innerWidth: 400, innerHeight: 300 },
        view: { x: 0, y: 0, width: 600, height: 450 },
      }),
    ).toEqual({ x: 150, y: 75, width: 60, height: 30 });
  });

  it('folds in the device-emulation scale of a letterboxed preset', () => {
    // Mobile 390x844 scaled to fit a 422px-tall panel (scale 0.5), centred at x=505.
    expect(
      pageRectToWindow(rect, {
        viewport: { innerWidth: 390, innerHeight: 844 },
        view: { x: 505, y: 40, width: 195, height: 422 },
      }),
    ).toEqual({ x: 555, y: 65, width: 20, height: 10 });
  });

  it('does not divide by zero', () => {
    const out = pageRectToWindow(rect, {
      viewport: { innerWidth: 0, innerHeight: 0 },
      view: { x: 1, y: 2, width: 0, height: 0 },
    });
    expect(out).toEqual({ x: 101, y: 52, width: 40, height: 20 });
  });
});

describe('clipRect', () => {
  it('intersects and collapses when disjoint', () => {
    expect(clipRect({ x: -10, y: 5, width: 50, height: 50 }, { x: 0, y: 0, width: 30, height: 30 })).toEqual({
      x: 0,
      y: 5,
      width: 30,
      height: 25,
    });
    expect(clipRect({ x: 100, y: 100, width: 5, height: 5 }, { x: 0, y: 0, width: 10, height: 10 }).width).toBe(0);
  });
});

describe('placePopover', () => {
  const area = { x: 0, y: 0, width: 800, height: 600 };
  const size = { width: 300, height: 200 };

  it('goes below the anchor when it fits', () => {
    expect(placePopover({ x: 100, y: 100, width: 50, height: 20 }, size, area)).toEqual({
      x: 100,
      y: 128,
      side: 'below',
    });
  });

  it('goes above when there is no room below, and clamps horizontally', () => {
    expect(placePopover({ x: 700, y: 500, width: 50, height: 20 }, size, area)).toEqual({
      x: 500,
      y: 292,
      side: 'above',
    });
  });

  it('goes beside a tall anchor when neither above nor below fits', () => {
    expect(placePopover({ x: 10, y: 150, width: 50, height: 300 }, size, area)).toEqual({
      x: 68,
      y: 150,
      side: 'right',
    });
    expect(placePopover({ x: 600, y: 150, width: 190, height: 300 }, size, area)).toEqual({
      x: 292,
      y: 150,
      side: 'left',
    });
  });

  it('pins to the edge that covers less of the anchor in a short panel', () => {
    const short = { x: 0, y: 0, width: 500, height: 400 };
    const popover = { width: 400, height: 260 };
    // Anchor low in the panel: pin to the top.
    expect(placePopover({ x: 20, y: 250, width: 460, height: 40 }, popover, short)).toEqual({
      x: 20,
      y: 0,
      side: 'inside',
    });
    // Anchor high in the panel: pin to the bottom.
    expect(placePopover({ x: 20, y: 100, width: 460, height: 40 }, popover, short)).toEqual({
      x: 20,
      y: 140,
      side: 'inside',
    });
  });
});

describe('sourceTier and targetComponent', () => {
  const base: ResolvedComponent = {
    name: 'X',
    minified: false,
    server: false,
    definedAt: null,
    renderedAt: null,
    rect: null,
    definedIn: null,
    renderedIn: null,
  };
  const withLine = { path: '/p/a.tsx', relative: 'a.tsx', line: 3, column: 1 };
  const noLine = { ...withLine, line: null };

  it('ranks file+line, file only and nothing', () => {
    expect(sourceTier({ ...base, renderedIn: withLine })).toBe(1);
    expect(sourceTier({ ...base, definedIn: noLine })).toBe(2);
    expect(sourceTier(base)).toBe(3);
    expect(sourceTier(null)).toBe(3);
  });

  it('formats sources and falls back to the nearest component', () => {
    expect(formatSource(withLine)).toBe('a.tsx:3');
    expect(formatSource(noLine)).toBe('a.tsx');
    const components = [base, { ...base, name: 'Y' }];
    expect(targetComponent({ components, targetIndex: 1 })?.name).toBe('Y');
    expect(targetComponent({ components, targetIndex: 9 })?.name).toBe('X');
    expect(targetComponent({ components: [], targetIndex: 0 })).toBeNull();
  });
});
