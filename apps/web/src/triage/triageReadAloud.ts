import type { PhraseId } from '../voice/phrases';

/** Triage step ids aligned with TriagePage STEPS. */
export type TriageReadAloudStep =
  | 'age'
  | 'sex'
  | 'temperature'
  | 'feverDays'
  | 'convulsions'
  | 'unable_to_drink'
  | 'vomiting_everything'
  | 'lethargy'
  | 'breathing'
  | 'pale_palms'
  | 'blood_stool'
  | 'bloody_urine'
  | 'bleeding'
  | 'hemoglobin'
  | 'tdr'
  | 'freetext';

const YES_NO: PhraseId[] = ['prompt_yes', 'prompt_no'];
const YES_NO_UNKNOWN: PhraseId[] = ['prompt_yes', 'prompt_no', 'prompt_unknown'];

const STEP_OPTIONS: Partial<Record<TriageReadAloudStep, PhraseId[]>> = {
  sex: ['opt_female', 'opt_male'],
  convulsions: YES_NO,
  unable_to_drink: YES_NO,
  vomiting_everything: YES_NO,
  lethargy: YES_NO,
  breathing: YES_NO,
  pale_palms: YES_NO_UNKNOWN,
  blood_stool: YES_NO_UNKNOWN,
  bloody_urine: YES_NO_UNKNOWN,
  bleeding: YES_NO_UNKNOWN,
  tdr: ['opt_positive', 'opt_negative', 'opt_invalid'],
  hemoglobin: ['prompt_skip_hemoglobin'],
};

/** Question + answer options for one step (phrase catalog only). */
export function phraseIdsForTriageStep(
  step: TriageReadAloudStep,
  questionPhrase?: PhraseId,
): PhraseId[] {
  const ids: PhraseId[] = [];
  if (questionPhrase) ids.push(questionPhrase);
  const opts = STEP_OPTIONS[step];
  if (opts?.length) ids.push(...opts);
  return ids;
}

export function phraseIdsForAllTriageSteps(
  steps: TriageReadAloudStep[],
  questionFor: (step: TriageReadAloudStep) => PhraseId | undefined,
): PhraseId[] {
  const out: PhraseId[] = [];
  for (const s of steps) {
    out.push(...phraseIdsForTriageStep(s, questionFor(s)));
  }
  return out;
}
