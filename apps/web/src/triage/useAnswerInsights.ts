/**
 * Layer-2: debounced, cancellable AI enrichment. Never blocks Continue/Back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { TriageInput } from '../types';
import {
  buildConsistencyWarnings,
  buildLocalAnswerInsights,
  hashSnapshot,
  type AnswerInsight,
  type ConsistencyWarning,
} from './localAnswerInsights';

const DEBOUNCE_MS = 400;
const TIMEOUT_MS = 3000;

type CacheEntry = {
  insights: AnswerInsight[];
  warnings: ConsistencyWarning[];
};

const cache = new Map<string, CacheEntry>();

function uiLang(lang: string): 'rw' | 'en' {
  return lang.startsWith('rw') ? 'rw' : 'en';
}

export function useAnswerInsights(
  form: TriageInput,
  answered: Set<string>,
  language: string,
  online: boolean,
) {
  const lang = uiLang(language);
  const answeredList = useMemo(() => Array.from(answered), [answered]);
  const layer1 = useMemo(
    () => buildLocalAnswerInsights(form, answered, lang),
    [form, answered, lang],
  );
  const localWarnings = useMemo(
    () => buildConsistencyWarnings(form, answered, lang),
    [form, answered, lang],
  );

  const [aiInsights, setAiInsights] = useState<AnswerInsight[]>([]);
  const [aiWarnings, setAiWarnings] = useState<ConsistencyWarning[]>([]);
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const snapshotHash = useMemo(() => hashSnapshot(form, answeredList), [form, answeredList]);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    abortRef.current?.abort();

    if (!online || answeredList.length === 0) {
      setAiInsights([]);
      setAiWarnings([]);
      setPending(false);
      return;
    }

    const cached = cache.get(snapshotHash);
    if (cached) {
      setAiInsights(cached.insights);
      setAiWarnings(cached.warnings);
      setPending(false);
      return;
    }

    setPending(true);
    timerRef.current = window.setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timeout = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      const answers: Record<string, unknown> = {
        age_months: form.age_months,
        sex: form.sex,
        temperature_c: form.temperature_c,
        fever_days: form.fever_days,
        convulsions: form.convulsions,
        unable_to_drink: form.unable_to_drink,
        vomiting_everything: form.vomiting_everything,
        lethargy: form.lethargy,
        severe_breathing_difficulty: form.severe_breathing_difficulty,
        tdr_result: form.tdr_result,
      };

      void api
        .aiAnswerInsight({ answers, language: lang })
        .then((res) => {
          if (ctrl.signal.aborted) return;
          window.clearTimeout(timeout);
          const data = (res?.data || {}) as {
            insights?: Array<Record<string, unknown>>;
            warnings?: Array<Record<string, unknown>>;
          };
          const insights: AnswerInsight[] = Array.isArray(data.insights)
            ? data.insights.map((i) => ({
                field: String(i.field || ''),
                text: String(i.text || ''),
                source: (i.source as AnswerInsight['source']) || 'ai',
                flag: i.flag != null ? String(i.flag) : null,
                contribution: i.contribution != null ? String(i.contribution) : null,
              }))
            : [];
          const warnings: ConsistencyWarning[] = Array.isArray(data.warnings)
            ? data.warnings.map((w) => ({
                id: String(w.id || 'warn'),
                text: String(w.text || ''),
                dismissible: true as const,
              }))
            : [];
          cache.set(snapshotHash, { insights, warnings });
          setAiInsights(insights);
          setAiWarnings(warnings);
          setPending(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          window.clearTimeout(timeout);
          // Keep Layer-1 insights visible; do not wipe the panel on network blip
          setAiInsights([]);
          setAiWarnings([]);
          setPending(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [snapshotHash, online, answeredList.length, form, lang]);

  const mergedInsights = useMemo(() => {
    const byField = new Map<string, AnswerInsight>();
    for (const i of layer1) byField.set(i.field, i);
    for (const i of aiInsights) {
      if (!i.field) continue;
      const prev = byField.get(i.field);
      // Prefer AI text when present but keep rule flag/contribution if richer
      byField.set(i.field, {
        ...(prev || i),
        ...i,
        source: i.source || 'ai',
        text: i.text || prev?.text || '',
      });
    }
    return Array.from(byField.values());
  }, [layer1, aiInsights]);

  const warnings = useMemo(() => {
    const all = [...localWarnings, ...aiWarnings];
    const seen = new Set<string>();
    return all.filter((w) => {
      if (dismissed.has(w.id) || seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
  }, [localWarnings, aiWarnings, dismissed]);

  const dismissWarning = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  };

  return {
    insights: mergedInsights,
    layer1,
    warnings,
    pending,
    onlineEnrichment: online,
    dismissWarning,
    snapshotHash,
  };
}
