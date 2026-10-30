import {
  type VibratoAdvice,
  type VibratoMark,
  type VibratoTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const seconds = (ms: number) => (ms / 1000).toFixed(1);

const rate = (hz: number) => hz.toFixed(1);

const halfExtent = (cents: number) => Math.round(cents / 2);

const describeTraits = (t: TFunction, traits: VibratoTraits): string[] =>
  traits.vibrato
    ? [
        t('pages.project.vocal.vibrato.fact.vibrato', {
          delay: seconds(traits.delayMs),
          rate: rate(traits.rateHz),
          cents: halfExtent(traits.extentCents),
        }),
      ]
    : [t('pages.project.vocal.vibrato.fact.straight')];

const describeTip = (
  t: TFunction,
  mark: VibratoMark,
  advice: VibratoAdvice,
) => {
  const { lead } = mark;
  const take = mark.take ?? lead;
  const tips: Record<VibratoAdvice, () => string> = {
    add: () =>
      t('pages.project.vocal.vibrato.tip.add', {
        delay: seconds(lead.delayMs),
        rate: rate(lead.rateHz),
        cents: halfExtent(lead.extentCents),
      }),
    straight: () => t('pages.project.vocal.vibrato.tip.straight'),
    later: () =>
      t('pages.project.vocal.vibrato.tip.later', {
        delay: seconds(lead.delayMs),
      }),
    earlier: () =>
      t('pages.project.vocal.vibrato.tip.earlier', {
        delay: seconds(lead.delayMs),
      }),
    slower: () =>
      t('pages.project.vocal.vibrato.tip.slower', {
        rate: rate(lead.rateHz),
        yours: rate(take.rateHz),
      }),
    faster: () =>
      t('pages.project.vocal.vibrato.tip.faster', {
        rate: rate(lead.rateHz),
        yours: rate(take.rateHz),
      }),
    narrower: () =>
      t('pages.project.vocal.vibrato.tip.narrower', {
        cents: halfExtent(lead.extentCents),
        yours: halfExtent(take.extentCents),
      }),
    wider: () =>
      t('pages.project.vocal.vibrato.tip.wider', {
        cents: halfExtent(lead.extentCents),
        yours: halfExtent(take.extentCents),
      }),
  };
  return tips[advice]();
};

export const describeVibrato = (
  t: TFunction,
  mark: VibratoMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.vibrato.label'),
  title: t('pages.project.vocal.vibrato.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark, mark.advice) : undefined,
  look: t('pages.project.vocal.vibrato.look'),
  why: t('pages.project.vocal.vibrato.why'),
});
