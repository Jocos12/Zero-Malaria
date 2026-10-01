import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { WebShell } from '../components/shells';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';

type ActivitySnap = {
  calls?: number;
  fallbacks?: number;
  escalations?: number;
  consults?: number;
  asks?: number;
  rejected_outputs?: number;
  average_latency_ms?: number;
  by_provider?: Record<string, number>;
  synthetic_note?: string;
  as_of?: string;
};

type Ping = {
  provider?: string;
  configured?: boolean;
  reachable?: boolean;
  model?: string;
  pass?: boolean;
  http_status?: number | null;
  reason?: string;
  latency_ms?: number;
};

export function AiActivityPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<ActivitySnap | null>(null);
  const [err, setErr] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pings, setPings] = useState<Ping[] | null>(null);

  useEffect(() => {
    void api
      .aiActivity()
      .then((res) => setData(res as ActivitySnap))
      .catch(() => setErr(true));
  }, []);

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await api.aiHealthTest();
      setPings((res.pings as Ping[]) || []);
    } catch {
      setPings([{ provider: 'error', pass: false, reason: 'request failed' }]);
    } finally {
      setTesting(false);
    }
  };

  return (
    <WebShell title={t('ai.activityTitle')} crumbs={[t('common.appName'), t('ai.activityTitle')]}>
      <PageHeader title={t('ai.activityTitle')} subtitle={t('ai.activitySubtitle')} />
      <p className="mb-4 text-xs text-ink-muted">{t('ai.syntheticMetrics')}</p>
      <div className="mb-4">
        <Button size="sm" onClick={() => void runTest()} loading={testing} data-testid="ai-health-test-btn">
          {t('ai.testConnection')}
        </Button>
      </div>
      {pings ? (
        <Card className="mb-4" data-testid="ai-health-test-results">
          <p className="text-xs font-semibold uppercase text-ink-muted">{t('ai.testConnection')}</p>
          <ul className="mt-2 space-y-2 text-sm">
            {pings.map((p) => (
              <li key={String(p.provider)} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{p.provider}</span>
                <span className={p.pass ? 'text-success' : 'text-warning'}>{p.reason}</span>
                <span className="font-mono text-xs text-ink-muted">
                  {p.model} · {p.latency_ms ?? 0}ms · HTTP {p.http_status ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {err || !data ? (
        <EmptyState icon={<Activity className="h-8 w-8" />} title={t('common.empty')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [t('ai.activityCalls'), data.calls],
            [t('ai.activityFallbacks'), data.fallbacks],
            [t('ai.activityEscalations'), data.escalations],
            [t('ai.activityConsults'), data.consults],
            [t('ai.activityAsks'), data.asks],
            [t('ai.activityRejected'), data.rejected_outputs],
            [t('ai.activityAvgLatency'), `${data.average_latency_ms ?? 0} ms`],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <p className="text-xs font-semibold uppercase text-ink-muted">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value ?? 0}</p>
            </Card>
          ))}
          <Card className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase text-ink-muted">{t('ai.activityProviders')}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(data.by_provider || {}).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="font-mono">{v}</span>
                </li>
              ))}
              {!Object.keys(data.by_provider || {}).length ? (
                <li className="text-ink-muted">{t('common.empty')}</li>
              ) : null}
            </ul>
          </Card>
        </div>
      )}
    </WebShell>
  );
}
