import type { ElementDescriptor, Rect } from '@arbora/shared';
import { REF_ATTRIBUTE } from './main-world.js';

/** The computed styles the prompt includes (the ones people ask agents to change). */
export const DESCRIBED_STYLES = [
  'display',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'padding',
  'margin',
  'border',
  'border-radius',
  'width',
  'height',
] as const;

export interface HtmlLimits {
  readonly depth: number;
  readonly text: number;
  readonly attribute: number;
  readonly total: number;
}

export const HTML_LIMITS: HtmlLimits = { depth: 3, text: 200, attribute: 200, total: 6000 };

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
const OPAQUE_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * `outerHTML` trimmed for a prompt: `depth` levels of elements, text and attribute values cut,
 * event-handler attributes and Arbora's own ref dropped, script/style bodies elided, and the whole
 * string capped at `total` characters.
 */
export function trimmedHtml(element: Element, limits: HtmlLimits = HTML_LIMITS): string {
  const state = { out: '', truncated: false };
  const write = (chunk: string): boolean => {
    if (state.truncated) return false;
    if (state.out.length + chunk.length > limits.total) {
      state.truncated = true;
      return false;
    }
    state.out += chunk;
    return true;
  };
  const visit = (node: Node, depth: number): void => {
    if (state.truncated) return;
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (text.trim()) write(escapeText(cut(text, limits.text)));
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attributes = Array.from(el.attributes)
      .filter((a) => !/^on/i.test(a.name) && a.name !== REF_ATTRIBUTE)
      .map((a) => (a.value === '' ? ` ${a.name}` : ` ${a.name}="${escapeAttribute(cut(a.value, limits.attribute))}"`))
      .join('');
    if (!write(`<${tag}${attributes}>`)) return;
    if (VOID_ELEMENTS.has(tag)) return;
    const children = Array.from(el.childNodes).filter(
      (c) => c.nodeType === ELEMENT_NODE || (c.nodeType === TEXT_NODE && (c.textContent ?? '').trim()),
    );
    if (children.length > 0) {
      if (OPAQUE_ELEMENTS.has(tag) || depth + 1 >= limits.depth) write('…');
      else for (const child of children) visit(child, depth + 1);
    }
    write(`</${tag}>`);
  };
  visit(element, 0);
  return state.truncated ? `${state.out}\n<!-- truncated -->` : state.out;
}

function isSimpleIdent(value: string): boolean {
  return /^[A-Za-z][\w-]*$/.test(value);
}

function attributeSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

function unique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/**
 * A selector that finds `element` again after a re-render: a unique id, else a unique
 * `data-testid`, else an `nth-child` path from the nearest ancestor with a unique id (or `html`).
 */
export function stableSelector(element: Element): string {
  const doc = element.ownerDocument;
  const own = (el: Element): string | null => {
    if (el.id) {
      const selector = isSimpleIdent(el.id) ? `#${el.id}` : attributeSelector('id', el.id);
      if (unique(doc, selector)) return selector;
    }
    const testId = el.getAttribute('data-testid');
    if (testId) {
      const selector = attributeSelector('data-testid', testId);
      if (unique(doc, selector)) return selector;
    }
    return null;
  };
  const direct = own(element);
  if (direct) return direct;
  const parts: string[] = [];
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el !== element) {
      const anchor = own(el);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
    }
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const index = Array.from(parent.children).indexOf(el) + 1;
    parts.unshift(`${tag}:nth-child(${index})`);
  }
  return parts.join(' > ');
}

/**
 * Assigns `data-arbora-ref` ids, only to selected elements (never on hover, which would mutate
 * the page on every mouse move). A WeakMap keeps the id stable for a node React or Vue reuses.
 */
export class ElementRefs {
  private readonly refs = new WeakMap<Element, string>();
  private next = 1;

  assign(element: Element): string {
    let ref = this.refs.get(element);
    if (!ref) {
      ref = String(this.next++);
      this.refs.set(element, ref);
    }
    if (element.getAttribute(REF_ATTRIBUTE) !== ref) element.setAttribute(REF_ATTRIBUTE, ref);
    return ref;
  }

  get(element: Element): string | undefined {
    return this.refs.get(element);
  }
}

function toRect(box: DOMRect): Rect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** The element-level part of a selection (works in the isolated world: DOM and styles only). */
export function describeElement(element: Element, win: Window): ElementDescriptor {
  const doc = element.ownerDocument;
  const classes = Array.from(element.classList).slice(0, 50);
  const uniqueClasses = classes.filter((c) => doc.getElementsByClassName(c).length === 1);
  const computed = win.getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const property of DESCRIBED_STYLES) {
    const value = computed.getPropertyValue(property).trim();
    if (value) styles[property] = cut(value, 300);
  }
  const text = cut(element.textContent.replace(/\s+/g, ' ').trim(), 200);
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: classes.map((c) => cut(c, 200)),
    uniqueClasses: uniqueClasses.map((c) => cut(c, 200)),
    text,
    html: trimmedHtml(element),
    styles,
    rect: toRect(element.getBoundingClientRect()),
  };
}
