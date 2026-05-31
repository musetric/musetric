import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noNullLiteralRule = createRestrictedSyntaxRule(
  'Disallow null literals outside useRef',
  [
    {
      selector:
        "Literal[raw='null']:not(CallExpression[callee.name='useRef'] > Literal[raw='null'])",
      message: 'Do not use null',
    },
  ],
);
