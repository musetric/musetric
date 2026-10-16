import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import { Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

export type QueryErrorProps = {
  error?: unknown;
};
export const QueryError: FC<QueryErrorProps> = (props) => {
  const { error } = props;
  const { t } = useTranslation();
  return (
    <Stack
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      <ReportGmailerrorredIcon color='error' fontSize='large' />
      <Typography color='error'>{t('common.queryView.error')}</Typography>
      {!!error && <Typography color='error'>{String(error)}</Typography>}
    </Stack>
  );
};
