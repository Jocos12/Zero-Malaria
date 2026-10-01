import { Pause, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui';
import { cn } from '../../lib/cn';
import type { ReadAloudPrefs } from '../../voice/readAloudPrefs';
import {
  getSpeed,
  setPlaybackGainBoost,
  setPlaybackVolume,
  setSpeed,
  type VoiceSpeed,
} from '../../voice/speak';
import { useVoice } from '../../voice/VoiceContext';

/** Compact triage voice prefs — primary Read control lives on the question card. */
export function TriageReadAloudBar({
  className,
  prefs,
  onPrefsChange,
}: {
  className?: string;
  prefs: ReadAloudPrefs;
  onPrefsChange: (next: ReadAloudPrefs) => void;
  /** @deprecated kept optional for call-site compatibility */
  onReadQuestion?: () => void;
  onReadAll?: () => void;
}) {
  const { t } = useTranslation();
  const voice = useVoice();
  const speed = getSpeed();
  const speaking = voice.state === 'speaking';

  const syncAudioLevels = useCallback((p: ReadAloudPrefs) => {
    setPlaybackVolume(p.volume);
    setPlaybackGainBoost(p.gainBoost);
  }, []);

  useEffect(() => {
    syncAudioLevels(prefs);
  }, [prefs, syncAudioLevels]);

  const patch = (next: Partial<ReadAloudPrefs>) => {
    onPrefsChange({ ...prefs, ...next });
  };

  const toggleEnabled = () => {
    voice.unlock();
    const enabled = !prefs.enabled;
    if (!enabled) voice.stop();
    patch({ enabled });
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface-muted px-3 py-2',
        className,
      )}
      data-testid="triage-read-aloud-bar"
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border"
          checked={prefs.enabled}
          onChange={toggleEnabled}
          data-testid="triage-read-aloud-toggle"
        />
        <span>{t('triage.readQuestionsAloud')}</span>
      </label>

      <label className="flex items-center gap-1.5 text-xs">
        <Volume2 className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={prefs.volume}
          className="w-20"
          aria-label={t('triage.readAloudVolume')}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
      </label>

      <div className="flex items-center gap-0.5 text-xs">
        {(['0.75', '1', '1.25'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={cn(
              'rounded px-1.5 py-0.5 font-semibold',
              String(speed) === v ? 'bg-primary text-white' : 'text-ink-muted hover:bg-surface',
            )}
            onClick={() => setSpeed(Number(v) as VoiceSpeed)}
          >
            {v}×
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {speaking ? (
          <IconButton label={t('voice.tooltipStop')} onClick={() => voice.stop()}>
            <Pause className="h-4 w-4" aria-hidden />
          </IconButton>
        ) : null}
        <IconButton label={t('voice.tooltipMute')} onClick={() => voice.toggleMute()}>
          {voice.mute ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}
