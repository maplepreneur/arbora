import { Play } from 'lucide-react';
import { CLASSIC_SOUND_IDS, NATURE_SOUND_IDS, type SoundId, type SoundSettings } from '@arbora/shared';
import { updateSettings } from '../../settings-client';
import { playSound, SOUND_LABELS } from '../../sounds';
import { useApp } from '../../store';
import { SectionTitle, SettingRow, Toggle } from './controls';

type SoundEvent = 'permission' | 'finished' | 'failed';

const EVENTS: readonly { id: SoundEvent; title: string; detail: string }[] = [
  { id: 'permission', title: 'Needs you', detail: 'A permission card or a login is waiting.' },
  { id: 'finished', title: 'Finished', detail: 'A turn ended (not when you stopped it).' },
  { id: 'failed', title: 'Failed', detail: 'The agent crashed or a request failed.' },
];

function SoundPicker({ event, sounds }: { event: SoundEvent; sounds: SoundSettings }) {
  const value = sounds[event];
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label={`Sound for ${event}`}
        data-testid={`sound-${event}`}
        value={value}
        disabled={!sounds.enabled}
        onChange={(e) => {
          const next = e.target.value as SoundId;
          void updateSettings({ sounds: { [event]: next } });
          playSound(next, sounds.volume);
        }}
        className="h-7 rounded border border-border bg-bg px-1.5 text-xs disabled:opacity-50"
      >
        <option value="none">{SOUND_LABELS.none}</option>
        <optgroup label="Nature">
          {NATURE_SOUND_IDS.map((id) => (
            <option key={id} value={id}>
              {SOUND_LABELS[id]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Classic">
          {CLASSIC_SOUND_IDS.map((id) => (
            <option key={id} value={id}>
              {SOUND_LABELS[id]}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        type="button"
        aria-label={`Play the ${event} sound`}
        disabled={!sounds.enabled || value === 'none'}
        onClick={() => playSound(value, sounds.volume)}
        className="rounded border border-border p-1 text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Play size={11} />
      </button>
    </div>
  );
}

/** Notifications and sounds for agent threads (Solo/Herdr-style "an agent needs you"). */
export function NotificationsSection() {
  const notifications = useApp((s) => s.settings.notifications);
  const sounds = useApp((s) => s.settings.sounds);
  const platform = useApp((s) => s.info.platform);
  return (
    <div data-testid="notifications-section">
      <p className="mb-2 text-sm text-fg-muted">
        Agents keep working while you look at the page or another thread. Arbora tells you when one waits for
        permission, finishes or fails, and the bell in the title bar jumps to it.
      </p>
      <SectionTitle>Desktop notifications</SectionTitle>
      <SettingRow title="Show notifications" detail="Click one to bring Arbora forward on that thread.">
        <Toggle
          on={notifications.enabled}
          label="Show notifications"
          testId="setting-notifications"
          onChange={(on) => void updateSettings({ notifications: { enabled: on } })}
        />
      </SettingRow>
      {EVENTS.map((event) => (
        <SettingRow key={event.id} title={event.title} detail={event.detail}>
          <Toggle
            on={notifications[event.id]}
            label={`Notify when ${event.title.toLowerCase()}`}
            onChange={(on) => void updateSettings({ notifications: { [event.id]: on } })}
          />
        </SettingRow>
      ))}
      <SettingRow
        title="Also while Arbora has focus"
        detail="Off: only when Arbora is in the background. The thread you are reading never notifies."
      >
        <Toggle
          on={notifications.whenFocused}
          label="Notify while focused"
          onChange={(on) => void updateSettings({ notifications: { whenFocused: on } })}
        />
      </SettingRow>
      <SettingRow
        title={platform === 'darwin' ? 'Dock badge' : 'Taskbar badge and flash'}
        detail="The number of threads that need you, and a flash of the window while it is in the background."
      >
        <Toggle
          on={notifications.badge}
          label="Badge"
          onChange={(on) => void updateSettings({ notifications: { badge: on } })}
        />
      </SettingRow>
      {platform === 'linux' && (
        <p className="pt-2 text-[11px] text-fg-subtle">
          Linux needs a notification daemon (mako, dunst, swaync; Omarchy ships mako). Without one Arbora keeps the
          badge and sounds.
        </p>
      )}

      <SectionTitle>Sounds</SectionTitle>
      <SettingRow title="Play sounds" detail="Short synthesized cues; nothing is downloaded.">
        <Toggle
          on={sounds.enabled}
          label="Play sounds"
          testId="setting-sounds"
          onChange={(on) => void updateSettings({ sounds: { enabled: on } })}
        />
      </SettingRow>
      <SettingRow title="Volume">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Sound volume"
          value={sounds.volume}
          disabled={!sounds.enabled}
          onChange={(e) => void updateSettings({ sounds: { volume: Number(e.target.value) } })}
          onPointerUp={() => playSound(sounds.finished === 'none' ? 'chime' : sounds.finished, sounds.volume)}
          className="w-36 accent-[var(--accent)]"
        />
        <span className="w-8 text-right text-xs tabular-nums text-fg-subtle">{sounds.volume}</span>
      </SettingRow>
      {EVENTS.map((event) => (
        <SettingRow key={event.id} title={event.title} detail={event.detail}>
          <SoundPicker event={event.id} sounds={sounds} />
        </SettingRow>
      ))}
      <SettingRow
        title="Also for the thread on screen"
        detail="Off: the thread you are reading in a focused window stays quiet."
      >
        <Toggle
          on={sounds.whenFocused}
          label="Sounds for the visible thread"
          onChange={(on) => void updateSettings({ sounds: { whenFocused: on } })}
        />
      </SettingRow>
    </div>
  );
}
