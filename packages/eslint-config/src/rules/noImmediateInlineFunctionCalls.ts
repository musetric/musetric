import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noImmediateInlineFunctionCallsRule = createRestrictedSyntaxRule(
  'Disallow immediately invoked inline functions',
  [
    {
      selector:
        ':matches(CallExpression[callee.type="FunctionExpression"], CallExpression[callee.type="ArrowFunctionExpression"])',
      message:
        'Do not invoke inline functions immediately; define the function separately instead',
    },
  ],
);
