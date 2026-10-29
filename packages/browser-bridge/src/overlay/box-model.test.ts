import { describe, expect, it } from 'vitest';
import { boxModel, edges } from './box-model.js';

const style = (values: Record<string, string>) => ({ getPropertyValue: (name: string) => values[name] ?? '' });

describe('boxModel', () => {
  it('grows the margin box and shrinks padding and content boxes', () => {
    const model = boxModel(
      { x: 10, y: 20, width: 100, height: 50 },
      { top: 4, right: 4, bottom: 4, left: 4 },
      { top: 1, right: 1, bottom: 1, left: 1 },
      { top: 8, right: 16, bottom: 8, left: 16 },
    );
    expect(model.margin).toEqual({ x: 6, y: 16, width: 108, height: 58 });
    expect(model.border).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(model.padding).toEqual({ x: 11, y: 21, width: 98, height: 48 });
    expect(model.content).toEqual({ x: 27, y: 29, width: 66, height: 32 });
  });

  it('never produces negative sizes', () => {
    const big = { top: 50, right: 50, bottom: 50, left: 50 };
    expect(boxModel({ x: 0, y: 0, width: 10, height: 10 }, big, big, big).content.width).toBe(0);
  });
});

describe('edges', () => {
  it('reads computed lengths and treats auto/empty as zero', () => {
    expect(
      edges(
        style({
          'border-top-width': '2px',
          'border-right-width': '1.5px',
          'border-bottom-width': '',
          'border-left-width': 'auto',
        }),
        'border',
        '-width',
      ),
    ).toEqual({ top: 2, right: 1.5, bottom: 0, left: 0 });
  });
});
