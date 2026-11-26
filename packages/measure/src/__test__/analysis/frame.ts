import { getSpread, type Spread } from '../dsp/stats.js';
import { type FrameRun } from '../runs.js';
import {
  findShift,
  findStaticPixels,
  type GrayScreen,
  maskFixedEdges,
  type ScreenBox,
} from './screen.js';

const playSettleMs = 500;
const pictureRowStep = 4;
const pictureReach = 0.75;
const rulerReach = 0.3;
const controlShare = 0.75;
const offTolerance = 0.05;

export const frameParts = [
  'configure',
  'writeBuffers',
  'createCommand',
  'sliceSamples',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
  'draw',
] as const;

const cpuParts: readonly string[] = [
  'configure',
  'writeBuffers',
  'createCommand',
];

const isHeld = (run: FrameRun, at: number) =>
  run.held.findLast((change) => change[0] <= at)?.[1] === 1;

export type FramePhase = 'playing' | 'drag';

const inPhase = (run: FrameRun, phase: FramePhase) =>
  run.frames.filter((frame) =>
    phase === 'playing'
      ? frame.playing &&
        frame.startedAt >= run.playedAt + playSettleMs &&
        frame.startedAt < run.swipeStartedAt
      : isHeld(run, frame.startedAt),
  );

type FrameEntry = FrameRun['frames'][number];

const gpuSum = (frame: FrameEntry) =>
  frameParts
    .filter((part) => !cpuParts.includes(part))
    .reduce((sum, part) => sum + (frame.metrics[part] ?? 0), 0);

export type FramePartsResult = {
  view: FrameRun['view'];
  phase: FramePhase;
  count: number;
  perSecond: number;
  toSubmit: Spread;
  toGpuEnd: Spread;
  gpu: Spread;
  parts: { label: string; spread: Spread }[];
};

export const analyzeFrameParts = (
  runs: readonly FrameRun[],
  view: FrameRun['view'],
  phase: FramePhase,
): FramePartsResult => {
  const views = runs.filter((run) => run.view === view);
  const frames = views.flatMap((run) => inPhase(run, phase));
  const seconds = views
    .map((run) => {
      const own = inPhase(run, phase);
      const last = own.at(-1);
      return last ? (last.startedAt - own[0].startedAt) / 1000 : 0;
    })
    .reduce((sum, value) => sum + value, 0);
  const profiled = frames.filter(
    (frame) => Object.keys(frame.metrics).length > 0,
  );
  return {
    view,
    phase,
    count: frames.length,
    perSecond: seconds > 0 ? frames.length / seconds : 0,
    toSubmit: getSpread(
      frames.map((frame) => frame.submittedAt - frame.startedAt),
    ),
    toGpuEnd: getSpread(frames.map((frame) => frame.doneAt - frame.startedAt)),
    gpu: getSpread(profiled.map(gpuSum)),
    parts: frameParts.map((label) => ({
      label,
      spread: getSpread(profiled.map((frame) => frame.metrics[label] ?? 0)),
    })),
  };
};

const toBox = (box: ScreenBox): ScreenBox => ({
  left: Math.round(box.left),
  top: Math.round(box.top),
  width: Math.round(box.width),
  height: Math.round(box.height),
});

export type ScreenMatch = {
  rulerSeconds: number;
  pictureSeconds: number;
  rulerScore: number;
  pictureScore: number;
};

export type ScreenResult = {
  secondsPerPixel: number;
  control: { seconds: number; ruler: number; picture: number };
  matches: ScreenMatch[];
  offsets: number[];
  off: number;
};

export type ScreenSet = {
  run: FrameRun;
  read: (name: string) => GrayScreen;
};

export const analyzeScreens = (set: ScreenSet): ScreenResult | undefined => {
  const { run, read } = set;
  const { screens, control } = run;
  if (!control) {
    return undefined;
  }
  const references = [
    ...screens.map((screen) => read(screen.reference)),
    read(control.reference),
  ];
  const still = findStaticPixels(references);
  const steady = maskFixedEdges(references, still);
  const picture = toBox(run.boxes.spectrogram);
  const ruler = toBox(run.boxes.ruler);
  const compare = (frame: GrayScreen, reference: GrayScreen) => ({
    ruler: findShift({
      frame,
      reference,
      still,
      box: ruler,
      rowStep: 1,
      reach: rulerReach,
    }),
    picture: findShift({
      frame,
      reference,
      still: steady,
      box: picture,
      rowStep: pictureRowStep,
      reach: pictureReach,
    }),
  });
  const twin = compare(read(control.reference), read(control.base));
  const controlSeconds = (control.frame - control.baseFrame) / run.sampleRate;
  const secondsPerPixel = controlSeconds / twin.ruler.shift;
  const matches = screens.map((screen) => {
    const shifts = compare(read(screen.name), read(screen.reference));
    return {
      rulerSeconds: shifts.ruler.shift * secondsPerPixel,
      pictureSeconds: shifts.picture.shift * secondsPerPixel,
      rulerScore: shifts.ruler.score,
      pictureScore: shifts.picture.score,
    };
  });
  const offsets = matches
    .filter(
      (match) =>
        match.rulerScore >= controlShare * twin.ruler.score &&
        match.pictureScore >= controlShare * twin.picture.score,
    )
    .map((match) => match.pictureSeconds - match.rulerSeconds);
  return {
    secondsPerPixel,
    control: {
      seconds: controlSeconds,
      ruler: twin.ruler.shift * secondsPerPixel,
      picture: twin.picture.shift * secondsPerPixel,
    },
    matches,
    offsets,
    off: offsets.filter((offset) => Math.abs(offset) > offTolerance).length,
  };
};
