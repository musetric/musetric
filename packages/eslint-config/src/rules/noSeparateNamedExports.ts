import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noSeparateNamedExportsRule = createRestrictedSyntaxRule(
  'Disallow separate named export declarations',
  [
    {
      selector: 'ExportNamedDeclaration[specifiers.length>0]:not([source])',
      message:
        'Inline export values and types at their declaration instead of exporting separately.',
    },
  ],
);
