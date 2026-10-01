import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Users } from 'lucide-react';
import { Orb } from '../components/liquid/alive';
import { motion, useReducedMotion } from 'framer-motion';
import { ChwShell } from '../components/shells';
import { Button, Card, EmptyState, StatusPill } from '../components/ui';
import { db } from '../db';
import type { LocalReferral } from '../types';
import { relativeTime } from '../lib/relativeTime';
import { formatPatientLine } from '../lib/format';
import { listContainer, listItem } from '../lib/motion';

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [recent, setRecent] = useState<LocalReferral[]>([]);
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState(0);

  useEffect(() => {
    void (async () => {
      const refs = await db.referrals.orderBy('created_at').reverse().limit(5).toArray();
      setRecent(refs);
      setPending(refs.filter((r) => r.status === 'sent' || r.status === 'received').length);
      const cutoff = Date.now() - 24 * 3600 * 1000;
      setAlerts(
        refs.filter(
          (r) =>
            !r.arrived_at &&
            ['sent', 'received'].includes(r.status) &&
            new Date(r.created_at).getTime() <= cutoff,
        ).length,
      );
    })();
  }, []);

  return (
    <ChwShell>
      <div className="mb-4">
        <p className="text-sm text-ink-muted">{t('home.chwLabel')} · {t('home.village')}</p>
        <h2 className="mt-1 text-[32px] font-bold leading-tight tracking-[-0.03em] text-ink">{t('home.greeting')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('home.subtitle')}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: t('home.todayPatients'), value: recent.length || 0, tone: 'teal' as const },
          { label: t('home.pendingReferrals'), value: pending, tone: 'sky' as const },
          { label: t('home.openAlerts'), value: alerts, tone: 'amber' as const },
        ].map((s, i) => (
          <Card key={s.label} className="p-3.5">
            <Orb size={22} tone={s.tone} delay={i} />
            <p className="mt-2.5 tabular text-[26px] font-bold leading-none tracking-[-0.03em]">{s.value}</p>
            <p className="text-[11px] text-ink-muted">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-5 bg-[linear-gradient(135deg,rgba(11,60,93,0.08),rgba(20,128,122,0.10))] p-5" hover>
        <div className="flex items-start gap-3">
          <Orb size={48} tone="ocean" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-ink">{t('home.newPatient')}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t('home.subtitle')}</p>
            <Button className="mt-4 w-full" size="lg" onClick={() => navigate('/app/triage')} rightIcon={<ArrowRight className="h-4 w-4" />}>
              {t('home.newPatient')}
            </Button>
          </div>
        </div>
      </Card>

      <h3 className="mb-2.5 px-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('home.recent')}</h3>
      {recent.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" strokeWidth={1.75} />}
          title={t('referrals.empty')}
          description={t('home.subtitle')}
        />
      ) : (
        <motion.div
          className="space-y-2"
          variants={reduce ? undefined : listContainer}
          initial="initial"
          animate="animate"
        >
          {recent.map((row) => (
            <motion.div key={row.client_uuid} variants={reduce ? undefined : listItem}>
              <Card className="flex items-center justify-between gap-3 p-3" hover>
                <div>
                  <p className="text-sm font-semibold">
                    {formatPatientLine(row.age_months, row.sex, t)}
                  </p>
                  <p className="text-xs text-ink-muted">{relativeTime(row.created_at)}</p>
                </div>
                <StatusPill status={row.decision} />
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </ChwShell>
  );
}
