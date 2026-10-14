import { type TranscriptionWord } from './types.js';

const piecePattern = /^['’-]\p{L}/u;

export const joinWordPieces = (
  words: TranscriptionWord[],
): TranscriptionWord[] => {
  const joined: TranscriptionWord[] = [];
  for (const word of words) {
    const previous = joined.at(-1);
    if (previous && piecePattern.test(word.text)) {
      joined[joined.length - 1] = {
        ...previous,
        text: previous.text + word.text,
        end: word.end,
      };
      continue;
    }
    joined.push(word);
  }
  return joined;
};
