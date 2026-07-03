import eslint from '@eslint/js';
import { type Linter } from 'eslint';
import {
  createTypeScriptImportResolver,
  defaultConditionNames,
} from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import * as sonarjs from 'eslint-plugin-sonarjs';
import { musetricPlugin, musetricRecommendedRules } from '../plugin.js';

export const jsConfig: Linter.Config = {
  files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  ignores: ['dist/**/*', '.tsbuildinfo/**/*', 'storage/**/*'],
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
  settings: {
    ...importX.configs.typescript.settings,
    'import-x/ignore': ['\\.(?:worker|worklet)\\.ts$'],
    'import-x/resolver': undefined,
    'import-x/resolver-next': createTypeScriptImportResolver({
      conditionNames: ['monorepo', ...defaultConditionNames],
      extensions: [
        ...importX.configs.typescript.settings['import-x/extensions'],
      ],
    }),
  },
  plugins: {
    'import-x': importX,
    musetric: musetricPlugin,
    'simple-import-sort': simpleImportSort,
    sonarjs,
  },
  rules: {
    ...eslint.configs.recommended.rules,
    ...importX.flatConfigs.recommended.rules,
    ...musetricRecommendedRules,
    ...sonarjs.configs.recommended.rules,
    eqeqeq: ['error', 'always'],
    'func-names': ['error'],
    'func-style': ['error'],
    'import-x/no-cycle': ['error', { ignoreExternal: true }],
    'import-x/no-extraneous-dependencies': [
      'error',
      {
        bundledDependencies: true,
        devDependencies: true,
        includeTypes: true,
        optionalDependencies: true,
        packageDir: ['./'],
        peerDependencies: true,
      },
    ],
    'import-x/no-self-import': 'error',
    'max-depth': ['error', 3],
    'max-lines': [
      'error',
      { max: 400, skipBlankLines: false, skipComments: false },
    ],
    'max-nested-callbacks': ['error', 3],
    'max-params': ['error', 4],
    'no-duplicate-imports': ['error'],
    'no-else-return': ['error', { allowElseIf: false }],
    'no-lonely-if': 'error',
    'no-nested-ternary': 'error',
    'no-restricted-exports': [
      'error',
      {
        restrictDefaultExports: {
          direct: true,
          named: true,
          defaultFrom: true,
          namedFrom: true,
          namespaceFrom: true,
        },
      },
    ],
    'no-restricted-globals': [
      'error',
      {
        name: '__dirname',
        message:
          'Use import.meta.url with fileURLToPath() instead of __dirname in ES modules',
      },
      {
        name: '__filename',
        message: 'Use import.meta.url instead of __filename in ES modules',
      },
      {
        name: 'require',
        message: 'Use import statements instead of require() in ES modules',
      },
      {
        name: 'exports',
        message: 'Use export statements instead of exports in ES modules',
      },
      {
        name: 'module',
        message:
          'Use export statements instead of module.exports in ES modules',
      },
    ],
    'no-useless-rename': ['error'],
    'object-shorthand': ['error', 'always'],
    'prefer-destructuring': [
      'error',
      {
        AssignmentExpression: {
          array: false,
          object: false,
        },
        VariableDeclarator: {
          array: true,
          object: true,
        },
      },
      {
        enforceForRenamedProperties: false,
      },
    ],
    'simple-import-sort/exports': 'error',
    'simple-import-sort/imports': [
      'error',
      {
        groups: [['^\\u0000', '^node:', '^@?\\w', '^', '^\\.']],
      },
    ],
    'sonarjs/assertions-in-tests': 'off',
    'sonarjs/code-eval': 'off',
    'sonarjs/cognitive-complexity': 'off',
    'sonarjs/different-types-comparison': 'off',
    'sonarjs/function-return-type': 'off',
    'sonarjs/hashing': 'off',
    'sonarjs/max-lines': ['warn', { maximum: 350 }],
    'sonarjs/no-collapsible-if': 'error',
    'sonarjs/no-nested-conditional': 'off',
    'sonarjs/no-nested-functions': 'off',
    'sonarjs/no-os-command-from-path': 'off',
    'sonarjs/no-redundant-jump': 'off',
    'sonarjs/prefer-immediate-return': 'error',
    'sonarjs/prefer-regexp-exec': 'off',
    'sonarjs/pseudo-random': 'off',
    'sonarjs/todo-tag': 'off',
  },
};
