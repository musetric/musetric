import { type Rule } from 'eslint';
import { type BinaryExpression, type Node, type Statement } from 'estree';
import {
  getCheckedValueName,
  isTestFile,
  rawNamePattern,
} from './untrustedNames.js';

const isZeroLiteral = (node: Node): boolean =>
  node.type === 'Literal' && node.value === 0;

const getSignCheckedName = (node: BinaryExpression): string | undefined => {
  if (
    (node.operator === '<' || node.operator === '<=') &&
    isZeroLiteral(node.right)
  ) {
    return getCheckedValueName(node.left);
  }
  if (
    (node.operator === '>' || node.operator === '>=') &&
    isZeroLiteral(node.left)
  ) {
    return getCheckedValueName(node.right);
  }
  return undefined;
};

const containsThrow = (statement: Statement): boolean => {
  if (statement.type === 'ThrowStatement') {
    return true;
  }
  if (statement.type === 'BlockStatement') {
    return statement.body.some((child) => child.type === 'ThrowStatement');
  }
  return false;
};

const isThrowGuardTest = (node: Rule.Node): boolean => {
  const { parent } = node;
  if (!parent) {
    return false;
  }
  if (parent.type === 'IfStatement') {
    return parent.test === node && containsThrow(parent.consequent);
  }
  if (
    parent.type === 'Program' ||
    parent.type.endsWith('Statement') ||
    parent.type.endsWith('Declaration')
  ) {
    return false;
  }
  return isThrowGuardTest(parent);
};

export const noDefensiveThrowGuardsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow throw guards built on sign checks of contract-typed values',
    },
    messages: {
      signGuard:
        "Redundant sign guard '{{name}} < 0': remove it. The TypeScript contract already promises '{{name}}' is sane, so a negative value is a caller bug — not something this site should defend against. Only keep a sign guard if '{{name}}' is genuinely untrusted boundary data: in that case rename it with a 'raw' prefix and validate it at the entry point, not here.",
    },
    schema: [],
  },
  create: (context) => {
    if (isTestFile(context.filename)) {
      return {};
    }

    return {
      BinaryExpression: (node) => {
        const name = getSignCheckedName(node);
        if (name === undefined || rawNamePattern.test(name)) {
          return;
        }
        if (!isThrowGuardTest(node)) {
          return;
        }
        context.report({
          node,
          messageId: 'signGuard',
          data: { name },
        });
      },
    };
  },
};
