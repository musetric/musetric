import type { Rule } from 'eslint';

type RestrictedSyntax = {
  message: string;
  selector: string;
};

export const createRestrictedSyntaxRule = (
  description: string,
  restrictions: RestrictedSyntax[],
): Rule.RuleModule => ({
  meta: {
    type: 'problem',
    docs: {
      description,
    },
    schema: [],
  },
  create: (context) => {
    const listeners: Rule.RuleListener = {};

    for (const restriction of restrictions) {
      listeners[restriction.selector] = (node: Rule.Node) => {
        context.report({
          node,
          message: restriction.message,
        });
      };
    }

    return listeners;
  },
});
