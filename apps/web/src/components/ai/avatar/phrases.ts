import type { SpeakLang } from './safeSpeak';

export const GREETING_PHRASE_ID = 'avatar_greeting';
export const ASR_UNCLEAR_PHRASE_ID = 'avatar_asr_unclear';
export const OFFLINE_PHRASE_ID = 'avatar_offline_unavailable';
export const SAFETY_PHRASE_ID = 'avatar_safety_blocked';

export function greetingPhrase(lang: SpeakLang): string {
  if (lang === 'fr') return 'Bonjour. Je suis votre assistante. Posez une courte question.';
  if (lang === 'en') return 'Hello. I am your assistant. Ask a short question.';
  return 'Muraho. Ndi umufasha wawe. Baza ikibazo gito.';
}

export function asrUnclearPhrase(lang: SpeakLang): string {
  if (lang === 'fr') return "Je n'ai pas bien entendu. Réessayez.";
  if (lang === 'en') return "I didn't catch that clearly. Please try again.";
  return 'Ntabwumvise neza, subira.';
}

/** Short thinking fillers — never reuse the same index twice in a row. */
export function fillerPhrases(lang: SpeakLang): string[] {
  if (lang === 'fr') {
    return ['Oui, un instant…', 'Je regarde…', "D'accord, je vérifie…"];
  }
  if (lang === 'en') {
    return ['Yes, one moment…', 'Let me check…', 'Okay, looking now…'];
  }
  return ['Yego, reka turebe…', 'Ndategereje…', 'Ngira nsobanure…'];
}

export { offlinePhrase, safetyBlockedPhrase } from './offlinePhrases';
