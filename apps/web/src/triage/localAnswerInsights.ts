/**
 * Layer-1: instant, deterministic insights from local malaria rules / clinical_config.
 * Must stay synchronous and fast (<50ms). no network.
 */
import { MALARIA_RULES } from '../rules/malariaRules.generated';
import type { TriageInput } from '../types';

export type InsightSource = 'rule' | 'ml' | 'ai';

export type AnswerInsight = {
  field: string;
  text: string;
  source: InsightSource;
  flag?: string | null;
  contribution?: string | null;
};

export type ConsistencyWarning = {
  id: string;
  text: string;
  dismissible: true;
};

function ageBand(months: number): string {
  if (months < MALARIA_RULES.infant_refer_months) return 'under_infant';
  if (months < 12) return 'infant';
  if (months < 60) return 'under_five';
  return 'older';
}

/** Pure sync insights for answered clinical fields. */
export function buildLocalAnswerInsights(
  form: Partial<TriageInput>,
  answered: Set<string> | string[],
  lang: 'rw' | 'en' | 'fr' = 'en',
): AnswerInsight[] {
  const answeredSet = answered instanceof Set ? answered : new Set(answered);
  const out: AnswerInsight[] = [];
  const rw = lang === 'rw';
  const fr = lang === 'fr';

  if (answeredSet.has('age') && typeof form.age_months === 'number') {
    const m = form.age_months;
    const band = ageBand(m);
    let text: string;
    if (band === 'under_infant') {
      text = rw
        ? `Imyaka ${m} amezi. munsi ya ${MALARIA_RULES.infant_refer_months} amezi; itegeko ryo kohereza ripfunguye.`
        : fr
          ? `Âge ${m} mois. sous le seuil nourrisson (${MALARIA_RULES.infant_refer_months} mois); règle de référence active.`
          : `Age ${m} mo. under infant threshold (${MALARIA_RULES.infant_refer_months} mo); referral rule applies.`;
    } else if (band === 'infant') {
      text = rw
        ? `Imyaka ${m} amezi. umwana muto; ibimenyetso by'akaga bireba cyane.`
        : fr
          ? `Âge ${m} mois. nourrisson; les signes de danger priment.`
          : `Age ${m} mo. young infant; danger signs take priority.`;
    } else {
      text = rw
        ? `Imyaka ${m} amezi. ibipimo by'imyaka byakoreshejwe mu mategeko.`
        : fr
          ? `Âge ${m} mois. utilisé dans les règles communautaires.`
          : `Age ${m} mo. used for community-care age bands.`;
    }
    out.push({
      field: 'age',
      text,
      source: 'rule',
      contribution: band === 'under_infant' ? 'high' : 'low',
      flag: band === 'under_infant' ? 'infant_refer' : null,
    });
  }

  if (answeredSet.has('sex') && form.sex) {
    out.push({
      field: 'sex',
      text: rw
        ? 'Igitsina cyanditswe. ntabwo gihindura icyemezo cyihutirwa.'
        : fr
          ? 'Sexe enregistré. n’altère pas l’urgence seule.'
          : 'Sex recorded. does not alone change urgency.',
      source: 'rule',
      contribution: 'none',
    });
  }

  if (answeredSet.has('temperature') && typeof form.temperature_c === 'number') {
    const t = form.temperature_c;
    const fever = t >= 37.5;
    out.push({
      field: 'temperature',
      text: fever
        ? rw
          ? `Ubushyuhe ${t}°C. ubushyuhe bwagaragaye.`
          : fr
            ? `Température ${t}°C. fièvre présente.`
            : `Temperature ${t}°C. fever present.`
        : rw
          ? `Ubushyuhe ${t}°C. busanzwe; gereranya n'iminsi y'ubushyuhe.`
          : fr
            ? `Température ${t}°C. normale; comparer aux jours de fièvre.`
            : `Temperature ${t}°C. normal range; cross-check fever days.`,
      source: 'rule',
      contribution: fever ? 'medium' : 'low',
      flag: fever ? 'fever' : null,
    });
  }

  if (answeredSet.has('feverDays') && typeof form.fever_days === 'number') {
    const d = form.fever_days;
    const persistent = d >= MALARIA_RULES.persistent_fever_days;
    out.push({
      field: 'feverDays',
      text: persistent
        ? rw
          ? `Ubushyuhe bw'iminsi ${d}. ${MALARIA_RULES.persistent_fever_days}+ iminsi; gukurikirana / kohereza bishoboka.`
          : fr
            ? `Fièvre ${d} jours. seuil ${MALARIA_RULES.persistent_fever_days}+ jours; suivi / référence possible.`
            : `Fever ${d} days. meets ${MALARIA_RULES.persistent_fever_days}+ day threshold; follow-up / refer may apply.`
        : rw
          ? `Ubushyuhe bw'iminsi ${d}.`
          : fr
            ? `Fièvre depuis ${d} jour(s).`
            : `Fever for ${d} day(s).`,
      source: 'rule',
      contribution: persistent ? 'medium' : 'low',
      flag: persistent ? 'persistent_fever' : null,
    });
  }

  const dangerFields: { step: string; field: keyof TriageInput; id: string }[] = [
    { step: 'convulsions', field: 'convulsions', id: 'convulsions' },
    { step: 'unable_to_drink', field: 'unable_to_drink', id: 'unable_to_drink' },
    { step: 'vomiting_everything', field: 'vomiting_everything', id: 'vomiting_everything' },
    { step: 'lethargy', field: 'lethargy', id: 'lethargy' },
    { step: 'breathing', field: 'severe_breathing_difficulty', id: 'severe_breathing_difficulty' },
  ];
  for (const d of dangerFields) {
    if (!answeredSet.has(d.step)) continue;
    const val = Boolean(form[d.field]);
    const sign = MALARIA_RULES.danger_signs.find((s) => s.id === d.id);
    const reason = rw ? sign?.reason_rw || d.id : sign?.reason_en || d.id;
    out.push({
      field: d.step,
      text: val
        ? rw
          ? `${reason}. ikimenyetso cy'akaga; kohereza byihutirwa.`
          : fr
            ? `${reason}. signe de danger; référence urgente.`
            : `${reason}. danger sign; urgent referral.`
        : rw
          ? 'Nta kimenyetso cy\'akaga cyavuzwe kuri iki kibazo.'
          : fr
            ? 'Aucun signe de danger signalé pour cette question.'
            : 'No danger sign reported for this question.',
      source: 'rule',
      contribution: val ? 'critical' : 'none',
      flag: val ? 'danger' : null,
    });
  }

  if (answeredSet.has('tdr') && form.tdr_result) {
    const r = form.tdr_result;
    let text: string;
    if (r === 'positive') {
      text = rw
        ? 'TDR yemewe. gukurikiza amabwiriza yo kuvura / kohereza.'
        : fr
          ? 'TDR positif. suivre le protocole de traitement / référence.'
          : 'RDT positive. follow treatment / referral protocol.';
    } else if (r === 'negative') {
      text = rw
        ? 'TDR mbi. gereranya n\'ubushyuhe n\'ibimenyetso by\'akaga.'
        : fr
          ? 'TDR négatif. croiser avec fièvre et signes de danger.'
          : 'RDT negative. cross-check fever and danger signs.';
    } else if (r === 'invalid') {
      text = rw
        ? 'TDR ntabwo yemewe. ohereza gusubiramo ikizamini.'
        : fr
          ? 'TDR invalide. référer pour nouveau test.'
          : 'RDT invalid. refer for repeat testing.';
    } else {
      text = rw ? 'TDR ntiyakozwe.' : fr ? 'TDR non fait.' : 'RDT not done.';
    }
    out.push({
      field: 'tdr',
      text,
      source: 'rule',
      contribution: r === 'invalid' || r === 'positive' ? 'high' : 'medium',
      flag: r === 'invalid' ? 'invalid_tdr' : null,
    });
  }

  return out;
}

