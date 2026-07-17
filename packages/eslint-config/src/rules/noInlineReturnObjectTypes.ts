import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not use inline object types in function return types; declare a named result type instead';

const functionSelector =
  ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSDeclareFunction)';

export const noInlineReturnObjectTypesRule = createRestrictedSyntaxRule(
  'Disallow inline object types in function return types',
  [
    {
      selector: `${functionSelector} > TSTypeAnnotation.returnType > TSTypeLiteral`,
      message,
    },
    {
      selector: `${functionSelector} > TSTypeAnnotation.returnType > TSTypeReference > TSTypeParameterInstantiation > TSTypeLiteral`,
      message,
    },
  ],
);
