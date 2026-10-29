import { describe, expect, it } from 'vitest';
import { LEGACY_MODEL_OPTION_ID, sessionConfigOptions, withLegacyModel } from './config-options.js';

const kimiModel = {
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue: 'kimi-code/k3',
  options: [{ value: 'kimi-code/k3', name: 'K3' }],
};

describe('sessionConfigOptions', () => {
  it('keeps the agent config options and drops entries it does not understand', () => {
    expect(sessionConfigOptions({ configOptions: [kimiModel, { type: 'mystery', id: 'x' }] })).toEqual([kimiModel]);
    expect(sessionConfigOptions({ sessionId: 's' })).toEqual([]);
    expect(sessionConfigOptions(null)).toEqual([]);
  });

  it('synthesises a model option from the legacy models field', () => {
    const options = sessionConfigOptions({
      models: {
        currentModelId: 'default',
        availableModels: [
          { modelId: 'default', name: 'Default (recommended)', description: 'Sonnet' },
          { modelId: 'opus', name: 'Opus' },
        ],
      },
    });
    expect(options).toEqual([
      {
        type: 'select',
        id: LEGACY_MODEL_OPTION_ID,
        name: 'Model',
        category: 'model',
        currentValue: 'default',
        options: [
          { value: 'default', name: 'Default (recommended)', description: 'Sonnet' },
          { value: 'opus', name: 'Opus' },
        ],
      },
    ]);
    expect(withLegacyModel(options, 'opus')[0]).toMatchObject({ currentValue: 'opus' });
  });

  it('prefers a real model config option over the legacy field', () => {
    const options = sessionConfigOptions({
      configOptions: [kimiModel],
      models: { currentModelId: 'x', availableModels: [{ modelId: 'x', name: 'X' }] },
    });
    expect(options).toEqual([kimiModel]);
  });
});