/** Soft consistency checks. never block or change decision. */
export function buildConsistencyWarnings(
  form: Partial<TriageInput>,
  answered: Set<string> | string[],
  lang: 'rw' | 'en' | 'fr' = 'en',
): ConsistencyWarning[] {
  const answeredSet = answered instanceof Set ? answered : new Set(answered);
  const warnings: ConsistencyWarning[] = [];
  const rw = lang === 'rw';
  const fr = lang === 'fr';

  if (
    answeredSet.has('temperature') &&
    answeredSet.has('feverDays') &&
    typeof form.temperature_c === 'number' &&
    typeof form.fever_days === 'number' &&
    form.temperature_c < 37.5 &&
    form.fever_days >= 3
  ) {
    warnings.push({
      id: 'temp_vs_fever_days',
      text: rw
        ? 'Nyamuneka wemeze: ubushyuhe busanzwe ariko ubushyuhe bwamaze iminsi 3+.'
        : fr
          ? 'Veuillez confirmer : température normale mais fièvre depuis 3+ jours.'
          : 'Please confirm: normal temperature but fever for 3+ days.',
      dismissible: true,
    });
  }

  if (answeredSet.has('age') && typeof form.age_months === 'number' && form.age_months > 120) {
    warnings.push({
      id: 'age_unit_check',
      text: rw
        ? 'Nyamuneka wemeze: imyaka yanditswe nka mezi ishobora kuba yari imyaka.'
        : fr
          ? 'Veuillez confirmer : l’âge en mois semble élevé (années saisies par erreur ?).'
          : 'Please confirm: age in months looks high (years entered by mistake?).',
      dismissible: true,
    });
  }

  if (
    answeredSet.has('unable_to_drink') &&
    form.unable_to_drink === false &&
    answeredSet.has('vomiting_everything') &&
    form.vomiting_everything === true
  ) {
    warnings.push({
      id: 'vomit_vs_drink',
      text: rw
        ? 'Nyamuneka wemeze: araruka byose ariko ashobora kunywa.'
        : fr
          ? 'Veuillez confirmer : vomit tout mais peut boire.'
          : 'Please confirm: vomiting everything but able to drink.',
      dismissible: true,
    });
  }

  return warnings;
}

export function insightsByField(insights: AnswerInsight[]): Record<string, AnswerInsight> {
  const map: Record<string, AnswerInsight> = {};
  for (const i of insights) map[i.field] = i;
  return map;
}

export function hashSnapshot(form: Partial<TriageInput>, answered: string[]): string {
  const keys = [
    'age_months',
    'sex',
    'temperature_c',
    'fever_days',
    'convulsions',
    'unable_to_drink',
    'vomiting_everything',
    'lethargy',
    'severe_breathing_difficulty',
    'tdr_result',
  ] as const;
  const payload: Record<string, unknown> = { answered: [...answered].sort() };
  for (const k of keys) {
    if (form[k] !== undefined) payload[k] = form[k];
  }
  return JSON.stringify(payload);
}
