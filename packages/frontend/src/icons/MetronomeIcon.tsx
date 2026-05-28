import { SvgIcon, type SvgIconProps } from '@mui/material';

export const MetronomeIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <path
      d='M8 4h8l2 17H6L8 4z'
      fill='none'
      stroke='currentColor'
      strokeLinejoin='round'
      strokeWidth={1.7}
    />
    <path
      d='M12 19L17 6'
      fill='none'
      stroke='currentColor'
      strokeLinecap='round'
      strokeWidth={1.7}
      opacity={0.85}
    />
    <circle cx='12' cy='21' r='1.4' fill='currentColor' />
  </SvgIcon>
);
