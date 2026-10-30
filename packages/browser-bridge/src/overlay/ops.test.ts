// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { REF_ATTRIBUTE } from '../main-world.js';
import { OpLog, applyOp, planDrop, revertOp, type OpMeta } from './ops.js';

const meta: OpMeta = { selector: '#card', componentChain: ['Card'], sourceFile: null, sourceLine: null };

function card(): HTMLElement {
  document.body.innerHTML = '<section id="card" style="padding-top: 8px">Hello</section>';
  return document.getElementById('card') as HTMLElement;
}

describe('op recorder', () => {
  it('rounds-trips style, text and attr through undo and redo', () => {
    const element = card();
    const log = new OpLog();
    log.style(document, element, 'padding-top', '20px', meta);
    expect(element.style.getPropertyPriority('padding-top')).toBe('important');
    expect(element.style.getPropertyValue('padding-top')).toBe('20px');

    log.text(element, 'Hello', 'Total', meta);
    expect(element.textContent).toBe('Total');
    log.attr(element, 'title', 'Counter', meta);
    expect(element.getAttribute('title')).toBe('Counter');

    log.undo(document);
    expect(element.hasAttribute('title')).toBe(false);
    log.undo(document);
    expect(element.textContent).toBe('Hello');
    log.undo(document);
    expect(element.style.getPropertyValue('padding-top')).toBe('8px');
    expect(element.style.getPropertyPriority('padding-top')).toBe('');

    log.redo(document);
    log.redo(document);
    log.redo(document);
    expect(element.style.getPropertyValue('padding-top')).toBe('20px');
    expect(element.textContent).toBe('Total');
    expect(element.getAttribute('title')).toBe('Counter');

    log.revertAll(document);
    expect(element.style.getPropertyValue('padding-top')).toBe('8px');
    expect(element.textContent).toBe('Hello');
    expect(element.hasAttribute('title')).toBe(false);
    expect(log.cursor).toBe(0);
    expect(log.ops).toHaveLength(3);
  });

  it('rounds-trips move, insert, duplicate and delete', () => {
    document.body.innerHTML = '<div id="box"><span id="a">A</span><span id="b">B</span><span id="c">C</span></div>';
    const box = document.getElementById('box') as HTMLElement;
    const item = document.getElementById('b') as HTMLElement;
    const log = new OpLog();

    log.move(item, box, 0, { ...meta, selector: '#b' });
    expect([...box.children].map((el) => el.id)).toEqual(['b', 'a', 'c']);
    log.undo(document);
    expect([...box.children].map((el) => el.id)).toEqual(['a', 'b', 'c']);
    log.redo(document);
    expect([...box.children].map((el) => el.id)).toEqual(['b', 'a', 'c']);

    log.insert(document, box, 1, 'button', meta);
    expect(box.children[1]?.tagName).toBe('BUTTON');
    expect(box.children[1]?.textContent).toBe('Button');
    const inserted = box.children[1] as HTMLElement;
    log.undo(document);
    expect(box.querySelector('button')).toBeNull();
    log.redo(document);
    expect(box.querySelector('button')?.getAttribute(REF_ATTRIBUTE)).toBe(inserted.getAttribute(REF_ATTRIBUTE));

    const original = document.getElementById('a') as HTMLElement;
    const duplicate = log.duplicate(document, original, meta);
    expect(duplicate?.kind).toBe('insert');
    const copies = [...box.children].filter((el) => el.id === 'a');
    expect(copies).toHaveLength(2);
    expect(copies[0]?.getAttribute(REF_ATTRIBUTE)).not.toBe(copies[1]?.getAttribute(REF_ATTRIBUTE));

    log.delete(document.getElementById('c') as HTMLElement, { ...meta, selector: '#c' });
    expect(document.getElementById('c')).toBeNull();
    log.undo(document);
    expect(document.getElementById('c')?.textContent).toBe('C');
  });

  it('reapplies onto a replaced node and marks a missing target stale', () => {
    const element = card();
    const log = new OpLog();
    const op = log.style(document, element, 'background-color', 'red', meta);
    element.remove();
    document.body.innerHTML = '<section id="card">Hello</section>';
    log.reapply(document);
    const next = document.getElementById('card') as HTMLElement;
    expect(next.style.getPropertyValue('background-color')).toBe('red');
    expect(next.getAttribute(REF_ATTRIBUTE)).toBe(op.target.ref);
    expect(log.ops[0]?.stale).toBe(false);

    next.remove();
    log.reapply(document);
    expect(log.ops[0]?.stale).toBe(true);
    expect(applyOp(document, log.ops[0]!)).toBe(false);
    expect(revertOp(document, log.ops[0]!)).toBe(false);
  });

  it('shows the original and back without losing the list or the cursor', () => {
    const element = card();
    const log = new OpLog();
    log.style(document, element, 'padding-top', '20px', meta);
    log.text(element, 'Hello', 'Total', meta);
    log.showOriginal(document, true);
    expect(element.style.getPropertyValue('padding-top')).toBe('8px');
    expect(element.textContent).toBe('Hello');
    expect(log.cursor).toBe(2);
    log.showOriginal(document, false);
    expect(element.style.getPropertyValue('padding-top')).toBe('20px');
    expect(element.textContent).toBe('Total');
  });

  it('switches one change off and deletes one, keeping later changes applied', () => {
    const element = card();
    const log = new OpLog();
    const first = log.style(document, element, 'padding-top', '20px', meta);
    const second = log.style(document, element, 'padding-top', '30px', meta);
    const text = log.text(element, 'Hello', 'Total', meta);

    log.setMuted(document, second.id, true);
    expect(element.style.getPropertyValue('padding-top')).toBe('20px');
    expect(element.textContent).toBe('Total');
    log.setMuted(document, first.id, true);
    expect(element.style.getPropertyValue('padding-top')).toBe('8px');
    expect(element.style.getPropertyPriority('padding-top')).toBe('');
    log.setMuted(document, second.id, false);
    expect(element.style.getPropertyValue('padding-top')).toBe('30px');

    log.remove(document, text.id);
    expect(element.textContent).toBe('Hello');
    expect(log.ops.map((op) => op.id)).toEqual([first.id, second.id]);
    expect(log.cursor).toBe(2);

    // Discard with a change switched off still lands on the original page.
    log.revertAll(document);
    expect(element.style.getPropertyValue('padding-top')).toBe('8px');
    expect(element.textContent).toBe('Hello');
  });

  it('drops beside a sibling or into the middle of a sibling container', () => {
    document.body.innerHTML = '<div id="box"><div id="a"></div><div id="b"><i id="inner"></i></div></div>';
    const dragged = document.getElementById('a') as HTMLElement;
    const sibling = document.getElementById('b') as HTMLElement;
    const rect = { top: 0, bottom: 100 };
    expect(planDrop(dragged, sibling, 10, () => rect)).toEqual({ parent: dragged.parentElement, index: 0 });
    expect(planDrop(dragged, sibling, 90, () => rect)).toEqual({ parent: dragged.parentElement, index: 1 });
    expect(planDrop(dragged, document.getElementById('inner') as HTMLElement, 50, () => rect)?.parent).toBe(sibling);
  });
});
