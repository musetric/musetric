import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noFunctionDeclarationsRule = createRestrictedSyntaxRule(
  'Disallow function declarations and TypeScript overload signatures',
  [
    {
      selector: 'FunctionDeclaration',
      message:
        'Do not use function declarations, assign an arrow function expression to a const instead',
    },
    {
      selector: 'TSDeclareFunction',
      message:
        'Do not use TypeScript overload signatures, express overloads with a single arrow function whose parameter and return types are unions instead',
    },
  ],
);
