import { SvgIcon, type SvgIconProps } from '@mui/material';
import { type SpectrogramExpandedLane } from '@musetric/spectrogram';

const hiddenLaneOpacity = 0.3;

export type SpectrumLanesIconProps = SvgIconProps & {
  expandedLane: SpectrogramExpandedLane;
};

export const SpectrumLanesIcon = (props: SpectrumLanesIconProps) => {
  const { expandedLane, ...iconProps } = props;

  return (
    <SvgIcon {...iconProps}>
      <rect
        x='3'
        y='3.5'
        width='18'
        height='7.5'
        rx='2'
        fill='currentColor'
        opacity={expandedLane === 'lead' ? hiddenLaneOpacity : 1}
      />
      <rect
        x='3'
        y='13'
        width='18'
        height='7.5'
        rx='2'
        fill='currentColor'
        opacity={expandedLane === 'recording' ? hiddenLaneOpacity : 1}
      />
    </SvgIcon>
  );
};
