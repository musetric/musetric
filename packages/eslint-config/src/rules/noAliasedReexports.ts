import type { Rule } from 'eslint';

const hasTypeImportKind = (node: object): boolean =>
  'importKind' in node && node.importKind === 'type';

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

type TypeReference = {
  type: string;
  typeName?: TypeReference;
  name?: string;
};

type TypeAliasDeclaration = {
  id: TypeReference;
  typeAnnotation: TypeReference;
};

export const noAliasedReexportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow re-exporting imported bindings through aliases',
    },
    messages: {
      aliasedReexport:
        'Do not re-export imported bindings through local aliases. Remove the re-export and import the original binding directly where it is used.',
    },
    schema: [],
  },
  create: (context) => {
    const importedValueNameByLocalName = new Map<string, string>();
    const importedTypeNameByLocalName = new Map<string, string>();

    const reportIfImportedTypeAlias = (node: TypeAliasDeclaration): void => {
      const { typeAnnotation } = node;
      if (
        node.id.type === 'Identifier' &&
        typeAnnotation.type === 'TSTypeReference' &&
        typeAnnotation.typeName?.type === 'Identifier' &&
        typeAnnotation.typeName.name !== undefined &&
        importedTypeNameByLocalName.get(typeAnnotation.typeName.name) ===
          node.id.name
      ) {
        context.report({
          node: context.sourceCode.ast,
          messageId: 'aliasedReexport',
        });
      }
    };

    return {
      ImportDeclaration: (node) => {
        const { value } = node.source;
        if (typeof value !== 'string') {
          return;
        }

        for (const specifier of node.specifiers) {
          if (hasTypeImportKind(node)) {
            importedTypeNameByLocalName.set(
              specifier.local.name,
              specifier.local.name,
            );
            continue;
          }

          if (
            specifier.type === 'ImportSpecifier' &&
            hasTypeImportKind(specifier)
          ) {
            const importedName = getImportedName(specifier.imported);
            if (importedName !== undefined) {
              importedTypeNameByLocalName.set(
                specifier.local.name,
                importedName,
              );
            }
            continue;
          }

          if (specifier.type === 'ImportSpecifier') {
            const importedName = getImportedName(specifier.imported);
            if (importedName !== undefined) {
              importedValueNameByLocalName.set(
                specifier.local.name,
                importedName,
              );
            }
            continue;
          }

          importedValueNameByLocalName.set(
            specifier.local.name,
            specifier.local.name,
          );
        }
      },
      ExportNamedDeclaration: (node) => {
        const { declaration } = node;
        if (!declaration || declaration.type !== 'VariableDeclaration') {
          return;
        }

        for (const declarator of declaration.declarations) {
          if (
            declarator.id.type === 'Identifier' &&
            declarator.init?.type === 'Identifier' &&
            importedValueNameByLocalName.get(declarator.init.name) ===
              declarator.id.name
          ) {
            context.report({
              node: declarator,
              messageId: 'aliasedReexport',
            });
          }
        }
      },
      TSTypeAliasDeclaration: reportIfImportedTypeAlias,
    };
  },
};
