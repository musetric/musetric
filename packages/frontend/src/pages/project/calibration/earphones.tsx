import { type ReactNode } from 'react';

export type FigurePoint = [number, number];

export type Earphone = {
  drawing: ReactNode;
  touch: FigurePoint;
  center: FigurePoint;
};

export const earbud: Earphone = {
  drawing: (
    <>
      <line
        x1='18'
        y1='4'
        x2='25'
        y2='22'
        stroke='#ececec'
        strokeWidth='6.5'
        strokeLinecap='round'
      />
      <ellipse cx='4.4' cy='0' rx='4.4' ry='5.6' fill='#9aa0a6' />
      <ellipse cx='15' cy='-1' rx='9.8' ry='8.6' fill='#ececec' />
      <ellipse cx='18.5' cy='-4.5' rx='2.4' ry='1.7' fill='#4b4f54' />
    </>
  ),
  touch: [0, 0],
  center: [14, 4],
};

export const headphones: Earphone = {
  drawing: (
    <>
      <path
        d='M-19 -3C-19 -33 19 -33 19 -3'
        fill='none'
        stroke='#d6d6d6'
        strokeWidth='4'
        strokeLinecap='round'
      />
      <g fill='#4a4a4a' stroke='#d6d6d6' strokeWidth='2'>
        <rect x='-25' y='-9' width='12' height='20' rx='6' />
        <rect x='13' y='-9' width='12' height='20' rx='6' />
      </g>
      <g fill='#262626'>
        <rect x='-13' y='-6' width='3.5' height='14' rx='1.75' />
        <rect x='9.5' y='-6' width='3.5' height='14' rx='1.75' />
      </g>
    </>
  ),
  touch: [-19, 11],
  center: [0, -8],
};
