import { useState } from 'react';
import clsx from 'clsx';
import { fontFamily, MONO_FONT_STACK, SANS_FONT_STACK, UI_SCALE_MAX, UI_SCALE_MIN } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { useApp } from '../../store';
import { inputClass, SectionTitle, SettingRow } from './controls';

const SCALE_PRESETS = [90, 100, 110, 125, 150] as const;

type FontKey = 'interfaceFont' | 'codeFont' | 'agentFont';

function FontInput({ field, placeholder, sample }: { field: FontKey; placeholder: string; sample: string }) {
  const value = useApp((s) => s.settings.appearance[field]);
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    const next = draft.trim();
    if (next !== value) void updateSettings({ appearance: { [field]: next } });
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 truncate text-right text-sm text-fg-muted" style={{ fontFamily: sample }}>
        Aa 0O 1l
      </span>
      <input
        value={draft}
        placeholder={placeholder}
        aria-label={field}
        data-testid={`setting-${field}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        className={clsx(inputClass, 'w-48')}
      />
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  label,
  testId,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      data-testid={testId}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isInteger(next) && next >= min && next <= max) onChange(next);
      }}
      className="h-7 w-16 rounded border border-border bg-bg px-2 text-xs"
    />
  );
}

export function AppearanceSection() {
  const appearance = useApp((s) => s.settings.appearance);
  const editorSize = useApp((s) => s.settings.editor.fontSize);
  const terminalSize = useApp((s) => s.settings.terminal.fontSize);
  return (
    <div>
      <SectionTitle>Size</SectionTitle>
      <SettingRow title="Interface size" detail="Zooms the whole window. The page in the browser panel keeps its size.">
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Interface size"
            className="flex rounded-md border border-border bg-bg-muted p-0.5"
          >
            {SCALE_PRESETS.map((scale) => (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={appearance.uiScale === scale}
                data-testid={`ui-scale-${scale}`}
                onClick={() => void updateSettings({ appearance: { uiScale: scale } })}
                className={clsx(
                  'rounded px-2 py-0.5 text-xs',
                  appearance.uiScale === scale ? 'bg-bg text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
                )}
              >
                {scale}%
              </button>
            ))}
          </div>
          <NumberInput
            value={appearance.uiScale}
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            label="Interface size in percent"
            testId="setting-ui-scale"
            onChange={(uiScale) => void updateSettings({ appearance: { uiScale } })}
          />
        </div>
      </SettingRow>
      <SettingRow title="Agent text size" detail="Messages in agent threads and the prompt box.">
        <NumberInput
          value={appearance.agentFontSize}
          min={10}
          max={24}
          label="Agent text size"
          testId="setting-agent-font-size"
          onChange={(agentFontSize) => void updateSettings({ appearance: { agentFontSize } })}
        />
      </SettingRow>
      <SettingRow title="Editor font size">
        <NumberInput
          value={editorSize}
          min={8}
          max={32}
          label="Editor font size"
          testId="setting-editor-font-size"
          onChange={(fontSize) => void updateSettings({ editor: { fontSize } })}
        />
      </SettingRow>
      <SettingRow title="Terminal font size">
        <NumberInput
          value={terminalSize}
          min={8}
          max={32}
          label="Terminal font size"
          testId="setting-terminal-font-size"
          onChange={(fontSize) => void updateSettings({ terminal: { fontSize } })}
        />
      </SettingRow>
      <SectionTitle>Fonts</SectionTitle>
      <SettingRow title="Interface font" detail="Any installed font. Empty uses the system font.">
        <FontInput
          field="interfaceFont"
          placeholder="System"
          sample={fontFamily(appearance.interfaceFont, SANS_FONT_STACK)}
        />
      </SettingRow>
      <SettingRow
        title="Code font"
        detail="Editor, terminal and code in agent threads. Empty uses Dank Mono when it is installed, then the system monospace font."
      >
        <FontInput field="codeFont" placeholder="Dank Mono" sample={fontFamily(appearance.codeFont, MONO_FONT_STACK)} />
      </SettingRow>
      <SettingRow title="Agent font" detail="Agent messages and the prompt box. Empty follows the interface font.">
        <FontInput
          field="agentFont"
          placeholder="Interface font"
          sample={fontFamily(appearance.agentFont, fontFamily(appearance.interfaceFont, SANS_FONT_STACK))}
        />
      </SettingRow>
    </div>
  );
}
