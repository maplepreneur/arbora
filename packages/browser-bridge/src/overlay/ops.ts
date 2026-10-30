import type { DesignInsertKind, DesignOp, DesignTarget } from '@arbora/shared';
import { REF_ATTRIBUTE } from '../main-world.js';

/** What the overlay knows about an element when it records an op. */
export interface OpMeta {
  readonly selector: string;
  readonly componentChain: readonly string[];
  readonly sourceFile: string | null;
  readonly sourceLine: number | null;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Inline style of an HTML or SVG element. Uses the element's own window so it works in the page. */
export function declaredStyle(element: Element): CSSStyleDeclaration | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  if (element instanceof view.HTMLElement || element instanceof view.SVGElement) return element.style;
  return null;
}

export function elementByRef(doc: Document, ref: string): Element | null {
  if (!/^[0-9]+$/.test(ref)) return null;
  return doc.querySelector(`[${REF_ATTRIBUTE}="${ref}"]`);
}

/** The element for an op: its ref, or the selector with the ref written back onto a re-rendered node. */
export function findTarget(doc: Document, target: DesignTarget): Element | null {
  const byRef = elementByRef(doc, target.ref);
  if (byRef) return byRef;
  if (!target.selector) return null;
  try {
    const found = doc.querySelector(target.selector);
    if (!found) return null;
    found.setAttribute(REF_ATTRIBUTE, target.ref);
    return found;
  } catch {
    return null;
  }
}

function targetOf(ref: string, meta: OpMeta): DesignTarget {
  return {
    ref,
    selector: meta.selector,
    componentChain: [...meta.componentChain],
    sourceFile: meta.sourceFile,
    sourceLine: meta.sourceLine,
  };
}

function childIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 0;
  return Array.from(parent.children).indexOf(element);
}

/** Index in `parent` after `element` is removed (its current index when it is already a child). */
export function indexAfterRemoval(parent: Element, element: Element, before: Element | null): number {
  const children = Array.from(parent.children).filter((child) => child !== element);
  if (!before) return children.length;
  const index = children.indexOf(before);
  return index < 0 ? children.length : index;
}

/**
 * Where a drag should land. `under` is the element under the pointer, ignoring the dragged node.
 * A point in the middle half of a sibling container drops inside it; the edges reorder beside it.
 */
export function planDrop(
  dragged: Element,
  under: Element | null,
  clientY: number,
  rectOf: (element: Element) => { top: number; bottom: number } = (element) => element.getBoundingClientRect(),
): { parent: Element; index: number } | null {
  const origin = dragged.parentElement;
  if (!origin || !under || under === dragged) return null;
  let node: Element | null = under;
  while (node && node !== origin && node.parentElement !== origin) node = node.parentElement;
  if (!node || node === dragged) return null;
  if (node === origin) return { parent: origin, index: indexAfterRemoval(origin, dragged, null) };
  const rect = rectOf(node);
  const height = rect.bottom - rect.top;
  const edge = height * 0.25;
  const into =
    !VOID_ELEMENTS.has(node.tagName.toLowerCase()) &&
    height > 0 &&
    clientY > rect.top + edge &&
    clientY < rect.bottom - edge;
  if (into) return { parent: node, index: indexAfterRemoval(node, dragged, null) };
  const after = height === 0 || clientY >= rect.top + height / 2;
  const slot = indexAfterRemoval(origin, dragged, node);
  return { parent: origin, index: slot + (after ? 1 : 0) };
}

function moveElement(element: Element, parent: Element, index: number): void {
  const children = Array.from(parent.children).filter((child) => child !== element);
  parent.insertBefore(element, children[index] ?? null);
}

