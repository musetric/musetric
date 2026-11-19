import { Stack } from '@mui/material';
import { type FC } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type CalibrationPrompt } from '../store.js';
import { CalibrationActions } from './CalibrationActions.js';
import { CalibrationFigure } from './CalibrationFigure.js';
import { CalibrationGauge } from './CalibrationGauge.js';
import { CalibrationHeader } from './CalibrationHeader.js';
import { CalibrationMessage } from './CalibrationMessage.js';
import { CalibrationVolume } from './CalibrationVolume.js';
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
  const gutter = sheet ? 5 : 6;
  const measuring = phase === 'measuring';

  return (
    <Stack>
      <CalibrationHeader
        title={flow.title}
        kind={kind}
        outputLabel={outputLabel}
        calibrated={phase === 'done' || latencySource === 'calibrated'}
        closeDisabled={measuring}
        sheet={sheet}
        details={<TimingDetails disabled={measuring} />}
        onClose={onClose}
      />
      <CalibrationGauge
        phase={phase}
        figure={
          <CalibrationFigure
            spot={spot}
            place={place}
            animated={!measuring && phase !== 'done'}
            label={texts.figure}
          />
        }
        gutter={gutter}
      />
      <CalibrationMessage
        phase={phase}
        texts={texts}
        headphones={place === 'headphones'}
        gutter={gutter}
      />
      <CalibrationVolume gutter={gutter} />
      <CalibrationActions
        primary={flow.primary}
        secondary={flow.secondary}
        gutter={gutter}
      />
    </Stack>
  );
};
