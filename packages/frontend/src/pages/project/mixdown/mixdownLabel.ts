import { type TFunction } from 'i18next';
import { formatTransposeSemitones } from '../buttons/formatTransposeSemitones.js';

export type MixdownLabelTrack = {
  name: string;
  volume: number;
};

const isAudible = (track?: MixdownLabelTrack): track is MixdownLabelTrack =>
  track !== undefined && track.volume > 0;

export type MixdownLabelInput = {
  recording?: MixdownLabelTrack;
  lead: MixdownLabelTrack;
  backing: MixdownLabelTrack;
  instrumental: MixdownLabelTrack;
  transposeSemitones: number;
  tempoRatio: number;
};

const getTracksLabel = (
  input: MixdownLabelInput,
  t: TFunction,
): string | undefined => {
  const audible = [
    input.recording,
    input.lead,
    input.backing,
    input.instrumental,
  ].filter(isAudible);
  if (audible.length === 0) {
    return undefined;
  }
  if (
    isAudible(input.recording) &&
    !isAudible(input.lead) &&
    isAudible(input.instrumental)
  ) {
    return t('pages.project.mixdown.cover');
  }
  if (audible.length === 1) {
    return audible[0].name;
  }
  if (audible.length === 2) {
    return t('pages.project.mixdown.pair', {
      first: audible[0].name,
      second: audible[1].name,
    });
  }
  return t('pages.project.mixdown.mix');
};

export const getMixdownLabel = (
  input: MixdownLabelInput,
  t: TFunction,
): string | undefined => {
  const tracks = getTracksLabel(input, t);
  if (tracks === undefined) {
    return undefined;
  }
  const changes: string[] = [];
  if (input.transposeSemitones !== 0) {
    changes.push(
      t('pages.project.player.controls.transposeValue', {
        value: formatTransposeSemitones(input.transposeSemitones),
      }),
    );
  }
  if (input.tempoRatio !== 1) {
    changes.push(
      t('pages.project.player.controls.tempoRatioValue', {
        value: input.tempoRatio.toFixed(2),
      }),
    );
  }
  return [tracks, ...changes].join(', ');
};
