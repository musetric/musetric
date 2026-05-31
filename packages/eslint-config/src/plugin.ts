import type { ESLint, Linter } from 'eslint';
import { musetricRules } from './rules/index.js';

export const musetricRecommendedRules: Linter.RulesRecord = {
  'musetric/no-aliased-reexports': 'error',
  'musetric/no-mixed-reexports': 'error',
  'musetric/no-named-reexports': 'error',
};

export const musetricPlugin: ESLint.Plugin = {
  rules: musetricRules,
};
