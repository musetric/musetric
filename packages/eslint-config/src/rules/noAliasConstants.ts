import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not create alias constants (`const a = b`); use the original binding directly instead of renaming it through a module-level constant.';

const selectorSuffix =
  'VariableDeclarator[id.type="Identifier"][init.type="Identifier"][init.name!="undefined"]';

export const noAliasConstantsRule = createRestrictedSyntaxRule(
  'Disallow module-level constants that only alias another binding',
  [
    {
      selector: `Program > VariableDeclaration > ${selectorSuffix}`,
      message,
    },
    {
      selector: `Program > ExportNamedDeclaration > VariableDeclaration > ${selectorSuffix}`,
      message,
    },
  ],
);
