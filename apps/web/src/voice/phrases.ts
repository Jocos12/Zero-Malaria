import { MALARIA_RULES } from '../rules/malariaRules.generated';
import type { Decision } from '../types';

export type VoiceLang = 'en' | 'rw';

export type PhraseEntry = { id: string; en: string; rw: string };

function p(id: string, en: string, rw: string): PhraseEntry {
  return { id, en, rw };
}

/** Fixed read-aloud catalog  -  not LLM-generated. */
export const PHRASES = {
  age: p('age', 'How old is the patient, in months?', 'Umurwayi afite imyaka ingahe, mu mezi?'),
  sex: p('sex', 'Is the patient female or male?', 'Umurwayi ni umugore cyangwa umugabo?'),
  fever: p('fever', 'Does the patient have fever?', 'Umurwayi afite ubushyuhe?'),
  fever_days: p(
    'fever_days',
    'How many days has the fever lasted?',
    'Ubushyuhe bwamaze iminsi ingahe?',
  ),
  temperature: p(
    'temperature',
    'What is the body temperature in degrees Celsius?',
    'Ubushyuhe bw\'umubiri ni bungana iki mu Celsius?',
  ),
  convulsions: p(
    'convulsions',
    'Convulsions or fits, yes or no?',
    'Gusetsa cyangwa fits, yego cyangwa oya?',
  ),
  unable_to_drink: p(
    'unable_to_drink',
    'Unable to drink or feed, yes or no?',
    'Ntashobora kunywa cyangwa kurya, yego cyangwa oya?',
  ),
  vomiting_everything: p(
    'vomiting_everything',
    'Vomiting everything, yes or no?',
    'Araruka byose, yego cyangwa oya?',
  ),
  lethargy: p(
    'lethargy',
    'Lethargy or unconsciousness, yes or no?',
    'Yacitse intege cyangwa ntabona, yego cyangwa oya?',
  ),
  severe_breathing_difficulty: p(
    'severe_breathing_difficulty',
    'Severe breathing difficulty, yes or no?',
    'Agorwa cyane n\'uruhuha, yego cyangwa oya?',
  ),
  pale_palms_or_eyelids: p(
    'pale_palms_or_eyelids',
    'Pale palms or very pale inside the eyelids, yes, no, or unknown?',
    'Umutwe w\'ibiganza cyangwa imbere y\'ijisho byera cyane, yego, oya, cyangwa simbizi?',
  ),
  blood_in_stool: p(
    'blood_in_stool',
    'Blood in the stool, yes, no, or unknown?',
    'Amaraso mu nda, yego, oya, cyangwa simbizi?',
  ),
  dark_or_bloody_urine: p(
    'dark_or_bloody_urine',
    'Dark or bloody urine, yes, no, or unknown?',
    'Inkari yijimye cyangwa ifite amaraso, yego, oya, cyangwa simbizi?',
  ),
  bleeding_nose_gums_skin_or_vomit_blood: p(
    'bleeding_nose_gums_skin_or_vomit_blood',
    'Bleeding from nose, gums, skin, or blood in vomit, yes, no, or unknown?',
    'Kuva amaraso mu zuru, mu kanwa, ku ruhu, cyangwa mu nda, yego, oya, cyangwa simbizi?',
  ),
  hemoglobin_g_dl: p(
    'hemoglobin_g_dl',
    'If known, what is the hemoglobin in grams per deciliter? You may skip.',
    'Niba uzi, hemoglobine ni ingahe mu garamu kuri desilita? Ushobora gusimbuka.',
  ),
  tdr: p(
    'tdr',
    'What is the malaria rapid test result: positive, negative, or invalid?',
    'Ikizamini cy\'uburozi cy\'umusaraba: cyiza, cyangwa nabi, cyangwa nticyemewe?',
  ),

  result_treat_at_home: p(
    'result_treat_at_home',
    'Recommendation: treat at home with community follow-up.',
    'Icyifuzo: kuvura mu rugo hamwe no gukurikirana mu mudugudu.',
  ),
  result_refer: p(
    'result_refer',
    'Recommendation: refer the patient to a health center.',
    'Icyifuzo: ohereza umurwayi ku kigo nderabuzima.',
  ),
  result_urgent_refer: p(
    'result_urgent_refer',
    'Urgent recommendation: refer immediately to a health center.',
    'Icyifuzo cyihutirwa: ohereze vuba ku kigo nderabuzima.',
  ),

  reason_convulsions: p(
    'reason_convulsions',
    MALARIA_RULES.danger_signs.find((s) => s.id === 'convulsions')!.reason_en,
    MALARIA_RULES.danger_signs.find((s) => s.id === 'convulsions')!.reason_rw,
  ),
  reason_unable_to_drink: p(
    'reason_unable_to_drink',
    MALARIA_RULES.danger_signs.find((s) => s.id === 'unable_to_drink')!.reason_en,
    MALARIA_RULES.danger_signs.find((s) => s.id === 'unable_to_drink')!.reason_rw,
  ),
  reason_vomiting_everything: p(
    'reason_vomiting_everything',
    MALARIA_RULES.danger_signs.find((s) => s.id === 'vomiting_everything')!.reason_en,
    MALARIA_RULES.danger_signs.find((s) => s.id === 'vomiting_everything')!.reason_rw,
  ),
  reason_lethargy: p(
    'reason_lethargy',
    MALARIA_RULES.danger_signs.find((s) => s.id === 'lethargy')!.reason_en,
    MALARIA_RULES.danger_signs.find((s) => s.id === 'lethargy')!.reason_rw,
  ),
  reason_severe_breathing_difficulty: p(
    'reason_severe_breathing_difficulty',
    MALARIA_RULES.danger_signs.find((s) => s.id === 'severe_breathing_difficulty')!.reason_en,
    MALARIA_RULES.danger_signs.find((s) => s.id === 'severe_breathing_difficulty')!.reason_rw,
  ),

  reason_infant_age_referral: p(
    'reason_infant_age_referral',
    MALARIA_RULES.rules.find((r) => r.id === 'infant_age_referral')!.reason_en,
    MALARIA_RULES.rules.find((r) => r.id === 'infant_age_referral')!.reason_rw,
  ),
  reason_invalid_tdr_refer: p(
    'reason_invalid_tdr_refer',
    MALARIA_RULES.rules.find((r) => r.id === 'invalid_tdr_refer')!.reason_en,
    MALARIA_RULES.rules.find((r) => r.id === 'invalid_tdr_refer')!.reason_rw,
  ),
  reason_persistent_fever_negative_tdr: p(
    'reason_persistent_fever_negative_tdr',
    MALARIA_RULES.rules.find((r) => r.id === 'persistent_fever_negative_tdr')!.reason_en,
    MALARIA_RULES.rules.find((r) => r.id === 'persistent_fever_negative_tdr')!.reason_rw,
  ),
  reason_incomplete_assessment: p(
    'reason_incomplete_assessment',
    MALARIA_RULES.rules.find((r) => r.id === 'incomplete_assessment')!.reason_en,
    MALARIA_RULES.rules.find((r) => r.id === 'incomplete_assessment')!.reason_rw,
  ),
  reason_default_treat_at_home: p(
    'reason_default_treat_at_home',
    MALARIA_RULES.rules.find((r) => r.id === 'default_treat_at_home')!.reason_en,
    MALARIA_RULES.rules.find((r) => r.id === 'default_treat_at_home')!.reason_rw,
  ),

  next_treat_at_home: p(
    'next_treat_at_home',
    'Give home care advice, schedule follow-up, and confirm the decision before closing.',
    'Tanga inama zo kwita mu rugo, teganya gukurikirana, wemeze icyemezo mbere yo gufunga.',
  ),
  next_treat_1: p(
    'next_treat_1',
    'Complete any missing assessment questions if still open.',
    'Uzuza ibibazo by\'isuzuma bibuze niba biracyari bifunguye.',
  ),
  next_treat_2: p(
    'next_treat_2',
    'Advise home care and fever follow-up per protocol.',
    'Tanga inama zo kwita mu rugo no gukurikirana ubushyuhe hakurikijwe amabwiriza.',
  ),
  next_treat_3: p(
    'next_treat_3',
    'Explain danger signs that require immediate return.',
    'Sobanura ibimenyetso by\'akaga bisaba gusubira vuba.',
  ),
  next_treat_4: p(
    'next_treat_4',
    'Confirm this recommendation on screen before you finish.',
    'Emeza icyifuzo kuri ekrani mbere yo kurangiza.',
  ),
  next_refer: p(
    'next_refer',
    'Prepare a referral handover and help the patient reach the health center.',
    'Tegeka kohereza umurwayi kandi umufashe kugera ku kigo nderabuzima.',
  ),
  next_refer_1: p(
    'next_refer_1',
    'Prepare a referral handover summary.',
    'Tegeka incamake yo kohereza umurwayi.',
  ),
  next_refer_2: p(
    'next_refer_2',
    'Send the patient to the health facility today.',
    'Ohereza umurwayi ku kigo nderabuzima uyu munsi.',
  ),
  next_refer_3: p(
    'next_refer_3',
    'Advise caregiver on danger signs while traveling.',
    'Menyesha umurezi ibimenyetso by\'akaga mu nzira.',
  ),
  next_urgent_refer: p(
    'next_urgent_refer',
    'Refer urgently now. Stay with the patient if possible and call for transport help.',
    'Ohereza vuba. Guma hafi y\'umurwayi niba bishoboka kandi hamagara ubufasha bwo gutwara.',
  ),
  next_urgent_1: p(
    'next_urgent_1',
    'Stay with the patient; do not delay.',
    'Guma hafi y\'umurwayi; ntutinye.',
  ),
  next_urgent_2: p(
    'next_urgent_2',
    'Arrange urgent transport to the health center.',
    'Teganya uburyo bwo gutwara vuba ku kigo nderabuzima.',
  ),
  next_urgent_3: p(
    'next_urgent_3',
    'Tell the nurse the danger signs and RDT result.',
    'Bwirira umuforomo ibimenyetso by\'akaga n\'igisubizo cya TDR.',
  ),
  next_urgent_4: p(
    'next_urgent_4',
    'Do not give community doses. Not in this protocol pack.',
    'Ntanga doze zo mu mudugudu. Ntabwo ziri muri aya mabwiriza.',
  ),

  confirm_reminder: p(
    'confirm_reminder',
    'Please confirm this recommendation on screen before you finish.',
    'Nyamuneka wemeze icyo cyifuzo kuri ekrani mbere yo kurangiza.',
  ),
  disclaimer: p(
    'disclaimer',
    MALARIA_RULES.meta.disclaimer,
    'Iyi ni igikoresho cy\'ubufasha mu gufata icyemezo. Si ahantu ho gusimbura ubuvuzi.',
  ),

  prevention_nets: p(
    'prevention_nets',
    'Sleep under an insecticide-treated bed net every night.',
    'Rya munsi y\'urutoki rw\'ibisabwa buri joro.',
  ),
  prevention_exposure: p(
    'prevention_exposure',
    'Reduce mosquito bites: cover arms and legs in the evening, clear standing water near homes.',
    'Gabanya ibitotsi by\'inzige: ukinge intoki n\'amaguru nimugoroba, kuraho amazi ahagaze hafi y\'urugo.',
  ),
  prevention_early_test: p(
    'prevention_early_test',
    'Test early when fever starts, do not wait many days.',
    'Kora ikizamini vuba ubushyuhe buhera, ntugere ute iminsi myinshi.',
  ),
  prevention_early_care: p(
    'prevention_early_care',
    'Seek care quickly if danger signs appear or the child worsens.',
    'Shakira ubuvuzi vuba niba ibimenyetso by\'akaga bihagaze cyangwa umwana agenda ababaye.',
  ),

  why_generic: p(
    'why_generic',
    'Here is why this recommendation was made, based on the rules that were triggered.',
    'Dore impamvu icyifuzo cyakozwe, hashingiwe ku mategeko yabonetse.',
  ),
  what_now_generic: p(
    'what_now_generic',
    'Here is what to do next for this recommendation.',
    'Dore icyo ugomba gukora ubu kuri iyi recommendation.',
  ),
  slower_hint: p(
    'slower_hint',
    'I will speak more slowly.',
    'Nzavuga buhoro.',
  ),
  repeat_hint: p(
    'repeat_hint',
    'I will repeat the recommendation.',
    'Nzongera gusubiramo icyifuzo.',
  ),

  help_age: p(
    'help_age',
    'Age in months drives infant referral rules. Use months for children under five.',
    'Imyaka mu mezi igena amategeko yo kohereza abana bato. Koresha amezi ku bana bari munsi y\'imyaka itanu.',
  ),
  help_sex: p(
    'help_sex',
    'Sex is recorded for the patient record; it does not change the malaria decision alone.',
    'Igitsina cyandikwa mu dosiye; nticyihindura icyemezo cya malaria cyonyine.',
  ),
  help_temperature: p(
    'help_temperature',
    'Measure axillary or rectal temperature. Very high fever with danger signs needs urgent referral.',
    'Pima ubushyuhe bw\'umubiri. Ubushyuhe bwinshi hamwe n\'ibimenyetso by\'akaga bisaba kohereza vuba.',
  ),
  help_fever_days: p(
    'help_fever_days',
    'Long fever with a negative test may still need referral per national rules.',
    'Ubushyuhe bw\'iminsi myinshi n\'ikizamini cyiza bishobora gusaba kohereza ukurikije amategeko.',
  ),
  help_convulsions: p(
    'help_convulsions',
    'Convulsions are a danger sign, answer yes if the patient had fits or seizures.',
    'Gusetsa ni ikimenyetso cy\'akaga, subiza yego niba umurwayi yagize fits cyangwa seizures.',
  ),
  help_unable_to_drink: p(
    'help_unable_to_drink',
    'Yes if the patient cannot drink or breastfeed at all.',
    'Subiza yego niba umurwayi ntashobora kunywa cyangwa kuronsa na gato.',
  ),
  help_vomiting_everything: p(
    'help_vomiting_everything',
    'Yes if the patient vomits all food or fluids and cannot keep anything down.',
    'Subiza yego niba araruka byose kandi ntashobora kubika ibyo yariye cyangwa yanyoye.',
  ),
  help_lethargy: p(
    'help_lethargy',
    'Yes if the patient is very weak, difficult to wake, or unconscious.',
    'Subiza yego niba umurwayi afite intege nke cyane, agorwa gukanguka, cyangwa ntabona.',
  ),
  help_severe_breathing_difficulty: p(
    'help_severe_breathing_difficulty',
    'Yes if breathing is fast, noisy, or the chest pulls in with each breath.',
    'Subiza yego niba aruhuka vuba, ijwi ryo guhumeka, cyangwa igifu kinjira mu guhumeka.',
  ),
  help_pale_palms_or_eyelids: p(
    'help_pale_palms_or_eyelids',
    'Check palm color and inside the lower eyelid. This is stored for the nurse; it does not change the urgent decision until clinicians validate the rule.',
    'Reba ibara ry\'ibiganza n\'imbere y\'ijisho. Byandikwa ku muforomo; ntibihindura icyemezo cyihutirwa kugeza abaganga ba RBC bemeye amategeko.',
  ),
  help_blood_in_stool: p(
    'help_blood_in_stool',
    'Ask the caregiver if they saw blood in the stool. Inform the nurse if yes. Rules escalation is off until RBC validation.',
    'Baza umurezi niba yabonye amaraso mu nda. Menyesha umuforomo niba ari yego. Kohereza byihutirwa birafunze kugeza RBC ibemeye.',
  ),
  help_dark_or_bloody_urine: p(
    'help_dark_or_bloody_urine',
    'Dark or red urine may need nurse review. Your answer is recorded; automated urgency from this alone is disabled.',
    'Inkari yijimye cyangwa itukura ishobora gusuzumwa n\'umuforomo. Igisubizo cyandikwa; ubwihutirwa bwikora ntibukora kuri iki gusa.',
  ),
  help_bleeding_nose_gums_skin_or_vomit_blood: p(
    'help_bleeding_nose_gums_skin_or_vomit_blood',
    'Include nose, gums, skin, or vomit with blood. Tell the nurse if yes. You can still refer manually anytime.',
    'Harimo mu zuru, mu kanwa, ku ruhu, cyangwa mu nda. Menyesha umuforomo niba ari yego. Ushobora kohereza ukivuze igihe cyose.',
  ),
  help_hemoglobin_g_dl: p(
    'help_hemoglobin_g_dl',
    'Optional lab value in g/dL. Skip if unknown. No automated threshold is applied in this demo.',
    'Agaciro ko mu garamu kuri desilita (si ngombwa). Simbuka niba utazi. Nta gipimo cyikora mu iyi demo.',
  ),
  help_tdr: p(
    'help_tdr',
    'Record the rapid diagnostic test result from the cassette. Invalid means the test failed, do not treat on that result alone.',
    'Andika igisubizo cy\'ikizamini cy\'umusaraba. Nticyemewe bisobanuye ko ikizamini cyanze, ntuvure ukurikije gusa icyo.',
  ),
  help_freetext: p(
    'help_freetext',
    'Optional notes in Kinyarwanda or English. AI may suggest fields, you must verify before applying.',
    'Inyandiko z\'ubushobozi mu Kinyarwanda cyangwa Icyongereza. AI ishobora gusaba ibice, ugomba kubigenzura mbere yo kubikoresha.',
  ),
  guided_greeting: p(
    'guided_greeting',
    'Voice guided triage. I will ask each question. Answer clearly, then confirm what I heard.',
    'Gupima mu ijwi. Nzakubaza ibibazo. Subiza neza, hanyuma wemeze ibyo numvise.',
  ),
  confirm_danger_sign: p(
    'confirm_danger_sign',
    'This is a danger sign. Please say yes to confirm, or no if I misunderstood.',
    'Iki ni ikimenyetso cy\'akaga. Vuga yego niba ari ukuri, cyangwa oya niba nabitumvise nabi.',
  ),

  prompt_yes: p('prompt_yes', 'Yes', 'Yego'),
  prompt_no: p('prompt_no', 'No', 'Oya'),
  prompt_yes_common: p('prompt_yes_common', 'Yes', 'Yego'),
  prompt_no_common: p('prompt_no_common', 'No', 'Oya'),
  prompt_unknown: p('prompt_unknown', 'Unknown', 'Simbizi'),
  opt_female: p('opt_female', 'Female', 'Umugore'),
  opt_male: p('opt_male', 'Male', 'Umugabo'),
  opt_positive: p('opt_positive', 'Positive', 'Cyiza (positive)'),
  opt_negative: p('opt_negative', 'Negative', 'Nabi (negative)'),
  opt_invalid: p('opt_invalid', 'Invalid', 'Nticyemewe'),
  prompt_skip_hemoglobin: p(
    'prompt_skip_hemoglobin',
    'Skip hemoglobin',
    'Simbuka hemoglobine',
  ),
} as const satisfies Record<string, PhraseEntry>;

