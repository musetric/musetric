import { SvgIcon, type SvgIconProps } from '@mui/material';

export const NoteBarsIcon = (props: SvgIconProps) => (
  <SvgIcon {...props}>
    <rect x='3' y='5' width='8' height='3.4' rx='1.7' fill='currentColor' />
    <rect
      x='12'
      y='10.3'
      width='9'
      height='3.4'
      rx='1.7'
      fill='currentColor'
      opacity={0.86}
    />
    <rect
      x='5.5'
      y='15.6'
      width='7'
      height='3.4'
      rx='1.7'
      fill='currentColor'
      opacity={0.72}
    />
  </SvgIcon>
);
