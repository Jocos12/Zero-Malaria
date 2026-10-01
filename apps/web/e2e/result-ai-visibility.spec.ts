import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotDir = join(__dirname, '../../../docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const API = process.env.ZM_API || 'http://127.0.0.1:8000';
const PASSWORD = process.env.ZM_DEMO_PASSWORD || 'demo1234';

const TRIAGE = {
  input: {
    age_months: 24,
    sex: 'male',
    temperature_c: 39,
    fever_days: 2,
    convulsions: true,
    unable_to_drink: false,
    vomiting_everything: false,
    lethargy: false,
    severe_breathing_difficulty: false,
    tdr_result: 'positive',
  },
  result: {
    decision: 'urgent_refer',
    rules_decision: 'urgent_refer',
    public_decision: 'urgent_referral',
    reasons: ['Convulsions reported'],
    triggered_rules: ['convulsions'],
    confidence: 0.9,
    ml_escalated: false,
    severe_risk: 0.72,
    referral_noncompletion_risk: 0.48,
    shap_factors: ['convulsions increases risk', 'fever_days', 'temperature_c'],
    missing_info: [],
    reason_details: [],
    protocol_reference: 'demo',
    human_confirmation_required: true,
    disclaimer: 'Decision support tool.',
    ai_trace: {
      pipeline: [
        { id: 'inputs', status: 'done', provider: 'chw', latency_ms: 0, timestamp: '', locked: false },
        {
          id: 'rules',
          status: 'done',
          provider: 'protocol',
          latency_ms: 0,
          timestamp: '',
          locked: true,
          decision: 'urgent_refer',
          decision_label: 'URGENT referral',
        },
        { id: 'ml', status: 'done', provider: 'ml_local', latency_ms: 0, timestamp: '', locked: false },
        { id: 'ai_language', status: 'done', provider: 'local', latency_ms: 12, timestamp: '', locked: false },
        { id: 'chw_confirm', status: 'pending', provider: 'chw', latency_ms: 0, timestamp: '', locked: false },
      ],
      rules: {
        decision: 'urgent_refer',
        decision_label: 'URGENT referral',
        final_decision: 'urgent_refer',
        final_decision_label: 'URGENT referral',
        triggered_rule_ids: ['convulsions'],
        contributions: [
          {
            question: 'convulsions',
            answer: 'yes',
            effect: 'critical',
            reason_phrase_id: 'reason_convulsions',
            triggered: true,
          },
          {
            question: 'unable_to_drink',
            answer: 'no',
            effect: 'neutral',
            reason_phrase_id: 'reason_unable_to_drink',
            triggered: false,
          },
          {
            question: 'tdr_result',
            answer: 'positive',
            effect: 'raises',
            reason_phrase_id: 'field_tdr_result',
            triggered: false,
          },
        ],
      },
      ml: {
        urgency_risk: { score: 0.72, meaning: 'Severity risk', label_key: 'severity_risk' },
        referral_followup_risk: {
          score: 0.48,
          meaning: 'Risk of not reaching the facility',
          label_key: 'referral_followup_risk',
        },
        top_factors: [{ label: 'convulsions', direction: 'increases', raw: 'convulsions' }],
        escalated_by_ml: false,
        synthetic: true,
        can_only_escalate: true,
      },
      ai_added: [
        {
          type: 'plain_explanation',
          text: 'Decision locked by protocol. AI explains only.',
          provider: 'local',
          latency_ms: 12,
          source_rule_ids: ['convulsions'],
        },
        {
          type: 'family_message',
          text: 'Family: go to the facility NOW.',
          provider: 'local',
          latency_ms: 12,
          source_rule_ids: ['convulsions'],
        },
      ],
      guardrail: { urgency_lowered_blocked: false, blocked_items: [], drug_or_dose_filtered: false },
      consistency_checks: [],
      what_if: [
        {
          field: 'unable_to_drink',
          if_answer: 'yes',
          decision: 'urgent_refer',
          decision_label: 'URGENT referral',
          source: 'rules',
          note: 'rules_not_ai',
        },
      ],
      impact: {
        urgency_changed: 'never_locked',
        wording_items: 2,
        checks_run: 0,
        time_added_ms: 12,
        provider: 'local',
        fallback_reason: null,
        fallback_chain: '',
      },
      language: 'en',
    },
  },
  answer_insights: [
    {
      field: 'convulsions',
      text: 'Convulsions raise urgency to urgent referral.',
      source: 'rule',
      contribution: 'high',
      flag: 'danger',
    },
  ],
};

async function loginAndSeed(page: Page, lang: 'en' | 'rw' = 'en') {
  const res = await page.request.post(`${API}/auth/login`, {
    data: { username: 'chw.demo', password: PASSWORD },
  });
  const login = res.ok()
    ? res
    : await page.request.post(`${API}/auth/login`, {
        data: { username: 'super.admin', password: PASSWORD },
      });
  expect(login.ok()).toBeTruthy();
  const data = await login.json();
  await page.addInitScript(
    ({ session, triage, language }) => {
      sessionStorage.setItem('zm_session', JSON.stringify(session));
      sessionStorage.setItem('zm_last_triage', JSON.stringify(triage));
      localStorage.setItem('zm_lang', language);
      localStorage.setItem('zm_preferred_view', 'web');
      void navigator.serviceWorker?.getRegistrations().then((regs) => {
        regs.forEach((r) => void r.unregister());
      });
    },
    {
      session: {
        access_token: data.access_token,
        user: data.user,
        offline_until: Date.now() + 86400000,
      },
      triage: TRIAGE,
      language: lang,
    },
  );
}

async function openResult(page: Page) {
  await page.goto('/app/triage?result=open');
  await expect(page.getByTestId('result-modal')).toBeVisible({ timeout: 20_000 });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(shotDir, name), fullPage: false });
}

