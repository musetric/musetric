import { useTheme } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { type CalibrationSpot } from './calibrationTexts.js';

const outline = 'rgba(255,255,255,0.55)';
const screen = 'rgba(255,255,255,0.07)';
const cup = 'rgba(255,255,255,0.75)';

type Point = {
  x: number;
  y: number;
};

const MicrophoneMark: FC<Point> = (props) => {
  const color = useTheme().palette.primary.main;
  return (
    <>
      <circle cx={props.x} cy={props.y} r='1.8' fill={color} />
      <circle
        cx={props.x}
        cy={props.y}
        r='6'
        fill='none'
        stroke={color}
        strokeOpacity='0.6'
      />
      <circle
        cx={props.x}
        cy={props.y}
        r='11'
        fill='none'
        stroke={color}
        strokeOpacity='0.3'
      />
    </>
  );
};

type EarCupProps = Point & {
  band: string;
};

const EarCup: FC<EarCupProps> = (props) => (
  <>
    <ellipse
      cx={props.x}
      cy={props.y}
      rx='20'
      ry='12'
      fill='#4a4a4a'
      stroke={cup}
      strokeWidth='2'
    />
    <ellipse cx={props.x} cy={props.y} rx='11' ry='6' fill='#2a2a2a' />
    <path
      d={props.band}
      fill='none'
      stroke={cup}
      strokeWidth='3'
      strokeLinecap='round'
    />
  </>
);

type Drawing = {
  width: number;
  height: number;
  body: ReactNode;
  microphone: Point;
  earCup: EarCupProps;
};

const drawings: Record<CalibrationSpot, Drawing> = {
  phoneBottom: {
    width: 96,
    height: 112,
    body: (
      <>
        <rect
          x='26'
          y='4'
          width='44'
          height='80'
          rx='8'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='31' y='12' width='34' height='64' rx='3' fill={screen} />
      </>
    ),
    microphone: { x: 48, y: 82 },
    earCup: { x: 48, y: 96, band: 'M68 96C86 96 92 74 88 56' },
  },
  phoneTop: {
    width: 96,
    height: 112,
    body: (
      <>
        <rect
          x='26'
          y='28'
          width='44'
          height='80'
          rx='8'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='31' y='36' width='34' height='64' rx='3' fill={screen} />
      </>
    ),
    microphone: { x: 48, y: 30 },
    earCup: { x: 48, y: 16, band: 'M68 16C86 16 92 38 88 56' },
  },
  tabletTop: {
    width: 140,
    height: 104,
    body: (
      <>
        <rect
          x='10'
          y='26'
          width='120'
          height='74'
          rx='8'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='17' y='33' width='106' height='60' rx='3' fill={screen} />
      </>
    ),
    microphone: { x: 70, y: 29 },
    earCup: { x: 70, y: 14, band: 'M90 14C110 14 120 28 118 44' },
  },
  tabletBottom: {
    width: 140,
    height: 104,
    body: (
      <>
        <rect
          x='10'
          y='4'
          width='120'
          height='74'
          rx='8'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='17' y='11' width='106' height='60' rx='3' fill={screen} />
      </>
    ),
    microphone: { x: 70, y: 75 },
    earCup: { x: 70, y: 90, band: 'M90 90C110 90 120 76 118 60' },
  },
  computer: {
    width: 132,
    height: 96,
    body: (
      <>
        <rect
          x='14'
          y='6'
          width='104'
          height='66'
          rx='5'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='20' y='14' width='92' height='52' rx='2' fill={screen} />
        <path
          d='M4 76h124l-8 10H12z'
          fill='none'
          stroke={outline}
          strokeWidth='2'
          strokeLinejoin='round'
        />
        <circle cx='66' cy='10' r='1.6' fill='rgba(255,255,255,0.7)' />
      </>
    ),
    microphone: { x: 58, y: 10 },
    earCup: { x: 34, y: 18, band: 'M14 18C4 18 2 36 8 48' },
  },
};

export type CalibrationFigureProps = {
  spot: CalibrationSpot;
  headphones: boolean;
  label: string;
};

export const CalibrationFigure: FC<CalibrationFigureProps> = (props) => {
  const { spot, headphones, label } = props;
  const drawing = drawings[spot];
  return (
    <svg
      width={drawing.width}
      height={drawing.height}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role='img'
      aria-label={label}
      style={{ flex: 'none' }}
    >
      {drawing.body}
      <MicrophoneMark x={drawing.microphone.x} y={drawing.microphone.y} />
      {headphones && (
        <EarCup
          x={drawing.earCup.x}
          y={drawing.earCup.y}
          band={drawing.earCup.band}
        />
      )}
    </svg>
  );
};
