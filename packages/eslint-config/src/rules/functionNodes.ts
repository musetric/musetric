import {
  type ArrowFunction,
  forEachChild,
  type FunctionDeclaration,
  type FunctionExpression,
  isArrowFunction,
  isAsExpression,
  isBindingElement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isMethodSignature,
  isNonNullExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignature,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
  type MethodDeclaration,
  type Node,
} from 'typescript';

export type FunctionNode =
  ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;

export const isFunctionNode = (node: Node): node is FunctionNode =>
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  ((isFunctionDeclaration(node) || isMethodDeclaration(node)) &&
    node.body !== undefined);

type Visit = (node: Node) => boolean;

const walkWith = (visit: Visit) => {
  const walk = (node: Node): void => {
    if (visit(node) && !isFunctionNode(node)) {
      forEachChild(node, walk);
    }
  };
  return walk;
};

export const forEachInTree = (node: Node, visit: Visit): void => {
  forEachChild(node, walkWith(visit));
};

export const forEachInBody = (fn: FunctionNode, visit: Visit): void => {
  const walk = walkWith(visit);
  for (const parameter of fn.parameters) {
    walk(parameter);
  }
  if (fn.body) {
    walk(fn.body);
  }
};

export const nameOf = (node: Node): string | undefined => {
  const name =
    isPropertyAssignment(node) ||
    isShorthandPropertyAssignment(node) ||
    isMethodDeclaration(node) ||
    isPropertySignature(node) ||
    isMethodSignature(node) ||
    isPropertyDeclaration(node) ||
    isBindingElement(node) ||
    isVariableDeclaration(node)
      ? node.name
      : undefined;
  return name && (isIdentifier(name) || isStringLiteral(name))
    ? name.text
    : undefined;
};

export const skipOuter = (node: Node): Node => {
  let current = node;
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isNonNullExpression(current) ||
    isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};
