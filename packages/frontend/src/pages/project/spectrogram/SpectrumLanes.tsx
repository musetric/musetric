import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import {
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  ToggleButton,
  Tooltip,
} from '@mui/material';
import { type SpectrogramExpandedLane } from '@musetric/spectrogram';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { SpectrumLanesIcon } from '../../../icons/SpectrumLanesIcon.js';
import { useKeepFromGestures } from '../recording/useKeepFromGestures.js';
import { pictureLabelHeight } from '../visualization/pictureLabel.js';

const expandedLanes: SpectrogramExpandedLane[] = ['recording', 'lead', 'none'];

export const SpectrumLanes: FC = () => {
  const { t } = useTranslation();
  const keepFromGestures = useKeepFromGestures();
  const expandedLane = useEngineStore((state) => state.expandedSpectrumLane);
  const [anchorEl, setAnchorEl] = useState<HTMLElement>();
  const labels: Record<SpectrogramExpandedLane, string> = {
    recording: t('pages.project.spectrum.lanes.recording'),
    lead: t('pages.project.spectrum.lanes.lead'),
    none: t('pages.project.spectrum.lanes.both'),
  };
  const title = t('pages.project.spectrum.lanes.title', {
    lanes: labels[expandedLane],
  });
  const otherLane = expandedLane === 'recording' ? 'lead' : 'recording';
  const swapLabel =
    otherLane === 'lead'
      ? t('pages.project.spectrum.lanes.showLead')
      : t('pages.project.spectrum.lanes.showRecording');

  return (
    <>
      <Box ref={keepFromGestures} sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title={title}>
          <Box
            sx={{
              display: 'flex',
              height: pictureLabelHeight,
              borderRadius: 1,
              bgcolor: 'background.default',
            }}
          >
            <ToggleButton
              size='small'
              color='primary'
              value='lanes'
              selected={anchorEl !== undefined}
              aria-label={title}
              aria-haspopup='menu'
              aria-expanded={anchorEl !== undefined}
              sx={{
                py: 0,
                px: 0.75,
                gap: 0.25,
                '@media (any-pointer: coarse)': {
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: '-10px 0',
                  },
                },
              }}
              onClick={(event) => {
                setAnchorEl(event.currentTarget);
              }}
            >
              <SpectrumLanesIcon
                expandedLane={expandedLane}
                sx={{ fontSize: 14 }}
              />
              <ExpandMoreRoundedIcon sx={{ fontSize: 16 }} />
            </ToggleButton>
          </Box>
        </Tooltip>
        {expandedLane !== 'none' && (
          <Tooltip title={swapLabel}>
            <IconButton
              aria-label={swapLabel}
              sx={{
                height: pictureLabelHeight,
                px: 0.75,
                py: 0,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.default',
                color: 'text.primary',
                '@media (any-pointer: coarse)': {
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: '-10px 0',
                  },
                },
              }}
              onClick={() => {
                engine.store.update((state) => {
                  state.expandedSpectrumLane = otherLane;
                });
              }}
            >
              <SwapVertRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Menu
        anchorEl={anchorEl}
        open={anchorEl !== undefined}
        onClose={() => {
          setAnchorEl(undefined);
        }}
      >
        {expandedLanes.map((lane) => (
          <MenuItem
            key={lane}
            role='menuitemradio'
            aria-checked={lane === expandedLane}
            selected={lane === expandedLane}
            onClick={() => {
              setAnchorEl(undefined);
              engine.store.update((state) => {
                state.expandedSpectrumLane = lane;
              });
            }}
          >
            <ListItemIcon>
              <SpectrumLanesIcon expandedLane={lane} fontSize='small' />
            </ListItemIcon>
            <ListItemText primary={labels[lane]} />
            {lane === expandedLane && (
              <CheckRoundedIcon
                fontSize='small'
                color='primary'
                sx={{ ml: 2 }}
              />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