test.describe('Result AI visibility', () => {
  test('Rules only vs Rules + AI differ; safety lock; screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAndSeed(page, 'en');
    await openResult(page);

    await expect(page.getByTestId('ai-impact-strip')).toBeVisible();
    await expect(page.getByTestId('verdict-card')).toBeVisible();
    await expect(page.getByTestId('recommendation-hierarchy')).toBeVisible();
    await shot(page, 'result-ai-recommendation-1440-light.png');

    await page.getByTestId('tab-analysis').click();
    await expect(page.getByTestId('analysis-grouped')).toBeVisible();
    await expect(page.getByTestId('ml-gauges')).toBeVisible();
    await shot(page, 'result-ai-analysis-1440-light.png');

    await page.getByTestId('tab-recommendation').click();
    await page.getByTestId('ai-mode-rules').click();
    await expect(page.getByTestId('ai-off-state')).toBeVisible();
    await expect(page.getByTestId('ai-impact-strip')).toHaveCount(0);
    await shot(page, 'result-ai-rules-only-1440-light.png');

    await page.getByTestId('ai-mode-rules-ai').click();
    await expect(page.getByTestId('ai-impact-strip')).toBeVisible();
    await expect(page.getByTestId('pipeline-stepper')).toBeVisible();
    await shot(page, 'result-ai-rules-plus-ai-1440-light.png');

    await page.getByTestId('pipeline-step-rules').click();
    await shot(page, 'result-ai-pipeline-1440-light.png');

    await expect(page.getByTestId('what-if-panel')).toBeVisible();
    await page.getByTestId('what-if-panel').scrollIntoViewIfNeeded();
    await shot(page, 'result-ai-what-if-1440-light.png');

    await page.getByTestId('test-safety-lock').click();
    await expect(page.getByTestId('guardrail-panel')).toBeVisible();

    await expect(page.getByTestId('ai-compare-panel')).toBeVisible();
    await page.getByTestId('ai-compare-panel').scrollIntoViewIfNeeded();
    await shot(page, 'result-ai-compare-1440-light.png');

    // No raw enums in CHW-facing AI panels (banner uses translated labels)
    const left = await page.getByTestId('result-left-col').innerText();
    const compare = await page.getByTestId('ai-compare-panel').innerText();
    expect(`${left}\n${compare}`).not.toMatch(/\burgent_refer\b/);
    expect(`${left}\n${compare}`).not.toMatch(/\btreat_at_home\b/);
  });

  test('mobile 390 + dark theme screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAndSeed(page, 'en');
    await page.addInitScript(() => {
      localStorage.setItem('zm_theme', 'dark');
      document.documentElement.classList.add('dark');
    });
    await openResult(page);
    await expect(page.getByTestId('ai-impact-strip')).toBeVisible();
    await shot(page, 'result-ai-recommendation-390-dark.png');

    await page.getByTestId('ai-mode-rules').click();
    await expect(page.getByTestId('ai-off-state')).toBeVisible();
    await shot(page, 'result-ai-rules-only-390-dark.png');

    await page.getByTestId('ai-mode-rules-ai').click();
    await page.getByTestId('tab-assistant-mobile').click();
    await expect(page.getByTestId('ai-compare-panel')).toBeVisible();
    await shot(page, 'result-ai-compare-390-dark.png');
  });
});
