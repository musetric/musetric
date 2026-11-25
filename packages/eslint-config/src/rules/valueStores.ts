import {
  type CallExpression,
  type Declaration,
  forEachChild,
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  type NewExpression,
  type Node,
  type ObjectLiteralElementLike,
  type SourceFile,
  SyntaxKind,
  type TypeChecker,
} from 'typescript';
import { nameOf, skipOuter } from './functionNodes.js';

const aliasKinds = new Set([
  SyntaxKind.ImportSpecifier,
  SyntaxKind.ImportClause,
  SyntaxKind.NamespaceImport,
  SyntaxKind.ExportSpecifier,
  SyntaxKind.ImportEqualsDeclaration,
]);
const storeOperators = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
]);
const elementStoreMethods = new Set(['push', 'unshift']);

export const append = <Key, Value>(
  map: Map<Key, Value[]>,
  key: Key,
  value: Value,
) => {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
};

type Store = {
  target: Node;
  value: Node;
  element: boolean;
};

const storesAt = (node: Node): Store[] => {
  if (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    elementStoreMethods.has(node.expression.name.text)
  ) {
    const target = node.expression.expression;
    return node.arguments.map((value) => ({ target, value, element: true }));
  }
  if (
    !isBinaryExpression(node) ||
    !storeOperators.has(node.operatorToken.kind)
  ) {
    return [];
  }
  const { left, right: value } = node;
  return isElementAccessExpression(left)
    ? [{ target: left.expression, value, element: true }]
    : [{ target: left, value, element: false }];
};

export type CallNode = CallExpression | NewExpression;

export type ValueStores = {
  calls: CallNode[];
  elementsByName: Map<string, ObjectLiteralElementLike[]>;
  setStores: Map<Node, Node[]>;
  elementStores: Map<Node, Node[]>;
  declarationsAt: (node: Node) => readonly Declaration[];
};

export const indexValueStores = (
  checker: TypeChecker,
  sourceFiles: SourceFile[],
): ValueStores => {
  const calls: CallNode[] = [];
  const elementsByName = new Map<string, ObjectLiteralElementLike[]>();
  const stores: Store[] = [];
  const index = (node: Node): void => {
    if (isCallExpression(node) || isNewExpression(node)) {
      calls.push(node);
    }
    stores.push(...storesAt(node));
    if (isObjectLiteralExpression(node)) {
      for (const element of node.properties) {
        const name = nameOf(element);
        if (name !== undefined) {
          append(elementsByName, name, element);
        }
      }
    }
    forEachChild(node, index);
  };
  for (const file of sourceFiles) {
    forEachChild(file, index);
  }

  const declarationsAt = (node: Node): readonly Declaration[] => {
    const symbol = checker.getSymbolAtLocation(
      isPropertyAccessExpression(node) ? node.name : node,
    );
    const own = symbol?.declarations ?? [];
    if (symbol && own.some((declaration) => aliasKinds.has(declaration.kind))) {
      return checker.getAliasedSymbol(symbol).declarations ?? [];
    }
    return own;
  };

  const setStores = new Map<Node, Node[]>();
  const elementStores = new Map<Node, Node[]>();
  for (const store of stores) {
    const target = skipOuter(store.target);
    const declarations =
      isIdentifier(target) || isPropertyAccessExpression(target)
        ? declarationsAt(target)
        : [];
    for (const declaration of declarations) {
      append(
        store.element ? elementStores : setStores,
        declaration,
        store.value,
      );
    }
  }
  return { calls, elementsByName, setStores, elementStores, declarationsAt };
};
