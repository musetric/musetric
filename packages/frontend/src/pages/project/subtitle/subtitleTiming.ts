import { type api } from '@musetric/api';

export type SubtitleSegmentStatus = 'active' | 'future' | 'past';

export const getSubtitleSegmentEndTime = (segment: api.subtitle.Segment) => {
  const { words } = segment;
  if (words.length > 0) {
    return words[words.length - 1].end;
  }

  return segment.end;
};

export const getSubtitleActiveSegmentIndex = (
  subtitle: api.subtitle.Segment[],
  playbackTime: number,
): number => {
  if (subtitle.length === 0) {
    return -1;
  }

  let startIndex = 0;
  let endIndex = subtitle.length;

  while (startIndex < endIndex) {
    const middleIndex = Math.floor((startIndex + endIndex) / 2);
    const middleSegment = subtitle[middleIndex];

    if (playbackTime < getSubtitleSegmentEndTime(middleSegment)) {
      endIndex = middleIndex;
    } else {
      startIndex = middleIndex + 1;
    }
  }

  return startIndex;
};
