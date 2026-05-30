import type { Rule } from 'eslint';

const getImportedName = (node: {
  type: string;
  name?: string;
  value?: unknown;
}): string | undefined => {
  if (node.type === 'Identifier') {
    return node.name;
  }
  return typeof node.value === 'string' ? node.value : undefined;
};

export const noRenamedImportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow renaming named imports',
    },
    messages: {
      renamedImport:
        'Do not rename imports; import the original name directly.',
    },
    schema: [],
  },
  create: (context) => ({
    ImportSpecifier: (node) => {
      const importedName = getImportedName(node.imported);
      if (importedName !== undefined && importedName !== node.local.name) {
        context.report({
          node,
          messageId: 'renamedImport',
        });
      }
    },
  }),
};
