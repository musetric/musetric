import {
  type OnsetAdvice,
  type OnsetMark,
  type OnsetTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const hardRiseMs = 15;
const softRiseMs = 45;
const leadInShownMs = 30;
const scoopShownCents = 40;

const describeTraits = (t: TFunction, traits: OnsetTraits): string[] => {
  const facts: string[] = [];
  const riseMs = Math.round(traits.riseMs);
  if (traits.riseMs <= hardRiseMs) {
    facts.push(t('pages.project.vocal.onset.fact.hard', { ms: riseMs }));
  } else if (traits.riseMs >= softRiseMs) {
    facts.push(t('pages.project.vocal.onset.fact.soft', { ms: riseMs }));
  } else {
    facts.push(t('pages.project.vocal.onset.fact.medium', { ms: riseMs }));
  }
  if (traits.leadInMs >= leadInShownMs) {
    facts.push(
      t('pages.project.vocal.onset.fact.leadIn', {
        ms: Math.round(traits.leadInMs),
      }),
    );
  }
  if (traits.scoopCents <= -scoopShownCents) {
    facts.push(
      t('pages.project.vocal.onset.fact.scoop', {
        semitones: (-traits.scoopCents / 100).toFixed(1),
      }),
    );
  }
  return facts;
};

const describeTip = (t: TFunction, mark: OnsetMark, advice: OnsetAdvice) => {
  const take = mark.take ?? mark.lead;
  const tips: Record<OnsetAdvice, () => string> = {
    softer: () => t('pages.project.vocal.onset.tip.softer'),
    harder: () => t('pages.project.vocal.onset.tip.harder'),
    moreLeadIn: () =>
      t('pages.project.vocal.onset.tip.moreLeadIn', {
        ms: Math.round(mark.lead.leadInMs),
      }),
    lessLeadIn: () =>
      t('pages.project.vocal.onset.tip.lessLeadIn', {
        ms: Math.round(take.leadInMs - mark.lead.leadInMs),
      }),
    scoop: () =>
      t('pages.project.vocal.onset.tip.scoop', {
        semitones: (-mark.lead.scoopCents / 100).toFixed(1),
      }),
    noScoop: () => t('pages.project.vocal.onset.tip.noScoop'),
  };
  return tips[advice]();
};

export const describeOnset = (
  t: TFunction,
  mark: OnsetMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.onset.label'),
  title: t('pages.project.vocal.onset.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark, mark.advice) : undefined,
  look: t('pages.project.vocal.onset.look'),
  why: t('pages.project.vocal.onset.why'),
});
