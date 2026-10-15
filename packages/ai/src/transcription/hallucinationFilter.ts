import { type TranscriptionSegment, type TranscriptionWord } from './types.js';

const hallucinationPatterns: RegExp[] = [
  /субтитр/i,
  /дима\s*торзок/i,
  /dimatorzok/i,
  /редактор\s+субтитров/i,
  /корректор/i,
  /продолжение\s+следует/i,
  /подписывайтесь/i,
  /спасибо\s+за\s+просмотр/i,

  /subtitles?\s+by/i,
  /thanks?\s+for\s+watching/i,
  /please\s+subscribe/i,
  /subscribe\s+to/i,

  /^(?:thank\s*you[\s.,!]*)+$/i,

  /amara\.org/i,
  /transcri(?:bed|ption)\s+by/i,
  /www\./i,
  /\.com\b/i,

  /©\s*transcript/i,
  /emily\s+beynon/i,
];

export const isHallucination = (text: string): boolean => {
  const stripped = text.trim();
  if (!stripped) {
    return false;
  }
  return hallucinationPatterns.some((pattern) => pattern.test(stripped));
};

export const filterHallucinatedSegments = (
  segments: TranscriptionSegment[],
): TranscriptionSegment[] =>
  segments.filter((segment) => !isHallucination(segment.text));

const signOffPattern =
  /^(?:vielen dank|danke(?: schön)?|gracias|muchas gracias|merci(?: beaucoup)?|спасибо|thank you|thanks|bye(?: bye)?|tschüss|adiós|au revoir|до свидания)[\s.,!]*$/iu;

export const isSignOff = (text: string): boolean =>
  signOffPattern.test(text.trim());

export const filterSignOffSegments = (
  segments: TranscriptionSegment[],
): TranscriptionSegment[] =>
  segments.filter((segment) => !isSignOff(segment.text));

const creditPhrases: RegExp[] = [
  /(?<!\p{L})sous-titr\p{L}*(?: (?:société radio-canada|st' ?501|fr|par (?:jérémy diaz|juanfrance)|réalisés par la communauté d'amara\.org))?/giu,
  /(?<!\p{L})société radio-canada/giu,
  /(?<!\p{L})untertitel(?:ung)? (?:des zdf|im auftrag des zdf(?: für funk)?|der amara\.org-community)(?:,? \d{4})?/giu,
  /(?<!\p{L})subt[ií]tulos? (?:realizados )?por la comunidad de amara\.org/giu,
  /(?<!\p{L})suscr[ií]bete(?: al canal)?/giu,
  /(?<!\p{L})gracias por ver el v[ií]deo/giu,
  /(?<!\p{L})legenda adriana zanotto/giu,
  /(?<!\p{L})merci d'avoir regardé(?: cette vidéo)?/giu,
  /(?<!\p{L})(?:la )?iglesia (?:de jesucristo )?(?:de los santos )?(?:de los )?últimos días/giu,
];

type TextRange = { from: number; to: number };

const creditRanges = (text: string): TextRange[] =>
  creditPhrases.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      from: match.index,
      to: match.index + match[0].length,
    })),
  );

export const dropCreditWords = (
  words: TranscriptionWord[],
): TranscriptionWord[] => {
  const starts: number[] = [];
  let text = '';
  for (const word of words) {
    text += text ? ' ' : '';
    starts.push(text.length);
    text += word.text;
  }
  const ranges = creditRanges(text);
  if (ranges.length === 0) {
    return words;
  }
  return words.filter(
    (_, index) =>
      !ranges.some(
        (range) => starts[index] >= range.from && starts[index] < range.to,
      ),
  );
};
