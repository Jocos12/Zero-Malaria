import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';
import { Badge } from '../ui';

export type ChatBlock =
  | {
      type: 'patient_card';
      age_months?: number | null;
      sex?: string;
      tdr?: string;
      temperature_c?: number | null;
      fever_days?: number | null;
      signs?: string[];
      decision?: string;
      decision_code?: string;
    }
  | { type: 'checklist'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'bullets'; items: string[]; why_caption?: string };

/** Minimal safe markdown: bold + newlines only (no HTML). */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const parts = (text || '').split(/(\*\*[^*]+\*\*)/g);
  return (
    <div className={cn('max-w-[70ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink', className)}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold">
              {p.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

export function ChatBlocks({
  blocks,
  onReadAloud,
}: {
  blocks?: ChatBlock[];
  onReadAloud?: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (!blocks?.length) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="chat-blocks">
      {blocks.map((b, idx) => {
        if (b.type === 'patient_card') {
          return (
            <div
              key={idx}
              className="rounded-[12px] border border-border bg-surface-muted/50 p-3 text-sm"
              data-testid="chat-patient-card"
            >
              <p className="mb-2 text-[11px] font-semibold uppercase text-ink-muted">
                {t('ai.patientCardTitle')}
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div>
                  <dt className="text-[10px] text-ink-muted">{t('ai.cardAge')}</dt>
                  <dd className="font-medium">{b.age_months ?? t('common.unavailable')}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-ink-muted">{t('ai.cardSex')}</dt>
                  <dd className="font-medium">{b.sex || t('common.unavailable')}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-ink-muted">{t('ai.cardRdt')}</dt>
                  <dd className="font-medium">{b.tdr || t('common.unavailable')}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-ink-muted">{t('ai.cardDecision')}</dt>
                  <dd>
                    <Badge tone="danger" className="normal-case">
                      {b.decision || t('common.unavailable')}
                    </Badge>
                  </dd>
                </div>
              </dl>
              {b.signs?.length ? (
                <p className="mt-2 text-[13px] text-ink-muted">
                  {t('ai.cardSigns')}: {b.signs.join(', ')}
                </p>
              ) : null}
            </div>
          );
        }
        if (b.type === 'checklist') {
          return (
            <ul key={idx} className="space-y-1.5" data-testid="chat-checklist">
              {b.items.slice(0, 5).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[15px]">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" aria-label={item} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'quote') {
          return (
            <blockquote
              key={idx}
              className="rounded-[12px] border-l-4 border-primary bg-primary/5 px-3 py-2 text-[15px] italic"
              data-testid="chat-quote"
            >
              <p>{b.text}</p>
              {onReadAloud ? (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-primary underline"
                  onClick={() => onReadAloud(b.text)}
                >
                  {t('ai.readAloudReply')}
                </button>
              ) : null}
            </blockquote>
          );
        }
        if (b.type === 'bullets') {
          return (
            <ul key={idx} className="list-disc space-y-1 pl-5 text-[15px]" data-testid="chat-bullets">
              {b.items.slice(0, 5).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        return null;
      })}
    </div>
  );
}
