import {
  type VocalMark,
  type VocalMarkKind,
  type VocalMarkMap,
  type VocalMarkStatus,
} from '@musetric/spectrogram';
import { type TFunction } from 'i18next';
import { describeAir } from './airText.js';
import { describeDynamics } from './dynamicsText.js';
import { describeOnset } from './onsetText.js';
import { describeRegister } from './registerText.js';
import { describeRelease } from './releaseText.js';
import { describeTiming } from './timingText.js';
import { describeTransition } from './transitionText.js';
import { describeVibrato } from './vibratoText.js';
import { describeVowel } from './vowelText.js';

export const vocalKindLabel = (t: TFunction, kind: VocalMarkKind): string =>
  ({
    onset: t('pages.project.vocal.onset.label'),
    release: t('pages.project.vocal.release.label'),
    vibrato: t('pages.project.vocal.vibrato.label'),
    transition: t('pages.project.vocal.transition.label'),
    register: t('pages.project.vocal.register.label'),
    timing: t('pages.project.vocal.timing.label'),
    dynamics: t('pages.project.vocal.dynamics.label'),
    air: t('pages.project.vocal.air.label'),
    vowel: t('pages.project.vocal.vowel.label'),
  })[kind];

export type VocalMarkText = {
  label: string;
  title: string;
  singer: string[];
  you?: string[];
  tip?: string;
  look: string;
  why: string;
};

type VocalMarkDescribers = {
  [Kind in VocalMarkKind]: (
    t: TFunction,
    mark: VocalMarkMap[Kind],
  ) => VocalMarkText;
};

const describers: VocalMarkDescribers = {
  vowel: describeVowel,
  air: describeAir,
  dynamics: describeDynamics,
  timing: describeTiming,
  register: describeRegister,
  transition: describeTransition,
  vibrato: describeVibrato,
  release: describeRelease,
  onset: describeOnset,
};

const describeKind = <Kind extends VocalMarkKind>(
  t: TFunction,
  kind: Kind,
  mark: VocalMarkMap[Kind],
): VocalMarkText => describers[kind](t, mark);

export const describeVocalMark = (
  t: TFunction,
  mark: VocalMark,
): VocalMarkText => describeKind(t, mark.kind, mark);

export const vocalStatusLabel = (
  t: TFunction,
  status: VocalMarkStatus,
): string =>
  ({
    differ: t('pages.project.vocal.card.status.differ'),
    match: t('pages.project.vocal.card.status.match'),
    trait: t('pages.project.vocal.card.status.trait'),
  })[status];
