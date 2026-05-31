import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noThisExpressionRule = createRestrictedSyntaxRule(
  'Disallow this expressions',
  [
    {
      selector: 'ThisExpression',
      message: 'Do not use this',
    },
  ],
);
