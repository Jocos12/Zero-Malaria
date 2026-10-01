import { ClipboardList, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { RecordTreatedModal } from '../components/activity/RecordTreatedModal';
import { Modal } from '../components/Modal';
import { WebShell } from '../components/shells';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  StatusPill,
  Timeline,
} from '../components/ui';
import { db } from '../db';
import { useLiveEventRefresh } from '../events/EventContext';
import { formatAgeMonths, formatSex } from '../lib/format';
import { formatDate, relativeTime } from '../lib/relativeTime';
import type { LocalReferral, ReferralStatus } from '../types';

const PAGE_SIZE = 10;

const STATUS_ORDER = [
  { key: 'sent', labelKey: 'referrals.sent' },
  { key: 'received', labelKey: 'referrals.received' },
  { key: 'arrived', labelKey: 'referrals.arrived' },
  { key: 'treated', labelKey: 'referrals.treated' },
] as const;

const STATUS_FILTER_VALUES: ReferralStatus[] = ['sent', 'received', 'arrived', 'treated'];

type PatientRow = {
  id?: string;
  client_uuid: string;
  facility_id?: string;
  chw_id?: string;
  district?: string;
  sector?: string;
  age_months: number;
  sex: string;
  decision: string;
  reasons: string[];
  summary?: string;
  status: ReferralStatus;
  created_at: string;
  received_at?: string;
  arrived_at?: string;
  treated_at?: string;
};

function mergeKey(row: PatientRow): string {
  return row.client_uuid || row.id || '';
}

function mapLocal(r: LocalReferral): PatientRow {
  return {
    id: r.id != null ? String(r.id) : undefined,
    client_uuid: r.client_uuid,
    facility_id: r.facility_id,
    chw_id: r.chw_id,
    district: r.district,
    sector: r.sector,
    age_months: r.age_months,
    sex: r.sex,
    decision: r.decision,
    reasons: r.reasons ?? [],
    summary: r.summary,
    status: r.status,
    created_at: r.created_at,
    received_at: r.received_at,
    arrived_at: r.arrived_at,
    treated_at: r.treated_at,
  };
}

function mapRemote(r: Record<string, unknown>): PatientRow {
  return {
    id: r.id != null ? String(r.id) : undefined,
    client_uuid: String(r.client_uuid ?? ''),
    facility_id: r.facility_id != null ? String(r.facility_id) : undefined,
    chw_id: r.chw_id != null ? String(r.chw_id) : undefined,
    district: r.district != null ? String(r.district) : undefined,
    sector: r.sector != null ? String(r.sector) : undefined,
    age_months: Number(r.age_months),
    sex: String(r.sex ?? ''),
    decision: String(r.decision ?? ''),
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
    summary: r.summary != null ? String(r.summary) : undefined,
    status: String(r.status ?? 'sent') as ReferralStatus,
    created_at: String(r.created_at ?? ''),
    received_at: r.received_at != null ? String(r.received_at) : undefined,
    arrived_at: r.arrived_at != null ? String(r.arrived_at) : undefined,
    treated_at: r.treated_at != null ? String(r.treated_at) : undefined,
  };
}

function patientCode(row: PatientRow, unknownLabel: string): string {
  if (row.client_uuid) {
    return row.client_uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
  }
  if (row.id) {
    const id = row.id;
    return id.length > 8 ? id.slice(-8).toUpperCase() : id.toUpperCase();
  }
  return unknownLabel;
}

