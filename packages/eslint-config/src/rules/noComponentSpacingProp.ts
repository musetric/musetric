import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noComponentSpacingPropRule = createRestrictedSyntaxRule(
  'Disallow the spacing prop on components',
  [
    {
      selector:
        "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[A-Z]/] > JSXAttribute[name.name='spacing']",
      message: 'Do not use the spacing prop on components',
    },
  ],
);
