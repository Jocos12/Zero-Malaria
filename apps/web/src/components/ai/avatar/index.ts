export { AssistantAvatar, type AvatarMood } from './AssistantAvatar';
export { useAvatarState } from './useAvatarState';
export { useLipSync } from './useLipSync';
export {
  useConversation,
  memorySlice,
  hasGreetedThisSession,
  markGreetedThisSession,
  clearGreetedThisSession,
  type TurnState,
} from './useConversation';
export { createSpeakQueue, splitSentences } from './speakQueue';
export {
  sanitizeForSpeech,
  speakLangCode,
  speakTextBrowser,
  stopBrowserSpeech,
  type SpeakLang,
} from './safeSpeak';
export {
  greetingPhrase,
  asrUnclearPhrase,
  fillerPhrases,
  offlinePhrase,
  safetyBlockedPhrase,
  GREETING_PHRASE_ID,
  ASR_UNCLEAR_PHRASE_ID,
  OFFLINE_PHRASE_ID,
  SAFETY_PHRASE_ID,
} from './phrases';
export { getAvatarAudio, putAvatarAudio } from './audioCache';
