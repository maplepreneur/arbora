export interface PickerOption {
  readonly value: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  /** Section heading; options without one go first, under no heading. */
  readonly group?: string | null | undefined;
}

export interface PickerGroup {
  readonly group: string | null;
  readonly options: readonly PickerOption[];
}

const PROVIDER_PREFIX = /^([^/\s]+)\/(.+)$/;

/**
 * Splits `provider/Model` names into a group and a short name when most options use that form
 * (OpenCode lists every provider's models in one flat select). Options that already have a
 * group are left alone.
 */
export function withProviderGroups(options: readonly PickerOption[]): PickerOption[] {
  if (options.length < 4 || options.some((o) => o.group)) return [...options];
  const prefixed = options.filter((o) => PROVIDER_PREFIX.test(o.name)).length;
  if (prefixed / options.length < 0.6) return [...options];
  return options.map((option) => {
    const match = PROVIDER_PREFIX.exec(option.name);
    return match?.[1] && match[2] ? { ...option, group: match[1], name: match[2] } : option;
  });
}

/** Options matching every whitespace-separated term (name, group, value or description), in order. */
export function filterOptions(options: readonly PickerOption[], query: string): PickerOption[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = [option.name, option.group ?? '', option.value, option.description ?? ''].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Groups in first-seen order, ungrouped options first. */
export function groupOptions(options: readonly PickerOption[]): PickerGroup[] {
  const groups = new Map<string | null, PickerOption[]>();
  const ungrouped = options.filter((o) => !o.group);
  if (ungrouped.length > 0) groups.set(null, ungrouped);
  for (const option of options) {
    if (!option.group) continue;
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  return [...groups.entries()].map(([group, list]) => ({ group, options: list }));
}
