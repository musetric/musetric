import { config } from '@musetric/eslint-config';

export default [
  ...config(),
  {
    files: ['src/migrations/steps/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.\\./types\\.js$|\\./[A-Za-z0-9]+\\.js$)',
              message:
                'A migration step is a frozen snapshot: import nothing but the Migration type, so no later change to the schema, the file system or the network can reach it.',
            },
          ],
        },
      ],
    },
  },
];
