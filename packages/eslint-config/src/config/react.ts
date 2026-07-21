import eslintReact from '@eslint-react/eslint-plugin';
import { type ESLint, type Linter } from 'eslint';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import { tsConfig } from './ts.js';

const reactRecommended = eslintReact.configs['recommended-typescript'];

export const reactConfig: Linter.Config = {
  ...tsConfig,
  files: ['**/*.{ts,tsx,cts,mts}'],
  plugins: {
    ...tsConfig.plugins,
    ...reactRecommended.plugins,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    'react-hooks': reactHooksPlugin as ESLint.Plugin,
    'react-refresh': reactRefreshPlugin,
  },
  settings: {
    ...tsConfig.settings,
    ...reactRecommended.settings,
  },
  rules: {
    ...tsConfig.rules,
    ...reactRecommended.rules,
    ...reactHooksPlugin.configs.recommended.rules,
    // eslint-plugin-react-hooks owns hook rules; silence @eslint-react duplicates.
    '@eslint-react/error-boundaries': 'off',
    '@eslint-react/exhaustive-deps': 'off',
    '@eslint-react/no-array-index-key': 'off',
    '@eslint-react/purity': 'off',
    '@eslint-react/rules-of-hooks': 'off',
    '@eslint-react/set-state-in-effect': 'off',
    '@eslint-react/set-state-in-render': 'off',
    '@eslint-react/static-components': 'off',
    '@eslint-react/unsupported-syntax': 'off',
    '@eslint-react/use-memo': 'off',
    'jsx-quotes': ['error', 'prefer-single'],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
};
