import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type FC, useLayoutEffect, useRef } from 'react';
import {
  getSubtitleLoopBands,
  type SubtitleLoopWords,
} from './subtitleLoopBands.js';

export type SubtitleLoopBandProps = {
  words: SubtitleLoopWords;
};

export const SubtitleLoopBand: FC<SubtitleLoopBandProps> = (props) => {
  const { first, last } = props.words;
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useLayoutEffect(() => {
    const root = ref.current;
    const segment = root?.parentElement;
    if (!root || !segment) {
      return;
    }
    const color = alpha(theme.palette.primary.main, 0.14);

    const render = () => {
      const bands = getSubtitleLoopBands(segment, { first, last });
      root.replaceChildren(
        ...bands.map((band) => {
          const element = document.createElement('div');
          Object.assign(element.style, {
            position: 'absolute',
            left: `${band.left}px`,
            top: `${band.top}px`,
            width: `${band.width}px`,
            height: `${band.height}px`,
            background: color,
          });
          return element;
        }),
      );
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(segment);
    return () => {
      observer.disconnect();
    };
  }, [first, last, theme]);

  return (
    <Box
      ref={ref}
      aria-hidden
      sx={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
    />
  );
};
