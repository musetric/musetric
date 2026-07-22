import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noTopLevelLetRule = createRestrictedSyntaxRule(
  'Disallow top-level let declarations',
  [
    {
      selector: 'Program > VariableDeclaration[kind="let"]',
      message: 'Do not use let at the top level',
    },
  ],
);
