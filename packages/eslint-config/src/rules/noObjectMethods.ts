import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noObjectMethodsRule = createRestrictedSyntaxRule(
  'Disallow object method syntax',
  [
    {
      selector:
        'Property[method=true]:not([key.name=/^(constructor|get|set)$/])',
      message: 'Do not use object methods, use arrow functions instead',
    },
  ],
);
