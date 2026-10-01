import type { SpeakLang } from './safeSpeak';

/** Fixed short lines for offline / safety — safe to cache and speak. No PHI. */
export const OFFLINE_PHRASE_ID = 'avatar_offline_unavailable';
export const SAFETY_PHRASE_ID = 'avatar_safety_blocked';

export function offlinePhrase(lang: SpeakLang): string {
  if (lang === 'fr') {
    return "Je suis hors ligne. Lisez le texte à l'écran. C'est vous qui décidez.";
  }
  if (lang === 'en') {
    return 'I am offline. Please read the text on screen. You decide.';
  }
  return 'Nta murandasi. Soma inyandiko. Ni wowe ufasisha icyemezo.';
}

export function safetyBlockedPhrase(lang: SpeakLang): string {
  if (lang === 'fr') {
    return "Je ne peux pas lire cette réponse à voix haute. Suivez le protocole à l'écran.";
  }
  if (lang === 'en') {
    return 'I cannot read that answer aloud. Follow the protocol on screen.';
  }
  return 'Sinshobora gusoma iriya gisubizo mu ijwi. Kurikiza amabwiriza ku mushinga.';
}
