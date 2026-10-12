import {
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { type SingerVoice } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export const SingerVoiceToggle: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const singerVoice = useEngineStore((state) => state.singerVoice);
  const options: { value: SingerVoice; label: string; caption: string }[] = [
    {
      value: 'original',
      label: t('pages.project.player.controls.singerVoiceOriginal'),
      caption: t('pages.project.player.controls.singerVoiceOriginalCaption'),
    },
    {
      value: 'shifted',
      label: t('pages.project.player.controls.singerVoiceShifted'),
      caption: t('pages.project.player.controls.singerVoiceShiftedCaption'),
    },
  ];

  return (
    <Stack gap={1}>
      <Typography fontSize={15} fontWeight={700}>
        {t('pages.project.player.controls.singerVoice')}
      </Typography>
      <RadioGroup
        value={singerVoice}
        onChange={(_, value) => {
          const option = options.find((item) => item.value === value);
          if (option === undefined) {
            return;
          }
          engine.store.update((state) => {
            state.singerVoice = option.value;
          });
        }}
      >
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            disabled={recording}
            control={
              <Radio
                size='small'
                color={option.value === 'original' ? 'default' : 'primary'}
              />
            }
            label={
              <Stack>
                <Typography fontSize={14} fontWeight={600}>
                  {option.label}
                </Typography>
                <Typography fontSize={12} color='text.secondary'>
                  {option.caption}
                </Typography>
              </Stack>
            }
          />
        ))}
      </RadioGroup>
    </Stack>
  );
};
