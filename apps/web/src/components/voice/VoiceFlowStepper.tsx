import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';

export type VoiceFlowStep = 'listen' | 'transcribe' | 'think' | 'speak' | 'idle';

const STEPS: VoiceFlowStep[] = ['listen', 'transcribe', 'think', 'speak'];

const LABELS: Record<Exclude<VoiceFlowStep, 'idle'>, { rw: string; enKey: string }> = {
  listen: { rw: 'Ndakumva', enKey: 'voice.stepListen' },
  transcribe: { rw: 'Nandika', enKey: 'voice.stepTranscribe' },
  think: { rw: 'Ndatekereza', enKey: 'voice.stepThink' },
  speak: { rw: 'Ndavuga', enKey: 'voice.stepSpeak' },
};

export function VoiceFlowStepper({
  step,
  provider,
  className,
}: {
  step: VoiceFlowStep;
  provider?: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const rw = i18n.language.startsWith('rw');
  if (step === 'idle') return null;
  return (
    <div
      className={cn('rounded-[12px] border border-border bg-surface/80 px-3 py-2', className)}
      data-testid="voice-flow-stepper"
      role="status"
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {t('voice.howTitle')}
        </p>
        {provider ? (
          <span className="truncate text-[10px] text-ink-muted" data-testid="voice-engine-chip">
            {provider}
          </span>
        ) : null}
      </div>
      <ol className="flex items-center gap-1">
        {STEPS.map((s) => {
          const active = s === step;
          const label = rw ? LABELS[s].rw : t(LABELS[s].enKey);
          return (
            <li
              key={s}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 text-center text-[11px]',
                active ? 'bg-primary/15 font-semibold text-primary' : 'text-ink-muted',
              )}
              data-active={active || undefined}
              data-step={s}
            >
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  active ? 'bg-primary animate-pulse' : 'bg-border',
                )}
                aria-hidden
              />
              <span className="truncate">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[11px] text-ink-muted">{t('voice.howHint')}</p>
    </div>
  );
}
