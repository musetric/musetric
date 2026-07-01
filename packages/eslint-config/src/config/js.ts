import eslint from '@eslint/js';
import { type ESLint, type Linter } from 'eslint';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sonarjs from 'eslint-plugin-sonarjs';
import { musetricPlugin, musetricRecommendedRules } from '../plugin.js';

export const jsConfig: Linter.Config = {
  files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  ignores: ['dist/**/*', '.tsbuildinfo/**/*', 'storage/**/*'],
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
  plugins: {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    'import-x': importX as unknown as ESLint.Plugin,
    musetric: musetricPlugin,
    'simple-import-sort': simpleImportSort,
    sonarjs,
  },
  rules: {
    ...eslint.configs.recommended.rules,
    ...musetricRecommendedRules,
    ...sonarjs.configs.recommended.rules,
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
    'sonarjs/assertions-in-tests': 'off',
    'sonarjs/code-eval': 'off',
    'sonarjs/cognitive-complexity': 'off',
    'sonarjs/different-types-comparison': 'off',
    'sonarjs/function-return-type': 'off',
    'sonarjs/hashing': 'off',
    'sonarjs/no-duplicated-branches': 'off',
    'sonarjs/no-identical-functions': 'off',
    'sonarjs/no-nested-conditional': 'off',
    'sonarjs/no-nested-functions': 'off',
    'sonarjs/no-os-command-from-path': 'off',
    'sonarjs/no-redundant-jump': 'off',
    'sonarjs/prefer-regexp-exec': 'off',
    'sonarjs/pseudo-random': 'off',
    'sonarjs/todo-tag': 'off',
    'func-names': ['error'],
    'func-style': ['error'],
    eqeqeq: ['error', 'always'],
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
    'no-useless-rename': ['error'],
    'no-duplicate-imports': ['error'],
    'simple-import-sort/imports': [
      'error',
      {
        groups: [['^\\u0000', '^node:', '^@?\\w', '^', '^\\.']],
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
    'object-shorthand': ['error', 'always'],
    'simple-import-sort/exports': 'error',
    'no-nested-ternary': 'error',
    'no-else-return': ['error', { allowElseIf: false }],
    'no-lonely-if': 'error',
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
  },
};
