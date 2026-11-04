import type { SessionConfigOption, ThreadState } from '@arbora/shared';

type SelectOption = Extract<SessionConfigOption, { type: 'select' }>;

/** What Shift+Tab rotates: a `mode` config option (ACP's newer form) or the session modes. */
export type ModeControl =
  | { readonly kind: 'config'; readonly option: SelectOption }
  | { readonly kind: 'modes'; readonly current: string; readonly values: readonly { id: string; name: string }[] };

/** What Alt+T rotates: a `thought_level` option, or one named like thinking, reasoning or effort. */
export type ThinkingControl =
  | { readonly kind: 'select'; readonly option: SelectOption }
  | { readonly kind: 'boolean'; readonly option: Extract<SessionConfigOption, { type: 'boolean' }> };

export function selectValues(option: SelectOption): { value: string; name: string }[] {
  return option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
}

export function modeControl(state: Pick<ThreadState, 'configOptions' | 'modes'>): ModeControl | null {
  const option = state.configOptions.find(
    (o): o is SelectOption => o.type === 'select' && o.category === 'mode' && selectValues(o).length > 1,
  );
  if (option) return { kind: 'config', option };
  const modes = state.modes;
  if (modes && modes.availableModes.length > 1) {
    return { kind: 'modes', current: modes.currentModeId, values: modes.availableModes };
  }
  return null;
}

const THINKING_NAME = /think|reason|effort/i;

export type SessionControlRole = 'mode' | 'effort' | 'other';

/** Mode and effort stay named that way when the agent calls the option something else. */
export function sessionControlRole(
  optionId: string,
  mode: ModeControl | null,
  thinking: ThinkingControl | null,
): SessionControlRole {
  if (mode?.kind === 'config' && mode.option.id === optionId) return 'mode';
  if (thinking?.option.id === optionId) return 'effort';
  return 'other';
}

export function sessionControlLabel(name: string, role: SessionControlRole): string {
  switch (role) {
    case 'mode':
      return 'Mode';
    case 'effort':
      return 'Effort';
    case 'other':
      return name;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

export function thinkingControl(state: Pick<ThreadState, 'configOptions'>): ThinkingControl | null {
  const options = state.configOptions;
  const byCategory = options.find((o) => o.category === 'thought_level');
  const byName = options.find(
    (o) => o.category !== 'model' && o.category !== 'mode' && (THINKING_NAME.test(o.id) || THINKING_NAME.test(o.name)),
  );
  const option = byCategory ?? byName;
  if (!option) return null;
  return option.type === 'select' ? { kind: 'select', option } : { kind: 'boolean', option };
}

/** The value after `current`, wrapping around; the first value when `current` is unknown. */
export function nextValue(values: readonly string[], current: string): string | null {
  if (values.length === 0) return null;
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? null;
}

/**
 * The values to try, in order, when rotating past `current`: every other value starting after it
 * and wrapping around, minus the ones the agent already refused.
 */
export function rotationOrder(values: readonly string[], current: string, refused: ReadonlySet<string>): string[] {
  const index = values.indexOf(current);
  const rotated = [...values.slice(index + 1), ...values.slice(0, Math.max(index, 0))];
  return rotated.filter((value) => value !== current && !refused.has(value));
}
