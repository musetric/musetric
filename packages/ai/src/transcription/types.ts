export type TranscriptionWord = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  words?: TranscriptionWord[];
};

export type PayloadSegment = {
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
};
