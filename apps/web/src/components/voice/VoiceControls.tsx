import {
  HelpCircle,
  Mic,
  Pause,
  RotateCcw,
  Snail,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton } from '../ui';
import { cn } from '../../lib/cn';
import { useVoice, type VoiceIntents } from '../../voice/VoiceContext';
import type { PhraseId } from '../../voice/phrases';
import type { PlaybackSource } from '../../voice/speak';

function sourceLabel(
  t: (k: string) => string,
  source: PlaybackSource | null,
  lang: 'rw' | 'en',
): string | null {
  if (!source) return null;
  const map: Record<PlaybackSource, string> = {
    audio_pack: lang === 'rw' ? t('voice.sourceAudioPackRw') : t('voice.sourceAudioPack'),
    pindo: t('voice.sourceHumanRw'),
    text: t('voice.sourceText'),
  };
  return map[source];
}

export function VoiceControls({
  phraseIds,
  helpPhraseId,
  className,
  showLabels = false,
  compact = false,
  onTranscriptConfirmed,
  language,
}: {
  phraseIds: PhraseId[];
  helpPhraseId?: PhraseId;
  className?: string;
  showLabels?: boolean;
  compact?: boolean;
  onTranscriptConfirmed?: (payload: { transcript: string; intents: VoiceIntents }) => void;
  /** When rw, mic is experimental (browser STT rarely supports Kinyarwanda). */
  language?: 'rw' | 'en';
}) {
  const { t, i18n } = useTranslation();
  const voice = useVoice();
  const { capabilities, playbackSource, unlocked, mute, state } = voice;
  const lang = language || (i18n.language.startsWith('rw') ? 'rw' : 'en');
  const micExperimental = lang === 'rw';

  const onListen = () => {
    voice.unlock();
    void voice.play(phraseIds, { language: lang });
  };

  const onHelp = () => {
    if (!helpPhraseId) return;
    voice.unlock();
    void voice.play([helpPhraseId], { language: lang });
  };

  const onMic = () => {
    void voice.listen();
  };

  if (!unlocked) {
    // Inline only — never cover the triage question/choices with a full-screen overlay.
    return (
      <div className={cn('space-y-2', className)}>
        <button
          type="button"
          className="w-full rounded-control border border-border bg-surface-muted px-4 py-3 text-left text-sm font-semibold text-ink"
          onClick={() => voice.unlock()}
        >
          {t('voice.unlockTap')}
        </button>
      </div>
    );
  }

  const badge = sourceLabel(t, playbackSource, lang);

  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn('flex flex-wrap items-center gap-2', compact && 'gap-1')}>
        <IconButton
          label={t('voice.tooltipListen')}
          showLabel={showLabels}
          onClick={onListen}
          disabled={state === 'speaking'}
        >
          <Volume2 className="h-4 w-4" aria-hidden />
        </IconButton>
        {capabilities.sttBrowser && !micExperimental ? (
          <IconButton
            label={t('voice.tooltipMic')}
            showLabel={showLabels}
            onClick={onMic}
            disabled={state === 'listening'}
          >
            <Mic className="h-4 w-4" aria-hidden />
          </IconButton>
        ) : null}
        {capabilities.sttBrowser && micExperimental ? (
          <IconButton
            label={`${t('voice.micExperimental')}. ${t('voice.micExperimentalHint')}`}
            showLabel={showLabels}
            onClick={onMic}
            disabled={state === 'listening'}
          >
            <Mic className="h-4 w-4 opacity-70" aria-hidden />
          </IconButton>
        ) : null}
        {helpPhraseId ? (
          <IconButton label={t('voice.help')} showLabel={showLabels} onClick={onHelp}>
            <HelpCircle className="h-4 w-4" aria-hidden />
          </IconButton>
        ) : null}
        <IconButton label={t('voice.tooltipReplay')} showLabel={showLabels} onClick={() => void voice.replay()}>
          <RotateCcw className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={t('voice.tooltipSlower')} showLabel={showLabels} onClick={() => voice.setSlower()}>
          <Snail className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={t('voice.tooltipStop')} showLabel={showLabels} onClick={() => voice.stop()}>
          <Pause className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton
          label={t('voice.tooltipMute')}
          showLabel={showLabels}
          onClick={() => voice.toggleMute()}
        >
          {mute ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </IconButton>
      </div>
      {badge ? (
        <Badge tone="neutral" className="text-[11px]">
          {badge}
        </Badge>
      ) : null}
      {voice.pendingTranscript && voice.state === 'confirming' ? (
        <div className="rounded-control border border-border bg-surface-muted p-3 text-sm">
          <p className="font-semibold">{t('voice.heard')}</p>
          <p className="mt-1">{voice.pendingTranscript}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const heard = voice.confirmHeard();
                if (heard) onTranscriptConfirmed?.(heard);
              }}
            >
              {t('voice.confirmHeard')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => voice.cancelHeard()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
