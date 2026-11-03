import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { Button } from '@mui/material';
import { type FC, type RefObject, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SubtitleCursor } from './subtitleCursor.js';

const showDelayMs = 500;

type LinePlace = {
  away: boolean;
  above: boolean;
};

const useCurrentLinePlace = (
  listRef: RefObject<HTMLDivElement | null>,
  cursor: SubtitleCursor,
): LinePlace => {
  const [place, setPlace] = useState<LinePlace>({ away: false, above: false });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    let frame: number | undefined = undefined;

    const update = () => {
      frame = undefined;
      const line = list.querySelector(
        `[data-subtitle-segment-index="${cursor.getActiveSegmentIndex()}"]`,
      );
      if (!line) {
        setPlace((value) => ({ ...value, away: false }));
        return;
      }
      const rect = line.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const above = rect.bottom <= listRect.top;
      const below = rect.top >= listRect.bottom;
      setPlace((value) => {
        const next = {
          away: above || below,
          above: above || below ? above : value.above,
        };
        return next.away === value.away && next.above === value.above
          ? value
          : next;
      });
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(update);
    };

    update();
    const unsubscribe = cursor.subscribeActiveSegmentIndex(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(list);
    list.addEventListener('scroll', schedule, { passive: true });
    return () => {
      unsubscribe();
      observer.disconnect();
      list.removeEventListener('scroll', schedule);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [listRef, cursor]);

  return place;
};

export type SubtitleCurrentLineButtonProps = {
  listRef: RefObject<HTMLDivElement | null>;
  cursor: SubtitleCursor;
  onClick: () => void;
};

export const SubtitleCurrentLineButton: FC<SubtitleCurrentLineButtonProps> = (
  props,
) => {
  const { listRef, cursor, onClick } = props;
  const { t } = useTranslation();
  const { away, above } = useCurrentLinePlace(listRef, cursor);

  return (
    <Button
      size='small'
      color='inherit'
      startIcon={
        above ? (
          <KeyboardArrowUpRoundedIcon />
        ) : (
          <KeyboardArrowDownRoundedIcon />
        )
      }
      onClick={onClick}
      sx={{
        position: 'absolute',
        right: 16,
        ...(above ? { top: 4 } : { bottom: 4 }),
        zIndex: 1,
        borderRadius: 4,
        px: 2,
        textTransform: 'none',
        whiteSpace: 'nowrap',
        bgcolor: 'background.default',
        '&:hover': { bgcolor: 'background.default' },
        opacity: away ? 1 : 0,
        visibility: away ? 'visible' : 'hidden',
        transition: away
          ? `opacity 120ms linear ${showDelayMs}ms, visibility 0s linear ${showDelayMs}ms`
          : 'opacity 80ms linear, visibility 0s linear 80ms',
      }}
    >
      {t('pages.project.subtitle.currentLine')}
    </Button>
  );
};
