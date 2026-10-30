import {
  DESIGN_STYLE_PROPS,
  type DesignCommand,
  type DesignOp,
  type DesignSelection,
  type DesignState,
  type FrameworkInfo,
} from '@arbora/shared';
import { stableSelector } from '../descriptor.js';
import { edges } from './box-model.js';
import type { PageWindow } from './inspector.js';
import { declaredStyle, elementByRef, findTarget, OpLog, planDrop, type OpMeta } from './ops.js';

/** What the design overlay needs from the browser preload. */
export interface DesignHost {
  /** Component chain (nearest first) and the best source file for an element. */
  chainFor(element: Element): Promise<{ names: string[]; file: string | null; line: number | null }>;
  /** The op list changed, or the selection did. Main persists this. */
  onState(state: DesignState): void;
  /** Escape with nothing selected. */
  onExitRequest(): void;
}

type Edge = 'top' | 'right' | 'bottom' | 'left';
type Drag =
  | {
      kind: 'space';
      edge: Edge;
      box: 'margin' | 'padding';
      pointer: number;
      start: number;
      element: Element;
      inlineBefore: string;
      inlinePriority: '' | 'important';
    }
  | { kind: 'move'; element: Element; x: number; y: number; moved: boolean };

const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
const HIT = 6;

/**
 * Arbora's accent (`--accent` in the renderer's styles.css). The overlay lives in the user's page,
 * which cannot see the app's CSS variables, so the values are repeated here.
 */
