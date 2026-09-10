import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noTopLevelLetRule = createRestrictedSyntaxRule(
  'Disallow top-level let declarations',
  [
    {
      selector: 'Program > VariableDeclaration[kind="let"]',
      message:
        'Do not use let at the top level. A mutable module binding is global state that every importer silently shares, and nobody in particular owns. Move it into the function or factory that drives the work, keep it in that closure, and let the caller decide who holds it and how long it lives. Mutating a top-level const object, or hiding the same singleton behind a module-level cache, is the same global state and is no better.',
    },
  ],
);
