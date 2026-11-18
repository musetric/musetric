import { Box, useTheme } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { type FC, type ReactNode } from 'react';
import {
  type CalibrationPlace,
  type CalibrationSpot,
} from './calibrationTexts.js';
import {
  earbud,
  type Earphone,
  type FigurePoint,
  headphones,
} from './earphones.js';

const outline = 'rgba(255,255,255,0.55)';
const screen = 'rgba(255,255,255,0.07)';
const loopSeconds = 2.6;
const dropPixels = 16;

const drop = keyframes`
  0% {
    transform: translate(0, -${dropPixels}px) scale(0.7);
    opacity: 0;
  }
  30%, 100% {
    transform: none;
    opacity: 1;
  }
`;

const ripple = keyframes`
  0%, 34% {
    transform: scale(0.4);
    opacity: 0;
  }
  40% {
    opacity: 0.9;
  }
  75%, 100% {
    transform: scale(2.4);
    opacity: 0;
  }
`;

const speakerRipple = keyframes`
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  12% {
    opacity: 0.9;
  }
  70%, 100% {
    transform: scale(2.6);
    opacity: 0;
  }
`;

const phoneBody = (top: number) => (
  <>
    <rect
      x='58'
      y={top}
      width='44'
      height='74'
      rx='8'
      fill='none'
      stroke={outline}
      strokeWidth='2'
    />
    <rect x='63' y={top + 8} width='34' height='58' rx='3' fill={screen} />
  </>
);

const tabletBody = (top: number) => (
  <>
    <rect
      x='10'
      y={top}
      width='140'
      height='72'
      rx='8'
      fill='none'
      stroke={outline}
      strokeWidth='2'
    />
    <rect x='17' y={top + 7} width='126' height='58' rx='3' fill={screen} />
  </>
);

const wideView = '0 -8 160 128';

type Pose = {
  target: FigurePoint;
  touch: FigurePoint;
  degrees: number;
  scale: number;
};

type Drawing = {
  view: string;
  body: ReactNode;
  microphone: FigurePoint;
  speakers: FigurePoint[];
  earphone: Earphone;
  pose: Pose;
  mate?: FigurePoint;
};

const drawings: Record<CalibrationSpot, Drawing> = {
  phoneBottom: {
    view: '38 -2 110 110',
    body: phoneBody(4),
    microphone: [72, 73],
    speakers: [[90, 73]],
    earphone: earbud,
    pose: { target: [72, 80], touch: [0, 0], degrees: 90, scale: 0.9 },
    mate: [114, 46],
  },
  phoneTop: {
    view: '42 0 110 110',
    body: phoneBody(34),
    microphone: [72, 39],
    speakers: [[90, 103]],
    earphone: earbud,
    pose: { target: [72, 32], touch: [0, 0], degrees: -90, scale: 0.9 },
    mate: [114, 66],
  },
  tabletTop: {
    view: wideView,
    body: tabletBody(34),
    microphone: [80, 39],
    speakers: [
      [14, 70],
      [146, 70],
    ],
    earphone: earbud,
    pose: { target: [80, 32], touch: [0, 0], degrees: -90, scale: 0.9 },
    mate: [128, 10],
  },
  tabletBottom: {
    view: wideView,
    body: tabletBody(4),
    microphone: [80, 71],
    speakers: [
      [14, 40],
      [146, 40],
    ],
    earphone: earbud,
    pose: { target: [80, 78], touch: [0, 0], degrees: 90, scale: 0.9 },
    mate: [128, 100],
  },
  computer: {
    view: wideView,
    body: (
      <>
        <rect
          x='26'
          y='34'
          width='108'
          height='68'
          rx='5'
          fill='none'
          stroke={outline}
          strokeWidth='2'
        />
        <rect x='32' y='43' width='96' height='53' rx='2' fill={screen} />
        <circle cx='80' cy='38.5' r='1.6' fill='rgba(255,255,255,0.7)' />
        <path
          d='M14 106h132l-9 10H23z'
          fill='none'
          stroke={outline}
          strokeWidth='2'
          strokeLinejoin='round'
        />
      </>
    ),
    microphone: [88, 38.5],
    speakers: [
      [30, 111],
      [130, 111],
    ],
    earphone: headphones,
    pose: { target: [88, 31], touch: [-19, 11], degrees: -20, scale: 0.8 },
  },
};

