import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not create alias types (`type A = B`); use the original type directly instead of renaming it through a type alias.';

export const noAliasTypesRule = createRestrictedSyntaxRule(
  'Disallow type aliases that only rename another type',
  [
    {
      selector:
        'TSTypeAliasDeclaration > TSTypeReference.typeAnnotation:not([typeArguments])',
      message,
    },
  ],
);
