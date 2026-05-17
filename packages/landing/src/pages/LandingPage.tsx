import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SitePage } from '../app/SitePage.js';
import productPreview from '../assets/productPreview.svg';

const featureCardSx = {
  borderColor: 'rgba(23, 22, 20, 0.12)',
  backgroundColor: 'rgba(255, 250, 242, 0.78)',
};

type ProcessStepProps = {
  number: string;
  title: string;
};

const ProcessStep = (props: ProcessStepProps) => {
  const { number, title } = props;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 5.5,
        borderRight: { xs: 0, md: '1px solid rgba(255, 250, 242, 0.16)' },
        borderBottom: { xs: '1px solid rgba(255, 250, 242, 0.16)', md: 0 },
        p: 2.75,
        '&:last-child': {
          borderRight: 0,
          borderBottom: 0,
        },
      }}
    >
      <Box
        component='span'
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          borderRadius: '50%',
          backgroundColor: '#f2c94c',
          color: 'text.primary',
          fontWeight: 900,
        }}
      >
        {number}
      </Box>
      <Typography component='strong' sx={{ fontSize: '1.4rem' }}>
        {title}
      </Typography>
    </Box>
  );
};

export const LandingPage = () => {
  const { t } = useTranslation();

  return (
    <SitePage>
      <Box
        component='section'
        aria-labelledby='heroTitle'
        sx={{
          position: 'relative',
          display: 'grid',
          alignItems: 'end',
          height: { xs: '82vh', md: '78vh' },
          maxHeight: 760,
          overflow: 'hidden',
          backgroundColor: '#151515',
        }}
      >
        <Box
          component='img'
          src={productPreview}
          alt={t('landing.hero.imageAlt')}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: {
              xs: 'linear-gradient(180deg, rgba(15, 15, 14, 0.42), rgba(15, 15, 14, 0.92)), linear-gradient(90deg, rgba(15, 15, 14, 0.88), rgba(15, 15, 14, 0.34))',
              md: 'linear-gradient(90deg, rgba(15, 15, 14, 0.9), rgba(15, 15, 14, 0.2)), linear-gradient(180deg, rgba(15, 15, 14, 0.1), rgba(15, 15, 14, 0.78))',
            },
          }}
        />
        <Container
          maxWidth='lg'
          sx={{
            position: 'relative',
            pb: { xs: 5.5, md: 9 },
            color: '#fffaf2',
          }}
        >
          <Typography
            component='p'
            sx={{
              mb: 2.25,
              color: 'secondary.main',
              fontSize: '0.78rem',
              fontWeight: 900,
              letterSpacing: 0,
              textTransform: 'uppercase',
            }}
          >
            {t('landing.hero.eyebrow')}
          </Typography>
          <Typography
            id='heroTitle'
            variant='h1'
            sx={{
              fontSize: 'clamp(4.2rem, 12vw, 8rem)',
              lineHeight: 0.92,
            }}
          >
            {t('landing.hero.title')}
          </Typography>
          <Typography
            sx={{
              width: { xs: '100%', md: 620 },
              mt: 3.25,
              color: 'rgba(255, 250, 242, 0.86)',
              fontSize: { xs: '1.06rem', md: '1.28rem' },
              lineHeight: 1.6,
            }}
          >
            {t('landing.hero.lead')}
          </Typography>
          <Stack direction='row' flexWrap='wrap' gap={1.5} sx={{ mt: 4.25 }}>
            <Button variant='contained' href='mailto:musetric@gmail.com'>
              {t('landing.hero.contact')}
            </Button>
            <Button
              variant='outlined'
              href='#details'
              sx={{
                borderColor: 'rgba(255, 250, 242, 0.28)',
                color: '#fffaf2',
                '&:hover': {
                  borderColor: 'rgba(255, 250, 242, 0.54)',
                  backgroundColor: 'rgba(255, 250, 242, 0.08)',
                },
              }}
            >
              {t('landing.hero.details')}
            </Button>
          </Stack>
        </Container>
      </Box>

      <Container
        id='details'
        component='section'
        maxWidth='lg'
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '0.9fr 1.35fr' },
          gap: { xs: 4, md: 5.25 },
          py: { xs: 6, md: 8.5 },
        }}
      >
        <Box>
          <Typography
            component='p'
            sx={{
              mb: 2.25,
              color: 'secondary.main',
              fontSize: '0.78rem',
              fontWeight: 900,
              letterSpacing: 0,
              textTransform: 'uppercase',
            }}
          >
            {t('landing.details.eyebrow')}
          </Typography>
          <Typography
            variant='h2'
            sx={{
              fontSize: 'clamp(2rem, 5vw, 3.4rem)',
              lineHeight: 1.05,
            }}
          >
            {t('landing.details.title')}
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 1.75,
          }}
        >
          <Card variant='outlined' sx={featureCardSx}>
            <CardContent>
              <Typography variant='h3' sx={{ fontSize: '1.08rem' }}>
                {t('landing.features.study.title')}
              </Typography>
              <Typography sx={{ mt: 1.75 }} color='text.secondary'>
                {t('landing.features.study.text')}
              </Typography>
            </CardContent>
          </Card>
          <Card variant='outlined' sx={featureCardSx}>
            <CardContent>
              <Typography variant='h3' sx={{ fontSize: '1.08rem' }}>
                {t('landing.features.practice.title')}
              </Typography>
              <Typography sx={{ mt: 1.75 }} color='text.secondary'>
                {t('landing.features.practice.text')}
              </Typography>
            </CardContent>
          </Card>
          <Card variant='outlined' sx={featureCardSx}>
            <CardContent>
              <Typography variant='h3' sx={{ fontSize: '1.08rem' }}>
                {t('landing.features.record.title')}
              </Typography>
              <Typography sx={{ mt: 1.75 }} color='text.secondary'>
                {t('landing.features.record.text')}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Container>

      <Container
        component='section'
        maxWidth='lg'
        sx={{ pb: { xs: 6, md: 8.5 } }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' },
            overflow: 'hidden',
            border: '1px solid rgba(23, 22, 20, 0.12)',
            borderRadius: 2,
            backgroundColor: 'text.primary',
            color: '#fffaf2',
          }}
        >
          <ProcessStep number='1' title={t('landing.flow.upload')} />
          <ProcessStep number='2' title={t('landing.flow.analyze')} />
          <ProcessStep number='3' title={t('landing.flow.practice')} />
          <ProcessStep number='4' title={t('landing.flow.record')} />
        </Box>
        <Typography
          color='text.secondary'
          sx={{
            width: { xs: '100%', md: 680 },
            mt: 2.75,
            ml: { xs: 0, md: 'auto' },
            lineHeight: 1.6,
            textAlign: { xs: 'left', md: 'right' },
          }}
        >
          {t('landing.flow.note')}
        </Typography>
      </Container>
    </SitePage>
  );
};
