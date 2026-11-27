import { type Config, config } from '@musetric/eslint-config';

const transportConfig: Config = [
  ...config(),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
];

export default transportConfig;
