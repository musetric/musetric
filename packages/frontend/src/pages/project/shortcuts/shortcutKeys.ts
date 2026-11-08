import { type api } from '@musetric/api';
import {
  maxTempoRatio,
  maxTransposeSemitones,
  minTempoRatio,
  minTransposeSemitones,
} from '@musetric/audio';
import { type EngineState } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { togglePlayback } from '../buttons/playback.js';
import {
  toggleView,
  type ViewToggleTarget,
} from '../buttons/viewToggle/viewToggle.js';
import { pressRecord } from '../calibration/takeActions.js';
import { enterLoop, isLoopAvailable, leaveLoop } from '../loop/loopActions.js';

const seekSeconds = 5;
const tempoStepsPerRatio = 20;
const textInputTypes = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
]);
const overlaySelector =
  '[role=dialog], [role=presentation], [role=menu], [role=listbox]';
const digitPattern = /^(?:Digit|Numpad)(\d)$/;

const shortcutViews: ViewToggleTarget[] = [
  { panel: 'details', view: 'text' },
  { panel: 'details', view: 'tracks' },
  { panel: 'spectrogram', view: 'notes' },
  { panel: 'spectrogram', view: 'spectrum' },
];

const isTextField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLInputElement && textInputTypes.has(target.type);
};

const isInsideOverlay = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(overlaySelector));

const isSlider = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === 'range';

const seekBy = (state: EngineState, seconds: number) => {
  if (!state.frameCount || state.statuses.realtime === 'error') {
    return;
  }
  const frames = Math.round(seconds * engine.context.sampleRate);
  engine.player.seek(state.frameIndex + frames, 'player');
};

const stepTempo = (state: EngineState, steps: number) => {
  const next = Math.round(state.tempoRatio * tempoStepsPerRatio) + steps;
  if (
    state.recording ||
    next < Math.round(minTempoRatio * tempoStepsPerRatio) ||
    next > Math.round(maxTempoRatio * tempoStepsPerRatio)
  ) {
    return;
  }
  engine.store.update((draft) => {
    draft.tempoRatio = next / tempoStepsPerRatio;
  });
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
  if (state.loopStage === undefined) {
    if (isLoopAvailable(state)) {
      enterLoop(subtitle);
    }
    return;
  }
  if (!state.recording) {
    leaveLoop();
  }
};

const pressDigit = (state: EngineState, digit: number) => {
  if (state.loopStage === 'sing') {
    if (digit === 0) {
      engine.player.selectTry(undefined);
      return;
    }
    const picked = state.loopTries.find((item) => item.number === digit);
    if (picked) {
      engine.player.selectTry(picked.id);
    }
    return;
  }
  const target = shortcutViews.at(digit - 1);
  if (digit > 0 && target && state.statuses.realtime !== 'error') {
    toggleView(target);
  }
};

const deleteSelectedTry = (state: EngineState) => {
  if (
    state.loopStage !== 'sing' ||
    state.loopTryPhase !== undefined ||
    state.loopSelectedTryId === undefined
  ) {
    return;
  }
  engine.player.deleteTry(state.loopSelectedTryId);
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
    run: (state) => {
      stepTempo(state, -1);
    },
  },
  BracketRight: {
    repeats: true,
    run: (state) => {
      stepTempo(state, 1);
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
    run: (state) => {
      deleteSelectedTry(state);
    },
  },
  Escape: {
    repeats: false,
    run: (state) => {
      if (state.loopStage !== undefined && !state.recording) {
        leaveLoop();
      }
    },
  },
};

const isIgnored = (event: KeyboardEvent): boolean =>
  event.defaultPrevented ||
  event.ctrlKey ||
  event.metaKey ||
  event.altKey ||
  isTextField(event.target) ||
  isInsideOverlay(event.target);

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
