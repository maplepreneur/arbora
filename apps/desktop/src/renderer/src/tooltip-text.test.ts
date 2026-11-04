import { describe, expect, it } from 'vitest';
import { splitTooltip } from './tooltip-text';

describe('splitTooltip', () => {
  it('pulls a trailing chord out as the shortcut', () => {
    expect(splitTooltip('Switch project (Ctrl+Alt+O)')).toEqual({ label: 'Switch project', shortcut: 'Ctrl+Alt+O' });
    expect(splitTooltip('Agent mode (⌘K)')).toEqual({ label: 'Agent mode', shortcut: '⌘K' });
    expect(splitTooltip('Landmarks (F6)')).toEqual({ label: 'Landmarks', shortcut: 'F6' });
  });

  it('keeps other parentheses in the label', () => {
    expect(splitTooltip('Stop the agent (Esc in the composer)')).toEqual({
      label: 'Stop the agent (Esc in the composer)',
      shortcut: null,
    });
    expect(splitTooltip('ACP log')).toEqual({ label: 'ACP log', shortcut: null });
  });
});
