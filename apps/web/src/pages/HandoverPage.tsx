import { Check, Copy, QrCode, Send } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChwShell } from '../components/shells';
import { Button, Card, EmptyState } from '../components/ui';
import { DEMO_FACILITY } from '../demo/scenario';
import { enqueueReferral } from '../db';
import { useSync } from '../sync/SyncContext';
import { useToast } from '../components/ToastProvider';
import type { DecisionResult, TriageInput } from '../types';

function uuid() {
  return crypto.randomUUID();
}

export function HandoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { refreshPending, syncNow } = useSync();
  const { push } = useToast();
  const [qr, setQr] = useState('');
  const [saved, setSaved] = useState(false);

  const triage = useMemo(() => {
    const raw = sessionStorage.getItem('zm_last_triage');
    if (!raw) return null;
    return JSON.parse(raw) as { input: TriageInput; result: DecisionResult };
  }, []);

  const summary = useMemo(() => {
    if (!triage) return '';
    const { input, result } = triage;
    const aiSummary = result.ai_advisory?.handover_summary;
    const visitSummary =
      typeof (triage as { ai_visit_summary?: string }).ai_visit_summary === 'string'
        ? (triage as { ai_visit_summary?: string }).ai_visit_summary
        : null;
    const bloodLines: string[] = [];
    if (input.pale_palms_or_eyelids) bloodLines.push(`Pale palms/eyelids: ${input.pale_palms_or_eyelids}`);
    if (input.blood_in_stool) bloodLines.push(`Blood in stool: ${input.blood_in_stool}`);
    if (input.dark_or_bloody_urine) bloodLines.push(`Dark/bloody urine: ${input.dark_or_bloody_urine}`);
    if (input.bleeding_nose_gums_skin_or_vomit_blood) {
      bloodLines.push(`Bleeding signs: ${input.bleeding_nose_gums_skin_or_vomit_blood}`);
    }
    if (input.hemoglobin_g_dl != null) bloodLines.push(`Hemoglobin: ${input.hemoglobin_g_dl} g/dL`);
    const lines = [
      `ZeroMalaria REFERRAL (${result.decision.toUpperCase()})`,
      `Age: ${input.age_months} months | Sex: ${input.sex}`,
      `Temp: ${input.temperature_c}°C | Fever days: ${input.fever_days} | TDR: ${input.tdr_result}`,
      ...(bloodLines.length ? [`Blood-related (inform nurse; rules pending RBC validation): ${bloodLines.join('; ')}`] : []),
      ...(result.inform_nurse_fields?.length
        ? [`Inform nurse flags: ${result.inform_nurse_fields.join(', ')}`]
        : []),
      `Reasons: ${result.reasons.join('; ')}`,
      result.protocol_reference ? `Protocol: ${result.protocol_reference}` : '',
      visitSummary ? `AI visit summary (verify): ${visitSummary}` : '',
      aiSummary ? `AI handover (advisory): ${aiSummary}` : '',
      result.ai_advisory?.chw_followed === true
        ? 'CHW noted AI suggestion'
        : result.ai_advisory?.chw_followed === false
          ? 'CHW kept rules decision only'
          : '',
      `Facility: ${DEMO_FACILITY.name} (${DEMO_FACILITY.facility_id})`,
      'Decision support tool. Not a replacement for clinical judgment.',
      'Synthetic demo data / AI-generated, verify before use',
    ];
    return lines.filter(Boolean).join('\n');
  }, [triage]);

  useEffect(() => {
    if (!summary) return;
    void QRCode.toDataURL(summary, { margin: 1, width: 220 }).then(setQr);
  }, [summary]);

  const send = async () => {
    if (!triage || triage.result.decision === 'treat_at_home') return;
    await enqueueReferral({
      client_uuid: uuid(),
      facility_id: DEMO_FACILITY.facility_id,
      chw_id: DEMO_FACILITY.chw_id,
      district: DEMO_FACILITY.district,
      sector: DEMO_FACILITY.sector,
      age_months: triage.input.age_months,
      sex: triage.input.sex,
      decision: triage.result.decision,
      reasons: triage.result.reasons,
      summary,
      status: 'sent',
      created_at: new Date().toISOString(),
      synced: false,
    });
    setSaved(true);
    await refreshPending();
    void syncNow();
    push(t('handover.sent'), 'success');
  };

  if (!triage) {
    return (
      <ChwShell title={t('handover.title')}>
        <EmptyState icon={<QrCode className="h-8 w-8" />} title={t('common.empty')} />
      </ChwShell>
    );
  }

  return (
    <ChwShell title={t('handover.title')}>
      <Card>
        <h3 className="font-semibold">{t('handover.summary')}</h3>
        <pre className="mt-3 whitespace-pre-wrap rounded-control bg-surface-muted p-3 text-xs leading-5 text-ink">
          {summary}
        </pre>
      </Card>

      <Card className="mt-3 flex flex-col items-center border-dashed">
        <p className="text-sm font-semibold">{t('handover.qr')}</p>
        {qr ? (
          <img src={qr} alt="Referral QR code" className="mt-3 rounded-control border border-border" />
        ) : (
          <p className="mt-3 text-sm text-ink-muted">{t('common.loading')}</p>
        )}
      </Card>

      <div className="mt-4 space-y-2">
        <Button
          variant="secondary"
          className="w-full"
          leftIcon={<Copy className="h-4 w-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(summary);
            push(t('handover.copied'), 'success');
          }}
        >
          {t('handover.sms')}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          leftIcon={<Send className="h-4 w-4" />}
          onClick={async () => {
            if (navigator.share) {
              try {
                await navigator.share({ text: summary, title: 'ZeroMalaria referral' });
              } catch {
                /* user cancelled */
              }
            } else {
              await navigator.clipboard.writeText(summary);
              push(t('handover.copied'), 'info');
            }
          }}
        >
          {t('common.shareSms')}
        </Button>
        {!saved ? (
          <Button className="w-full" variant="danger" onClick={() => void send()}>
            {t('result.createHandover')}
          </Button>
        ) : (
          <motion.div
            initial={reduce ? false : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center justify-center gap-2 rounded-card bg-success-soft p-4 font-semibold text-success"
          >
            <Check className="h-5 w-5" strokeWidth={1.75} />
            {t('handover.sent')}
          </motion.div>
        )}
        {saved ? (
          <Button className="w-full" onClick={() => navigate('/facility')}>
            {t('home.facility')}
          </Button>
        ) : null}
      </div>
    </ChwShell>
  );
}
