import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { Button } from '@mui/material';
import { type FC, type RefObject, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SubtitleCursor } from './subtitleCursor.js';

const showDelayMs = 500;
const farMargin = '100000px';

type LinePlace = {
  away: boolean;
  above: boolean;
};

const useCurrentLinePlace = (
  listRef: RefObject<HTMLDivElement | null>,
  cursor: SubtitleCursor,
): LinePlace => {
  const [place, setPlace] = useState<LinePlace>({ away: false, above: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    let line: Element | undefined = undefined;
    const outside = { above: false, below: false };

    const show = () => {
      const away = outside.above || outside.below;
      setPlace((value) => {
        const next = { away, above: away ? outside.above : value.above };
        return next.away === value.away && next.above === value.above
          ? value
          : next;
      });
    };

    const observeEdge = (edge: keyof typeof outside, rootMargin: string) =>
      new IntersectionObserver(
        (entries) => {
          const entry = entries.filter((item) => item.target === line).at(-1);
          if (!entry) {
            return;
          }
          outside[edge] = !entry.isIntersecting;
          show();
        },
        { root: list, rootMargin },
      );

    const observers = [
      observeEdge('above', `0px 0px ${farMargin} 0px`),
      observeEdge('below', `${farMargin} 0px 0px 0px`),
    ];

    const follow = () => {
      const next =
        list.querySelector(
          `[data-subtitle-segment-index="${cursor.getActiveSegmentIndex()}"]`,
        ) ?? undefined;
      if (next === line) {
        return;
      }
      for (const observer of observers) {
        if (line) {
          observer.unobserve(line);
        }
        if (next) {
          observer.observe(next);
        }
      }
      line = next;
      if (!line) {
        outside.above = false;
        outside.below = false;
        show();
      }
    };

    follow();
    const unsubscribe = cursor.subscribeActiveSegmentIndex(follow);
    const lines = new MutationObserver(follow);
    lines.observe(list, { childList: true });
    return () => {
      unsubscribe();
      lines.disconnect();
      for (const observer of observers) {
        observer.disconnect();
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
