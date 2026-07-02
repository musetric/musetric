import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not use inline object types in function parameters; declare a named argument type instead';

export const noInlineParameterObjectTypesRule = createRestrictedSyntaxRule(
  'Disallow inline object types in function parameters',
  [
    {
      selector:
        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > Identifier > TSTypeAnnotation > TSTypeLiteral',
      message,
    },
    {
      selector:
        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > AssignmentPattern > Identifier > TSTypeAnnotation > TSTypeLiteral',
      message,
    },
    {
      selector:
        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > RestElement > TSTypeAnnotation > TSTypeLiteral',
      message,
    },
  ],
);
