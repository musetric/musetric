import { noAliasConstantsRule } from './noAliasConstants.js';
import { noAliasedReexportsRule } from './noAliasedReexports.js';
import { noClassesRule } from './noClasses.js';
import { noComponentSpacingPropRule } from './noComponentSpacingProp.js';
import { noDefensiveThrowGuardsRule } from './noDefensiveThrowGuards.js';
import { noDynamicTranslationKeysRule } from './noDynamicTranslationKeys.js';
import { noFunctionDeclarationsRule } from './noFunctionDeclarations.js';
import { noImmediateInlineFunctionCallsRule } from './noImmediateInlineFunctionCalls.js';
import { noInlineParameterDestructuringRule } from './noInlineParameterDestructuring.js';
import { noInlineParameterObjectTypesRule } from './noInlineParameterObjectTypes.js';
import { noMixedReexportsRule } from './noMixedReexports.js';
import { noNamedReexportsRule } from './noNamedReexports.js';
import { noNullLiteralRule } from './noNullLiteral.js';
import { noObjectMethodsRule } from './noObjectMethods.js';
import { noProjectionConstantsRule } from './noProjectionConstants.js';
import { noRenamedImportsRule } from './noRenamedImports.js';
import { noScreamingSnakeCaseRule } from './noScreamingSnakeCase.js';
import { noSeparateNamedExportsRule } from './noSeparateNamedExports.js';
import { noSeparateTypeImportsRule } from './noSeparateTypeImports.js';
import { noSwitchStatementsRule } from './noSwitchStatements.js';
import { noThisExpressionRule } from './noThisExpression.js';
import { noTrivialFunctionWrappersRule } from './noTrivialFunctionWrappers.js';
import { noTypeMethodSignaturesRule } from './noTypeMethodSignatures.js';
import { noUntrustedValueChecksRule } from './noUntrustedValueChecks.js';

export const musetricRules = {
  'no-alias-constants': noAliasConstantsRule,
  'no-aliased-reexports': noAliasedReexportsRule,
  'no-classes': noClassesRule,
  'no-component-spacing-prop': noComponentSpacingPropRule,
  'no-defensive-throw-guards': noDefensiveThrowGuardsRule,
  'no-dynamic-translation-keys': noDynamicTranslationKeysRule,
  'no-function-declarations': noFunctionDeclarationsRule,
  'no-immediate-inline-function-calls': noImmediateInlineFunctionCallsRule,
  'no-inline-parameter-destructuring': noInlineParameterDestructuringRule,
  'no-inline-parameter-object-types': noInlineParameterObjectTypesRule,
  'no-mixed-reexports': noMixedReexportsRule,
  'no-named-reexports': noNamedReexportsRule,
  'no-null-literal': noNullLiteralRule,
  'no-object-methods': noObjectMethodsRule,
  'no-projection-constants': noProjectionConstantsRule,
  'no-renamed-imports': noRenamedImportsRule,
  'no-screaming-snake-case': noScreamingSnakeCaseRule,
  'no-separate-named-exports': noSeparateNamedExportsRule,
  'no-separate-type-imports': noSeparateTypeImportsRule,
  'no-switch-statements': noSwitchStatementsRule,
  'no-this-expression': noThisExpressionRule,
  'no-trivial-function-wrappers': noTrivialFunctionWrappersRule,
  'no-type-method-signatures': noTypeMethodSignaturesRule,
  'no-untrusted-value-checks': noUntrustedValueChecksRule,
};
