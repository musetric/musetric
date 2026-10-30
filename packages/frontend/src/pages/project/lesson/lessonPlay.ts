import { stemTypes } from '@musetric/audio';
import { type EngineRange } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { recordRangeOnce } from '../loop/recordRangeOnce.js';
import { type LessonSpan } from './lessonPhrase.js';

const listenMarginSeconds = 0.2;
const listenGapMs = 250;
const viewLeadSeconds = 0.15;

const frameOf = (seconds: number) =>
  Math.round(Math.max(0, seconds) * engine.context.sampleRate);

const rangeOf = (start: number, end: number): EngineRange => ({
  fromFrame: frameOf(start),
  toFrame: frameOf(end),
});

const delay = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type EngineSnapshot = ReturnType<typeof engine.store.get>;

export type EngineWait<Value> = {
  select: (state: EngineSnapshot) => Value;
  done: (value: Value) => boolean;
  timeoutMs?: number;
};

type PendingWait = {
  unsubscribe: () => void;
  timer: number;
};

export const waitForEngine = async <Value>(wait: EngineWait<Value>) =>
  new Promise<void>((resolve) => {
    if (wait.done(wait.select(engine.store.get()))) {
      resolve();
      return;
    }
    const pending: PendingWait = { unsubscribe: () => undefined, timer: 0 };
    const finish = () => {
      clearTimeout(pending.timer);
      pending.unsubscribe();
      resolve();
    };
    pending.unsubscribe = engine.store.subscribe(wait.select, (value) => {
      if (wait.done(value)) {
        finish();
      }
    });
    if (wait.timeoutMs !== undefined) {
      pending.timer = window.setTimeout(finish, wait.timeoutMs);
    }
  });

type TrackVolumes = EngineSnapshot['trackVolumes'];

const applyVolumes = (volumes: TrackVolumes) => {
  engine.store.update((state) => {
    state.trackVolumes = { ...volumes };
  });
};

type Voice = 'lead' | 'recording';

const soloVolumes = (saved: TrackVolumes, voice: Voice): TrackVolumes => {
  const volumes = { ...saved };
  for (const stemType of stemTypes) {
    volumes[stemType] = voice === 'lead' && stemType === 'lead' ? 1 : 0;
  }
  volumes.recording = voice === 'recording' ? 1 : 0;
  return volumes;
};

export const showLessonSpan = (span: LessonSpan) => {
  engine.player.seek(
    frameOf((span.focusStart ?? span.start) - viewLeadSeconds),
    'spectrogramVisualization',
  );
};

export type LessonSingOptions = LessonSpan & {
  projectId: number;
  singStart: number;
  singEnd: number;
};

export type LessonPlayer = {
  listen: (span: LessonSpan) => Promise<void>;
  sing: (options: LessonSingOptions) => Promise<void>;
  cancel: () => void;
};

export const createLessonPlayer = (): LessonPlayer => {
  let run = 0;
  let saved: TrackVolumes | undefined = undefined;

  const stopPlayback = async () => {
    if (engine.store.get().playing) {
      await engine.player.stop();
    }
  };

  const restore = () => {
    if (saved) {
      applyVolumes(saved);
      saved = undefined;
    }
  };

  const leave = async () => {
    await stopPlayback();
    if (engine.store.get().loopStage === undefined) {
      engine.player.setRange(undefined);
    } else {
      engine.player.closeLoop();
    }
    restore();
  };

  const begin = async () => {
    run += 1;
    await leave();
    saved = { ...engine.store.get().trackVolumes };
    return run;
  };

  const playVoice = async (voice: Voice, span: LessonSpan, current: number) => {
    if (current !== run || !saved) {
      return;
    }
    applyVolumes(soloVolumes(saved, voice));
    engine.player.setRange(
      rangeOf(span.start - listenMarginSeconds, span.end + listenMarginSeconds),
    );
    await engine.player.playRange('once');
    await waitForEngine({
      select: (state) => state.playing,
      done: (playing) => !playing,
    });
  };

  return {
    listen: async (span) => {
      const current = await begin();
      await playVoice('lead', span, current);
      await delay(listenGapMs);
      await playVoice('recording', span, current);
      if (current === run) {
        await leave();
        showLessonSpan(span);
      }
    },
    sing: async (options) => {
      const current = await begin();
      if (!saved) {
        return;
      }
      applyVolumes({ ...saved, lead: 0, recording: 0 });
      try {
        await recordRangeOnce(
          options.projectId,
          rangeOf(options.singStart, options.singEnd),
        );
      } finally {
        if (current === run) {
          await leave();
          showLessonSpan(options);
        }
      }
    },
    cancel: () => {
      run += 1;
      void leave();
    },
  };
};
