import type { ModelPrice, ModelPriceOverride } from './usage.js';

export interface ModelPriceRow {
  readonly provider: string;
  readonly label: string;
  readonly matches: readonly string[];
  readonly pricingUrl: string;
  readonly price: ModelPrice;
}

const AS_OF = '2026-11-07';

export const MODEL_PRICE_ROWS: readonly ModelPriceRow[] = [
  {
    provider: 'Anthropic',
    label: 'Claude Opus 5.5',
    matches: ['claude-opus-5-5', 'claude-opus-5.5'],
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'Anthropic',
    label: 'Claude Sonnet 5.5',
    matches: ['claude-sonnet-5-5', 'claude-sonnet-5.5'],
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'Anthropic',
    label: 'Claude Opus 4.5–4.8',
    matches: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5'],
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'Anthropic',
    label: 'Claude Sonnet 4 / 4.5 / 4.6',
    matches: ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4'],
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'Anthropic',
    label: 'Claude Haiku 4.5',
    matches: ['claude-haiku-4-5', 'claude-haiku-4.5'],
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'OpenAI',
    label: 'GPT-5.3 Codex',
    matches: ['gpt-5.3-codex', 'gpt-5-3-codex'],
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    price: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'OpenAI',
    label: 'GPT-6.1 Sol',
    matches: ['gpt-6.1-sol', 'gpt-6-1-sol'],
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'OpenAI',
    label: 'GPT-6.1 Terra',
    matches: ['gpt-6.1-terra', 'gpt-6-1-terra'],
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    price: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'xAI',
    label: 'Grok 4.7',
    matches: ['grok-4.7', 'grok-4-7'],
    pricingUrl: 'https://docs.x.ai/docs/models',
    price: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2, per: 1_000_000, asOf: AS_OF },
  },
  {
    provider: 'OpenCode',
    label: 'DeepSeek v4.1 Flash Free',
    matches: ['deepseek-v4.1-flash-free'],
    pricingUrl: 'https://opencode.ai/docs/models/',
    price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, per: 1_000_000, asOf: AS_OF },
  },
];

export function priceFor(modelId: string, overrides: readonly ModelPriceOverride[] = []): ModelPrice | null {
  const normalized = modelId.toLowerCase();
  const override = overrides.find((candidate) => candidate.modelId.toLowerCase() === normalized);
  if (override) {
    return {
      input: override.input,
      output: override.output,
      cacheRead: override.cacheRead,
      cacheWrite: override.cacheWrite,
      per: 1_000_000,
      asOf: 'custom',
    };
  }
  const match = MODEL_PRICE_ROWS.flatMap((row) =>
    row.matches.filter((alias) => normalized.includes(alias.toLowerCase())).map((alias) => ({ row, alias })),
  ).sort((a, b) => b.alias.length - a.alias.length)[0];
  return match?.row.price ?? null;
}
