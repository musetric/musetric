import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not destructure function parameters inline; destructure inside the function body instead';

export const noInlineParameterDestructuringRule = createRestrictedSyntaxRule(
  'Disallow inline destructuring in function parameters',
  [
    {
      selector:
        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSDeclareFunction) > :matches(ObjectPattern, ArrayPattern)',
      message,
    },
    {
      selector:
        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSDeclareFunction) > AssignmentPattern > :matches(ObjectPattern, ArrayPattern)',
      message,
    },
  ],
);
