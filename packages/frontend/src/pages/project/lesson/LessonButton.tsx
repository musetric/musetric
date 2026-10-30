import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import { IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { closeLesson, openLesson } from './lessonSession.js';
import { useLessonStore } from './lessonStore.js';

export const LessonButton: FC = () => {
  const { t } = useTranslation();
  const open = useLessonStore((state) => state.open);
  const label = t('pages.project.lesson.button');

  return (
    <Tooltip title={t('pages.project.lesson.buttonHint')}>
      <IconButton
        size='small'
        color={open ? 'primary' : 'inherit'}
        aria-label={label}
        sx={{ borderRadius: 2, px: 2, py: 1, minWidth: 48 }}
        onClick={() => {
          if (open) {
            closeLesson();
            return;
          }
          openLesson();
        }}
      >
        <Stack sx={{ alignItems: 'center', gap: 0.5 }}>
          <SchoolRoundedIcon fontSize='small' />
          <Typography variant='caption' noWrap sx={{ lineHeight: 1 }}>
            {label}
          </Typography>
        </Stack>
      </IconButton>
    </Tooltip>
  );
};
