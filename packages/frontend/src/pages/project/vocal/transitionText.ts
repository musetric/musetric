import {
  type TransitionAdvice,
  type TransitionMark,
  type TransitionTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const stepMs = 40;
const overshootShownCents = 30;

const semitones = (cents: number) => (Math.abs(cents) / 100).toFixed(1);

const describeTraits = (t: TFunction, traits: TransitionTraits): string[] => {
  const interval = semitones(traits.intervalCents);
  const facts = [
    traits.slideMs <= stepMs
      ? t('pages.project.vocal.transition.fact.step', {
          semitones: interval,
          ms: Math.round(traits.slideMs),
        })
      : t('pages.project.vocal.transition.fact.slide', {
          semitones: interval,
          ms: Math.round(traits.slideMs),
        }),
  ];
  if (traits.overshootCents >= overshootShownCents) {
    facts.push(
      t('pages.project.vocal.transition.fact.overshoot', {
        cents: Math.round(traits.overshootCents),
      }),
    );
  }
  return facts;
};

const describeTip = (
  t: TFunction,
  mark: TransitionMark,
  advice: TransitionAdvice,
) => {
  const tips: Record<TransitionAdvice, () => string> = {
    slide: () =>
      t('pages.project.vocal.transition.tip.slide', {
        ms: Math.round(mark.lead.slideMs),
      }),
    step: () => t('pages.project.vocal.transition.tip.step'),
    overshoot: () =>
      t('pages.project.vocal.transition.tip.overshoot', {
        cents: Math.round(mark.lead.overshootCents),
      }),
    noOvershoot: () => t('pages.project.vocal.transition.tip.noOvershoot'),
  };
  return tips[advice]();
};

export const describeTransition = (
  t: TFunction,
  mark: TransitionMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.transition.label'),
  title: t('pages.project.vocal.transition.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark, mark.advice) : undefined,
  look: t('pages.project.vocal.transition.look'),
  why: t('pages.project.vocal.transition.why'),
});