const ARBORA = {
  green: '#2f7d5b',
  bright: '#4fb385',
  ink: '#06120c',
} as const;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font: 11px/1.4 ui-sans-serif, system-ui, sans-serif; }
.outline { position: fixed; pointer-events: none; outline: 2px solid ${ARBORA.green}; outline-offset: -1px; }
.outline.primary { background: rgba(47, 125, 91, 0.06); }
.hover { position: fixed; pointer-events: none; outline: 1px solid ${ARBORA.bright}; outline-offset: -1px; }
.hover-label { position: fixed; padding: 1px 5px; background: ${ARBORA.bright}; color: ${ARBORA.ink}; font-size: 10px; white-space: nowrap; }
.handle { position: fixed; pointer-events: auto; box-sizing: border-box; }
.handle.padding { background: rgba(79, 179, 133, 0.22); }
.handle.margin { background: rgba(47, 125, 91, 0.14); background-image: repeating-linear-gradient(45deg, rgba(47, 125, 91, 0.22) 0 2px, transparent 2px 6px); }
.handle.padding:hover { background: rgba(79, 179, 133, 0.42); }
.handle.margin:hover { background-color: rgba(47, 125, 91, 0.3); }
.handle.top, .handle.bottom { cursor: ns-resize; }
.handle.left, .handle.right { cursor: ew-resize; }
.drop { position: fixed; pointer-events: none; background: ${ARBORA.green}; }
.label { position: fixed; max-width: 60vw; padding: 2px 6px; background: ${ARBORA.green}; color: #fff; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.label .name { font-weight: 700; }
.hidden { display: none !important; }
`;

function outward(edge: Edge, box: 'margin' | 'padding', dx: number, dy: number): number {
  switch (edge) {
    case 'top':
      return box === 'margin' ? -dy : dy;
    case 'bottom':
      return dy;
    case 'left':
      return -dx;
    case 'right':
      return dx;
    default: {
      const unreachable: never = edge;
      return unreachable;
    }
  }
}

/**
 * Design mode's in-page overlay. Same host rules as the inspector: a closed shadow root on
 * `<html>`, re-attached if a framework replaces nodes. Clicks select (Shift toggles). Spacing
 * handles write one style op per drag. Double-click edits text. Ops stay on the element as inline
 * `!important` styles until discard or save reverts them.
 */
export class DesignOverlay {
  private active = false;
  private readonly log = new OpLog();
  private readonly selected: Element[] = [];
  private readonly metas = new WeakMap<Element, OpMeta>();
  private editing: Element | null = null;
  private editingBefore = '';
  private drag: Drag | null = null;
  /** Pointer-up already selected; the click that follows must not select again. */
  private justSelected = false;
  private readonly chainToken = new WeakMap<Element, number>();
  private suppress = 0;
  /** Mutations our own ops caused and the observer has not delivered yet. */
  private ownMutations = 0;
  private frame = 0;
  private readonly host: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly label: HTMLElement;
  private readonly drop: HTMLElement;
  private readonly hoverBox: HTMLElement;
  private readonly hoverLabel: HTMLElement;
  private hovered: Element | null = null;
  /** The element of the change row the user is hovering in the panel. */
  private highlighted: Element | null = null;
  private showingOriginal = false;
  private readonly outlines = new Map<Element, HTMLElement>();
  private readonly handles: HTMLElement[] = [];
  private readonly observer: MutationObserver;

  constructor(
    private readonly win: PageWindow,
    private readonly callbacks: DesignHost,
  ) {
    const doc = win.document;
    this.host = doc.createElement('div');
    this.host.setAttribute('data-arbora-design', '');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    this.layer = doc.createElement('div');
    this.layer.className = 'layer';
    this.label = doc.createElement('div');
    this.label.className = 'label hidden';
    this.drop = doc.createElement('div');
    this.drop.className = 'drop hidden';
    this.hoverBox = doc.createElement('div');
    this.hoverBox.className = 'hover hidden';
    this.hoverLabel = doc.createElement('div');
    this.hoverLabel.className = 'hover-label hidden';
    this.layer.append(this.hoverBox, this.hoverLabel);
    for (const box of ['padding', 'margin'] as const) {
      for (const edge of EDGES) {
        const handle = doc.createElement('div');
        handle.className = `handle ${box} ${edge}`;
        handle.dataset['box'] = box;
        handle.dataset['edge'] = edge;
        handle.addEventListener('pointerdown', this.onHandleDown);
        this.handles.push(handle);
        this.layer.append(handle);
      }
    }
    this.layer.append(this.drop, this.label);
    root.append(style, this.layer);
    this.observer = new win.MutationObserver((records) => {
      if (!this.active) return;
      if (!this.host.isConnected) this.attach();
      if (this.suppress > 0 || this.ownMutations > 0) return;
      if (records.every((record) => this.host.contains(record.target))) return;
      this.scheduleReapply();
    });
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'click',
      'dblclick',
      'keydown',
      'contextmenu',
    ] as const) {
      win.addEventListener(type, this.onEvent, { capture: true });
    }
    win.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    win.addEventListener('resize', this.onScroll, { passive: true });
  }

  get on(): boolean {
    return this.active;
  }

  private framework: FrameworkInfo = { id: 'html', react: false, vue: false, reactVersion: null };

  /** Shows the overlay. `saved` is a crash draft to re-apply; ignored when this page already has ops. */
  start(saved: { ops: readonly DesignOp[]; cursor: number } | null, framework?: FrameworkInfo): void {
    if (framework) this.framework = framework;
    this.active = true;
    this.attach();
    if (saved && this.log.ops.length === 0 && saved.ops.length > 0) {
      this.log.load(saved.ops, saved.cursor);
      this.mutate(() => this.log.reapply(this.win.document));
    }
    this.observer.observe(this.win.document.documentElement, { childList: true, subtree: true, characterData: true });
    this.publish();
    this.render();
  }

  /** Hides the overlay. `revert` puts the DOM back; save does that after the after screenshot. */
  stop(revert: boolean): void {
    if (!this.active && this.selected.length === 0 && this.log.cursor === 0) return;
    this.finishText();
    if (revert) this.mutate(() => this.log.revertAll(this.win.document));
    this.active = false;
    this.showingOriginal = false;
    this.hovered = null;
    this.selected.splice(0);
    this.drag = null;
    this.observer.disconnect();
    this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.host.remove();
    this.publish();
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
  }

  command(command: DesignCommand): void {
    if (!this.active) return;
    const primary = this.primary();
    if (command.type === 'showOriginal') {
      if (command.on !== this.showingOriginal) {
        this.finishText();
        this.showingOriginal = command.on;
        this.mutate(() => this.log.showOriginal(this.win.document, command.on));
      }
      this.publish();
      this.render();
      return;
    }
    if (command.type === 'highlightOp') {
      this.highlighted = command.id ? this.opElement(command.id) : null;
      this.render();
      return;
    }
    // While comparing, the page shows the original; edits would land on the wrong DOM.
    if (this.showingOriginal) return;
    switch (command.type) {
      case 'selectOp': {
        const element = this.opElement(command.id);
        if (!element) return;
        this.finishText();
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        this.highlighted = null;
        this.select(element, false);
        return;
      }
      case 'removeOp':
        this.finishText();
        this.mutate(() => this.log.remove(this.win.document, command.id));
        this.highlighted = null;
        this.selected.splice(0, this.selected.length, ...this.selected.filter((el) => el.isConnected));
        break;
      case 'muteOp':
        this.finishText();
        this.mutate(() => this.log.setMuted(this.win.document, command.id, command.muted));
        this.selected.splice(0, this.selected.length, ...this.selected.filter((el) => el.isConnected));
        break;
      case 'undo':
        this.mutate(() => this.log.undo(this.win.document));
        this.selected.splice(0, this.selected.length, ...this.selected.filter((el) => el.isConnected));
        break;
      case 'redo':
        this.mutate(() => this.log.redo(this.win.document));
        break;
      case 'deselect':
        this.finishText();
        this.selected.splice(0);
        break;
      case 'endText':
        this.finishText();
        break;
      case 'style':
        if (!primary) return;
        this.mutate(() =>
          this.log.style(this.win.document, primary, command.property, command.value, this.meta(primary)),
        );
        break;
      case 'text': {
        if (!primary) return;
        const target = this.textTarget(primary);
        this.mutate(() => this.log.text(target, target.textContent, command.value, this.meta(target)));
        break;
      }
      case 'duplicate':
        if (primary) this.mutate(() => this.log.duplicate(this.win.document, primary, this.meta(primary)));
        break;
      case 'delete':
        if (primary) this.removeElement(primary);
        break;
      case 'insert':
        this.insertElement(command.elementKind);
        break;
      case 'selectAncestor': {
        let node: Element | null = primary;
        for (let i = 0; i < command.depth && node; i++) node = node.parentElement;
        if (node && node !== this.win.document.documentElement) {
          this.finishText();
          this.select(node, false);
        }
        return;
      }
      default: {
        const unreachable: never = command;
        throw new Error(`Unhandled design command ${JSON.stringify(unreachable)}`);
      }
    }
    this.publish();
    this.render();
  }

  dispose(): void {
    this.stop(true);
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'click',
      'dblclick',
      'keydown',
      'contextmenu',
    ] as const) {
      this.win.removeEventListener(type, this.onEvent, { capture: true });
    }
    this.win.removeEventListener('scroll', this.onScroll, { capture: true });
    this.win.removeEventListener('resize', this.onScroll);
  }

  private primary(): Element | null {
    return this.selected[this.selected.length - 1] ?? null;
  }

  private meta(element: Element): OpMeta {
    return (
      this.metas.get(element) ?? {
        selector: stableSelector(element),
        componentChain: [],
        sourceFile: null,
        sourceLine: null,
      }
    );
  }

  private mutate(fn: () => void): void {
    this.suppress++;
    this.ownMutations++;
    try {
      fn();
    } finally {
      this.suppress--;
    }
    queueMicrotask(() => {
      this.ownMutations--;
    });
  }

  private attach(): void {
    const html = this.win.document.documentElement;
    if (!this.host.isConnected) html.append(this.host);
  }

  private publish(): void {
    const primary = this.primary();
    const state: DesignState = {
      ops: this.log.ops,
      cursor: this.log.cursor,
      textEditing: this.editing !== null,
      selectionCount: this.selected.length,
      selection: primary && primary.isConnected ? this.snapshot(primary) : null,
      structureWarning: this.log.applied.some(
        (op) => !op.muted && (op.kind === 'move' || op.kind === 'insert' || op.kind === 'delete'),
      ),
      framework: this.framework,
      showingOriginal: this.showingOriginal,
    };
    this.callbacks.onState(state);
  }

  /**
   * The element a change is on. A delete's element is gone (unless switched off), so its parent
   * stands in.
   */
  private opElement(id: string): Element | null {
    const op = this.log.ops.find((entry) => entry.id === id);
    if (!op) return null;
    const own = findTarget(this.win.document, op.target);
    if (own?.isConnected) return own;
    if (op.kind === 'delete') return elementByRef(this.win.document, op.parentRef);
    return null;
  }

  /** `section.card`, the way Webflow names an element in the breadcrumb. */
  private elementLabel(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const first = Array.from(element.classList).find((name) => !name.includes(':') && !name.includes('['));
    return (first ? `${tag}.${first}` : tag).slice(0, 200);
  }

  private ancestorsOf(element: Element): { label: string }[] {
    const out: { label: string }[] = [];
    for (let node = element.parentElement; node && out.length < 12; node = node.parentElement) {
      if (node === this.win.document.documentElement) break;
      out.push({ label: this.elementLabel(node) });
    }
    return out;
  }

  private snapshot(element: Element): DesignSelection {
    const meta = this.meta(element);
    const computed = this.win.getComputedStyle(element);
    const styles: Record<string, string> = {};
    for (const property of DESIGN_STYLE_PROPS) styles[property] = computed.getPropertyValue(property).trim();
    return {
      ref: element.getAttribute('data-arbora-ref') ?? '',
      selector: meta.selector,
      tag: element.tagName.toLowerCase(),
      text: this.textTarget(element).textContent.replace(/\s+/g, ' ').trim().slice(0, 4000),
      componentChain: [...meta.componentChain],
      sourceFile: meta.sourceFile,
      sourceLine: meta.sourceLine,
      styles,
      handles: !this.hasTransform(element),
      ancestors: this.ancestorsOf(element),
    };
  }

  private hasTransform(element: Element): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = this.win.getComputedStyle(node).transform;
      if (value && value !== 'none') return true;
    }
    return false;
  }

  private remember(element: Element): void {
    const token = (this.chainToken.get(element) ?? 0) + 1;
    this.chainToken.set(element, token);
    const selector = stableSelector(element);
    void this.callbacks.chainFor(element).then((chain) => {
      if (!this.active || this.chainToken.get(element) !== token || !this.selected.includes(element)) return;
      this.metas.set(element, {
        selector,
        componentChain: chain.names.slice(0, 30),
        sourceFile: chain.file,
        sourceLine: chain.line,
      });
      if (this.primary() === element) this.publish();
    });
  }

  private readonly onScroll = (): void => {
    if (this.active) this.render();
  };

  private scheduleReapply(): void {
    this.frame ||= this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.active || this.showingOriginal) return;
      this.mutate(() => this.log.reapply(this.win.document));
      this.selected.splice(0, this.selected.length, ...this.selected.filter((el) => el.isConnected));
      this.publish();
      this.render();
    });
  }

  private isOwn(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  private pageElement(target: EventTarget | null): Element | null {
    if (!(target instanceof this.win.Element)) return null;
    if (target === this.host || this.host.contains(target)) return null;
    if (target === this.win.document.documentElement) return this.win.document.body;
    return target;
  }

  private readonly onEvent = (event: Event): void => {
    if (!this.active) return;
    if (this.drag) {
      if (event.type === 'pointermove') this.dragMove(event as PointerEvent);
      else if (event.type === 'pointerup') this.dragEnd(event as PointerEvent);
      if (event.type === 'pointermove' || event.type === 'pointerup') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (this.isOwn(event)) return;
    const keyboard = event.type === 'keydown' ? (event as KeyboardEvent) : null;
    if (this.editing) {
      if (keyboard?.key === 'Enter' && !keyboard.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.finishText();
        this.publish();
      }
      return;
    }
    if (keyboard?.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.selected.length > 0) {
        this.selected.splice(0);
        this.publish();
        this.render();
      } else this.callbacks.onExitRequest();
      return;
    }
    if (keyboard && (keyboard.key === 'Delete' || keyboard.key === 'Backspace') && this.primary()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const primary = this.primary();
      if (primary) this.removeElement(primary);
      this.publish();
      this.render();
      return;
    }
    if (event.type === 'keydown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.type === 'wheel' || event.type === 'scroll') return;
    const target = this.pageElement(event.target);
    if (event.type === 'pointermove') {
      if (target !== this.hovered) {
        this.hovered = target;
        this.render();
      }
      return;
    }
    if (this.showingOriginal) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.type === 'dblclick' && target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.beginText(this.textTarget(target));
      return;
    }
    if (event.type === 'pointerdown' && target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.drag = {
        kind: 'move',
        element: target,
        x: (event as PointerEvent).clientX,
        y: (event as PointerEvent).clientY,
        moved: false,
      };
      return;
    }
    if (event.type === 'click' && target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.justSelected) this.select(target, (event as MouseEvent).shiftKey);
      this.justSelected = false;
      return;
    }
    if (event.type === 'contextmenu') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly onHandleDown = (event: Event): void => {
    if (!this.active || this.editing) return;
    const handle = event.currentTarget;
    const primary = this.primary();
    if (!(handle instanceof this.win.HTMLElement) || !primary) return;
    const edge = handle.dataset['edge'] as Edge | undefined;
    const box = handle.dataset['box'] as 'margin' | 'padding' | undefined;
    if (!edge || !box) return;
    event.preventDefault();
    event.stopPropagation();
    const style = declaredStyle(primary);
    if (!style) return;
    const pointer = event as PointerEvent;
    const property = `${box}-${edge}`;
    const start = Number.parseFloat(this.win.getComputedStyle(primary).getPropertyValue(property)) || 0;
    this.drag = {
      kind: 'space',
      edge,
      box,
      pointer: edge === 'left' || edge === 'right' ? pointer.clientX : pointer.clientY,
      start,
      element: primary,
      inlineBefore: style.getPropertyValue(property),
      inlinePriority: style.getPropertyPriority(property) === 'important' ? 'important' : '',
    };
  };

  private dragMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'space') {
      const delta = (drag.edge === 'left' || drag.edge === 'right' ? event.clientX : event.clientY) - drag.pointer;
      const next = Math.max(0, Math.round(drag.start + outward(drag.edge, drag.box, delta, delta)));
      declaredStyle(drag.element)?.setProperty(`${drag.box}-${drag.edge}`, `${next}px`, 'important');
      this.render();
      return;
    }
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    const under = this.elementAt(event.clientX, event.clientY, drag.element);
    const place = planDrop(drag.element, under, event.clientY);
    if (!place) {
      this.drop.classList.add('hidden');
      return;
    }
    const rect = place.parent.getBoundingClientRect();
    this.drop.classList.remove('hidden');
    this.drop.style.left = `${rect.left}px`;
    this.drop.style.top = `${rect.top}px`;
    this.drop.style.width = `${Math.max(rect.width, 2)}px`;
    this.drop.style.height = '2px';
  }

  private dragEnd(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.drop.classList.add('hidden');
    if (!drag) return;
    if (drag.kind === 'space') {
      const property = `${drag.box}-${drag.edge}`;
      const style = declaredStyle(drag.element);
      const authored = style?.getPropertyValue(property) ?? '';
      if (!drag.inlineBefore && !drag.inlinePriority) style?.removeProperty(property);
      else style?.setProperty(property, drag.inlineBefore, drag.inlinePriority);
      const computed = this.win.getComputedStyle(drag.element).getPropertyValue(property).trim();
      if (authored && authored !== computed) {
        this.mutate(() => this.log.style(this.win.document, drag.element, property, authored, this.meta(drag.element)));
      }
      this.publish();
      this.render();
      return;
    }
    if (!drag.moved) {
      this.justSelected = true;
      this.select(drag.element, event.shiftKey);
      return;
    }
    const place = planDrop(drag.element, this.elementAt(event.clientX, event.clientY, drag.element), event.clientY);
    if (
      place &&
      (place.parent !== drag.element.parentElement ||
        place.index !== Array.from(place.parent.children).indexOf(drag.element))
    ) {
      this.mutate(() => this.log.move(drag.element, place.parent, place.index, this.meta(drag.element)));
    }
    this.publish();
    this.render();
  }

  private elementAt(x: number, y: number, skip: Element): Element | null {
    const list = this.win.document.elementsFromPoint(x, y);
    for (const el of list) {
      if (!(el instanceof this.win.Element)) continue;
      if (el === this.host || this.host.contains(el) || el === skip || skip.contains(el)) continue;
      return el;
    }
    return null;
  }

  private select(element: Element, shift: boolean): void {
    if (shift) {
      const index = this.selected.indexOf(element);
      if (index >= 0) this.selected.splice(index, 1);
      else if (this.selected.length < 50) this.selected.push(element);
    } else {
      this.selected.splice(0, this.selected.length, element);
    }
    if (this.selected.includes(element)) this.remember(element);
    this.publish();
    this.render();
  }

  /** The element a text edit should change: itself when it is a leaf, otherwise its first text-only descendant. */
  private textTarget(element: Element): Element {
    if (element.children.length === 0) return element;
    const walker = this.win.document.createTreeWalker(element, this.win.NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof this.win.Element && node.children.length === 0 && node.textContent.trim()) return node;
      node = walker.nextNode();
    }
    return element;
  }

  private beginText(element: Element): void {
    this.finishText();
    if (!this.selected.includes(element)) this.selected.splice(0, this.selected.length, element);
    this.remember(element);
    this.editing = element;
    this.editingBefore = element.textContent;
    element.setAttribute('contenteditable', 'true');
    if (element instanceof this.win.HTMLElement) element.focus();
    this.publish();
  }

  private finishText(): void {
    const element = this.editing;
    if (!element) return;
    const after = element.textContent;
    this.editing = null;
    element.removeAttribute('contenteditable');
    if (after !== this.editingBefore) {
      this.mutate(() => this.log.text(element, this.editingBefore, after, this.meta(element)));
    }
  }

  private removeElement(element: Element): void {
    this.finishText();
    this.mutate(() => this.log.delete(element, this.meta(element)));
    const index = this.selected.indexOf(element);
    if (index >= 0) this.selected.splice(index, 1);
  }

  private insertElement(kind: 'div' | 'text' | 'image' | 'button'): void {
    const primary = this.primary();
    const parent = primary?.parentElement ?? this.win.document.body;
    const index = primary ? Array.from(parent.children).indexOf(primary) + 1 : parent.children.length;
    this.mutate(() => this.log.insert(this.win.document, parent, index, kind, this.meta(primary ?? parent)));
  }

  private render(): void {
    for (const [element, outline] of this.outlines) {
      if (!this.selected.includes(element) || !element.isConnected) {
        outline.remove();
        this.outlines.delete(element);
      }
    }
    const primary = this.primary();
    for (const element of this.selected) {
      if (!element.isConnected) continue;
      const outline = this.outlines.get(element) ?? this.makeOutline();
      this.outlines.set(element, outline);
      const rect = element.getBoundingClientRect();
      outline.style.left = `${rect.x}px`;
      outline.style.top = `${rect.y}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
      outline.classList.toggle('primary', element === primary);
    }
    const showHandles = primary?.isConnected && !this.hasTransform(primary) && !this.editing && !this.showingOriginal;
    for (const handle of this.handles) handle.classList.toggle('hidden', !showHandles);
    if (primary && showHandles) this.placeHandles(primary);
    if (primary?.isConnected) {
      const rect = primary.getBoundingClientRect();
      const chain = this.meta(primary).componentChain[0];
      this.label.classList.remove('hidden');
      this.label.textContent = '';
      const name = this.win.document.createElement('span');
      name.className = 'name';
      name.textContent = chain ? `${chain} ` : '';
      this.label.append(name, this.win.document.createTextNode(this.elementLabel(primary)));
      this.label.style.left = `${Math.max(0, rect.x)}px`;
      this.label.style.top = `${rect.y >= 20 ? rect.y - 19 : rect.bottom}px`;
    } else this.label.classList.add('hidden');
    this.renderHover(primary);
  }

  /** Thin outline and tag chip under the pointer (or for the hovered change row). */
  private renderHover(primary: Element | null): void {
    const hovered = this.highlighted ?? this.hovered;
    const show =
      Boolean(hovered?.isConnected) &&
      (this.highlighted !== null || hovered !== primary) &&
      !this.drag &&
      !this.editing;
    this.hoverBox.classList.toggle('hidden', !show);
    this.hoverLabel.classList.toggle('hidden', !show);
    if (!show || !hovered) return;
    const rect = hovered.getBoundingClientRect();
    this.hoverBox.style.left = `${rect.x}px`;
    this.hoverBox.style.top = `${rect.y}px`;
    this.hoverBox.style.width = `${rect.width}px`;
    this.hoverBox.style.height = `${rect.height}px`;
    this.hoverLabel.textContent = this.elementLabel(hovered);
    this.hoverLabel.style.left = `${Math.max(0, rect.x)}px`;
    this.hoverLabel.style.top = `${rect.y >= 16 ? rect.y - 15 : rect.bottom}px`;
  }

  private makeOutline(): HTMLElement {
    const outline = this.win.document.createElement('div');
    outline.className = 'outline';
    this.layer.append(outline);
    return outline;
  }

  private placeHandles(element: Element): void {
    const rect = element.getBoundingClientRect();
    const style = this.win.getComputedStyle(element);
    const margin = edges(style, 'margin');
    const padding = edges(style, 'padding');
    for (const handle of this.handles) {
      const edge = handle.dataset['edge'] as Edge;
      const box = handle.dataset['box'] as 'margin' | 'padding';
      const amount = box === 'margin' ? margin[edge] : padding[edge];
      const thick = Math.max(HIT, amount);
      if (edge === 'top' || edge === 'bottom') {
        handle.style.left = `${rect.x}px`;
        handle.style.width = `${rect.width}px`;
        handle.style.height = `${thick}px`;
        handle.style.top = `${edge === 'top' ? rect.y - (box === 'margin' ? thick : 0) : rect.bottom - (box === 'padding' ? thick : 0)}px`;
      } else {
        handle.style.top = `${rect.y}px`;
        handle.style.height = `${rect.height}px`;
        handle.style.width = `${thick}px`;
        handle.style.left = `${edge === 'left' ? rect.x - (box === 'margin' ? thick : 0) : rect.right - (box === 'padding' ? thick : 0)}px`;
      }
    }
  }
}
