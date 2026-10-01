import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Siren,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MapContainer, CircleMarker, Popup, TileLayer } from 'react-leaflet';
import { motion } from 'framer-motion';
import { activityCountsSummary, api } from '../api/client';
import { DesktopShell } from '../components/shells';
import {
  Badge,
  Button,
  Card,
  KpiCard,
  PageHeader,
  Select,
  Skeleton,
  SyntheticBadge,
} from '../components/ui';
import { cn } from '../lib/cn';
import 'leaflet/dist/leaflet.css';

const DISTRICTS = [
  { name: 'Nyagatare', lat: -1.38, lon: 30.32 },
  { name: 'Bugesera', lat: -2.18, lon: 30.14 },
  { name: 'Kirehe', lat: -2.27, lon: 30.66 },
  { name: 'Gisagara', lat: -2.6, lon: 29.85 },
  { name: 'Rusizi', lat: -2.49, lon: 29.0 },
  { name: 'Gasabo', lat: -1.91, lon: 30.09 },
];

const MOCK_KPIS = {
  cases_today: 42,
  urgent_referrals: 11,
  referral_completion_rate: 0.74,
  avg_arrival_delay_hours: 6.2,
  active_alerts: 3,
};

const MOCK_SURGE = {
  cases_today: 42,
  urgent_referrals: 11,
  series: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    cases: 8 + Math.round(6 * Math.sin(i / 4)) + (i > 20 ? 10 : 0),
  })),
  forecast: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    baseline: 12,
    low: 8,
    high: 16,
  })),
  by_district: {
    Nyagatare: 180,
    Bugesera: 140,
    Kirehe: 90,
    Gisagara: 70,
    Rusizi: 60,
    Gasabo: 35,
  },
};

const MOCK_FUNNEL = {
  live_referrals: { referred: 24, received: 18, arrived: 14, treated: 11 },
};

const MOCK_STOCK = {
  cells: [
    { facility_name: 'Nyamata HC', commodity: 'ACT', weeks_of_cover: 0, stockout: true, risk: 'stockout' },
    { facility_name: 'Nyamata HC', commodity: 'RDT', weeks_of_cover: 4.2, stockout: false, risk: 'ok' },
    { facility_name: 'Karangazi HC', commodity: 'injectable_artesunate', weeks_of_cover: 0, stockout: true, risk: 'stockout' },
    { facility_name: 'Rilima HC', commodity: 'ACT', weeks_of_cover: 0, stockout: true, risk: 'stockout' },
    { facility_name: 'Matimba HC', commodity: 'RDT', weeks_of_cover: 1.1, stockout: false, risk: 'low' },
    { facility_name: 'Mayange HC', commodity: 'ACT', weeks_of_cover: 3.4, stockout: false, risk: 'ok' },
  ],
};

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setN(Math.round(from + (value - from) * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value]);
  return <span className="tabular">{n.toLocaleString()}</span>;
}

