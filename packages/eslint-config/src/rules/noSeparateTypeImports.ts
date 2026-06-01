import { type Rule } from 'eslint';

const isTypeImportDeclaration = (node: object): boolean =>
  'importKind' in node && node.importKind === 'type';

export const noSeparateTypeImportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Disallow separate type import declarations',
    },
    messages: {
      separateTypeImport:
        'Inline type qualifiers at each specifier (`import { type X }`) instead of a separate `import type { X }` declaration.',
    },
    schema: [],
  },
  create: (context) => ({
    ImportDeclaration: (node) => {
      if (!isTypeImportDeclaration(node)) {
        return;
      }

      const namedSpecifiers = node.specifiers.filter(
        (specifier) => specifier.type === 'ImportSpecifier',
      );
      if (namedSpecifiers.length === 0) {
        return;
      }

      context.report({
        node,
        messageId: 'separateTypeImport',
        fix: (fixer) => {
          const { sourceCode } = context;
          const importToken = sourceCode.getFirstToken(node);
          const typeToken =
            importToken && sourceCode.getTokenAfter(importToken);
          const braceToken = typeToken && sourceCode.getTokenAfter(typeToken);
          if (!typeToken || !braceToken) {
            return [];
          }

          return [
            fixer.removeRange([typeToken.range[0], braceToken.range[0]]),
            ...namedSpecifiers.map((specifier) =>
              fixer.insertTextBefore(specifier, 'type '),
            ),
          ];
        },
      });
    },
  }),
};
