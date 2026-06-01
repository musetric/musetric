import { type Linter } from 'eslint';
import { jsConfig } from './config/js.js';
import { reactConfig } from './config/react.js';

export const config = () => {
  const configs: Linter.Config[] = [
    {
      ignores: jsConfig.ignores,
    },
    jsConfig,
    reactConfig,
    {
      files: ['**/*.config.ts'],
      rules: {
        'no-restricted-exports': 'off',
      },
    },
  ];

  return configs;
};
