import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  Box,
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

export const SpectrumLanesMenu: FC = () => {
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

  return (
    <>
      <Tooltip title={title}>
        <Box
          ref={keepFromGestures}
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
