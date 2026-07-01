import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

const message =
  'Do not create projection constants (`const x = obj.prop`); read the property from the source object directly instead of unwrapping a single field into a new binding.';

const selectorSuffix =
  'VariableDeclarator[id.type="Identifier"][init.type="MemberExpression"][init.computed=false][init.object.type="Identifier"]';

export const noProjectionConstantsRule = createRestrictedSyntaxRule(
  'Disallow module-level constants that only project a single property of another binding',
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
