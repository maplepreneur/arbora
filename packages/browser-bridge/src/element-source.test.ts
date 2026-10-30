// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { elementSourceFunction, type ElementSourceFacts } from './element-source.js';

describe('elementSourceFunction', () => {
  it('is self-contained and reports the chain and unique classes of `this`', () => {
    document.body.innerHTML = '<div class="card shared"><button class="primary shared">Save  now</button></div>';
    const button = document.querySelector('button');
    const owner = { tag: 0, type: function SaveButton() {}, return: null, child: null, sibling: null, stateNode: null };
    (button as unknown as Record<string, unknown>)['__reactFiber$y'] = {
      tag: 5,
      type: 'button',
      return: owner,
      child: null,
      sibling: null,
      stateNode: button,
    };
    const fn = (0, eval)(`(${elementSourceFunction()})`) as (this: Element) => ElementSourceFacts;
    const facts = fn.call(button as Element);
    expect(facts.components.map((c) => c.name)).toEqual(['SaveButton']);
    expect(facts).toMatchObject({
      tag: 'button',
      id: null,
      classes: ['primary', 'shared'],
      uniqueClasses: ['primary'],
      text: 'Save now',
    });
  });
});
