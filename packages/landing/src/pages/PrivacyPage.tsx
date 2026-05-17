import { Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LegalPage, LegalSection } from './LegalPage.js';

export const PrivacyPage = () => {
  const { t } = useTranslation();

  return (
    <LegalPage
      eyebrow={t('privacy.eyebrow')}
      title={t('privacy.title')}
      updated={t('privacy.updated')}
    >
      <LegalSection title={t('privacy.overview.title')}>
        <Typography color='text.secondary'>
          {t('privacy.overview.body')}
        </Typography>
      </LegalSection>
      <LegalSection title={t('privacy.data.title')}>
        <Typography color='text.secondary'>
          {t('privacy.data.audio')}
        </Typography>
        <Typography color='text.secondary'>
          {t('privacy.data.project')}
        </Typography>
        <Typography color='text.secondary'>
          {t('privacy.data.contact')}
        </Typography>
        <Typography color='text.secondary'>
          {t('privacy.data.technical')}
        </Typography>
      </LegalSection>
      <LegalSection title={t('privacy.use.title')}>
        <Typography color='text.secondary'>{t('privacy.use.body')}</Typography>
      </LegalSection>
      <LegalSection title={t('privacy.sharing.title')}>
        <Typography color='text.secondary'>
          {t('privacy.sharing.body')}
        </Typography>
      </LegalSection>
      <LegalSection title={t('privacy.security.title')}>
        <Typography color='text.secondary'>
          {t('privacy.security.body')}
        </Typography>
      </LegalSection>
      <LegalSection title={t('privacy.contact.title')}>
        <Typography color='text.secondary'>
          {t('privacy.contact.body')}{' '}
          <Link href='mailto:musetric@gmail.com'>musetric@gmail.com</Link>.
        </Typography>
      </LegalSection>
    </LegalPage>
  );
};
