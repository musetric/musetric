export type PitchExtractRequest = {
  pcmUrl: string;
  pcmStartSeconds: number;
  fromSeconds: number;
  toSeconds: number;
  hopMs: number;
  windowSize: number;
  zeroPaddingFactor: 1 | 2 | 4;
};

export type PitchFrame = {
  time: number;
  f0: number;
  trusted: boolean;
};

export const parsePitchCsv = (text: string): PitchFrame[] => {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const timeIndex = header.indexOf('time_s');
  const f0Index = header.indexOf('f0_hz');
  const trustedIndex = header.indexOf('trusted');
  if (timeIndex < 0 || f0Index < 0) {
    throw new Error('pitch csv needs time_s and f0_hz columns');
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return {
      time: Number(cells[timeIndex]),
      f0: Number(cells[f0Index]),
      trusted: trustedIndex < 0 || cells[trustedIndex] === '1',
    };
  });
};

export type PitchExtractResult = {
  hopSeconds: number;
  startSeconds: number;
  values: number[];
};

export type PitchCompareRequest = {
  referencePath: string;
  oursPath: string;
  fromSeconds: number;
  toSeconds: number | undefined;
};

export const formatPitchCsv = (result: PitchExtractResult): string => {
  const rows = result.values.map((value, index) => {
    const time = result.startSeconds + index * result.hopSeconds;
    return `${time.toFixed(4)},${value.toFixed(3)}`;
  });
  return ['time_s,f0_hz', ...rows].join('\n') + '\n';
};

const toleranceCents = 50;
const flipCents = 550;

const centsBetween = (a: number, b: number): number => 1200 * Math.log2(a / b);

const chromaDistance = (cents: number): number => {
  const folded = Math.abs(cents) % 1200;
  return Math.min(folded, 1200 - folded);
};

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

const quantile = (sorted: number[], position: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.round(position * (sorted.length - 1));
  return sorted[index];
};

const alignToReference = (
  reference: PitchFrame[],
  ours: PitchFrame[],
): Float64Array => {
  const aligned = new Float64Array(reference.length);
  if (ours.length === 0) {
    return aligned;
  }
  let cursor = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const { time } = reference[index];
    while (cursor + 1 < ours.length && ours[cursor + 1].time <= time) {
      cursor += 1;
    }
    aligned[index] = ours[cursor].time <= time ? ours[cursor].f0 : 0;
  }
  return aligned;
};

type PitchScore = {
  scored: number;
  recalled: number;
  correctPitch: number;
  correctChroma: number;
  octaves: number;
  errors: number[];
};

const scorePitch = (
  reference: PitchFrame[],
  ours: Float64Array,
): PitchScore => {
  const score: PitchScore = {
    scored: 0,
    recalled: 0,
    correctPitch: 0,
    correctChroma: 0,
    octaves: 0,
    errors: [],
  };
  for (let index = 0; index < reference.length; index += 1) {
    const frame = reference[index];
    const value = ours[index];
    if (frame.f0 <= 0 || !frame.trusted) {
      continue;
    }
    score.scored += 1;
    if (value <= 0) {
      continue;
    }
    score.recalled += 1;
    const error = centsBetween(value, frame.f0);
    score.errors.push(error);
    score.correctPitch += Math.abs(error) <= toleranceCents ? 1 : 0;
    score.correctChroma += chromaDistance(error) <= toleranceCents ? 1 : 0;
    score.octaves += Math.abs(Math.abs(error) - 1200) <= toleranceCents ? 1 : 0;
  }
  return score;
};

type VoicingScore = {
  unvoiced: number;
  falseAlarms: number;
};

const scoreVoicing = (
  reference: PitchFrame[],
  ours: Float64Array,
): VoicingScore => {
  const score: VoicingScore = { unvoiced: 0, falseAlarms: 0 };
  for (let index = 0; index < reference.length; index += 1) {
    if (reference[index].f0 > 0) {
      continue;
    }
    score.unvoiced += 1;
    score.falseAlarms += ours[index] > 0 ? 1 : 0;
  }
  return score;
};

type GapScore = {
  gaps: number;
  flips: number;
};

const scoreGaps = (ours: Float64Array): GapScore => {
  const score: GapScore = { gaps: 0, flips: 0 };
  let lastVoiced = 0;
  let inGap = false;
  for (const value of ours) {
    if (value <= 0) {
      inGap = true;
      continue;
    }
    if (inGap && lastVoiced > 0) {
      score.gaps += 1;
      score.flips +=
        Math.abs(centsBetween(value, lastVoiced)) > flipCents ? 1 : 0;
    }
    lastVoiced = value;
    inGap = false;
  }
  return score;
};

type NoteScore = {
  held: number;
  breaks: number;
};

const scoreNotes = (reference: PitchFrame[], ours: Float64Array): NoteScore => {
  const score: NoteScore = { held: 0, breaks: 0 };
  for (let index = 1; index < reference.length; index += 1) {
    const previous = reference[index - 1];
    const frame = reference[index];
    const held =
      previous.trusted &&
      frame.trusted &&
      previous.f0 > 0 &&
      frame.f0 > 0 &&
      Math.abs(centsBetween(frame.f0, previous.f0)) <= flipCents;
    if (!held) {
      continue;
    }
    score.held += 1;
    score.breaks += ours[index - 1] > 0 !== ours[index] > 0 ? 1 : 0;
  }
  return score;
};

export type PitchOverview = {
  frames: number;
  scoredFrames: number;
  rpa: number;
  rca: number;
  voicingRecall: number;
  falseAlarm: number;
  biasCents: number;
  spreadCents: number;
  octaveRate: number;
  gapFlipRate: number;
  noteBreakRate: number;
};

export const comparePitch = (
  referenceFrames: PitchFrame[],
  oursFrames: PitchFrame[],
  fromSeconds: number,
  toSeconds: number,
): PitchOverview => {
  const reference = referenceFrames.filter(
    (frame) => frame.time >= fromSeconds && frame.time < toSeconds,
  );
  const ours = alignToReference(reference, oursFrames);
  const pitch = scorePitch(reference, ours);
  const voicing = scoreVoicing(reference, ours);
  const gaps = scoreGaps(ours);
  const notes = scoreNotes(reference, ours);
  const errors = [...pitch.errors].sort((a, b) => a - b);
  return {
    frames: reference.length,
    scoredFrames: pitch.scored,
    rpa: ratio(pitch.correctPitch, pitch.scored),
    rca: ratio(pitch.correctChroma, pitch.scored),
    voicingRecall: ratio(pitch.recalled, pitch.scored),
    falseAlarm: ratio(voicing.falseAlarms, voicing.unvoiced),
    biasCents: quantile(errors, 0.5),
    spreadCents: quantile(errors, 0.75) - quantile(errors, 0.25),
    octaveRate: ratio(pitch.octaves, pitch.recalled),
    gapFlipRate: ratio(gaps.flips, gaps.gaps),
    noteBreakRate: ratio(notes.breaks, notes.held),
  };
};
