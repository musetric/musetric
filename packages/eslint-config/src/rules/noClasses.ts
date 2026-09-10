import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const ownership =
  'A class binds state to an instance and hands that instance around, so the state travels with it instead of belonging to the caller that started the work. Use a factory function that keeps its state in a closure and returns the operations the caller asked for.';

export const noClassesRule = createRestrictedSyntaxRule('Disallow classes', [
  {
    selector: 'ClassDeclaration',
    message: `Do not use class declarations. ${ownership}`,
  },
  {
    selector: 'ClassExpression',
    message: `Do not use class expressions. ${ownership}`,
  },
]);
