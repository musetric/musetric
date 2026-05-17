import { Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LegalPage, LegalSection } from './LegalPage.js';

export const SupportPage = () => {
  const { t } = useTranslation();

  return (
    <LegalPage
      eyebrow={t('support.eyebrow')}
      title={t('support.title')}
      updated={t('support.updated')}
    >
      <LegalSection title={t('support.contact.title')}>
        <Typography color='text.secondary'>
          {t('support.contact.body')}{' '}
          <Link href='mailto:musetric@gmail.com'>musetric@gmail.com</Link>.
        </Typography>
      </LegalSection>
      <LegalSection title={t('support.response.title')}>
        <Typography color='text.secondary'>
          {t('support.response.body')}
        </Typography>
      </LegalSection>
      <LegalSection title={t('support.include.title')}>
        <Typography color='text.secondary'>
          {t('support.include.body')}
        </Typography>
      </LegalSection>
    </LegalPage>
  );
};
