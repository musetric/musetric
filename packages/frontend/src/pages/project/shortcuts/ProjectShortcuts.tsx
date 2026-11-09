import {
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { handleProjectShortcut } from './shortcutKeys.js';

export type ProjectShortcutsProps = {
  projectId: number;
};

export const ProjectShortcuts: FC<ProjectShortcutsProps> = (props) => {
  const { projectId } = props;
  const { t } = useTranslation();
  const subtitleQuery = useQuery(endpoints.subtitle.get(projectId));
  const subtitle = subtitleQuery.data;
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    const handledCodes = new Set<string>();
    const handleKeyDown = (event: KeyboardEvent) => {
      const handled = handleProjectShortcut(event, {
        projectId,
        subtitle: subtitle ?? [],
        openList: () => {
          setListOpen(true);
        },
      });
      if (handled) {
        event.preventDefault();
        handledCodes.add(event.code);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (handledCodes.delete(event.code)) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [projectId, subtitle]);

  const rows = [
    {
      keys: t('pages.project.shortcuts.play.keys'),
      action: t('pages.project.shortcuts.play.action'),
    },
    {
      keys: t('pages.project.shortcuts.seek.keys'),
      action: t('pages.project.shortcuts.seek.action'),
    },
    {
      keys: t('pages.project.shortcuts.loop.keys'),
      action: t('pages.project.shortcuts.loop.action'),
    },
    {
      keys: t('pages.project.shortcuts.record.keys'),
      action: t('pages.project.shortcuts.record.action'),
    },
    {
      keys: t('pages.project.shortcuts.views.keys'),
      action: t('pages.project.shortcuts.views.action'),
    },
    {
      keys: t('pages.project.shortcuts.tempo.keys'),
      action: t('pages.project.shortcuts.tempo.action'),
    },
    {
      keys: t('pages.project.shortcuts.key.keys'),
      action: t('pages.project.shortcuts.key.action'),
    },
    {
      keys: t('pages.project.shortcuts.tries.keys'),
      action: t('pages.project.shortcuts.tries.action'),
    },
    {
      keys: t('pages.project.shortcuts.deleteTry.keys'),
      action: t('pages.project.shortcuts.deleteTry.action'),
    },
    {
      keys: t('pages.project.shortcuts.leaveLoop.keys'),
      action: t('pages.project.shortcuts.leaveLoop.action'),
    },
    {
      keys: t('pages.project.shortcuts.list.keys'),
      action: t('pages.project.shortcuts.list.action'),
    },
  ];

  return (
    <Dialog
      open={listOpen}
      fullWidth
      maxWidth='xs'
      onClose={() => {
        setListOpen(false);
      }}
    >
      <DialogTitle>{t('pages.project.shortcuts.title')}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          {rows.map((row) => (
            <Stack
              key={row.keys}
              direction='row'
              sx={{ gap: 3, justifyContent: 'space-between' }}
            >
              <Typography variant='body2'>{row.action}</Typography>
              <Typography
                variant='body2'
                sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {row.keys}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
