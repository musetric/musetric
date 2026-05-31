import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noScreamingSnakeCaseRule = createRestrictedSyntaxRule(
  'Disallow screaming snake case names',
  [
    {
      selector:
        'VariableDeclarator > Identifier.id[name=/^[A-Z]+(?:_[A-Z0-9]+)*$/]',
      message: 'Do not declare variables in SCREAMING_SNAKE_CASE',
    },
    {
      selector:
        "Property[key.type='Identifier'][key.name=/^[A-Z]+(?:_[A-Z0-9]+)*$/]",
      message: 'Do not use SCREAMING_SNAKE_CASE for object property names',
    },
    {
      selector:
        'TSPropertySignature > Identifier[name=/^[A-Z]+(?:_[A-Z0-9]+)*$/]',
      message: 'Do not use SCREAMING_SNAKE_CASE for property signatures',
    },
  ],
);
