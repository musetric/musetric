import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noTypeMethodSignaturesRule = createRestrictedSyntaxRule(
  'Disallow method signatures in types',
  [
    {
      selector: 'TSMethodSignature',
      message:
        'Do not use method signatures in types, use arrow function types instead',
    },
  ],
);
