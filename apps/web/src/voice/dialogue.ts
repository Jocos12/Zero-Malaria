import type { TriageInput } from '../types';
import type { PhraseId } from './phrases';

export type TriageSlot = keyof TriageInput;

export type DialogueNode = {
  id: string;
  phraseId: PhraseId;
  slot: TriageSlot;
  next: string | null;
  danger?: boolean;
  repromptPhraseId?: PhraseId;
  helpPhraseId?: PhraseId;
};

export const TRIAGE_DIALOGUE: Record<string, DialogueNode> = {
  age: {
    id: 'age',
    phraseId: 'age',
    slot: 'age_months',
    next: 'sex',
    helpPhraseId: 'help_age',
    repromptPhraseId: 'age',
  },
  sex: {
    id: 'sex',
    phraseId: 'sex',
    slot: 'sex',
    next: 'temperature',
    helpPhraseId: 'help_sex',
    repromptPhraseId: 'sex',
  },
  temperature: {
    id: 'temperature',
    phraseId: 'temperature',
    slot: 'temperature_c',
    next: 'feverDays',
    helpPhraseId: 'help_temperature',
    repromptPhraseId: 'temperature',
  },
  feverDays: {
    id: 'feverDays',
    phraseId: 'fever_days',
    slot: 'fever_days',
    next: 'convulsions',
    helpPhraseId: 'help_fever_days',
    repromptPhraseId: 'fever_days',
  },
  convulsions: {
    id: 'convulsions',
    phraseId: 'convulsions',
    slot: 'convulsions',
    next: 'unable_to_drink',
    danger: true,
    helpPhraseId: 'help_convulsions',
    repromptPhraseId: 'convulsions',
  },
  unable_to_drink: {
    id: 'unable_to_drink',
    phraseId: 'unable_to_drink',
    slot: 'unable_to_drink',
    next: 'vomiting_everything',
    danger: true,
    helpPhraseId: 'help_unable_to_drink',
    repromptPhraseId: 'unable_to_drink',
  },
  vomiting_everything: {
    id: 'vomiting_everything',
    phraseId: 'vomiting_everything',
    slot: 'vomiting_everything',
    next: 'lethargy',
    danger: true,
    helpPhraseId: 'help_vomiting_everything',
    repromptPhraseId: 'vomiting_everything',
  },
  lethargy: {
    id: 'lethargy',
    phraseId: 'lethargy',
    slot: 'lethargy',
    next: 'breathing',
    danger: true,
    helpPhraseId: 'help_lethargy',
    repromptPhraseId: 'lethargy',
  },
  breathing: {
    id: 'breathing',
    phraseId: 'severe_breathing_difficulty',
    slot: 'severe_breathing_difficulty',
    next: 'pale_palms',
    danger: true,
    helpPhraseId: 'help_severe_breathing_difficulty',
    repromptPhraseId: 'severe_breathing_difficulty',
  },
  pale_palms: {
    id: 'pale_palms',
    phraseId: 'pale_palms_or_eyelids',
    slot: 'pale_palms_or_eyelids',
    next: 'blood_stool',
    helpPhraseId: 'help_pale_palms_or_eyelids',
    repromptPhraseId: 'pale_palms_or_eyelids',
  },
  blood_stool: {
    id: 'blood_stool',
    phraseId: 'blood_in_stool',
    slot: 'blood_in_stool',
    next: 'bloody_urine',
    helpPhraseId: 'help_blood_in_stool',
    repromptPhraseId: 'blood_in_stool',
  },
  bloody_urine: {
    id: 'bloody_urine',
    phraseId: 'dark_or_bloody_urine',
    slot: 'dark_or_bloody_urine',
    next: 'bleeding',
    helpPhraseId: 'help_dark_or_bloody_urine',
    repromptPhraseId: 'dark_or_bloody_urine',
  },
  bleeding: {
    id: 'bleeding',
    phraseId: 'bleeding_nose_gums_skin_or_vomit_blood',
    slot: 'bleeding_nose_gums_skin_or_vomit_blood',
    next: 'hemoglobin',
    helpPhraseId: 'help_bleeding_nose_gums_skin_or_vomit_blood',
    repromptPhraseId: 'bleeding_nose_gums_skin_or_vomit_blood',
  },
  hemoglobin: {
    id: 'hemoglobin',
    phraseId: 'hemoglobin_g_dl',
    slot: 'hemoglobin_g_dl',
    next: 'tdr',
    helpPhraseId: 'help_hemoglobin_g_dl',
    repromptPhraseId: 'hemoglobin_g_dl',
  },
  tdr: {
    id: 'tdr',
    phraseId: 'tdr',
    slot: 'tdr_result',
    next: null,
    helpPhraseId: 'help_tdr',
    repromptPhraseId: 'tdr',
  },
};

export const TRIAGE_DIALOGUE_ORDER: string[] = [
  'age',
  'sex',
  'temperature',
  'feverDays',
  'convulsions',
  'unable_to_drink',
  'vomiting_everything',
  'lethargy',
  'breathing',
  'pale_palms',
  'blood_stool',
  'bloody_urine',
  'bleeding',
  'hemoglobin',
  'tdr',
];

export function dialogueStepIndex(nodeId: string): number {
  return TRIAGE_DIALOGUE_ORDER.indexOf(nodeId);
}
