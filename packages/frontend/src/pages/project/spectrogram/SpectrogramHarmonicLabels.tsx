import { alpha, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getFrequencyRange } from '@musetric/engine';
import {
  allTrackKeys,
  type SpectrogramCursorHarmonic,
  stackedLaneGap,
  type TrackKey,
} from '@musetric/spectrogram';
import { subscribeResizeObserver } from '@musetric/utils/dom';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';
import { getFrequencyYRatio } from './SpectrogramNoteScale/noteMarker.js';

const bandKeys: readonly TrackKey[] = ['recording', 'lead'];
const labelHeight = 14;
const cursorOffset = 4;

type HarmonicPlacement = {
  harmonic: number;
  y: number;
  dominant: boolean;
  selected: boolean;
};

const placeHarmonics = (
  positions: HarmonicPlacement[],
): HarmonicPlacement[] => {
  const placed: HarmonicPlacement[] = [];
  const byPriority = [
    ...positions.filter((position) => position.selected),
    ...positions.filter((position) => position.dominant && !position.selected),
    ...positions,
  ];
  for (const position of byPriority) {
    const free = placed.every(
      (other) => Math.abs(other.y - position.y) >= labelHeight,
    );
    if (free) {
      placed.push(position);
    }
  }
  return placed;
};

type BandLayout = {
  top: number;
  height: number;
  minFrequency: number;
  maxFrequency: number;
  labelLimit: number;
  selected: readonly number[];
};

const placeBand = (
  cursor: SpectrogramCursorHarmonic,
  layout: BandLayout,
): HarmonicPlacement[] => {
  const { fundamental, dominant } = cursor;
  if (fundamental <= 0) {
    return [];
  }
  const limit = Math.min(
    layout.maxFrequency,
    Math.max(layout.labelLimit, ...layout.selected.map((k) => k * fundamental)),
  );
  const positions: HarmonicPlacement[] = [];
  for (let harmonic = 1; harmonic * fundamental <= limit; harmonic += 1) {
    const ratio = getFrequencyYRatio(
      harmonic * fundamental,
      layout.minFrequency,
      layout.maxFrequency,
    );
    if (ratio !== undefined && ratio <= 1) {
      positions.push({
        harmonic,
        y: layout.top + ratio * layout.height,
        dominant: harmonic === dominant,
        selected: layout.selected.includes(harmonic),
      });
    }
  }
  return placeHarmonics(positions);
};

const toggleHarmonic = (harmonic: number) => {
  engine.store.update((state) => {
    const selected = state.selectedHarmonics;
    state.selectedHarmonics = selected.includes(harmonic)
      ? selected.filter((value) => value !== harmonic)
      : [...selected, harmonic].sort((first, second) => first - second);
  });
};

const clearHarmonics = () => {
  if (engine.store.get().selectedHarmonics.length > 0) {
    engine.store.update((state) => {
      state.selectedHarmonics = [];
    });
  }
};

