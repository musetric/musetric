import { type Resource, use } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json' with { type: 'json' };

export const resources: Resource = {
  en: { translation: en },
};

export const initI18next = async () =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
