import {
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isForOfStatement,
  isIdentifier,
  isNewExpression,
  isObjectLiteralExpression,
  isParameter,
  isPropertyAccessExpression,
  isSpreadElement,
  type Node,
  SyntaxKind,
  type TypeChecker,
} from 'typescript';
import { isFunctionNode } from './functionNodes.js';

const typedArrayNames = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
]);
const copyingMethods = new Set([
  'map',
  'filter',
  'slice',
  'concat',
  'flat',
  'flatMap',
  'toSorted',
  'toReversed',
  'toSpliced',
  'with',
  'splice',
  'subarray',
  'keys',
  'values',
  'entries',
]);
const copyingStatics = new Set(['from', 'of', 'keys', 'values', 'entries']);
const staticOwners = new Set(['Array', 'Object', ...typedArrayNames]);

const isAssignmentTarget = (node: Node): boolean =>
  isBinaryExpression(node.parent) &&
  node.parent.left === node &&
  node.parent.operatorToken.kind === SyntaxKind.EqualsToken;

const isListType = (checker: TypeChecker, receiver: Node): boolean => {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(receiver));
  const name = type.getSymbol()?.name;
  return (
    checker.isArrayLikeType(type) ||
    (name !== undefined && typedArrayNames.has(name))
  );
};

const describeCopy = (checker: TypeChecker, node: Node): string | undefined => {
  if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const { expression: receiver, name } = node.expression;
  if (
    isIdentifier(receiver) &&
    staticOwners.has(receiver.text) &&
    copyingStatics.has(name.text)
  ) {
    return `${receiver.text}.${name.text}()`;
  }
  return copyingMethods.has(name.text) && isListType(checker, receiver)
    ? `${name.text}()`
    : undefined;
};

export const describeAllocation = (
  checker: TypeChecker,
  node: Node,
): string | undefined => {
  if (isObjectLiteralExpression(node) && !isAssignmentTarget(node)) {
    return 'an object literal';
  }
  if (isArrayLiteralExpression(node) && !isAssignmentTarget(node)) {
    return 'an array literal';
  }
  if (isNewExpression(node)) {
    return `new ${node.expression.getText()}`;
  }
  if (
    isSpreadElement(node) &&
    (isCallExpression(node.parent) || isNewExpression(node.parent))
  ) {
    return 'a spread argument';
  }
  if (isFunctionNode(node)) {
    return 'a closure';
  }
  if (isForOfStatement(node)) {
    return 'a for...of loop';
  }
  if (isArrayBindingPattern(node)) {
    return 'array destructuring';
  }
  if (isParameter(node) && node.dotDotDotToken) {
    return 'a rest parameter';
  }
  return describeCopy(checker, node);
};
