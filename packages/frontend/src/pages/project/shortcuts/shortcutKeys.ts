import { type api } from '@musetric/api';
import { maxTransposeSemitones, minTransposeSemitones } from '@musetric/audio';
import { type EngineState } from '@musetric/engine';
import { findTopOverlay } from '../../../app/systemBack.js';
import { engine } from '../../../engine/engine.js';
import { togglePlayback } from '../buttons/playback.js';
import { stepTempo } from '../buttons/tempoSteps.js';
import {
  toggleView,
  type ViewToggleTarget,
} from '../buttons/viewToggle/viewToggle.js';
import { pressRecord } from '../calibration/takeActions.js';
import {
  deleteChosenTry,
  enterLoop,
  isLoopAvailable,
  leaveLoop,
  pickTry,
} from '../loop/loopActions.js';
import { useProjectStore } from '../store.js';

const seekSeconds = 5;
const digitPattern = /^(?:Digit|Numpad)(\d)$/;

const shortcutViews: ViewToggleTarget[] = [
  { panel: 'details', view: 'text' },
  { panel: 'details', view: 'tracks' },
  { panel: 'spectrogram', view: 'notes' },
  { panel: 'spectrogram', view: 'spectrum' },
];

const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type !== 'range'));

const isSlider = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === 'range';

const seekBy = (state: EngineState, seconds: number) => {
  if (!state.frameCount || state.statuses.realtime === 'error') {
    return;
  }
  const frames = Math.round(seconds * engine.context.sampleRate);
  engine.player.seek(state.frameIndex + frames, 'player');
};

const stepKey = (state: EngineState, semitones: number) => {
  const next = state.transposeSemitones + semitones;
  if (
    state.recording ||
    next < minTransposeSemitones ||
    next > maxTransposeSemitones
  ) {
    return;
  }
  engine.store.update((draft) => {
    draft.transposeSemitones = next;
  });
};

const toggleLoop = (
  state: EngineState,
  subtitle: readonly api.subtitle.Segment[],
) => {
  if (state.loopStage !== undefined) {
    leaveLoop();
    return;
  }
  if (isLoopAvailable(state) && useProjectStore.getState().spectrogramOpen) {
    enterLoop(subtitle);
  }
};

const pressDigit = (state: EngineState, digit: number) => {
  if (state.loopStage === 'sing') {
    pickTry(digit === 0 ? undefined : digit);
    return;
  }
  const target = shortcutViews.at(digit - 1);
  if (digit > 0 && target && state.statuses.realtime !== 'error') {
    toggleView(target);
  }
};

export type ProjectShortcutContext = {
  projectId: number;
  subtitle: readonly api.subtitle.Segment[];
  openList: () => void;
};

type ShortcutAction = {
  repeats: boolean;
  run: (state: EngineState, context: ProjectShortcutContext) => void;
};

const shortcutActions: Partial<Record<string, ShortcutAction>> = {
  Space: {
    repeats: false,
    run: () => {
      togglePlayback();
    },
  },
  ArrowLeft: {
    repeats: true,
    run: (state) => {
      seekBy(state, -seekSeconds);
    },
  },
  ArrowRight: {
    repeats: true,
    run: (state) => {
      seekBy(state, seekSeconds);
    },
  },
  KeyL: {
    repeats: false,
    run: (state, context) => {
      toggleLoop(state, context.subtitle);
    },
  },
  KeyR: {
    repeats: false,
    run: (_state, context) => {
      pressRecord(context.projectId);
    },
  },
  BracketLeft: {
    repeats: true,
    run: () => {
      stepTempo(-1);
    },
  },
  BracketRight: {
    repeats: true,
    run: () => {
      stepTempo(1);
    },
  },
  Minus: {
    repeats: true,
    run: (state) => {
      stepKey(state, -1);
    },
  },
  Equal: {
    repeats: true,
    run: (state) => {
      stepKey(state, 1);
    },
  },
  Delete: {
    repeats: false,
    run: () => {
      deleteChosenTry();
    },
  },
  Escape: {
    repeats: false,
    run: () => {
      leaveLoop();
    },
  },
};

const isIgnored = (event: KeyboardEvent): boolean =>
  event.defaultPrevented ||
  event.ctrlKey ||
  event.metaKey ||
  event.altKey ||
  isField(event.target) ||
  findTopOverlay() !== undefined;

export const handleProjectShortcut = (
  event: KeyboardEvent,
  context: ProjectShortcutContext,
): boolean => {
  if (isIgnored(event)) {
    return false;
  }
  if (event.key === '?') {
    if (!event.repeat) {
      context.openList();
    }
    return true;
  }
  if (event.shiftKey) {
    return false;
  }
  const digit = digitPattern.exec(event.code)?.[1];
  if (digit !== undefined) {
    if (!event.repeat) {
      pressDigit(engine.store.get(), Number(digit));
    }
    return true;
  }
  const action = shortcutActions[event.code];
  if (!action || (isSlider(event.target) && event.code.startsWith('Arrow'))) {
    return false;
  }
  if (!event.repeat || action.repeats) {
    action.run(engine.store.get(), context);
  }
  return true;
};
