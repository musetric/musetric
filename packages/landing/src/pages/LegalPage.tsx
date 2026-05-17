import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SitePage } from '../app/SitePage.js';

type LegalPageProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  updated: string;
};

export const LegalPage = (props: LegalPageProps) => {
  const { children, eyebrow, title, updated } = props;
  const { t } = useTranslation();

  return (
    <SitePage>
      <Container maxWidth='md' sx={{ py: { xs: 5, md: 8 } }}>
        <Button href='/' variant='text' sx={{ mb: 4, px: 0 }}>
          {t('legal.backHome')}
        </Button>
        <Typography
          component='p'
          sx={{
            mb: 2,
            color: 'secondary.main',
            fontSize: '0.78rem',
            fontWeight: 900,
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </Typography>
        <Typography
          variant='h1'
          sx={{
            fontSize: { xs: '2.5rem', md: '4rem' },
            lineHeight: 1,
          }}
        >
          {title}
        </Typography>
        <Typography color='text.secondary' sx={{ mt: 2 }}>
          {updated}
        </Typography>
        <Stack gap={4} sx={{ mt: 5 }}>
          {children}
        </Stack>
      </Container>
    </SitePage>
  );
};

type LegalSectionProps = {
  children: ReactNode;
  title: string;
};

export const LegalSection = (props: LegalSectionProps) => {
  const { children, title } = props;

  return (
    <Box>
      <Typography variant='h2' sx={{ mb: 1.5, fontSize: '1.45rem' }}>
        {title}
      </Typography>
      <Stack gap={1.5}>{children}</Stack>
    </Box>
  );
};
