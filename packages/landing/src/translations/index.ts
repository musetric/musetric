import i18next, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json' with { type: 'json' };

export const resources: Resource = {
  en: { translation: en },
};

export const i18n = i18next;

export const initI18next = async () =>
  i18next.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
