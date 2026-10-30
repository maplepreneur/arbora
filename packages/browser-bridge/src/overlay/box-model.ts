import type { Rect } from '@arbora/shared';

export interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface BoxModel {
  readonly margin: Rect;
  readonly border: Rect;
  readonly padding: Rect;
  readonly content: Rect;
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Reads `<prefix>-top`, `-right`, ... (with an optional suffix such as `-width`) from a computed style. */
export function edges(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>, prefix: string, suffix = ''): Edges {
  return {
    top: px(style.getPropertyValue(`${prefix}-top${suffix}`)),
    right: px(style.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: px(style.getPropertyValue(`${prefix}-bottom${suffix}`)),
    left: px(style.getPropertyValue(`${prefix}-left${suffix}`)),
  };
}

function grow(rect: Rect, by: Edges, sign: 1 | -1): Rect {
  const width = rect.width + sign * (by.left + by.right);
  const height = rect.height + sign * (by.top + by.bottom);
  return {
    x: rect.x - sign * by.left,
    y: rect.y - sign * by.top,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

/** DevTools-style boxes from the border box (`getBoundingClientRect`) and the computed edges. */
export function boxModel(borderBox: Rect, margin: Edges, border: Edges, padding: Edges): BoxModel {
  const paddingBox = grow(borderBox, border, -1);
  return {
    margin: grow(borderBox, margin, 1),
    border: borderBox,
    padding: paddingBox,
    content: grow(paddingBox, padding, -1),
  };
}
