import { describe, expect, it } from 'vitest';
import type { DesignOp, DesignTarget } from './design.js';
import { mergeTailwindClasses, patchTailwindSource, planWriteThrough } from './write-through.js';

const target: DesignTarget = {
  ref: '1',
  selector: '[data-testid="card-counter"]',
  componentChain: ['Card'],
  sourceFile: 'src/components/Card.tsx',
  sourceLine: 12,
};

function style(partial: Partial<Extract<DesignOp, { kind: 'style' }>> = {}): DesignOp {
  return {
    id: 'op-1',
    kind: 'style',
    target,
    property: 'padding-top',
    before: '24px',
    after: '40px',
    computedAfter: '40px',
    inlineBefore: '',
    inlinePriority: '',
    stale: false,
    ...partial,
  };
}

const CARD = `export function Card() {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      data-testid={\`card-\${title.toLowerCase()}\`}
    >
      <h2 className="text-lg font-semibold text-slate-900">Title</h2>
    </section>
  );
}
`;

describe('planWriteThrough', () => {
  it('plans a tier-1 Tailwind style change', () => {
    const plan = planWriteThrough([style()], 'tailwind');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits).toEqual([
      {
        file: 'src/components/Card.tsx',
        line: 12,
        classes: [{ className: 'pt-10', property: 'padding-top' }],
      },
    ]);
  });

  it('refuses a text change, a missing line, a stale op, and a non-Tailwind project', () => {
    expect(planWriteThrough([{ ...style(), kind: 'text', before: 'a', after: 'b' }], 'tailwind').ok).toBe(false);
    expect(planWriteThrough([style({ target: { ...target, sourceLine: null } })], 'tailwind').ok).toBe(false);
    expect(planWriteThrough([style({ stale: true })], 'tailwind').ok).toBe(false);
    expect(planWriteThrough([style()], 'plain-css').ok).toBe(false);
  });

  it('keeps the later edit when one property is set twice', () => {
    const plan = planWriteThrough(
      [style({ id: 'a', after: '16px', computedAfter: '16px' }), style({ id: 'b' })],
      'tailwind',
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits[0]?.classes).toEqual([{ className: 'pt-10', property: 'padding-top' }]);
  });
});

describe('mergeTailwindClasses', () => {
  it('adds a side utility beside the shorthand and drops the same side', () => {
    expect(
      mergeTailwindClasses(
        ['rounded-xl', 'p-6', 'pt-2', 'md:p-12', 'hover:pt-1'],
        [{ className: 'pt-10', property: 'padding-top' }],
      ),
    ).toEqual(['rounded-xl', 'p-6', 'md:p-12', 'hover:pt-1', 'pt-10']);
  });

  it('replaces the shorthand when the edit is the shorthand', () => {
    expect(mergeTailwindClasses(['p-6', 'px-2', 'md:p-12'], [{ className: 'p-10', property: 'padding' }])).toEqual([
      'md:p-12',
      'p-10',
    ]);
  });

  it('replaces a text colour and leaves the size', () => {
    expect(
      mergeTailwindClasses(
        ['text-lg', 'text-slate-900', 'font-sans'],
        [{ className: 'text-red-500', property: 'color' }],
      ),
    ).toEqual(['text-lg', 'font-sans', 'text-red-500']);
  });
});

describe('patchTailwindSource', () => {
  it('writes the class onto the multiline tag the line points at', () => {
    const patched = patchTailwindSource(CARD, 'Card.tsx', [
      { line: 3, classes: [{ className: 'pt-10', property: 'padding-top' }] },
    ]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.text).toContain('className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm pt-10"');
    expect(patched.text).toContain('className="text-lg font-semibold text-slate-900"');
  });

  it('finds the tag when the line is the attribute line', () => {
    const patched = patchTailwindSource(CARD, 'Card.tsx', [
      { line: 4, classes: [{ className: 'bg-red-500', property: 'background-color' }] },
    ]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.text).not.toContain('bg-white');
    expect(patched.text).toContain('bg-red-500');
  });

  it('inserts className when the tag has none, and class in a Vue file', () => {
    const jsx = patchTailwindSource('<div>\n', 'Box.tsx', [
      { line: 1, classes: [{ className: 'flex', property: 'display' }] },
    ]);
    expect(jsx).toEqual({ ok: true, text: '<div className="flex">\n' });
    const vue = patchTailwindSource('<button />\n', 'Box.vue', [
      { line: 1, classes: [{ className: 'flex', property: 'display' }] },
    ]);
    expect(vue).toEqual({ ok: true, text: '<button class="flex" />\n' });
  });

  it('refuses a dynamic class expression', () => {
    const patched = patchTailwindSource('<div className={clsx("p-6")}>\n', 'Box.tsx', [
      { line: 1, classes: [{ className: 'pt-10', property: 'padding-top' }] },
    ]);
    expect(patched.ok).toBe(false);
  });

  it('updates a braced string literal', () => {
    const patched = patchTailwindSource('<div className={"p-6"}>\n', 'Box.tsx', [
      { line: 1, classes: [{ className: 'pt-10', property: 'padding-top' }] },
    ]);
    expect(patched).toEqual({ ok: true, text: '<div className={"p-6 pt-10"}>\n' });
  });
});
