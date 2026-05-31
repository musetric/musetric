import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noDynamicTranslationKeysRule = createRestrictedSyntaxRule(
  'Disallow dynamic translation keys',
  [
    {
      selector:
        "CallExpression[callee.name='t']:not([arguments.0.type='Literal'][arguments.0.value=/^[\\s\\S]*$/])",
      message: 'Call t with a single string literal key',
    },
  ],
);