export function RbcPage() {
  const { t } = useTranslation();
  const [district, setDistrict] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [kpis, setKpis] = useState(MOCK_KPIS);
  const [surge, setSurge] = useState(MOCK_SURGE);
  const [funnel, setFunnel] = useState(MOCK_FUNNEL);
  const [stock, setStock] = useState(MOCK_STOCK);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [hotspotSignals, setHotspotSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoOnly, setDemoOnly] = useState(false);
  const [treatedToday, setTreatedToday] = useState<number | null>(null);
  const [treatedWeek, setTreatedWeek] = useState<number | null>(null);
  const [treatedAutoToday, setTreatedAutoToday] = useState<number | null>(null);
  const [treatedManualToday, setTreatedManualToday] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const hotspotParams: Record<string, string> = {};
      if (district) hotspotParams.district = district;

      const loadHotspots = async () => {
        if (!online) {
          setHotspotSignals([]);
          return;
        }
        try {
          const hs = await api.hotspots(hotspotParams);
          setHotspotSignals(Array.isArray(hs?.signals) ? hs.signals : []);
        } catch {
          setHotspotSignals([]);
        }
      };

      const loadActivity = async () => {
        if (!online) {
          setTreatedToday(null);
          setTreatedWeek(null);
          setTreatedAutoToday(null);
          setTreatedManualToday(null);
          return;
        }
        try {
          const activityParams = district ? { district } : undefined;
          const [todaySum, weekSum] = await Promise.all([
            activityCountsSummary({ period: 'today', ...activityParams }),
            activityCountsSummary({ period: 'week', ...activityParams }),
          ]);
          setTreatedToday(todaySum.combined.patients_treated);
          setTreatedWeek(weekSum.combined.patients_treated);
          setTreatedAutoToday(todaySum.auto_total.patients_treated);
          setTreatedManualToday(todaySum.manual_total.patients_treated);
        } catch {
          setTreatedToday(null);
          setTreatedWeek(null);
          setTreatedAutoToday(null);
          setTreatedManualToday(null);
        }
      };

      try {
        const params: Record<string, string> = {};
        if (district) params.district = district;
        if (ageGroup) params.age_group = ageGroup;
        const [k, s, f, st, a] = await Promise.all([
          api.kpis(district || undefined),
          api.surge(params),
          api.funnel(district || undefined),
          api.stock(district ? { district } : undefined),
          api.alerts(),
          loadHotspots(),
          loadActivity(),
        ]);
        setKpis(k);
        setSurge(s);
        setFunnel(f);
        setStock(st);
        setAlerts(a);
        setDemoOnly(false);
      } catch {
        setDemoOnly(true);
        setKpis(MOCK_KPIS);
        setSurge(MOCK_SURGE);
        setFunnel(MOCK_FUNNEL);
        setStock(MOCK_STOCK);
        setAlerts([{ message: t('alerts.notArrived'), referral: { client_uuid: 'demo' } }]);
        await loadHotspots();
        await loadActivity();
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [district, ageGroup, t]);

  const chartData = useMemo(() => {
    const hist = (surge.series || []).map((p: any) => ({
      date: p.date.slice(5),
      cases: p.cases,
    }));
    const fc = (surge.forecast || []).map((p: any) => ({
      date: p.date.slice(5),
      baseline: p.baseline,
      low: p.low,
      high: p.high,
    }));
    return [...hist, ...fc];
  }, [surge]);

  const funnelStages = [
    { stage: t('rbc.funnelReferred'), value: funnel.live_referrals?.referred || 0 },
    { stage: t('rbc.funnelReceived'), value: funnel.live_referrals?.received || 0 },
    { stage: t('rbc.funnelArrived'), value: funnel.live_referrals?.arrived || 0 },
    { stage: t('rbc.funnelTreated'), value: funnel.live_referrals?.treated || 0 },
  ];
  const dropoffs = funnelStages.map((s, i) => {
    if (i === 0) return 0;
    const prev = funnelStages[i - 1].value || 1;
    return Math.round(((prev - s.value) / prev) * 100);
  });
  const worstDrop = Math.max(...dropoffs);

  const ranked = Object.entries(surge.by_district || {})
    .map(([name, cases]) => ({ name, cases: Number(cases) }))
    .sort((a, b) => b.cases - a.cases);
  const maxCases = ranked[0]?.cases || 1;

  const sparks = [4, 6, 5, 8, 7, 9, 11, 10];

  const topHotspot = hotspotSignals[0] ?? null;
  const hotspotWording =
    !topHotspot?.wording || topHotspot.wording === 'outbreak confirmed'
      ? t('rbc.hotspotBanner')
      : topHotspot.wording;

  return (
    <DesktopShell title={t('rbc.title')} crumbs={['ZeroMalaria', t('nav.rbc')]}>
      <PageHeader
        title={t('rbc.title')}
        subtitle={t('common.disclaimer')}
        badge={<SyntheticBadge label={t('common.synthetic')} />}
      />
      <div className="sticky top-[65px] z-10 -mx-4 mb-4 border-b border-border bg-app/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-ink-muted">
            {t('rbc.district')}
            <Select className="mt-1 w-44" value={district} onChange={(e) => setDistrict(e.target.value)}>
              <option value="">{t('rbc.allDistricts')}</option>
              {DISTRICTS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs font-semibold text-ink-muted">
            {t('rbc.ageGroup')}
            <Select className="mt-1 w-40" value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
              <option value="">{t('rbc.allAges')}</option>
              <option value="under5">{t('rbc.under5')}</option>
              <option value="5to14">{t('rbc.age5to14')}</option>
              <option value="15plus">{t('rbc.age15plus')}</option>
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            {district ? (
              <Badge tone="primary">
                {district}
                <button type="button" aria-label={t('rbc.clearFilter')} onClick={() => setDistrict('')}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {ageGroup ? (
              <Badge tone="info">
                {ageGroup === 'under5' ? t('rbc.under5') : ageGroup === '5to14' ? t('rbc.age5to14') : t('rbc.age15plus')}
                <button type="button" aria-label={t('rbc.clearFilter')} onClick={() => setAgeGroup('')}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {(district || ageGroup) && (
              <Button size="sm" variant="ghost" onClick={() => { setDistrict(''); setAgeGroup(''); }}>
                {t('common.clearFilters')}
              </Button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone="warning">{t('common.synthetic')}</Badge>
            {demoOnly ? <Badge tone="info">{t('common.offlineMock')}</Badge> : null}
          </div>
        </div>
      </div>

      {treatedToday != null || treatedWeek != null ? (
        <Card className="mb-4 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t('activity.rbcStripTitle')}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs text-ink-muted">{t('activity.kpiTreatedToday')}</p>
              <p className="text-2xl font-bold tabular text-ink">{treatedToday ?? 0}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {t('activity.autoTotal')}: {treatedAutoToday ?? 0} · {t('activity.manualTotal')}:{' '}
                {treatedManualToday ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">{t('activity.kpiTreatedWeek')}</p>
              <p className="text-2xl font-bold tabular text-ink">{treatedWeek ?? 0}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-muted">{t('activity.rbcStripNote')}</p>
        </Card>
      ) : null}

      {topHotspot ? (
        <Card className="mb-4 border-warning/50 bg-warning/5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" strokeWidth={1.75} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-ink">{hotspotWording}</p>
              <p className="mt-1 text-ink-muted">
                <span className="font-medium text-ink">{topHotspot.location}</span>
                {' · '}
                {topHotspot.period}
                {typeof topHotspot.percent_change === 'number' ? (
                  <>
                    {' · '}
                    <span className="tabular font-medium text-warning">+{topHotspot.percent_change}%</span>
                    {' vs baseline'}
                  </>
                ) : null}
              </p>
              {topHotspot.recommended_action ? (
                <p className="mt-2 text-ink-muted">
                  <span className="font-semibold text-ink">{t('rbc.recommendedAction')}:</span>{' '}
                  {topHotspot.recommended_action}
                </p>
              ) : null}
              {topHotspot.evidence ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {t('rbc.evidence')}: {JSON.stringify(topHotspot.evidence)}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-ink-muted">{t('rbc.hotspotNote')}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label={t('rbc.casesToday')}
            value={<CountUp value={kpis.cases_today || 0} />}
            icon={<Activity className="h-4 w-4" />}
            delta={{ value: 8, label: t('rbc.vsPrev') }}
            spark={sparks}
          />
          <KpiCard
            label={t('rbc.urgent')}
            value={<CountUp value={kpis.urgent_referrals || 0} />}
            icon={<Siren className="h-4 w-4" />}
            delta={{ value: 2, label: t('rbc.vsPrev') }}
            spark={[2, 3, 2, 4, 5, 4, 6, 5]}
          />
          <KpiCard
            label={t('rbc.completion')}
            value={Math.round((kpis.referral_completion_rate || 0) * 100)}
            suffix="%"
            icon={<TrendingUp className="h-4 w-4" />}
            delta={{ value: 3, label: t('rbc.vsPrev') }}
            spark={[60, 62, 65, 68, 70, 72, 74, 74]}
          />
          <KpiCard
            label={t('rbc.delay')}
            value={Math.round((kpis.avg_arrival_delay_hours || 0) * 10) / 10}
            icon={<Clock3 className="h-4 w-4" />}
            delta={{ value: -0.4, label: 'h' }}
            spark={[8, 7.5, 7, 6.8, 6.5, 6.4, 6.2, 6.2]}
          />
          <KpiCard
            label={t('rbc.activeAlerts')}
            value={<CountUp value={kpis.active_alerts || alerts.length} />}
            icon={<AlertTriangle className="h-4 w-4" />}
            delta={{ value: 1 }}
            spark={[1, 2, 2, 3, 2, 3, 3, 3]}
          />
        </div>
      )}

      <div className="mb-4 grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <h3 className="mb-3 font-semibold">{t('rbc.map')}</h3>
          <div className="h-80 overflow-hidden rounded-card">
            <MapContainer center={[-1.94, 29.87]} zoom={7.2} scrollWheelZoom={false}>
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {DISTRICTS.map((d) => {
                const cases = (surge.by_district || {})[d.name] || 0;
                const hot = cases > 120 || (district ? d.name === district : false);
                return (
                  <CircleMarker
                    key={d.name}
                    center={[d.lat, d.lon]}
                    radius={10 + Math.min(22, cases / 12)}
                    pathOptions={{
                      color: hot ? '#D97706' : '#14807A',
                      fillColor: hot ? '#D97706' : '#14807A',
                      fillOpacity: 0.45 + Math.min(0.4, cases / 300),
                    }}
                    eventHandlers={{
                      click: () => setDistrict(d.name === district ? '' : d.name),
                    }}
                    className={hot ? 'animate-pulse' : undefined}
                  >
                    <Popup>
                      <strong>{d.name}</strong>
                      <br />
                      {cases} {t('common.syntheticShort')}
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </Card>
        <Card className="xl:col-span-5">
          <h3 className="mb-3 font-semibold">{t('rbc.topDistricts')}</h3>
          <div className="space-y-3">
            {ranked.map((d) => (
              <button
                key={d.name}
                type="button"
                className="w-full text-left"
                onClick={() => setDistrict(d.name === district ? '' : d.name)}
              >
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold">{d.name}</span>
                  <span className="tabular text-ink-muted">{d.cases}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-muted">
                  <div
                    className={cn('h-full rounded-full', d.cases > 120 ? 'bg-warning' : 'bg-accent')}
                    style={{ width: `${(d.cases / maxCases) * 100}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold">{t('rbc.timeseries')}</h3>
            <Badge tone="neutral">{t('rbc.forecast')}</Badge>
          </div>
          <p className="mb-3 text-xs text-ink-muted">{t('common.forecastNote')}</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-ink-muted)" fontSize={12} />
                <YAxis stroke="var(--color-ink-muted)" fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="high" stroke="none" fill="var(--color-primary-soft)" name="forecast high" />
                <Area type="monotone" dataKey="low" stroke="none" fill="var(--color-app)" name="forecast low" />
                <Area type="monotone" dataKey="baseline" stroke="var(--color-ink-muted)" fill="none" name={t('rbc.baselineSeries')} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="cases" stroke="var(--color-accent)" fill="var(--color-accent-soft)" name="cases" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="xl:col-span-5">
          <h3 className="mb-3 font-semibold">{t('rbc.funnel')}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelStages}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="stage" stroke="var(--color-ink-muted)" fontSize={12} />
                <YAxis stroke="var(--color-ink-muted)" fontSize={12} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  radius={[8, 8, 0, 0]}
                  fill="var(--color-primary)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            {funnelStages.map((s, i) =>
              i === 0 ? null : (
                <p key={s.stage} className={cn(dropoffs[i] === worstDrop && dropoffs[i] > 0 && 'font-semibold text-warning')}>
                  Drop {funnelStages[i - 1].stage} → {s.stage}: {dropoffs[i]}%
                </p>
              ),
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7 overflow-x-auto">
          <h3 className="mb-3 font-semibold">{t('rbc.stock')}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 font-medium">Facility</th>
                <th className="font-medium">Commodity</th>
                <th className="font-medium">Cover (wks)</th>
                <th className="font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {(stock.cells || []).slice(0, 14).map((c: any, i: number) => (
                <tr key={`${c.facility_name}-${c.commodity}-${i}`} className="border-t border-border">
                  <td className="py-2.5">{c.facility_name}</td>
                  <td>{c.commodity}</td>
                  <td className="tabular">{c.weeks_of_cover}</td>
                  <td>
                    <Badge
                      tone={c.risk === 'stockout' ? 'danger' : c.risk === 'low' ? 'warning' : 'success'}
                    >
                      {c.risk}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="xl:col-span-5">
          <h3 className="mb-3 font-semibold">{t('rbc.feed')}</h3>
          <div className="space-y-2">
            {(alerts.length ? alerts : [{ message: t('alerts.empty') }]).slice(0, 8).map((a: any, i: number) => (
              <motion.div
                key={a.referral?.client_uuid || i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-start gap-2 rounded-control border border-border bg-surface-muted px-3 py-2 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
                <span>{a.message}</span>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="mb-2 font-semibold">{t('rbc.compareTools')}</h3>
        <p className="text-sm text-ink-muted">{t('rbc.compareToolsBody')}</p>
        <p className="mt-2 text-xs text-ink-muted">{t('rbc.sourceCanvas')}</p>
      </Card>

      <p className="mt-6 text-xs text-ink-muted">{t('common.disclaimer')} · {t('common.forecastNote')}</p>
    </DesktopShell>
  );
}

export default RbcPage;
