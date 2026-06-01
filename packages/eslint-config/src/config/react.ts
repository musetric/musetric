import { type ESLint, type Linter } from 'eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import { tsConfig } from './ts.js';

export const reactConfig: Linter.Config = {
  ...tsConfig,
  files: ['**/*.{ts,tsx}'],
  plugins: {
    ...tsConfig.plugins,
    react: reactPlugin,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    'react-hooks': reactHooksPlugin as ESLint.Plugin,
    'react-refresh': reactRefreshPlugin,
  },
  settings: {
    ...tsConfig.settings,
    react: { version: 'detect' },
  },
  rules: {
    ...tsConfig.rules,
    ...reactPlugin.configs.recommended.rules,
    ...reactPlugin.configs['jsx-runtime'].rules,
    ...reactHooksPlugin.configs.recommended.rules,
    'jsx-quotes': ['error', 'prefer-single'],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/forbid-component-props': ['error', { forbid: ['spacing'] }],
  },
};
