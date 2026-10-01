/** Readable triggered-rule sentences (never raw keys like unable_to_drink). */

export type RuleLang = 'en' | 'rw' | 'fr';

const RULE_SENTENCE: Record<string, { en: string; rw: string; fr: string }> = {
  convulsions: {
    en: 'Convulsions (fits) were reported',
    rw: 'Gusetsa (fits) byavuzwe',
    fr: 'Des convulsions ont été signalées',
  },
  unable_to_drink: {
    en: 'Unable to drink or feed was reported',
    rw: 'Ntashobora kunywa cyangwa kurya byavuzwe',
    fr: 'Incapacité de boire ou de s’alimenter signalée',
  },
  vomiting_everything: {
    en: 'Vomiting everything was reported',
    rw: 'Araruka byose byavuzwe',
    fr: 'Vomissements de tout ont été signalés',
  },
  lethargy: {
    en: 'Lethargy or unconsciousness was reported',
    rw: 'Yacitse intege cyangwa ntabona byavuzwe',
    fr: 'Léthargie ou inconscience signalée',
  },
  severe_breathing_difficulty: {
    en: 'Severe breathing difficulty was reported',
    rw: "Agorwa cyane n'uruhuha byavuzwe",
    fr: 'Détresse respiratoire sévère signalée',
  },
  invalid_tdr_refer: {
    en: 'Invalid RDT. Refer for repeat testing.',
    rw: 'TDR ntabwo yemewe. Ohereza gusubiramo.',
    fr: 'TDR invalide. Référer pour nouveau test.',
  },
  infant_age_referral: {
    en: 'Young-infant age band triggers referral',
    rw: "Imyaka y'umwana muto isaba kohereza",
    fr: 'Tranche d’âge nourrisson → référence',
  },
  default_treat_at_home: {
    en: 'No danger-sign or referral rule on answered fields',
    rw: "Nta kimenyetso cy'akaga cyabonetse ku bisubizo",
    fr: 'Aucun signe de danger / règle de référence sur les réponses',
  },
};

export function ruleSentence(id: string, lang: string): string {
  const row = RULE_SENTENCE[id];
  if (!row) {
    // Never show snake_case keys — humanize as last resort
    return id.replace(/_/g, ' ');
  }
  if (lang.startsWith('rw')) return row.rw;
  if (lang.startsWith('fr')) return row.fr;
  return row.en;
}

export function shortReason(reasons: string[] | undefined, triggered: string[] | undefined, lang: string): string {
  // Prefer localized rule sentences so RW UI never shows English reason strings from API.
  if (triggered?.[0]) return ruleSentence(triggered[0], lang);
  if (reasons?.[0] && !lang.startsWith('rw')) return reasons[0];
  return '';
}
