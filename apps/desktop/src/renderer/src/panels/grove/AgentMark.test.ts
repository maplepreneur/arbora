// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_LOGO_IDS } from './agent-logos';
import { AgentMark, agentMonogram } from './AgentMark';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Ids from `BUILT_IN_AGENTS` in packages/acp-client/src/registry.ts. */
const BUILT_IN_AGENT_IDS = ['claude-code', 'codex', 'kimi', 'grok', 'opencode', 'antigravity'] as const;

function mount(name: string, agentId?: string): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(AgentMark, { name, agentId }));
  });
  mounted = root;
  const mark = host.querySelector('[data-testid="agent-mark"]');
  if (!(mark instanceof HTMLElement)) throw new Error('agent mark missing');
  return mark;
}

let mounted: Root | undefined;

describe('AgentMark', () => {
  afterEach(() => {
    act(() => mounted?.unmount());
    mounted = undefined;
    document.body.replaceChildren();
  });

  it('uses a logo for every built-in agent, not the letter fallback', () => {
    expect([...AGENT_LOGO_IDS]).toEqual([...BUILT_IN_AGENT_IDS]);
    for (const agentId of BUILT_IN_AGENT_IDS) {
      const mark = mount('Custom title', agentId);
      expect(mark.getAttribute('data-logo')).toBe('true');
      expect(mark.querySelector('svg')).not.toBeNull();
      expect(mark.textContent.trim()).toBe('');
      act(() => mounted?.unmount());
      mounted = undefined;
      document.body.replaceChildren();
    }
  });

  it('keeps a letter monogram for an unknown agent', () => {
    const mark = mount('OpenCode', 'my-agent');
    expect(mark.getAttribute('data-logo')).toBe('false');
    expect(mark.querySelector('svg')).toBeNull();
    expect(mark.textContent).toBe(agentMonogram('OpenCode'));
    expect(mark.textContent).toBe('OP');
  });

  it('keeps a letter monogram when the agent id is missing', () => {
    const mark = mount('Kimi Code');
    expect(mark.getAttribute('data-logo')).toBe('false');
    expect(mark.textContent).toBe('KC');
  });
});
