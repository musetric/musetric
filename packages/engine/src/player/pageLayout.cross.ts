import { type PlayerStemLayout } from './protocol.cross.js';

export const pageEndFrame = (layout: PlayerStemLayout, index: number): number =>
  layout.pageStarts[index + 1] ?? layout.frameCount;

export const findPageIndex = (
  layout: PlayerStemLayout,
  frame: number,
): number => {
  if (frame < 0 || frame >= layout.frameCount) {
    return -1;
  }
  const { pageStarts } = layout;
  let low = 0;
  let high = pageStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pageStarts[middle] <= frame) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};
