import {
  type DynamicsAdvice,
  type DynamicsMark,
  type DynamicsTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const swellSlope = 4;
const fadeSlope = -6;
const minRangeDb = 3;

const describeTraits = (t: TFunction, traits: DynamicsTraits): string[] => {
  const slope = Math.round(Math.abs(traits.slopeDbPerSecond));
  if (traits.rangeDb >= minRangeDb && traits.slopeDbPerSecond >= swellSlope) {
    return [t('pages.project.vocal.dynamics.fact.swell', { db: slope })];
  }
  if (traits.rangeDb >= minRangeDb && traits.slopeDbPerSecond <= fadeSlope) {
    return [t('pages.project.vocal.dynamics.fact.fade', { db: slope })];
  }
  return [t('pages.project.vocal.dynamics.fact.steady')];
};

const describeTip = (t: TFunction, advice: DynamicsAdvice) =>
  ({
    swell: t('pages.project.vocal.dynamics.tip.swell'),
    fade: t('pages.project.vocal.dynamics.tip.fade'),
    steady: t('pages.project.vocal.dynamics.tip.steady'),
  })[advice];

export const describeDynamics = (
  t: TFunction,
  mark: DynamicsMark,
): VocalMarkText => ({
  label: t('pages.project.vocal.dynamics.label'),
  title: t('pages.project.vocal.dynamics.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark.advice) : undefined,
  look: t('pages.project.vocal.dynamics.look'),
  why: t('pages.project.vocal.dynamics.why'),
});
