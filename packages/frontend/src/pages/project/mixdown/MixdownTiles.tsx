import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { alpha, Badge, Box, Button, Tooltip, Typography } from '@mui/material';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TempoIcon } from '../../../icons/TempoIcon.js';
import { TransposeIcon } from '../../../icons/TransposeIcon.js';
import { useKeyCaption } from '../buttons/useKeyCaption.js';
import { useTempoCaption } from '../buttons/useTempoCaption.js';
import { useProjectStore } from '../store.js';

type Tile = {
  name: string;
  label: string;
  icon: ReactNode;
  caption: string;
  badge?: string;
  changed: boolean;
  open: boolean;
  pick: (tile: HTMLElement) => void;
};

export type MixdownTilesProps = {
  sideAnchor?: HTMLElement;
  disabled: boolean;
};

export const MixdownTiles: FC<MixdownTilesProps> = (props) => {
  const { sideAnchor, disabled } = props;
  const { t } = useTranslation();
  const mixAnchorEl = useProjectStore((state) => state.mixAnchorEl);
  const setMixAnchorEl = useProjectStore((state) => state.setMixAnchorEl);
  const transposeAnchorEl = useProjectStore((state) => state.transposeAnchorEl);
  const setTransposeAnchorEl = useProjectStore(
    (state) => state.setTransposeAnchorEl,
  );
  const tempoAnchorEl = useProjectStore((state) => state.tempoAnchorEl);
  const setTempoAnchorEl = useProjectStore((state) => state.setTempoAnchorEl);
  const mixChanged = useEngineStore((state) =>
    Object.values(state.trackVolumes).some((volume) => volume !== 1),
  );
  const keyCaption = useKeyCaption();
  const tempoCaption = useTempoCaption();
  const pickerSide = sideAnchor ? 'end' : 'top';

  const tiles: Tile[] = [
    {
      name: 'mix',
      label: t('pages.project.mix.title'),
      icon: <TuneRoundedIcon />,
      caption: t('pages.project.mix.title'),
      changed: mixChanged,
      open: mixAnchorEl !== undefined,
      pick: (tile) => {
        setMixAnchorEl(sideAnchor ?? tile, pickerSide);
      },
    },
    {
      name: 'key',
      label: keyCaption.label,
      icon: <TransposeIcon />,
      caption: keyCaption.caption,
      badge: keyCaption.badge,
      changed: keyCaption.changed,
      open: transposeAnchorEl !== undefined,
      pick: (tile) => {
        setTransposeAnchorEl(sideAnchor ?? tile, pickerSide);
      },
    },
    {
      name: 'tempo',
      label: tempoCaption.label,
      icon: <TempoIcon />,
      caption: tempoCaption.caption,
      badge: tempoCaption.badge,
      changed: tempoCaption.changed,
      open: tempoAnchorEl !== undefined,
      pick: (tile) => {
        setTempoAnchorEl(sideAnchor ?? tile, pickerSide);
      },
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 2,
      }}
    >
      {tiles.map((tile) => (
        <Tooltip key={tile.name} title={tile.label}>
          <Button
            aria-label={tile.label}
            aria-expanded={tile.open}
            disabled={disabled}
            color={tile.changed ? 'primary' : 'inherit'}
            onClick={(event) => {
              tile.pick(event.currentTarget);
            }}
            sx={(theme) => ({
              height: 76,
              flexDirection: 'column',
              gap: 2,
              borderRadius: 3,
              bgcolor: tile.open
                ? alpha(theme.palette.primary.main, 0.16)
                : 'action.hover',
            })}
          >
            <Badge
              badgeContent={tile.badge}
              max={999}
              color='primary'
              invisible={tile.badge === undefined}
              sx={{
                '& .MuiBadge-badge': {
                  height: 18,
                  minWidth: 18,
                  px: 1.25,
                  fontSize: 11,
                  fontWeight: 700,
                },
              }}
            >
              {tile.icon}
            </Badge>
            <Typography
              noWrap
              sx={{ fontSize: 13, fontWeight: 400, lineHeight: 1 }}
            >
              {tile.caption}
            </Typography>
          </Button>
        </Tooltip>
      ))}
    </Box>
  );
};
