import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import {
  Button,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/index.js';
import { routes } from '../../app/router/routes.js';

const searchThreshold = 12;

export type ProjectsTitleProps = {
  search: string;
  setSearch: (value: string) => void;
};
export const ProjectsTitle: FC<ProjectsTitleProps> = (props) => {
  const { search, setSearch } = props;
  const { t } = useTranslation();
  const projectList = useQuery(endpoints.project.list());
  const count = projectList.data?.length ?? 0;

  return (
    <Stack
      direction='row'
      flexWrap='wrap'
      alignItems='center'
      columnGap={3}
      rowGap={2}
    >
      <Stack direction='row' gap={2} alignItems='baseline'>
        <Typography variant='h4'>{t('pages.projects.title')}</Typography>
        {count > 0 && (
          <Typography variant='subtitle1' color='text.secondary'>
            {count}
          </Typography>
        )}
      </Stack>
      <Stack
        direction='row'
        gap={2}
        alignItems='center'
        justifyContent='flex-end'
        flexGrow={1}
        minWidth={0}
      >
        {count > searchThreshold && (
          <TextField
            size='small'
            value={search}
            placeholder={t('pages.projects.search')}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position='start'>
                    <SearchIcon fontSize='small' />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              flex: '1 1 140px',
              maxWidth: 220,
              '& fieldset': { border: 'none' },
              '& .MuiInputBase-root': { backgroundColor: 'background.paper' },
            }}
          />
        )}
        {count > 0 && (
          <Button
            component={routes.projectsCreate.Link}
            variant='contained'
            color='primary'
            startIcon={<AddIcon fontSize='inherit' />}
          >
            {t('pages.projects.create')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
};
