import { Stack, ToggleButton, Typography } from '@mui/material';
import { type VoiceOctave } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const VoiceOctaveToggle: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const voiceOctave = useEngineStore((state) => state.voiceOctave);
  const options: { value: VoiceOctave; label: string }[] = [
    { value: -1, label: t('pages.project.player.controls.voiceOctaveLower') },
    { value: 0, label: t('pages.project.player.controls.voiceOctaveSame') },
    { value: 1, label: t('pages.project.player.controls.voiceOctaveHigher') },
  ];

  return (
    <Stack gap={2}>
      <Stack direction='row' alignItems='baseline' gap={2}>
        <Typography fontSize={15} fontWeight={700}>
          {t('pages.project.player.controls.voiceOctave')}
        </Typography>
        <Typography fontSize={12} color='text.secondary'>
          {t('pages.project.player.controls.voiceOctaveCaption')}
        </Typography>
      </Stack>
      <Stack
        direction='row'
        gap={1}
        p={1}
        borderRadius='10px'
        bgcolor='action.hover'
      >
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            value={option.value}
            selected={option.value === voiceOctave}
            disabled={recording}
            color={option.value === 0 ? 'standard' : 'primary'}
            sx={{
              flex: 1,
              height: 40,
              border: 0,
              borderRadius: 2,
              fontSize: 14,
              textTransform: 'none',
              '&.Mui-selected': { fontWeight: 700 },
              '@media (any-pointer: coarse)': { height: 44 },
            }}
            onClick={() => {
              engine.store.update((state) => {
                state.voiceOctave = option.value;
              });
            }}
          >
            {option.label}
          </ToggleButton>
        ))}
      </Stack>
    </Stack>
  );
};
