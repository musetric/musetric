import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noThisExpressionRule = createRestrictedSyntaxRule(
  'Disallow this expressions',
  [
    {
      selector: 'ThisExpression',
      message:
        'Do not use this. A function that reads or writes state through this depends on whatever object it happens to be called on, so its state has no owner the reader can point at. Take what the function needs as arguments and keep the state in the closure of the caller that created it.',
    },
  ],
);
