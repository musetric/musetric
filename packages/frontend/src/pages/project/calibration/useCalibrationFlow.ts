import { type CalibrationErrorCode } from '@musetric/engine';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type CalibrationPrompt } from '../store.js';
import { startTake } from './takeActions.js';

export type CalibrationFailure = 'noisy' | 'quiet' | 'silent' | 'failed';

const getFailure = (
  error: CalibrationErrorCode | undefined,
): CalibrationFailure =>
  error === 'noisy' || error === 'quiet' || error === 'silent'
    ? error
    : 'failed';

export type CalibrationPhase =
  'ask' | 'measuring' | 'done' | CalibrationFailure;

type Result = 'none' | 'done' | 'failed';

const getPhase = (
  calibrating: boolean,
  result: Result,
  error: CalibrationErrorCode | undefined,
): CalibrationPhase => {
  if (calibrating) {
    return 'measuring';
  }
  if (result === 'done') {
    return 'done';
  }
  if (result === 'failed') {
    return getFailure(error);
  }
  return 'ask';
};

export type CalibrationAction = {
  label: string;
  onClick: () => void;
};

export type CalibrationFlow = {
  phase: CalibrationPhase;
  title: string;
  primary?: CalibrationAction;
  secondary?: CalibrationAction;
};

export const useCalibrationFlow = (
  prompt: CalibrationPrompt,
  onClose: () => void,
): CalibrationFlow => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const calibrating = useEngineStore((state) => state.calibrating);
  const error = useEngineStore((state) => state.calibrationError);
  const [result, setResult] = useState<Result>('none');
  const phase = getPhase(calibrating, result, error);
  const take = prompt === 'settings' ? undefined : prompt;

  const measure = () => {
    setResult('none');
    void engine.calibration.calibrate().then((calibrated) => {
      setResult(calibrated ? 'done' : 'failed');
    });
  };
  const finish = () => {
    onClose();
    if (take) {
      startTake(take, projectId);
    }
  };
  const skip = () => {
    engine.calibration.skip();
    finish();
  };

  const retry = {
    label: t('pages.project.calibration.tryAgain'),
    onClick: measure,
  };
  const leave = take
    ? { label: t('pages.project.calibration.skip'), onClick: skip }
    : { label: t('pages.project.calibration.notNow'), onClick: onClose };
  const actions: Record<
    CalibrationPhase,
    Pick<CalibrationFlow, 'primary' | 'secondary'>
  > = {
    ask: {
      primary: {
        label: t('pages.project.calibration.calibrate'),
        onClick: measure,
      },
      secondary: leave,
    },
    measuring: {},
    done: {
      primary: take
        ? { label: t('pages.project.calibration.start'), onClick: finish }
        : { label: t('pages.project.calibration.done'), onClick: onClose },
      secondary: {
        label: t('pages.project.calibration.again'),
        onClick: measure,
      },
    },
    noisy: { primary: retry, secondary: leave },
    quiet: { primary: retry, secondary: leave },
    silent: { primary: retry, secondary: leave },
    failed: { primary: retry, secondary: leave },
  };
  const titles: Record<CalibrationPhase, string> = {
    ask: take
      ? t('pages.project.calibration.title.take')
      : t('pages.project.calibration.title.settings'),
    measuring: t('pages.project.calibration.title.measuring'),
    done: t('pages.project.calibration.title.done'),
    noisy: t('pages.project.calibration.title.failed'),
    quiet: t('pages.project.calibration.title.failed'),
    silent: t('pages.project.calibration.title.failed'),
    failed: t('pages.project.calibration.title.failed'),
  };

  return { phase, title: titles[phase], ...actions[phase] };
};
