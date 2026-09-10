import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noReflectRule = createRestrictedSyntaxRule('Disallow Reflect', [
  {
    selector: "Identifier[name='Reflect']",
    message:
      'Do not use Reflect. It hides the real type and API boundary behind dynamic access. Use the supported API directly. If a dependency type is incomplete or the only available API is deprecated, use that API directly with a narrow, documented type assertion when needed, so the incompatibility stays visible and can be fixed. Do not hide it with Reflect.',
  },
]);
