import { TextField } from '@mui/material';
import { api } from '@musetric/api';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { type FC, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useProjectStore } from '../store.js';

export type RecordingNameFieldProps = {
  recording: api.recording.Item;
  otherNames: string[];
};

export const RecordingNameField: FC<RecordingNameFieldProps> = (props) => {
  const { recording, otherNames } = props;
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const setRenamingRecordingId = useProjectStore(
    (state) => state.setRenamingRecordingId,
  );
  const edited = useMutation(endpoints.recording.edit(projectId));
  const [draft, setDraft] = useState(recording.name);
  const [error, setError] = useState<string>();
  const cancelledRef = useRef(false);

  const findProblem = (name: string): string | undefined => {
    if (!name) {
      return t('pages.project.recording.nameEmpty');
    }
    const lowered = name.toLowerCase();
    if (otherNames.some((other) => other.toLowerCase() === lowered)) {
      return t('pages.project.recording.nameTaken');
    }
    return undefined;
  };

  const save = () => {
    if (edited.isPending || cancelledRef.current) {
      return;
    }
    const name = draft.trim();
    if (name === recording.name) {
      setRenamingRecordingId(undefined);
      return;
    }
    const problem = findProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    edited.mutate(
      { recordingId: recording.id, name },
      {
        onSuccess: () => {
          setRenamingRecordingId(undefined);
        },
        onError: (failure) => {
          setError(
            isAxiosError(failure) && failure.response?.status === 409
              ? t('pages.project.recording.nameTaken')
              : t('pages.project.recording.nameFailed'),
          );
        },
      },
    );
  };

  return (
    <TextField
      variant='standard'
      size='small'
      fullWidth
      autoFocus
      value={draft}
      error={error !== undefined}
      disabled={edited.isPending}
      helperText={error}
      slotProps={{
        input: { sx: { typography: 'body2' } },
        htmlInput: {
          maxLength: api.recording.nameMaxLength,
          'aria-label': t('pages.project.recording.name'),
        },
      }}
      sx={{ pr: 3 }}
      onFocus={(event) => {
        event.target.select();
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setError(undefined);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        }
        if (event.key === 'Escape') {
          cancelledRef.current = true;
          setRenamingRecordingId(undefined);
        }
      }}
      onBlur={() => {
        if (findProblem(draft.trim())) {
          cancelledRef.current = true;
          setRenamingRecordingId(undefined);
          return;
        }
        save();
      }}
    />
  );
};
