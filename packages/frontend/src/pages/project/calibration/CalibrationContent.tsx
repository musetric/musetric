import { Stack } from '@mui/material';
import {
  classifyAudioOutputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type CalibrationPrompt } from '../store.js';
import { CalibrationActions } from './CalibrationActions.js';
import { CalibrationDone } from './CalibrationDone.js';
import { CalibrationFailureNote } from './CalibrationFailureNote.js';
import { CalibrationHeader } from './CalibrationHeader.js';
import { CalibrationProgress } from './CalibrationProgress.js';
import { CalibrationSteps } from './CalibrationSteps.js';
import {
  getCalibrationDevice,
  getCalibrationPlace,
  useCalibrationTexts,
} from './calibrationTexts.js';
import { useCalibrationFlow } from './useCalibrationFlow.js';

export type CalibrationContentProps = {
  prompt: CalibrationPrompt;
  sheet: boolean;
  onClose: () => void;
};

export const CalibrationContent: FC<CalibrationContentProps> = (props) => {
  const { prompt, sheet, onClose } = props;
  const { t } = useTranslation();
  const audioDevices = useEngineStore((state) => state.audioDevices);
  const outputDeviceId = useEngineStore((state) => state.audioOutputDeviceId);
  const latencySource = useEngineStore((state) => state.latencySource);
  const flow = useCalibrationFlow(prompt, onClose);
  const { phase } = flow;
  const output = resolveAudioOutputDevice(audioDevices, {
    explicitDeviceId: outputDeviceId,
  });
  const kind = output ? classifyAudioOutputDevice(output) : 'unknown';
  const place = getCalibrationPlace(kind, output?.label ?? '');
  const device = getCalibrationDevice();
  const texts = useCalibrationTexts(place, device);
  const outputLabel =
    output?.label || t('pages.project.calibration.thisOutput');
  const headphones = place === 'headphones';
  const gutter = sheet ? 5 : 6;

  return (
    <Stack>
      <CalibrationHeader
        title={flow.title}
        kind={kind}
        outputLabel={outputLabel}
        calibrated={phase === 'done' || latencySource === 'calibrated'}
        closeDisabled={phase === 'measuring'}
        sheet={sheet}
        onClose={onClose}
      />
      {phase === 'ask' && (
        <CalibrationSteps
          bluetooth={kind === 'bluetooth'}
          handheld={device === 'phone'}
          headphones={headphones}
          texts={texts}
          gutter={gutter}
        />
      )}
      {phase === 'measuring' && <CalibrationProgress gutter={gutter} />}
      {phase === 'done' && (
        <CalibrationDone
          headphones={headphones}
          outputLabel={outputLabel}
          gutter={gutter}
        />
      )}
      {phase !== 'ask' && phase !== 'measuring' && phase !== 'done' && (
        <CalibrationFailureNote failure={phase} texts={texts} gutter={gutter} />
      )}
      <CalibrationActions
        primary={flow.primary}
        secondary={flow.secondary}
        sheet={sheet}
        gutter={gutter}
      />
    </Stack>
  );
};
