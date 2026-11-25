import { type Config, config } from './src/index.js';

const configs: Config = [
  ...config(),
  {
    ignores: ['src/**/__test__/fixtures/**/*'],
  },
];

export default configs;
