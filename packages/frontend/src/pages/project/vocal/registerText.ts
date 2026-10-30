import {
  type RegisterAdvice,
  type RegisterMark,
  type RegisterTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const lightGapDb = 12;
const fullGapDb = 3;

const describeTraits = (t: TFunction, traits: RegisterTraits): string[] => {
  const gap = Math.round(traits.firstOverSecondDb);
  const upper = Math.round(-traits.upperDb);
  if (traits.firstOverSecondDb >= lightGapDb) {
    return [t('pages.project.vocal.register.fact.light', { db: gap, upper })];
  }
  if (traits.firstOverSecondDb <= fullGapDb) {
    return [
      gap < 0
        ? t('pages.project.vocal.register.fact.belt', { db: -gap, upper })
        : t('pages.project.vocal.register.fact.full', { db: gap, upper }),
    ];
  }
  return [t('pages.project.vocal.register.fact.mixed', { db: gap, upper })];
};

const describeTip = (t: TFunction, advice: RegisterAdvice) =>
  ({
    fuller: t('pages.project.vocal.register.tip.fuller'),
    lighter: t('pages.project.vocal.register.tip.lighter'),
  })[advice];

export const describeRegister = (
  t: TFunction,
  mark: RegisterMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.register.label'),
  title: t('pages.project.vocal.register.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark.advice) : undefined,
  look: t('pages.project.vocal.register.look'),
  why: t('pages.project.vocal.register.why'),
});
