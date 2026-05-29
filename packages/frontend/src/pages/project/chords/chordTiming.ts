import { type api } from '@musetric/api';

export const getActiveChordIndex = (
  segments: api.chords.ChordSegment[],
  playbackTime: number,
): number => {
  if (segments.length === 0) {
    return -1;
  }

  let startIndex = 0;
  let endIndex = segments.length;

  while (startIndex < endIndex) {
    const middleIndex = Math.floor((startIndex + endIndex) / 2);
    if (playbackTime < segments[middleIndex].end) {
      endIndex = middleIndex;
    } else {
      startIndex = middleIndex + 1;
    }
  }

  return startIndex;
};
