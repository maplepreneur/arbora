// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { describeElement, ElementRefs, stableSelector, trimmedHtml } from './descriptor.js';
import { REF_ATTRIBUTE } from './main-world.js';

afterEach(() => {
  document.body.replaceChildren();
});

function html(markup: string): Element {
  document.body.innerHTML = markup;
  const first = document.body.firstElementChild;
  if (!first) throw new Error('no element');
  return first;
}

describe('trimmedHtml', () => {
  it('keeps three levels, data-* and style, and drops handlers and Arbora refs', () => {
    const el = html(
      `<section class="card" data-testid="c" style="color: red" onclick="x()" ${REF_ATTRIBUTE}="3"><div><p><b>deep</b></p></div></section>`,
    );
    expect(trimmedHtml(el)).toBe(
      '<section class="card" data-testid="c" style="color: red"><div><p>…</p></div></section>',
    );
  });

  it('cuts long text and attribute values and elides script bodies', () => {
    const el = html(`<div title="${'t'.repeat(300)}">${'x'.repeat(300)}<script>alert(1)</script></div>`);
    const out = trimmedHtml(el);
    expect(out).toContain(`title="${'t'.repeat(200)}…"`);
    expect(out).toContain(`${'x'.repeat(200)}…`);
    expect(out).toContain('<script>…</script>');
  });

  it('caps the total size', () => {
    const el = html(`<ul>${'<li>item</li>'.repeat(2000)}</ul>`);
    const out = trimmedHtml(el, { depth: 3, text: 200, attribute: 200, total: 500 });
    expect(out.length).toBeLessThan(600);
    expect(out).toContain('<!-- truncated -->');
  });

  it('escapes text and attribute values', () => {
    const el = html('<p title="a&quot;b">1 &lt; 2</p>');
    expect(trimmedHtml(el)).toBe('<p title="a&quot;b">1 &lt; 2</p>');
  });
});

describe('stableSelector', () => {
  it('prefers a unique id, then a unique data-testid', () => {
    html('<main><button id="go">Go</button><div data-testid="card"><span></span></div></main>');
    expect(stableSelector(document.getElementById('go')!)).toBe('#go');
    expect(stableSelector(document.querySelector('[data-testid="card"]')!)).toBe('[data-testid="card"]');
  });

  it('builds an nth-child path anchored at the nearest unique id', () => {
    html('<div id="root"><ul><li>a</li><li><a>b</a></li></ul></div>');
    const link = document.querySelector('a')!;
    const selector = stableSelector(link);
    expect(selector).toBe('#root > ul:nth-child(1) > li:nth-child(2) > a:nth-child(1)');
    expect(document.querySelector(selector)).toBe(link);
  });

  it('falls back to the document root when no ancestor has an id', () => {
    html('<div><span></span><span></span></div>');
    const span = document.querySelectorAll('span')[1]!;
    const selector = stableSelector(span);
    expect(selector.startsWith('html > body')).toBe(true);
    expect(document.querySelector(selector)).toBe(span);
  });
});

describe('ElementRefs', () => {
  it('assigns incrementing refs once per element and re-applies the attribute', () => {
    const refs = new ElementRefs();
    const a = html('<p></p>');
    const b = document.createElement('p');
    expect(refs.assign(a)).toBe('1');
    expect(refs.assign(b)).toBe('2');
    a.removeAttribute(REF_ATTRIBUTE);
    expect(refs.assign(a)).toBe('1');
    expect(a.getAttribute(REF_ATTRIBUTE)).toBe('1');
    expect(refs.get(b)).toBe('2');
  });
});

describe('describeElement', () => {
  it('lists classes, unique classes, text and selected computed styles', () => {
    html(
      '<div><button class="btn primary" style="display: inline-block">  Save   now </button><i class="btn"></i></div>',
    );
    const button = document.querySelector('button')!;
    const described = describeElement(button, window);
    expect(described.tag).toBe('button');
    expect(described.classes).toEqual(['btn', 'primary']);
    expect(described.uniqueClasses).toEqual(['primary']);
    expect(described.text).toBe('Save now');
    expect(described.styles['display']).toBe('inline-block');
    expect(described.html.startsWith('<button')).toBe(true);
  });
});
