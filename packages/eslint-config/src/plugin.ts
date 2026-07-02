import { type ESLint, type Linter } from 'eslint';
import { musetricRules } from './rules/index.js';

export const musetricRecommendedRules: Linter.RulesRecord = {
  'musetric/no-alias-constants': 'error',
  'musetric/no-aliased-reexports': 'error',
  'musetric/no-classes': 'error',
  'musetric/no-component-spacing-prop': 'error',
  'musetric/no-defensive-throw-guards': 'error',
  'musetric/no-dynamic-translation-keys': 'error',
  'musetric/no-immediate-inline-function-calls': 'error',
  'musetric/no-inline-parameter-destructuring': 'error',
  'musetric/no-inline-parameter-object-types': 'error',
  'musetric/no-mixed-reexports': 'error',
  'musetric/no-named-reexports': 'error',
  'musetric/no-null-literal': 'error',
  'musetric/no-object-methods': 'error',
  'musetric/no-projection-constants': 'error',
  'musetric/no-renamed-imports': 'error',
  'musetric/no-screaming-snake-case': 'error',
  'musetric/no-separate-named-exports': 'error',
  'musetric/no-separate-type-imports': 'error',
  'musetric/no-switch-statements': 'error',
  'musetric/no-this-expression': 'error',
  'musetric/no-trivial-function-wrappers': 'error',
  'musetric/no-type-method-signatures': 'error',
};

export const musetricPlugin: ESLint.Plugin = {
  rules: musetricRules,
};
