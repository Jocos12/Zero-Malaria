/** Localized protocol recommendation copy (mirrors API local_mode). */

export type ProtocolLang = 'rw' | 'en';

function langOf(language: string): ProtocolLang {
  return language.startsWith('rw') ? 'rw' : 'en';
}

/** Strip em/en dashes from CHW-facing text. */
export function stripDashes(text: string): string {
  return (text || '')
    .replace(/[\u2014\u2013\u2212]+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const DANGER: Record<string, { rw: string; en: string }> = {
  convulsions: { rw: 'gusetsa', en: 'convulsions' },
  unable_to_drink: { rw: 'ntashobora kunywa', en: 'unable to drink' },
  vomiting_everything: { rw: 'kuraruka byose', en: 'vomiting everything' },
  lethargy: { rw: "gucika intege / ntabona", en: 'lethargy or unconsciousness' },
  severe_breathing_difficulty: { rw: "agorwa n'uruhuha", en: 'severe breathing difficulty' },
};

export function protocolSteps(decision: string, language: string): string[] {
  const rw = langOf(language) === 'rw';
  if (decision === 'urgent_refer') {
    return rw
      ? [
          "Komeza uri hafi y'umurwayi. Ntutinye.",
          'Tegura gutwara umwana ku kigo nderabuzima byihutirwa.',
          "Bwirira umuforomo ibimenyetso by'akaga n'igisubizo cya TDR.",
          "Ntanga doze zo mu mudugudu. Ntabwo ziri muri aya mabwiriza.",
        ]
      : [
          'Stay with the patient. Do not delay.',
          'Arrange urgent transport to the health center.',
          'Tell the nurse the danger signs and RDT result.',
          'Do not give community doses. Not in this protocol pack.',
        ];
  }
  if (decision === 'refer') {
    return rw
      ? [
          'Tegura incamake yo kohereza.',
          'Ohereza umurwayi ku kigo nderabuzima uyu munsi.',
          "Sobanurira umurezi ibimenyetso by'akaga mu nzira.",
        ]
      : [
          'Prepare a referral handover summary.',
          'Send the patient to the health facility today.',
          'Advise caregiver on danger signs while traveling.',
        ];
  }
  return rw
    ? [
        'Zuza ibibazo byasigaye niba bikenewe.',
        'Tanga inama zo kuvura mu rugo no gukurikirana ubushyuhe.',
        "Sobanura ibimenyetso by'akaga bisaba kagaruka vuba.",
      ]
    : [
        'Complete any missing assessment questions if still open.',
        'Advise home care and fever follow-up per protocol.',
        'Explain danger signs that require immediate return.',
      ];
}

export function protocolFamily(decision: string, language: string): string {
  const rw = langOf(language) === 'rw';
  if (decision === 'urgent_refer') {
    return rw
      ? "Sobanurira umuryango ko hari ibimenyetso by'akaga. Bagende ku kigo nderabuzima NONAHA."
      : 'Explain that danger signs require urgent facility care now.';
  }
  if (decision === 'refer') {
    return rw
      ? 'Sobanura impamvu yo kohereza. Bazane igisubizo cya TDR niba kibonetse.'
      : 'Explain why referral is needed and what to bring (RDT result if available).';
  }
  return rw
    ? "Kurikiranira gusetsa, kutashobora kunywa, kuraruka byose, gucika intege, cyangwa agorwa n'uruhuha."
    : 'Watch for fits, inability to drink, vomiting everything, lethargy, or severe breathing difficulty.';
}

export function protocolComeBack(decision: string, language: string): string {
  const rw = langOf(language) === 'rw';
  if (decision === 'urgent_refer') {
    return rw
      ? 'Genda nonaha. Kurikiranira niba aruhuha byongereye, gusetsa, cyangwa ntashobora kunywa.'
      : 'Go now. Watch for worsening breathing, fits, or inability to drink.';
  }
  if (decision === 'refer') {
    return rw
      ? "Garuka vuba niba ibimenyetso by'akaga bigaragara."
      : 'Return sooner if danger signs appear.';
  }
  return rw
    ? "Garuka niba ubushyuhe bukomeje cyangwa hakagaragara ikimenyetso cy'akaga."
    : 'Come back if fever persists or any danger sign appears.';
}

export function protocolWhy(triggered: string[] | undefined, language: string): string[] {
  const rw = langOf(language) === 'rw';
  const out: string[] = [];
  for (const rid of (triggered || []).slice(0, 2)) {
    const d = DANGER[rid];
    if (d) {
      out.push(rw ? `${d.rw} byavuzwe` : `${d.en.charAt(0).toUpperCase()}${d.en.slice(1)} was reported`);
    }
  }
  return out;
}