export type PhraseId = keyof typeof PHRASES;

function applyTemplate(text: string): string {
  return text
    .replaceAll('{infant_refer_months}', String(MALARIA_RULES.infant_refer_months))
    .replaceAll('{persistent_fever_days}', String(MALARIA_RULES.persistent_fever_days));
}

export function getPhrase(id: PhraseId, lang: VoiceLang): string {
  const entry = PHRASES[id];
  const raw = lang === 'rw' ? entry.rw : entry.en;
  return applyTemplate(raw);
}

export function reasonPhraseIdForRuleOrSign(ruleOrSignId: string): PhraseId | null {
  const key = `reason_${ruleOrSignId}` as PhraseId;
  return key in PHRASES ? key : null;
}

export function buildResultSequence(decision: Decision, triggered_rules: string[]): PhraseId[] {
  const seq: PhraseId[] = [];
  if (decision === 'treat_at_home') seq.push('result_treat_at_home');
  else if (decision === 'refer') seq.push('result_refer');
  else seq.push('result_urgent_refer');

  for (const id of triggered_rules) {
    const reasonId = reasonPhraseIdForRuleOrSign(id);
    if (reasonId) seq.push(reasonId);
  }

  if (decision === 'treat_at_home') {
    seq.push('next_treat_1', 'next_treat_2', 'next_treat_3', 'next_treat_4');
  } else if (decision === 'refer') {
    seq.push('next_refer_1', 'next_refer_2', 'next_refer_3');
  } else {
    seq.push('next_urgent_1', 'next_urgent_2', 'next_urgent_3', 'next_urgent_4');
  }

  seq.push('confirm_reminder');
  return seq;
}

/** Fixed catalog steps for the Result "What to do now" card (never LLM). */
export const NEXT_STEPS_BY_DECISION: Record<Decision, PhraseId[]> = {
  treat_at_home: ['next_treat_1', 'next_treat_2', 'next_treat_3', 'next_treat_4'],
  refer: ['next_refer_1', 'next_refer_2', 'next_refer_3'],
  urgent_refer: ['next_urgent_1', 'next_urgent_2', 'next_urgent_3', 'next_urgent_4'],
};

export const PREVENTION_PHRASE_IDS: PhraseId[] = [
  'prevention_nets',
  'prevention_exposure',
  'prevention_early_test',
  'prevention_early_care',
];
