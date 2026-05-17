import { Box, Container, Link, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export const SiteFooter = () => {
  const { t } = useTranslation();

  return (
    <Box
      component='footer'
      sx={{ borderTop: '1px solid rgba(23, 22, 20, 0.1)' }}
    >
      <Container
        maxWidth='lg'
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          gap: 2,
          py: 3,
        }}
      >
        <Typography color='text.secondary'>
          {t('landing.footer.brand')}
        </Typography>
        <Stack direction='row' flexWrap='wrap' gap={2.5}>
          <Link color='text.primary' href='/privacy' underline='hover'>
            {t('landing.footer.privacy')}
          </Link>
          <Link color='text.primary' href='/support' underline='hover'>
            {t('landing.footer.support')}
          </Link>
          <Link
            color='text.primary'
            href='mailto:musetric@gmail.com'
            underline='hover'
          >
            musetric@gmail.com
          </Link>
        </Stack>
      </Container>
    </Box>
  );
};
