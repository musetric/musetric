import {
  type EngineState,
  getActiveRecording,
  getCalibrationNeeded,
} from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { canPlay } from '../buttons/playback.js';
import { lockLoop } from '../loop/loopActions.js';
import { type CalibrationPrompt, useProjectStore } from '../store.js';

export type TakeKind = Exclude<CalibrationPrompt, 'settings'>;

export const startTake = (kind: TakeKind, projectId: number) => {
  if (kind === 'record') {
    void engine.player.record(projectId);
    return;
  }
  if (engine.store.get().loopStage === 'range') {
    lockLoop();
  }
  void engine.player.recordTry(projectId);
};

export const requestTake = (kind: TakeKind, projectId: number) => {
  if (getCalibrationNeeded(engine.store.get())) {
    useProjectStore.getState().setCalibrationPrompt(kind);
    return;
  }
  startTake(kind, projectId);
};

export const canPressRecord = (state: EngineState): boolean =>
  canPlay(state) && getActiveRecording(state) !== undefined;

export const pressRecord = (projectId: number) => {
  const state = engine.store.get();
  if (!canPressRecord(state)) {
    return;
  }
  if (state.loopStage !== undefined) {
    if (state.loopTryPhase) {
      void engine.player.cancelTry();
      return;
    }
    requestTake('recordTry', projectId);
    return;
  }
  if (state.recording) {
    void engine.player.stopRecording();
    return;
  }
  requestTake('record', projectId);
};
