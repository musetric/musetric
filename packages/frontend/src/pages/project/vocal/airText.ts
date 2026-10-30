import {
  type AirAdvice,
  type AirMark,
  type AirTraits,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { type VocalMarkText } from './vocalMarkText.js';

const describeTraits = (t: TFunction, traits: AirTraits): string[] => {
  const db = Math.abs(traits.relativeDb).toFixed(1);
  if (traits.relativeDb <= -traits.spreadDb) {
    return [t('pages.project.vocal.air.fact.airier', { db })];
  }
  if (traits.relativeDb >= traits.spreadDb) {
    return [t('pages.project.vocal.air.fact.clearer', { db })];
  }
  return [t('pages.project.vocal.air.fact.usual')];
};

const describeTip = (t: TFunction, advice: AirAdvice) =>
  ({
    moreAir: t('pages.project.vocal.air.tip.moreAir'),
    lessAir: t('pages.project.vocal.air.tip.lessAir'),
  })[advice];

export const describeAir = (t: TFunction, mark: AirMark): VocalMarkText => ({
  label: t('pages.project.vocal.air.label'),
  title: t('pages.project.vocal.air.title'),
  singer: describeTraits(t, mark.lead),
  you: mark.take ? describeTraits(t, mark.take) : undefined,
  tip: mark.advice ? describeTip(t, mark.advice) : undefined,
  look: t('pages.project.vocal.air.look'),
  why: t('pages.project.vocal.air.why'),
});
