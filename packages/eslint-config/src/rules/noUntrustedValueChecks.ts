import { type Rule } from 'eslint';
import {
  type BinaryExpression,
  type CallExpression,
  type Expression,
  type SpreadElement,
} from 'estree';
import { type Node, type Program, type Type, TypeFlags } from 'typescript';
import {
  getCheckedValueName,
  isTestFile,
  rawNamePattern,
} from './untrustedNames.js';

const numberCheckNames = new Set(['isInteger', 'isFinite', 'isNaN']);
const globalCheckNames = new Set(['isNaN', 'isFinite']);
const equalityOperators = new Set(['==', '!=', '===', '!==']);
const typeofPrimitiveFlags = new Map<string, TypeFlags>([
  ['number', TypeFlags.NumberLike],
  ['string', TypeFlags.StringLike],
  ['boolean', TypeFlags.BooleanLike],
]);

const isValueCheckCallee = (callee: CallExpression['callee']): boolean => {
  if (callee.type === 'Identifier') {
    return globalCheckNames.has(callee.name);
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Number' &&
    callee.property.type === 'Identifier' &&
    numberCheckNames.has(callee.property.name)
  );
};

type TypeofCheck = {
  operand: Expression;
  flags: TypeFlags;
};

const getTypeofCheck = (node: BinaryExpression): TypeofCheck | undefined => {
  if (!equalityOperators.has(node.operator)) {
    return undefined;
  }
  const sides = [
    { operand: node.left, literal: node.right },
    { operand: node.right, literal: node.left },
  ];
  for (const side of sides) {
    if (
      side.operand.type === 'UnaryExpression' &&
      side.operand.operator === 'typeof' &&
      side.literal.type === 'Literal' &&
      typeof side.literal.value === 'string'
    ) {
      const flags = typeofPrimitiveFlags.get(side.literal.value);
      if (flags !== undefined) {
        return { operand: side.operand.argument, flags };
      }
    }
  }
  return undefined;
};

const isPlainPrimitiveType = (type: Type, flags: TypeFlags): boolean => {
  if (type.isUnion()) {
    return type.types.every((member) => isPlainPrimitiveType(member, flags));
  }
  return (type.flags & flags) !== 0;
};

type TsParserServices = {
  program?: Program;
  esTreeNodeToTSNodeMap?: {
    get: (node: Expression | SpreadElement) => Node | undefined;
  };
};

export const noUntrustedValueChecksRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow runtime type and shape checks on values whose TypeScript type already guarantees the contract',
    },
    messages: {
      untrustedCheck:
        "Redundant runtime check on '{{name}}': remove it. The TypeScript type already is the contract — a value that violates it is the caller's bug, not this site's job to absorb. Only keep the check if '{{name}}' is genuinely untrusted boundary data: rename it with a 'raw' prefix and validate it at the entry point, not here. Real math (such as divisibility) belongs in a `%` expression, not a shape check.",
    },
    schema: [],
  },
  create: (context) => {
    if (isTestFile(context.filename)) {
      return {};
    }
    const services: TsParserServices | undefined =
      context.sourceCode.parserServices;
    const program = services?.program;
    const nodeMap = services?.esTreeNodeToTSNodeMap;
    if (!program || !nodeMap) {
      return {};
    }
    const checker = program.getTypeChecker();

    const isContractPrimitive = (
      node: Expression | SpreadElement,
      flags: TypeFlags,
    ): boolean => {
      const tsNode = nodeMap.get(node);
      if (!tsNode) {
        return false;
      }
      return isPlainPrimitiveType(checker.getTypeAtLocation(tsNode), flags);
    };

    const report = (node: Rule.Node, name: string): void => {
      context.report({
        node,
        messageId: 'untrustedCheck',
        data: { name },
      });
    };

    return {
      CallExpression: (node) => {
        if (!isValueCheckCallee(node.callee)) {
          return;
        }
        if (node.arguments.length === 0) {
          return;
        }
        const [argument] = node.arguments;
        const name = getCheckedValueName(argument);
        if (name === undefined || rawNamePattern.test(name)) {
          return;
        }
        if (!isContractPrimitive(argument, TypeFlags.NumberLike)) {
          return;
        }
        report(node, name);
      },
      BinaryExpression: (node) => {
        const check = getTypeofCheck(node);
        if (!check) {
          return;
        }
        const name = getCheckedValueName(check.operand);
        if (name === undefined || rawNamePattern.test(name)) {
          return;
        }
        if (!isContractPrimitive(check.operand, check.flags)) {
          return;
        }
        report(node, name);
      },
    };
  },
};
