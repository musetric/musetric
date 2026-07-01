import i18next, { type Resource } from 'i18next';
import en from './en.json' with { type: 'json' };

export const resources: Resource = {
  en: { translation: en },
};

export const initI18next = async () => {
  const queries = new URLSearchParams(window.location.search);
  const lng = queries.get('lng') ?? 'en';
  return i18next.init({
    resources,
    lng,
  });
};
