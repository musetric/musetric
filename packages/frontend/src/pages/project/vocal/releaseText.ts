import {
  type ReleaseAdvice,
  type ReleaseMark,
  type ReleaseTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const fallShownCents = 40;

const seconds = (ms: number) => (ms / 1000).toFixed(1);

const describeTraits = (t: TFunction, traits: ReleaseTraits): string[] => {
  const facts = [
    t('pages.project.vocal.release.fact.hold', {
      seconds: seconds(traits.holdMs),
    }),
  ];
  if (traits.fallCents <= -fallShownCents) {
    facts.push(
      t('pages.project.vocal.release.fact.fall', {
        semitones: (-traits.fallCents / 100).toFixed(1),
      }),
    );
  }
  return facts;
};

const describeTip = (
  t: TFunction,
  mark: ReleaseMark,
  advice: ReleaseAdvice,
) => {
  const take = mark.take ?? mark.lead;
  const tips: Record<ReleaseAdvice, () => string> = {
    fall: () =>
      t('pages.project.vocal.release.tip.fall', {
        semitones: (-mark.lead.fallCents / 100).toFixed(1),
      }),
    noFall: () => t('pages.project.vocal.release.tip.noFall'),
    longer: () =>
      t('pages.project.vocal.release.tip.longer', {
        seconds: seconds(mark.lead.holdMs),
        yours: seconds(take.holdMs),
      }),
    shorter: () =>
      t('pages.project.vocal.release.tip.shorter', {
        seconds: seconds(mark.lead.holdMs),
        yours: seconds(take.holdMs),
      }),
  };
  return tips[advice]();
};

export const describeRelease = (
  t: TFunction,
  mark: ReleaseMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.release.label'),
  title: t('pages.project.vocal.release.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark, mark.advice) : undefined,
  look: t('pages.project.vocal.release.look'),
  why: t('pages.project.vocal.release.why'),
});