const toPlacement = (pose: Pose) => {
  const radians = (pose.degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [touchX, touchY] = pose.touch;
  const x = pose.target[0] - (touchX * cos - touchY * sin) * pose.scale;
  const y = pose.target[1] - (touchX * sin + touchY * cos) * pose.scale;
  return {
    transform: `translate(${x} ${y}) rotate(${pose.degrees}) scale(${pose.scale})`,
    locate: (point: FigurePoint): FigurePoint => [
      x + (point[0] * cos - point[1] * sin) * pose.scale,
      y + (point[0] * sin + point[1] * cos) * pose.scale,
    ],
  };
};

const getRippleSources = (drawing: Drawing, place: CalibrationPlace) => {
  if (place === 'speaker') {
    return drawing.speakers;
  }
  const [x, y] = drawing.pose.target;
  const [mx, my] = drawing.microphone;
  return [[x + (mx - x) * 0.3, y + (my - y) * 0.3] satisfies FigurePoint];
};

export type CalibrationFigureProps = {
  spot: CalibrationSpot;
  place: CalibrationPlace;
  animated: boolean;
  label: string;
};

export const CalibrationFigure: FC<CalibrationFigureProps> = (props) => {
  const { spot, place, animated, label } = props;
  const color = useTheme().palette.primary.main;
  const drawing = drawings[spot];
  const placement = toPlacement(drawing.pose);
  const [centerX, centerY] = placement.locate(drawing.earphone.center);
  const [microphoneX, microphoneY] = drawing.microphone;
  const sources = getRippleSources(drawing, place);
  const earphonePlace = place !== 'speaker';
  const mate =
    earphonePlace && drawing.mate
      ? toPlacement({
          ...drawing.pose,
          target: drawing.mate,
          degrees: drawing.pose.degrees + 35,
        })
      : undefined;

  return (
    <Box
      component='svg'
      viewBox={drawing.view}
      role='img'
      aria-label={label}
      sx={{
        width: '100%',
        height: '100%',
        flex: 'none',
        overflow: 'visible',
        '& .ripple': {
          transformBox: 'fill-box',
          transformOrigin: 'center',
          opacity: 0,
        },
        ...(animated && {
          '& .earphone': {
            animation: `${drop} ${loopSeconds}s cubic-bezier(0.3, 1.4, 0.5, 1) infinite`,
          },
          '& .ripple': {
            transformBox: 'fill-box',
            transformOrigin: 'center',
            opacity: 0,
            animation: `${earphonePlace ? ripple : speakerRipple} ${earphonePlace ? loopSeconds : 1.8}s ease-out infinite`,
          },
          '& .ripple.late': { animationDelay: '0.3s' },
        }),
        '@media (prefers-reduced-motion: reduce)': {
          '& .earphone, & .ripple': { animation: 'none' },
        },
      }}
    >
      {drawing.body}
      {place === 'speaker' &&
        drawing.speakers.map((speaker) => (
          <circle
            key={speaker.join(' ')}
            cx={speaker[0]}
            cy={speaker[1]}
            r='1.4'
            fill='rgba(255,255,255,0.6)'
          />
        ))}
      <circle cx={microphoneX} cy={microphoneY} r='2' fill={color} />
      <circle
        cx={microphoneX}
        cy={microphoneY}
        r='5.5'
        fill='none'
        stroke={color}
        strokeOpacity='0.6'
      />
      {mate && <g transform={mate.transform}>{drawing.earphone.drawing}</g>}
      {sources.map((source) => (
        <g key={source.join(' ')} fill='none' stroke={color} strokeWidth='1.6'>
          <circle className='ripple' cx={source[0]} cy={source[1]} r='6' />
          <circle className='ripple late' cx={source[0]} cy={source[1]} r='6' />
        </g>
      ))}
      {earphonePlace && (
        <g
          className='earphone'
          style={{
            transformBox: 'view-box',
            transformOrigin: `${centerX}px ${centerY}px`,
          }}
        >
          <g transform={placement.transform}>{drawing.earphone.drawing}</g>
        </g>
      )}
    </Box>
  );
};
