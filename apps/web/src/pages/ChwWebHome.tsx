import { ClipboardList, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Orb } from '../components/liquid/alive';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { activityCountsSummary, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { RecordTreatedModal } from '../components/activity/RecordTreatedModal';
import { WebShell } from '../components/shells';
import { ConversationBar } from '../components/voice/ConversationBar';
import { Badge, Button, Card, KpiCard, Skeleton } from '../components/ui';
import { db } from '../db';

async function fetchRemotePatients(): Promise<{ client_uuid?: string; id?: string }[]> {
  try {
    return (await api.scopedReferrals()) as { client_uuid?: string; id?: string }[];
  } catch {
    try {
      return (await api.referrals()) as { client_uuid?: string; id?: string }[];
    } catch {
      return [];
    }
  }
}

async function countMergedPatients(): Promise<number> {
  const remote = await fetchRemotePatients();
  const local = await db.referrals.toArray();
  const seen = new Set<string>();
  for (const r of [...remote, ...local]) {
    const k = String(r.client_uuid || r.id || '');
    if (k) seen.add(k);
  }
  return seen.size;
}

/** Desktop CHW workspace  -  web shell with reduced menu (not a phone frame). */
export function ChwWebHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recordOpen, setRecordOpen] = useState(false);
  const [patientsOpen, setPatientsOpen] = useState<number | null>(null);
  const [seenToday, setSeenToday] = useState<number | null>(null);
  const [treatedToday, setTreatedToday] = useState<number | null>(null);
  const [treatedWeek, setTreatedWeek] = useState<number | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setKpiLoading(true);
    try {
      const [today, week, openCount] = await Promise.all([
        activityCountsSummary({ period: 'today' }).catch(() => null),
        activityCountsSummary({ period: 'week' }).catch(() => null),
        countMergedPatients(),
      ]);
      setPatientsOpen(openCount);
      setSeenToday(today?.combined.patients_seen ?? null);
      setTreatedToday(today?.combined.patients_treated ?? null);
      setTreatedWeek(week?.combined.patients_treated ?? null);
    } catch {
      setPatientsOpen(null);
      setSeenToday(null);
      setTreatedToday(null);
      setTreatedWeek(null);
    } finally {
      setKpiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return (
    <WebShell title={t('nav.home')} crumbs={[t('common.appName'), t('auth.roleChw')]}>
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">
              {t('home.greeting')}
              {user?.display_name ? `, ${user.display_name}` : ''}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {user?.village || t('home.village')} · {user?.district || ''}
            </p>
          </div>
          <Badge tone="warning">{t('common.synthetic')}</Badge>
        </div>

        <Card className="mb-6 overflow-hidden bg-[linear-gradient(135deg,rgba(11,60,93,0.08),rgba(20,128,122,0.10))] p-7">
          <p className="text-[22px] font-bold tracking-[-0.02em] text-ink">{t('home.newPatient')}</p>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">{t('home.subtitle')}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="lg" leftIcon={<Plus className="h-4 w-4" />} onClick={() => navigate('/app/triage')}>
              {t('nav.newTriage')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => navigate('/app/triage?voiceGuide=1')}
            >
              {t('voice.startGuidedTriage')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              leftIcon={<ClipboardList className="h-4 w-4" />}
              onClick={() => setRecordOpen(true)}
            >
              {t('activity.recordButton')}
            </Button>
          </div>
        </Card>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpiLoading ? (
            <>
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </>
          ) : (
            <>
              <KpiCard
                label={t('activity.kpiPatientsOpen')}
                value={patientsOpen ?? 0}
              />
              <KpiCard
                label={t('activity.kpiSeenToday')}
                value={seenToday ?? 0}
              />
              <KpiCard
                label={t('activity.kpiTreatedToday')}
                value={treatedToday ?? 0}
              />
              <KpiCard
                label={t('activity.kpiTreatedWeek')}
                value={treatedWeek ?? 0}
              />
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5" hover>
            <Orb size={40} tone="teal" />
            <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{t('nav.myPatients')}</h3>
            {!kpiLoading && patientsOpen != null ? (
              <p className="mt-1 text-2xl font-bold tabular text-ink">{patientsOpen}</p>
            ) : null}
            <Button variant="outline" className="mt-3" size="sm" onClick={() => navigate('/app/my-patients')}>
              {t('common.continue')}
            </Button>
          </Card>
          <Card className="p-5" hover>
            <Orb size={40} tone="sky" delay={1} />
            <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{t('nav.myReferrals')}</h3>
            {!kpiLoading && patientsOpen != null ? (
              <p className="mt-1 text-2xl font-bold tabular text-ink">{patientsOpen}</p>
            ) : null}
            <Button variant="outline" className="mt-3" size="sm" onClick={() => navigate('/app/my-referrals')}>
              {t('common.continue')}
            </Button>
          </Card>
          <Card className="p-5" hover>
            <Orb size={40} tone="amber" delay={2} />
            <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{t('nav.alerts')}</h3>
            <Button variant="outline" className="mt-3" size="sm" onClick={() => navigate('/app/alerts')}>
              {t('common.continue')}
            </Button>
          </Card>
        </div>

        <ConversationBar onStart={() => navigate('/app/triage?voiceGuide=1')} />
      </div>
      <RecordTreatedModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={() => void loadSummary()}
      />
    </WebShell>
  );
}
