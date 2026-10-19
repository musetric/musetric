import { useTheme } from '@mui/material';
import { type FC } from 'react';

const outline = 'rgba(255,255,255,0.55)';
const cup = 'rgba(255,255,255,0.75)';

export type CalibrationFigureProps = {
  handheld: boolean;
  headphones: boolean;
  label: string;
};

export const CalibrationFigure: FC<CalibrationFigureProps> = (props) => {
  const { handheld, headphones, label } = props;
  const microphone = useTheme().palette.primary.main;

  if (handheld) {
    return (
      <svg
        width='96'
        height='112'
        viewBox='0 0 96 112'
        role='img'
        aria-label={label}
        style={{ flex: 'none' }}
      >
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
        <rect
          x='31'
          y='12'
          width='34'
          height='64'
          rx='3'
          fill='rgba(255,255,255,0.07)'
        />
        <circle cx='48' cy='82' r='1.8' fill={microphone} />
        <circle
          cx='48'
          cy='82'
          r='6'
          fill='none'
          stroke={microphone}
          strokeOpacity='0.6'
        />
        <circle
          cx='48'
          cy='82'
          r='11'
          fill='none'
          stroke={microphone}
          strokeOpacity='0.3'
        />
        {headphones && (
          <>
            <ellipse
              cx='48'
              cy='96'
              rx='20'
              ry='12'
              fill='#4a4a4a'
              stroke={cup}
              strokeWidth='2'
            />
            <ellipse cx='48' cy='96' rx='11' ry='6' fill='#2a2a2a' />
            <path
              d='M68 96C86 96 92 74 88 56'
              fill='none'
              stroke={cup}
              strokeWidth='3'
              strokeLinecap='round'
            />
          </>
        )}
      </svg>
    );
  }

  return (
    <svg
      width='132'
      height='96'
      viewBox='0 0 132 96'
      role='img'
      aria-label={label}
      style={{ flex: 'none' }}
    >
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
      <rect
        x='20'
        y='14'
        width='92'
        height='52'
        rx='2'
        fill='rgba(255,255,255,0.07)'
      />
      <path
        d='M4 76h124l-8 10H12z'
        fill='none'
        stroke={outline}
        strokeWidth='2'
        strokeLinejoin='round'
      />
      <circle cx='66' cy='10' r='1.6' fill='rgba(255,255,255,0.7)' />
      <circle cx='58' cy='10' r='1.6' fill={microphone} />
      <circle
        cx='58'
        cy='10'
        r='6'
        fill='none'
        stroke={microphone}
        strokeOpacity='0.6'
      />
      <circle
        cx='58'
        cy='10'
        r='11'
        fill='none'
        stroke={microphone}
        strokeOpacity='0.3'
      />
      {headphones && (
        <>
          <circle
            cx='40'
            cy='30'
            r='13'
            fill='#4a4a4a'
            stroke={cup}
            strokeWidth='2'
          />
          <circle cx='40' cy='30' r='7' fill='#2a2a2a' />
          <path
            d='M27 30C14 30 8 48 12 60'
            fill='none'
            stroke={cup}
            strokeWidth='3'
            strokeLinecap='round'
          />
        </>
      )}
    </svg>
  );
};