export const SpectrogramHarmonicLabels: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const chipColors = {
      background: alpha(theme.palette.common.black, 0.8),
      label: alpha(theme.palette.text.primary, 0.7),
      dominant: theme.palette.primary.main,
      selectedBackground: theme.palette.primary.main,
      selectedLabel: theme.palette.primary.contrastText,
    };
    const chips: HTMLButtonElement[] = [];

    const handleClick = (event: MouseEvent) => {
      if (event.currentTarget instanceof HTMLButtonElement) {
        toggleHarmonic(Number(event.currentTarget.dataset.harmonic));
      }
    };
    const stopPropagation = (event: Event) => {
      event.stopPropagation();
    };

    const getChip = (index: number): HTMLButtonElement => {
      const existing = chips.at(index);
      if (existing) {
        return existing;
      }
      const chip = document.createElement('button');
      chip.type = 'button';
      Object.assign(chip.style, {
        position: 'absolute',
        transform: 'translateY(-50%)',
        height: `${labelHeight}px`,
        padding: '0 3px',
        border: 'none',
        borderRadius: '3px',
        font: `600 11px ${theme.typography.fontFamily}`,
        lineHeight: `${labelHeight}px`,
        cursor: 'pointer',
        pointerEvents: 'auto',
      });
      chip.addEventListener('click', handleClick);
      chip.addEventListener('pointerdown', stopPropagation);
      container.append(chip);
      chips.push(chip);
      return chip;
    };

    const paintChip = (
      chip: HTMLButtonElement,
      placement: HarmonicPlacement,
    ) => {
      const label = String(placement.harmonic);
      chip.textContent = label;
      chip.dataset.harmonic = label;
      chip.title = t('pages.project.spectrogram.selectHarmonic', {
        harmonic: placement.harmonic,
      });
      chip.ariaLabel = chip.title;
      chip.ariaPressed = String(placement.selected);
      chip.style.background = placement.selected
        ? chipColors.selectedBackground
        : chipColors.background;
      const unselectedLabel = placement.dominant
        ? chipColors.dominant
        : chipColors.label;
      chip.style.color = placement.selected
        ? chipColors.selectedLabel
        : unselectedLabel;
      chip.style.display = 'block';
    };

    const render = () => {
      const state = engine.store.get();
      const { harmonics, playheadRatio } = useSettingsStore.getState();
      const cursor = state.cursorHarmonics;
      const shown =
        harmonics.enabled && state.spectrogramView === 'spectrum' && cursor;
      const { width, height } = container.getBoundingClientRect();
      const { minFrequency, maxFrequency } = getFrequencyRange(state);
      const bandHeight = (height - stackedLaneGap) / bandKeys.length;
      const placements = shown
        ? bandKeys.flatMap((key, band) =>
            placeBand(cursor[key], {
              top: band * (bandHeight + stackedLaneGap),
              height: bandHeight,
              minFrequency,
              maxFrequency,
              labelLimit: harmonics.dominantMaxFrequency,
              selected: state.selectedHarmonics,
            }),
          )
        : [];
      const x = Math.round(playheadRatio * width) + cursorOffset;

      placements.forEach((placement, index) => {
        const chip = getChip(index);
        paintChip(chip, placement);
        chip.style.left = `${x}px`;
        chip.style.top = `${placement.y}px`;
      });
      for (const chip of chips.slice(placements.length)) {
        chip.style.display = 'none';
      }
    };

    render();

    const unsubscribeResize = subscribeResizeObserver(container, render);
    const unsubscribeEngine = engine.store.subscribe((state) => {
      const range = getFrequencyRange(state);
      const cursor = state.cursorHarmonics;
      const harmonics = cursor
        ? allTrackKeys
            .map((key) => `${cursor[key].fundamental}:${cursor[key].dominant}`)
            .join('|')
        : '';
      return `${state.spectrogramView}:${range.minFrequency}:${range.maxFrequency}:${harmonics}:${state.selectedHarmonics.join(',')}`;
    }, render);
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => `${state.harmonics.enabled}:${state.playheadRatio}`,
      render,
    );
    const unsubscribeView = engine.store.subscribe(
      (state) => state.spectrogramView,
      (view) => {
        if (view !== 'spectrum') {
          clearHarmonics();
        }
      },
    );
    const unsubscribeHints = useSettingsStore.subscribe(
      (state) => state.harmonics.enabled,
      (enabled) => {
        if (!enabled) {
          clearHarmonics();
        }
      },
    );

    return () => {
      unsubscribeResize();
      unsubscribeEngine();
      unsubscribeSettings();
      unsubscribeView();
      unsubscribeHints();
      clearHarmonics();
      for (const chip of chips) {
        chip.removeEventListener('click', handleClick);
        chip.removeEventListener('pointerdown', stopPropagation);
        chip.remove();
      }
    };
  }, [theme, t]);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    />
  );
};
