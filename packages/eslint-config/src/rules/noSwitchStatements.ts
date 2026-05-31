import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noSwitchStatementsRule = createRestrictedSyntaxRule(
  'Disallow switch statements',
  [
    {
      selector: 'SwitchStatement',
      message: 'Do not use switch statements',
    },
  ],
);
