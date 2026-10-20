import { Stack } from '@mui/material';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type CalibrationPrompt } from '../store.js';
import { CalibrationActions } from './CalibrationActions.js';
import { CalibrationDone } from './CalibrationDone.js';
import { CalibrationFailureNote } from './CalibrationFailureNote.js';
import { CalibrationHeader } from './CalibrationHeader.js';
import { CalibrationProgress } from './CalibrationProgress.js';
import { CalibrationSteps } from './CalibrationSteps.js';
import { TimingDetails } from './TimingDetails.js';
import { useCalibrationFlow } from './useCalibrationFlow.js';
import { useCalibrationSetup } from './useCalibrationSetup.js';

export type CalibrationContentProps = {
  prompt: CalibrationPrompt;
  sheet: boolean;
  onClose: () => void;
};

export const CalibrationContent: FC<CalibrationContentProps> = (props) => {
  const { prompt, sheet, onClose } = props;
  const latencySource = useEngineStore((state) => state.latencySource);
  const flow = useCalibrationFlow(prompt, onClose);
  const { phase } = flow;
  const { kind, place, spot, texts, outputLabel } = useCalibrationSetup();
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
          spot={spot}
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
      {phase !== 'measuring' && <TimingDetails gutter={gutter} />}
    </Stack>
  );
};
