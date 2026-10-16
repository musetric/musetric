import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  IconButton,
  Stack,
  type Theme,
  ToggleButton,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { type LoopTry } from '@musetric/engine';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const fullLabelMaxTries = 4;

const outline = (theme: Theme) =>
  `1px solid ${alpha(theme.palette.text.primary, 0.28)}`;

const groupSx = (theme: Theme) => ({
  flexGrow: { xs: 1, sm: 0 },
  minWidth: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  border: outline(theme),
  borderRadius: 2.5,
  '& > :not(:last-child)': {
    borderRight: outline(theme),
  },
});

const segmentSx = (theme: Theme) => ({
  flex: '1 0 auto',
  height: { xs: 44, sm: 40 },
  px: { xs: 2, sm: 4.5 },
  border: 0,
  borderRadius: 0,
  textTransform: 'none',
  fontSize: 15,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  color: alpha(theme.palette.text.primary, 0.85),
});

const originalSelectedSx = (theme: Theme) => ({
  '&.Mui-selected, &.Mui-selected:hover': {
    fontWeight: 700,
    color: 'text.primary',
    backgroundColor: alpha(theme.palette.text.primary, 0.16),
  },
});

const trySelectedSx = (theme: Theme) => ({
  '&.Mui-selected, &.Mui-selected:hover': {
    fontWeight: 700,
    color: 'primary.main',
    backgroundColor: alpha(theme.palette.primary.main, 0.24),
  },
});

const getTryName = (t: TFunction, item: LoopTry): string => {
  const name = t('pages.project.loop.try', { number: item.number });
  return item.tempoRatio === 1
    ? name
    : `${name} · ${item.tempoRatio.toFixed(2)}x`;
};

export type LoopTakeSwitchProps = {
  disabled: boolean;
  deletable: boolean;
};

export const LoopTakeSwitch: FC<LoopTakeSwitchProps> = (props) => {
  const { disabled, deletable } = props;
  const { t } = useTranslation();
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const tries = useEngineStore((state) => state.loopTries);
  const selectedTryId = useEngineStore((state) => state.loopSelectedTryId);

  if (tries.length === 0) {
    return undefined;
  }

  const selectedTry = tries.find((item) => item.id === selectedTryId);
  const trashVisible = deletable && selectedTry !== undefined;
  const getLabel = (item: LoopTry): string => {
    if (isDesktop) {
      return getTryName(t, item);
    }
    return tries.length > fullLabelMaxTries
      ? String(item.number)
      : t('pages.project.loop.try', { number: item.number });
  };

  return (
    <Stack direction='row' sx={{ alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Stack
        direction='row'
        role='group'
        aria-label={t('pages.project.loop.takes')}
        sx={groupSx}
      >
        <ToggleButton
          value='original'
          selected={selectedTry === undefined}
          disabled={disabled}
          onChange={() => {
            engine.player.selectTry(undefined);
          }}
          sx={[segmentSx, originalSelectedSx]}
        >
          {t('pages.project.loop.original')}
        </ToggleButton>
        {tries.map((item) => (
          <ToggleButton
            key={item.id}
            value={item.id}
            selected={item.id === selectedTryId}
            disabled={disabled}
            aria-label={getTryName(t, item)}
            onChange={() => {
              engine.player.selectTry(item.id);
            }}
            sx={[segmentSx, trySelectedSx]}
          >
            {getLabel(item)}
          </ToggleButton>
        ))}
      </Stack>
      <IconButton
        aria-label={
          selectedTry &&
          t('pages.project.loop.deleteTry', {
            name: getTryName(t, selectedTry),
          })
        }
        disabled={!trashVisible}
        onClick={() => {
          if (selectedTry) {
            engine.player.deleteTry(selectedTry.id);
          }
        }}
        sx={{ visibility: trashVisible ? 'visible' : 'hidden' }}
      >
        <DeleteOutlineRoundedIcon />
      </IconButton>
    </Stack>
  );
};
