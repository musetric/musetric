import { type Rule } from 'eslint';
import { type ModuleDeclaration, type Statement } from 'estree';

type ProgramStatement = ModuleDeclaration | Statement;

const isReexportStatement = (node: ProgramStatement): boolean =>
  node.type === 'ExportAllDeclaration' ||
  (node.type === 'ExportNamedDeclaration' &&
    'source' in node &&
    Boolean(node.source));

export const noMixedReexportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow mixing re-export statements with implementation statements in one file',
    },
    messages: {
      mixed:
        'Do not mix re-exports with implementation in one file; use a dedicated re-export file or an implementation file.',
    },
    schema: [],
  },
  create: (context) => {
    let reexportNode: ProgramStatement | undefined = undefined;
    let implementationNode: ProgramStatement | undefined = undefined;

    return {
      Program: (node) => {
        for (const statement of node.body) {
          if (isReexportStatement(statement)) {
            reexportNode = reexportNode ?? statement;
          } else if (statement.type !== 'ImportDeclaration') {
            implementationNode = implementationNode ?? statement;
          }
        }
      },
      'Program:exit': () => {
        if (reexportNode !== undefined && implementationNode !== undefined) {
          context.report({
            node: reexportNode,
            messageId: 'mixed',
          });
        }
      },
    };
  },
};
