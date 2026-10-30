import {
  type TimingAdvice,
  type TimingMark,
  type TimingTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const overallShownMs = 30;

const describeTake = (t: TFunction, traits: TimingTraits): string[] => {
  const offset = Math.round(Math.abs(traits.offsetMs));
  const facts = [
    traits.offsetMs >= 0
      ? t('pages.project.vocal.timing.fact.late', {
          ms: offset,
          count: traits.onsets,
        })
      : t('pages.project.vocal.timing.fact.early', {
          ms: offset,
          count: traits.onsets,
        }),
  ];
  if (Math.abs(traits.overallMs) >= overallShownMs) {
    facts.push(
      t('pages.project.vocal.timing.fact.overall', {
        ms: Math.round(traits.overallMs),
      }),
    );
  }
  return facts;
};

const describeTip = (
  t: TFunction,
  traits: TimingTraits,
  advice: TimingAdvice,
) =>
  ({
    earlier: t('pages.project.vocal.timing.tip.earlier', {
      ms: Math.round(traits.offsetMs),
    }),
    later: t('pages.project.vocal.timing.tip.later', {
      ms: Math.round(-traits.offsetMs),
    }),
  })[advice];

export const describeTiming = (
  t: TFunction,
  mark: TimingMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.timing.label'),
  title: t('pages.project.vocal.timing.title'),
  singer: [t('pages.project.vocal.timing.fact.singer')],
  you: mark.take ? describeTake(t, mark.take) : undefined,
  tip:
    mark.advice && mark.take
      ? describeTip(t, mark.take, mark.advice)
      : undefined,
  look: t('pages.project.vocal.timing.look'),
  why: t('pages.project.vocal.timing.why'),
});
