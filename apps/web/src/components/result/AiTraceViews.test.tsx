/**
 * AiTraceViews: rules vs rules_ai section visibility and Analysis dossier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '../../i18n';
import type { AiTrace, DecisionResult } from '../../types';
import {
  AiOffState,
  AnalysisGrouped,
  ImpactStrip,
  ModeSwitchFrame,
} from './AiTraceViews';

vi.mock('../../api/client', () => ({
  api: {
    aiTrace: async () => ({ ok: true, data: null }),
    aiCompare: async () => ({ ok: true, providers: [] }),
  },
}));

const dossierTrace: AiTrace = {
  pipeline: [
    { id: 'inputs', status: 'done' },
    { id: 'rules', status: 'done', locked: true, decision_label: 'Treat at home' },
    { id: 'ml', status: 'done' },
    { id: 'ai_language', status: 'done', provider: 'local' },
    { id: 'chw_confirm', status: 'pending' },
  ],
  rules: {
    decision: 'treat_at_home',
    decision_label: 'Treat at home',
    final_decision: 'treat_at_home',
    final_decision_label: 'Treat at home',
    triggered_rule_ids: ['default_treat_at_home'],
    contributions: [
      {
        question: 'convulsions',
        answer: 'no',
        effect: 'neutral',
        triggered: false,
      },
      {
        question: 'lethargy',
        answer: 'unknown',
        effect: 'not_reported',
        triggered: false,
      },
      {
        question: 'temperature_c',
        answer: '38.2',
        effect: 'neutral',
        triggered: false,
      },
      {
        question: 'tdr_result',
        answer: 'negative',
        effect: 'neutral',
        triggered: false,
      },
    ],
  },
  ml: {
    urgency_risk: { score: 0.12, meaning: 'severity' },
    referral_followup_risk: { score: 0.2, meaning: 'referral' },
    top_factors: [{ label: 'fever_days' }],
    synthetic: true,
    can_only_escalate: true,
  },
  ai_added: [
    { type: 'family_message', text: 'Watch for danger signs' },
    { type: 'missing_info', text: 'Did you check all danger signs?' },
    { type: 'nurse_summary', text: 'Nurse handover summary' },
  ],
  guardrail: { blocked_items: [] },
  consistency_checks: [],
  what_if: [],
  impact: {
    urgency_changed: 'never_locked',
    wording_items: 2,
    checks_run: 1,
    time_added_ms: 12,
    provider: 'local',
    fallback_chain: 'gemini>groq>local',
  },
};

describe('AiTraceViews mode sections', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // @ts-expect-error act env
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it('shows ai-off in rules mode and impact strip in rules_ai', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <div>
          <AiOffState />
          <ImpactStrip trace={dossierTrace} mode="rules" />
        </div>,
      );
    });
    expect(container.querySelector('[data-testid="ai-off-state"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ai-impact-strip"]')).toBeFalsy();

    await act(async () => {
      root.render(
        <div>
          <ModeSwitchFrame mode="rules_ai">
            <ImpactStrip trace={dossierTrace} mode="rules_ai" />
          </ModeSwitchFrame>
        </div>,
      );
    });
    expect(container.querySelector('[data-testid="ai-impact-strip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mode-frame-rules_ai"]')).toBeTruthy();
  });
});

describe('AnalysisGrouped dossier', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // @ts-expect-error act env
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it('rules mode shows core dossier sections without ML gauges', async () => {
    await act(async () => {
      root.render(
        <AnalysisGrouped trace={dossierTrace} mode="rules" language="en" protocolReference="demo.yaml" />,
      );
    });
    expect(container.querySelector('[data-testid="decision-path"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="answers-table"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="missing-data"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="protocol-evidence"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="analysis-rules-only-banner"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ml-gauges"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="analysis-rules-ai-banner"]')).toBeFalsy();
  });

  it('rules_ai mode shows ML gauges and rules+AI banner', async () => {
    await act(async () => {
      root.render(
        <AnalysisGrouped
          trace={dossierTrace}
          mode="rules_ai"
          language="en"
          highlightAi
          protocolReference="demo.yaml"
        />,
      );
    });
    expect(container.querySelector('[data-testid="ml-gauges"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="analysis-rules-ai-banner"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="analysis-nurse-summary"]')).toBeTruthy();
  });
});

void (null as unknown as DecisionResult);
