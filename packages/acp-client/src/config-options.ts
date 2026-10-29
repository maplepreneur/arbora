import { z } from 'zod';
import { sessionConfigOptionSchema, type SessionConfigOption } from '@arbora/shared';

/**
 * Model picker synthesised from the pre-`configOptions` `models` field that Claude Code's and
 * Grok's agents still return from `session/new` and `session/load`. Changing it goes through
 * `session/set_model` instead of `session/set_config_option`.
 */
export const LEGACY_MODEL_OPTION_ID = 'arbora:legacy-model';

const legacyModelStateSchema = z.object({
  currentModelId: z.string(),
  availableModels: z.array(
    z.object({ modelId: z.string(), name: z.string(), description: z.string().nullable().optional() }),
  ),
});

const sessionResponseSchema = z.object({
  configOptions: z.array(z.unknown()).nullable().optional(),
  models: legacyModelStateSchema.nullable().optional(),
});

/**
 * The config options a session response offers, with unknown entries dropped and a model option
 * synthesised from legacy `models` when the agent has no `category: 'model'` option of its own.
 */
export function sessionConfigOptions(response: unknown): SessionConfigOption[] {
  const parsed = sessionResponseSchema.safeParse(response);
  if (!parsed.success) return [];
  const options = (parsed.data.configOptions ?? []).flatMap((option) => {
    const result = sessionConfigOptionSchema.safeParse(option);
    return result.success ? [result.data] : [];
  });
  const models = parsed.data.models;
  if (!models || options.some((option) => option.category === 'model')) return options;
  return [
    ...options,
    {
      type: 'select',
      id: LEGACY_MODEL_OPTION_ID,
      name: 'Model',
      category: 'model',
      currentValue: models.currentModelId,
      options: models.availableModels.map((model) => ({
        value: model.modelId,
        name: model.name,
        ...(model.description != null ? { description: model.description } : {}),
      })),
    },
  ];
}

/** `options` with the legacy model option's current value replaced. */
export function withLegacyModel(options: readonly SessionConfigOption[], modelId: string): SessionConfigOption[] {
  return options.map((option) =>
    option.id === LEGACY_MODEL_OPTION_ID && option.type === 'select' ? { ...option, currentValue: modelId } : option,
  );
}