function dayPart(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function showsTreatedFlag(row: PatientRow): boolean {
  if (row.decision === 'treat_at_home') return true;
  return row.status === 'arrived' || row.status === 'treated';
}

function statusTimestamp(row: PatientRow, step: string): string | undefined {
  if (step === 'sent') return row.created_at || undefined;
  if (step === 'received') return row.received_at;
  if (step === 'arrived') return row.arrived_at;
  if (step === 'treated') return row.treated_at;
  return undefined;
}

export function PatientsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recordOpen, setRecordOpen] = useState(false);
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PatientRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const local = await db.referrals.orderBy('created_at').reverse().toArray();
    const localRows = local.map(mapLocal);
    try {
      let remoteRaw: Record<string, unknown>[];
      try {
        remoteRaw = await api.scopedReferrals();
      } catch {
        remoteRaw = await api.referrals();
      }
      const remoteRows = remoteRaw.map(mapRemote);
      const byKey = new Map<string, PatientRow>();
      for (const r of localRows) {
        const k = mergeKey(r);
        if (k) byKey.set(k, r);
      }
      for (const r of remoteRows) {
        const k = mergeKey(r);
        if (k) byKey.set(k, r);
      }
      setRows(
        [...byKey.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
    } catch {
      setRows(localRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEventRefresh(load, ['referral.created', 'referral.status_changed', 'referral.message']);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, decisionFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (decisionFilter && r.decision !== decisionFilter) return false;
      const day = dayPart(r.created_at);
      if (dateFrom && day && day < dateFrom) return false;
      if (dateTo && day && day > dateTo) return false;
      if (!q) return true;
      const code = patientCode(r, '').toLowerCase();
      const hay = [
        code,
        r.summary,
        r.id,
        r.client_uuid,
        r.chw_id,
        r.district,
        r.sector,
        r.facility_id,
        formatSex(r.sex, t),
        formatAgeMonths(r.age_months, t),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, statusFilter, decisionFilter, dateFrom, dateTo, t]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const statusLabel = (status: ReferralStatus) => {
    const key = STATUS_ORDER.find((s) => s.key === status)?.labelKey;
    return key ? t(key) : status;
  };

  return (
    <WebShell title={t('nav.patients')} crumbs={[t('nav.patients')]}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[200px] flex-1 text-xs font-semibold text-ink-muted">
          {t('patients.search')}
          <Input
            className="mt-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('patients.searchPlaceholder')}
          />
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          {t('patients.filterStatus')}
          <Select className="mt-1 w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {STATUS_FILTER_VALUES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          {t('patients.filterDecision')}
          <Select className="mt-1 w-44" value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="urgent_refer">{t('patients.decisionUrgent')}</option>
            <option value="refer">{t('patients.decisionRefer')}</option>
            <option value="treat_at_home">{t('patients.decisionHome')}</option>
          </Select>
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          {t('patients.filterDateFrom')}
          <Input
            className="mt-1 w-40"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          {t('patients.filterDateTo')}
          <Input
            className="mt-1 w-40"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        {user?.role === 'CHW' ? (
          <Button
            type="button"
            variant="secondary"
            className="mb-0.5"
            leftIcon={<ClipboardList className="h-4 w-4" />}
            onClick={() => setRecordOpen(true)}
          >
            {t('activity.recordButton')}
          </Button>
        ) : null}
      </div>

      {loading ? <Skeleton className="h-64" /> : null}

      {!loading && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-8 w-8" strokeWidth={1.75} />}
            title={t('patients.emptyTitle')}
            description={t('patients.emptyBody')}
            action={
              <Button onClick={() => navigate('/app/triage')}>{t('patients.emptyAction')}</Button>
            }
          />
        </Card>
      ) : null}

      {!loading && rows.length > 0 && filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-8 w-8" strokeWidth={1.75} />}
            title={t('patients.noMatchTitle')}
            description={t('patients.noMatchBody')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('');
                  setDecisionFilter('');
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                {t('common.clearFilters')}
              </Button>
            }
          />
        </Card>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase text-ink-muted">
                <tr>
                  <th className="px-4 py-3">{t('patients.colCode')}</th>
                  <th className="px-4 py-3">{t('patients.colAge')}</th>
                  <th className="px-4 py-3">{t('patients.colSex')}</th>
                  <th className="px-4 py-3">{t('patients.colLastTriage')}</th>
                  <th className="px-4 py-3">{t('patients.colDecision')}</th>
                  <th className="px-4 py-3">{t('patients.colStatus')}</th>
                  <th className="px-4 py-3">{t('patients.colTreated')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const key = mergeKey(row) || row.created_at;
                  const decision = row.decision as 'treat_at_home' | 'refer' | 'urgent_refer';
                  return (
                    <tr
                      key={key}
                      className="cursor-pointer border-b border-border/60 hover:bg-surface-muted/60"
                      onClick={() => setDetail(row)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold">
                        {patientCode(row, t('common.unknown'))}
                      </td>
                      <td className="px-4 py-3">{formatAgeMonths(row.age_months, t)}</td>
                      <td className="px-4 py-3">{formatSex(row.sex, t)}</td>
                      <td className="px-4 py-3 text-ink-muted" title={formatDate(row.created_at, i18n.language)}>
                        {relativeTime(row.created_at, i18n.language)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={decision} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        {showsTreatedFlag(row) ? (
                          <Badge tone="success">{t('patients.treatedYes')}</Badge>
                        ) : (
                          <span className="text-ink-muted">{t('patients.treatedNo')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <p className="text-ink-muted">{t('common.resultCount', { count: filtered.length })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('common.back')}
              </Button>
              <span className="text-ink-muted">
                {t('patients.pageOf', { page: safePage, total: pageCount })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                {t('common.continue')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={
          detail
            ? `${patientCode(detail, t('common.unknown'))} · ${formatAgeMonths(detail.age_months, t)} · ${formatSex(detail.sex, t)}`
            : ''
        }
        description={detail?.summary}
        size="md"
        testId="patient-detail-modal"
      >
        {detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-control bg-surface-muted p-3">
                <p className="text-xs text-ink-muted">{t('patients.colDecision')}</p>
                <StatusPill status={detail.decision as 'treat_at_home' | 'refer' | 'urgent_refer'} />
              </div>
              <div className="rounded-control bg-surface-muted p-3">
                <p className="text-xs text-ink-muted">{t('patients.colStatus')}</p>
                <StatusPill status={detail.status} />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-ink-muted">{t('patients.detailTimeline')}</p>
              <Timeline
                current={detail.status}
                steps={STATUS_ORDER.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
              />
              <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                {STATUS_ORDER.map((s) => {
                  const ts = statusTimestamp(detail, s.key);
                  if (!ts) return null;
                  return (
                    <li key={s.key}>
                      <span className="font-medium text-ink">{t(s.labelKey)}</span>
                      {' · '}
                      {formatDate(ts, i18n.language)}
                    </li>
                  );
                })}
              </ul>
            </div>

            {detail.reasons.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase text-ink-muted">{t('result.why')}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {detail.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-xs text-ink-muted">
              {t('patients.colLastTriage')}: {formatDate(detail.created_at, i18n.language)}
            </p>
          </div>
        ) : null}
      </Modal>
      <RecordTreatedModal open={recordOpen} onClose={() => setRecordOpen(false)} />
    </WebShell>
  );
}
