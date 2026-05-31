import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noClassesRule = createRestrictedSyntaxRule('Disallow classes', [
  {
    selector: 'ClassDeclaration',
    message: 'Do not use class declarations',
  },
  {
    selector: 'ClassExpression',
    message: 'Do not use class expressions',
  },
]);
