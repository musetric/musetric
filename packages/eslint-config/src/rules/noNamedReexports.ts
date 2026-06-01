import { type Rule } from 'eslint';

export const noNamedReexportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow named re-export statements',
    },
    messages: {
      namedReexport: 'Do not use named re-exports; use export * instead.',
    },
    schema: [],
  },
  create: (context) => ({
    ExportNamedDeclaration: (node) => {
      if (Boolean(node.source) && node.specifiers.length > 0) {
        context.report({
          node,
          messageId: 'namedReexport',
        });
      }
    },
  }),
};
