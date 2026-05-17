import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    output: 'src/translations/{{language}}.json',
    indentation: 2,
    sort: true,
    defaultNS: false,
    keySeparator: false,
    defaultValue: '',
  },
});
