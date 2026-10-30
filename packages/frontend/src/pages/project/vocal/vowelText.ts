import {
  type VowelAdvice,
  type VowelMark,
  type VowelTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const shownDb = 3;

const describeTraits = (t: TFunction, traits: VowelTraits): string[] => {
  const facts: string[] = [];
  const open = Math.round(Math.abs(traits.openDb));
  const front = Math.round(Math.abs(traits.frontDb));
  if (traits.openDb >= shownDb) {
    facts.push(t('pages.project.vocal.vowel.fact.open', { db: open }));
  } else if (traits.openDb <= -shownDb) {
    facts.push(t('pages.project.vocal.vowel.fact.close', { db: open }));
  }
  if (traits.frontDb >= shownDb) {
    facts.push(t('pages.project.vocal.vowel.fact.front', { db: front }));
  } else if (traits.frontDb <= -shownDb) {
    facts.push(t('pages.project.vocal.vowel.fact.round', { db: front }));
  }
  return facts;
};

const describeTip = (t: TFunction, advice: VowelAdvice) =>
  ({
    open: t('pages.project.vocal.vowel.tip.open'),
    close: t('pages.project.vocal.vowel.tip.close'),
    front: t('pages.project.vocal.vowel.tip.front'),
    round: t('pages.project.vocal.vowel.tip.round'),
  })[advice];

export const describeVowel = (
  t: TFunction,
  mark: VowelMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.vowel.label'),
  title: t('pages.project.vocal.vowel.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark.advice) : undefined,
  look: t('pages.project.vocal.vowel.look'),
  why: t('pages.project.vocal.vowel.why'),
});
