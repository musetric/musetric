import { noAliasConstantsRule } from './noAliasConstants.js';
import { noAliasedReexportsRule } from './noAliasedReexports.js';
import { noClassesRule } from './noClasses.js';
import { noComponentSpacingPropRule } from './noComponentSpacingProp.js';
import { noDynamicTranslationKeysRule } from './noDynamicTranslationKeys.js';
import { noImmediateInlineFunctionCallsRule } from './noImmediateInlineFunctionCalls.js';
import { noInlineParameterDestructuringRule } from './noInlineParameterDestructuring.js';
import { noMixedReexportsRule } from './noMixedReexports.js';
import { noNamedReexportsRule } from './noNamedReexports.js';
import { noNullLiteralRule } from './noNullLiteral.js';
import { noObjectMethodsRule } from './noObjectMethods.js';
import { noRenamedImportsRule } from './noRenamedImports.js';
import { noScreamingSnakeCaseRule } from './noScreamingSnakeCase.js';
import { noSeparateNamedExportsRule } from './noSeparateNamedExports.js';
import { noSeparateTypeImportsRule } from './noSeparateTypeImports.js';
import { noSwitchStatementsRule } from './noSwitchStatements.js';
import { noThisExpressionRule } from './noThisExpression.js';
import { noTypeMethodSignaturesRule } from './noTypeMethodSignatures.js';

export const musetricRules = {
  'no-alias-constants': noAliasConstantsRule,
  'no-aliased-reexports': noAliasedReexportsRule,
  'no-classes': noClassesRule,
  'no-component-spacing-prop': noComponentSpacingPropRule,
  'no-dynamic-translation-keys': noDynamicTranslationKeysRule,
  'no-immediate-inline-function-calls': noImmediateInlineFunctionCallsRule,
  'no-inline-parameter-destructuring': noInlineParameterDestructuringRule,
  'no-mixed-reexports': noMixedReexportsRule,
  'no-named-reexports': noNamedReexportsRule,
  'no-null-literal': noNullLiteralRule,
  'no-object-methods': noObjectMethodsRule,
  'no-renamed-imports': noRenamedImportsRule,
  'no-screaming-snake-case': noScreamingSnakeCaseRule,
  'no-separate-named-exports': noSeparateNamedExportsRule,
  'no-separate-type-imports': noSeparateTypeImportsRule,
  'no-switch-statements': noSwitchStatementsRule,
  'no-this-expression': noThisExpressionRule,
  'no-type-method-signatures': noTypeMethodSignaturesRule,
};