function placeholder(doc: Document, kind: DesignInsertKind): Element {
  switch (kind) {
    case 'div': {
      const el = doc.createElement('div');
      el.textContent = 'Block';
      return el;
    }
    case 'text': {
      const el = doc.createElement('p');
      el.textContent = 'Text';
      return el;
    }
    case 'image': {
      const el = doc.createElement('img');
      el.alt = 'Image';
      el.setAttribute(
        'src',
        `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect width="80" height="48" fill="#e5e7eb"/></svg>')}`,
      );
      return el;
    }
    case 'button': {
      const el = doc.createElement('button');
      el.setAttribute('type', 'button');
      el.textContent = 'Button';
      return el;
    }
    case 'duplicate': {
      const el = doc.createElement('div');
      return el;
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function fromHtml(doc: Document, html: string): Element | null {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/** Applies one op. False when the element or its parent is gone (the op is stale). */
export function applyOp(doc: Document, op: DesignOp): boolean {
  switch (op.kind) {
    case 'style': {
      const element = findTarget(doc, op.target);
      const style = element ? declaredStyle(element) : null;
      if (!style) return false;
      style.setProperty(op.property, op.after, 'important');
      return true;
    }
    case 'text': {
      const element = findTarget(doc, op.target);
      if (!element) return false;
      element.textContent = op.after;
      return true;
    }
    case 'attr': {
      const element = findTarget(doc, op.target);
      if (!element) return false;
      if (op.after === null) element.removeAttribute(op.name);
      else element.setAttribute(op.name, op.after);
      return true;
    }
    case 'move': {
      const element = findTarget(doc, op.target);
      const parent = elementByRef(doc, op.after.parentRef);
      if (!element || !parent) return false;
      moveElement(element, parent, op.after.index);
      return true;
    }
    case 'insert': {
      if (elementByRef(doc, op.target.ref)) return true;
      const parent = elementByRef(doc, op.parentRef);
      if (!parent) return false;
      const created = (op.html ? fromHtml(doc, op.html) : null) ?? placeholder(doc, op.elementKind);
      created.setAttribute(REF_ATTRIBUTE, op.target.ref);
      moveElement(created, parent, op.index);
      return true;
    }
    case 'delete': {
      const element = findTarget(doc, op.target);
      element?.remove();
      return true;
    }
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

/** Reverses one op. False when the node it needs has disappeared. */
export function revertOp(doc: Document, op: DesignOp): boolean {
  switch (op.kind) {
    case 'style': {
      const element = findTarget(doc, op.target);
      const style = element ? declaredStyle(element) : null;
      if (!style) return false;
      if (!op.inlineBefore && !op.inlinePriority) style.removeProperty(op.property);
      else style.setProperty(op.property, op.inlineBefore, op.inlinePriority);
      return true;
    }
    case 'text': {
      const element = findTarget(doc, op.target);
      if (!element) return false;
      element.textContent = op.before;
      return true;
    }
    case 'attr': {
      const element = findTarget(doc, op.target);
      if (!element) return false;
      if (op.before === null) element.removeAttribute(op.name);
      else element.setAttribute(op.name, op.before);
      return true;
    }
    case 'move': {
      const element = findTarget(doc, op.target);
      const parent = elementByRef(doc, op.before.parentRef);
      if (!element || !parent) return false;
      moveElement(element, parent, op.before.index);
      return true;
    }
    case 'insert': {
      elementByRef(doc, op.target.ref)?.remove();
      return true;
    }
    case 'delete': {
      if (elementByRef(doc, op.target.ref)) return true;
      const parent = elementByRef(doc, op.parentRef);
      const created = fromHtml(doc, op.html);
      if (!parent || !created) return false;
      created.setAttribute(REF_ATTRIBUTE, op.target.ref);
      moveElement(created, parent, op.index);
      return true;
    }
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

/**
 * The design-mode op list. `cursor` is the count of applied ops; undo moves it back and revert
 * restores the previous DOM, redo applies again. A crash-safe mirror sends `ops` and `cursor`.
 */
export class OpLog {
  ops: DesignOp[] = [];
  cursor = 0;
  private seq = 1;
  private refSeq = 1;

  get applied(): DesignOp[] {
    return this.ops.slice(0, this.cursor);
  }

  load(ops: readonly DesignOp[], cursor: number): void {
    this.ops = ops.map((op) => ({ ...op }));
    this.cursor = Math.min(cursor, this.ops.length);
    for (const op of this.ops) {
      const id = Number(op.id.replace(/^op-/, ''));
      if (Number.isInteger(id) && id >= this.seq) this.seq = id + 1;
      const ref = Number(op.target.ref);
      if (Number.isInteger(ref) && ref >= this.refSeq) this.refSeq = ref + 1;
    }
  }

  /** Re-applies the applied ops that are switched on, marking any whose target disappeared. */
  reapply(doc: Document): void {
    for (let i = 0; i < this.cursor; i++) {
      const op = this.ops[i];
      if (!op || op.muted) continue;
      this.mark(op.id, !applyOp(doc, op));
    }
  }

  /**
   * Puts the page back to how it was before any applied op, whichever are switched on. Reverting
   * every applied op newest first ends on each one's earliest `before`, which is the original.
   */
  restore(doc: Document): void {
    for (let i = this.cursor - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op) revertOp(doc, op);
    }
  }

  /** Puts the page back to how it was (`on`) or re-applies the edits, keeping the list and cursor. */
  showOriginal(doc: Document, on: boolean): void {
    if (on) this.restore(doc);
    else this.reapply(doc);
  }

  revertAll(doc: Document): void {
    this.restore(doc);
    this.cursor = 0;
  }

  undo(doc: Document): DesignOp | null {
    const op = this.ops[this.cursor - 1];
    if (!op) return null;
    this.restore(doc);
    this.cursor--;
    this.reapply(doc);
    return op;
  }

  redo(doc: Document): DesignOp | null {
    const op = this.ops[this.cursor];
    if (!op) return null;
    if (!op.muted) this.mark(op.id, !applyOp(doc, op));
    this.cursor++;
    return op;
  }

  /** Drops one applied op; the page shows the others as if it had never been made. */
  remove(doc: Document, id: string): DesignOp | null {
    const index = this.ops.findIndex((op) => op.id === id);
    const op = this.ops[index];
    if (!op || index >= this.cursor) return null;
    this.restore(doc);
    this.ops = this.ops.filter((entry) => entry.id !== id);
    this.cursor--;
    this.reapply(doc);
    return op;
  }

  /** Switches one applied op off or back on without dropping it. */
  setMuted(doc: Document, id: string, muted: boolean): DesignOp | null {
    const index = this.ops.findIndex((op) => op.id === id);
    const op = this.ops[index];
    if (!op || index >= this.cursor || Boolean(op.muted) === muted) return null;
    this.restore(doc);
    this.ops = this.ops.map((entry) => (entry.id === id ? { ...entry, muted } : entry));
    this.reapply(doc);
    return op;
  }

  style(doc: Document, element: Element, property: string, authored: string, meta: OpMeta): DesignOp {
    const view = doc.defaultView;
    const style = declaredStyle(element);
    if (!style) throw new Error('Design edits need an HTML element');
    const before = view?.getComputedStyle(element).getPropertyValue(property).trim() ?? '';
    const inlineBefore = style.getPropertyValue(property);
    const inlinePriority = style.getPropertyPriority(property) === 'important' ? 'important' : '';
    style.setProperty(property, authored, 'important');
    const computedAfter = view?.getComputedStyle(element).getPropertyValue(property).trim() || authored;
    return this.push({
      id: this.nextId(),
      kind: 'style',
      target: targetOf(this.assign(element), meta),
      property,
      before,
      after: authored,
      computedAfter,
      inlineBefore,
      inlinePriority,
      stale: false,
    });
  }

  text(element: Element, before: string, after: string, meta: OpMeta): DesignOp {
    element.textContent = after;
    return this.push({
      id: this.nextId(),
      kind: 'text',
      target: targetOf(this.assign(element), meta),
      before,
      after,
      stale: false,
    });
  }

  attr(element: Element, name: string, after: string | null, meta: OpMeta): DesignOp {
    const before = element.getAttribute(name);
    if (after === null) element.removeAttribute(name);
    else element.setAttribute(name, after);
    return this.push({
      id: this.nextId(),
      kind: 'attr',
      target: targetOf(this.assign(element), meta),
      name,
      before,
      after,
      stale: false,
    });
  }

  move(element: Element, parent: Element, index: number, meta: OpMeta): DesignOp | null {
    const origin = element.parentElement;
    if (!origin) return null;
    const before = { parentRef: this.assign(origin), index: childIndex(element) };
    const after = { parentRef: this.assign(parent), index };
    moveElement(element, parent, index);
    return this.push({
      id: this.nextId(),
      kind: 'move',
      target: targetOf(this.assign(element), meta),
      before,
      after,
      stale: false,
    });
  }

  insert(
    doc: Document,
    parent: Element,
    index: number,
    kind: DesignInsertKind,
    meta: OpMeta,
    html: string | null = null,
  ): DesignOp {
    const created = (html ? fromHtml(doc, html) : null) ?? placeholder(doc, kind);
    const ref = this.assign(created);
    moveElement(created, parent, index);
    return this.push({
      id: this.nextId(),
      kind: 'insert',
      target: targetOf(ref, { ...meta, selector: meta.selector }),
      elementKind: kind,
      parentRef: this.assign(parent),
      index,
      html: created.outerHTML,
      stale: false,
    });
  }

  delete(element: Element, meta: OpMeta): DesignOp | null {
    const parent = element.parentElement;
    if (!parent) return null;
    const op: DesignOp = {
      id: this.nextId(),
      kind: 'delete',
      target: targetOf(this.assign(element), meta),
      parentRef: this.assign(parent),
      index: childIndex(element),
      html: element.outerHTML,
      stale: false,
    };
    element.remove();
    return this.push(op);
  }

  duplicate(doc: Document, element: Element, meta: OpMeta): DesignOp | null {
    const parent = element.parentElement;
    if (!parent) return null;
    const copy = element.cloneNode(true);
    if (copy.nodeType !== 1) return null;
    const clone = copy as Element;
    for (const node of [clone, ...Array.from(clone.querySelectorAll(`[${REF_ATTRIBUTE}]`))]) {
      node.removeAttribute(REF_ATTRIBUTE);
    }
    return this.insert(doc, parent, childIndex(element) + 1, 'duplicate', meta, clone.outerHTML);
  }

  private nextId(): string {
    const id = `op-${this.seq}`;
    this.seq++;
    return id;
  }

  private assign(element: Element): string {
    const existing = element.getAttribute(REF_ATTRIBUTE);
    if (existing && /^[0-9]+$/.test(existing)) {
      const n = Number(existing);
      if (n >= this.refSeq) this.refSeq = n + 1;
      return existing;
    }
    const ref = String(this.refSeq);
    this.refSeq++;
    element.setAttribute(REF_ATTRIBUTE, ref);
    return ref;
  }

  private push(op: DesignOp): DesignOp {
    this.ops = [...this.ops.slice(0, this.cursor), op];
    this.cursor = this.ops.length;
    return op;
  }

  private mark(id: string, stale: boolean): void {
    this.ops = this.ops.map((op) => (op.id === id ? { ...op, stale } : op));
  }
}
