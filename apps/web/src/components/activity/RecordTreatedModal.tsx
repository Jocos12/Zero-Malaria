import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activityCountsList,
  activityCountsSummary,
  activityCountsUpsert,
  type ActivityCountMetrics,
  type ActivityCountRow,
} from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { enqueueActivityCount } from '../../db';
import { cn } from '../../lib/cn';
import { useSync } from '../../sync/SyncContext';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import { Button, Input } from '../ui';

const METRIC_KEYS = [
  'patients_seen',
  'patients_treated',
  'rdt_done',
  'rdt_positive',
  'referred',
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

const LABEL_KEYS: Record<MetricKey, string> = {
  patients_seen: 'activity.patientsSeen',
  patients_treated: 'activity.patientsTreated',
  rdt_done: 'activity.rdtDone',
  rdt_positive: 'activity.rdtPositive',
  referred: 'activity.referred',
};

const EMPTY_METRICS: ActivityCountMetrics = {
  patients_seen: 0,
  patients_treated: 0,
  rdt_done: 0,
  rdt_positive: 0,
  referred: 0,
};

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sumBySource(rows: ActivityCountRow[]): {
  auto: ActivityCountMetrics;
  manual: ActivityCountMetrics;
  combined: ActivityCountMetrics;
} {
  const auto = { ...EMPTY_METRICS };
  const manual = { ...EMPTY_METRICS };
  for (const row of rows) {
    const bucket = row.source === 'auto' ? auto : manual;
    for (const k of METRIC_KEYS) {
      bucket[k] += row[k] ?? 0;
    }
  }
  const combined = { ...EMPTY_METRICS };
  for (const k of METRIC_KEYS) {
    combined[k] = auto[k] + manual[k];
  }
  return { auto, manual, combined };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function RecordTreatedModal({ open, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { push } = useToast();
  const { status, refreshPending, syncNow } = useSync();

  const today = useMemo(() => localTodayIso(), []);

  const [date, setDate] = useState(today);
  const [fields, setFields] = useState<Record<MetricKey, string>>({
    patients_seen: '0',
    patients_treated: '0',
    rdt_done: '0',
    rdt_positive: '0',
    referred: '0',
  });
  const [note, setNote] = useState('');
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MetricKey | 'date', string>>>({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [totals, setTotals] = useState<{
    auto: ActivityCountMetrics;
    manual: ActivityCountMetrics;
    combined: ActivityCountMetrics;
  } | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(false);

  const resetForm = useCallback(() => {
    setDate(today);
    setFields({
      patients_seen: '0',
      patients_treated: '0',
      rdt_done: '0',
      rdt_positive: '0',
      referred: '0',
    });
    setNote('');
    setClientUuid(crypto.randomUUID());
    setVersion(undefined);
    setFieldErrors({});
    setSubmitError('');
  }, [today]);

  const loadManualForDate = useCallback(async (day: string) => {
    try {
      const rows = await activityCountsList({ date_from: day, date_to: day });
      const manual = rows.find((r) => r.source === 'manual');
      if (manual) {
        setClientUuid(manual.client_uuid);
        setVersion(manual.version);
        setFields({
          patients_seen: String(manual.patients_seen),
          patients_treated: String(manual.patients_treated),
          rdt_done: String(manual.rdt_done),
          rdt_positive: String(manual.rdt_positive),
          referred: String(manual.referred),
        });
        setNote(manual.note ?? '');
      } else {
        setClientUuid(crypto.randomUUID());
        setVersion(undefined);
        setFields({
          patients_seen: '0',
          patients_treated: '0',
          rdt_done: '0',
          rdt_positive: '0',
          referred: '0',
        });
        setNote('');
      }
    } catch {
      /* keep current form */
    }
  }, []);

  const refreshTotals = useCallback(async (day: string) => {
    if (status === 'offline') {
      setTotals(null);
      return;
    }
    setTotalsLoading(true);
    try {
      if (day === today) {
        const summary = await activityCountsSummary({ period: 'today' });
        setTotals({
          auto: summary.auto_total,
          manual: summary.manual_total,
          combined: summary.combined,
        });
      } else {
        const rows = await activityCountsList({ date_from: day, date_to: day });
        setTotals(sumBySource(rows));
      }
    } catch {
      setTotals(null);
    } finally {
      setTotalsLoading(false);
    }
  }, [status, today]);

  useEffect(() => {
    if (!open) return;
    resetForm();
    void loadManualForDate(today);
    void refreshTotals(today);
  }, [open, resetForm, loadManualForDate, refreshTotals, today]);

  useEffect(() => {
    if (!open) return;
    void loadManualForDate(date);
    void refreshTotals(date);
  }, [date, open, loadManualForDate, refreshTotals]);

  const validate = (): ActivityCountMetrics | null => {
    const nextErrors: Partial<Record<MetricKey | 'date', string>> = {};
    if (date > today) {
      nextErrors.date = t('activity.errFutureDate');
    }
    const metrics = { ...EMPTY_METRICS };
    for (const key of METRIC_KEYS) {
      const raw = fields[key].trim();
      if (raw === '') {
        nextErrors[key] = t('activity.errInteger');
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 500) {
        nextErrors[key] = t('activity.errInteger');
        continue;
      }
      metrics[key] = n;
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length ? null : metrics;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    const metrics = validate();
    if (!metrics) return;

    if (!user?.chw_code || !user.facility_id) {
      setSubmitError(t('activity.errOfflineChw'));
      return;
    }

    const body = {
      ...metrics,
      client_uuid: clientUuid,
      date,
      note: note.trim() || null,
      version: version ?? null,
    };

    setSaving(true);
    try {
      if (status === 'offline') {
        await enqueueActivityCount({
          ...body,
          chw_id: user.chw_code,
          facility_id: user.facility_id,
        });
        await refreshPending();
        push(t('activity.savedOffline'), 'info');
        onSaved?.();
        onClose();
        return;
      }

      const row = await activityCountsUpsert(body);
      setVersion(row.version);
      push(t('activity.saved'), 'success');
      void refreshTotals(date);
      onSaved?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('version_conflict') || msg.includes('409')) {
        setSubmitError(t('activity.errVersionConflict'));
        void loadManualForDate(date);
      } else if (msg.includes('future_date')) {
        setFieldErrors((prev) => ({ ...prev, date: t('activity.errFutureDate') }));
      } else {
        setSubmitError(t('common.error'));
      }
    } finally {
      setSaving(false);
      if (status !== 'offline') void syncNow();
    }
  };

  const dirty =
    note.trim() !== '' ||
    METRIC_KEYS.some((k) => fields[k] !== '0') ||
    date !== today;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('activity.recordTitle')}
      size="md"
      dirty={dirty}
      testId="record-treated-modal"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="record-treated-form" loading={saving}>
            {t('activity.submit')}
          </Button>
        </>
      }
    >
      <form id="record-treated-form" className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <label className="block text-xs font-semibold text-ink-muted">
          {t('activity.date')}
          <Input
            className="mt-1"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {fieldErrors.date ? (
            <p className="mt-1 text-xs font-medium text-danger">{fieldErrors.date}</p>
          ) : null}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {METRIC_KEYS.map((key) => (
            <label key={key} className="block text-xs font-semibold text-ink-muted">
              {t(LABEL_KEYS[key])}
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={500}
                step={1}
                inputMode="numeric"
                value={fields[key]}
                onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
              />
              {fieldErrors[key] ? (
                <p className="mt-1 text-xs font-medium text-danger">{fieldErrors[key]}</p>
              ) : null}
            </label>
          ))}
        </div>

        <label className="block text-xs font-semibold text-ink-muted">
          {t('activity.note')}
          <textarea
            className={cn(
              'mt-1 min-h-[88px] w-full resize-y rounded-control border border-transparent bg-[rgba(118,118,128,0.1)] px-4 py-3 text-[16px] text-ink placeholder:text-ink-muted/80 focus:border-accent/50 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-accent/15',
            )}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('activity.notePlaceholder')}
          />
        </label>

        <div className="rounded-card border border-border bg-surface/60 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t('activity.totalsHeading')}
          </p>
          {totalsLoading ? (
            <p className="mt-2 text-ink-muted">{t('common.loading')}</p>
          ) : totals ? (
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-ink-muted">{t('activity.autoTotal')}</dt>
                <dd className="font-semibold tabular text-ink">{totals.auto.patients_treated}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('activity.manualTotal')}</dt>
                <dd className="font-semibold tabular text-ink">{totals.manual.patients_treated}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('activity.combinedTotal')}</dt>
                <dd className="font-semibold tabular text-ink">{totals.combined.patients_treated}</dd>
              </div>
            </dl>
          ) : status === 'offline' ? (
            <p className="mt-2 text-xs text-ink-muted">{t('activity.totalsOffline')}</p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">{t('common.error')}</p>
          )}
        </div>

        {submitError ? <p className="text-sm font-medium text-danger">{submitError}</p> : null}
      </form>
    </Modal>
  );
}
