import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '../api/client';
import { AppOrChwShell, useIsAppRoute } from '../hooks/useAppShell';
import { Button, Card, EmptyState, Skeleton, StatusPill, Timeline } from '../components/ui';
import { db } from '../db';
import type { LocalReferral } from '../types';
import { relativeTime } from '../lib/relativeTime';
import { formatPatientLine } from '../lib/format';
import { listContainer, listItem } from '../lib/motion';
import { useLiveEventRefresh } from '../events/EventContext';

const ORDER = [
  { key: 'sent', labelKey: 'referrals.sent' },
  { key: 'received', labelKey: 'referrals.received' },
  { key: 'arrived', labelKey: 'referrals.arrived' },
  { key: 'treated', labelKey: 'referrals.treated' },
] as const;

export function ReferralsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const isApp = useIsAppRoute();
  const [rows, setRows] = useState<LocalReferral[]>([]);
  const [loading, setLoading] = useState(true);

  const [nowMs] = useState(() => Date.now());
  const triagePath = '/app/triage';
  const alertsPath = isApp ? '/app/alerts' : '/m/alerts';

  const load = useCallback(async () => {
    setLoading(true);
    const local = await db.referrals.orderBy('created_at').reverse().toArray();
    try {
      const remote = await api.referrals({ chw_id: 'CHW-BUG-01-01' });
      const mapped: LocalReferral[] = remote.map((r: any) => ({
        client_uuid: r.client_uuid,
        facility_id: r.facility_id,
        chw_id: r.chw_id,
        district: r.district,
        sector: r.sector,
        age_months: r.age_months,
        sex: r.sex,
        decision: r.decision,
        reasons: r.reasons,
        summary: r.summary,
        status: r.status,
        created_at: r.created_at,
        received_at: r.received_at,
        arrived_at: r.arrived_at,
        treated_at: r.treated_at,
        synced: true,
      }));
      const byUuid = new Map<string, LocalReferral>();
      [...local, ...mapped].forEach((r) => byUuid.set(r.client_uuid, r));
      setRows([...byUuid.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } catch {
      setRows(local);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEventRefresh(load, ['referral.created', 'referral.status_changed', 'referral.message']);

  return (
    <AppOrChwShell title={t('referrals.title')} crumbs={[t('nav.myReferrals')]}>
      {loading ? <Skeleton className="h-40" /> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title={t('referrals.empty')}
          action={<Button onClick={() => navigate(triagePath)}>{t('home.newPatient')}</Button>}
        />
      ) : null}
      <motion.div
        className={isApp ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}
        variants={reduce ? undefined : listContainer}
        initial="initial"
        animate="animate"
      >
        {rows.map((row) => {
          const overdue =
            !row.arrived_at &&
            ['sent', 'received'].includes(row.status) &&
            nowMs - new Date(row.created_at).getTime() > 24 * 3600 * 1000;
          return (
            <motion.div key={row.client_uuid} variants={reduce ? undefined : listItem}>
              <Card>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {formatPatientLine(row.age_months, row.sex, t)}
                    </p>
                    <p className="text-xs text-ink-muted">{relativeTime(row.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill status={row.decision} />
                    <StatusPill status={row.status} />
                  </div>
                </div>
                {overdue ? (
                  <div className="mb-3 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                    {t('referrals.overdueBanner')}
                    <Button className="mt-2 w-full" size="sm" variant="secondary" onClick={() => navigate(alertsPath)}>
                      {t('common.followUp')}
                    </Button>
                  </div>
                ) : null}
                <Timeline
                  current={row.status}
                  steps={ORDER.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
                />
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </AppOrChwShell>
  );
}
