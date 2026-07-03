import { type Linter } from 'eslint';
import { jsConfig } from './config/js.js';
import { reactConfig } from './config/react.js';
import { silenceSonarjsCatalogLog } from './config/silenceSonarjsCatalogLog.js';

export const config = () => {
  silenceSonarjsCatalogLog();

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
    {
      files: ['**/*.wgsl.ts'],
      rules: {
        'max-lines': 'off',
      },
    },
  ];

  return configs;
};
