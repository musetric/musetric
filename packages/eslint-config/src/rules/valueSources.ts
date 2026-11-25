import {
  type BindingElement,
  isBindingElement,
  isIdentifier,
  isMethodDeclaration,
  isMethodSignature,
  isObjectLiteralExpression,
  isParameter,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignature,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isVariableDeclaration,
  type Node,
  type ObjectLiteralElementLike,
} from 'typescript';
import { type FlowContext } from './flowContext.js';
import { isFunctionNode, nameOf } from './functionNodes.js';

const valueOfElement = (
  context: FlowContext,
  element: ObjectLiteralElementLike,
): Node[] => {
  if (isPropertyAssignment(element)) {
    return [element.initializer];
  }
  if (isShorthandPropertyAssignment(element)) {
    const symbol = context.checker.getShorthandAssignmentValueSymbol(element);
    return (symbol?.declarations ?? []).flatMap((declaration) =>
      context.trace('sources', declaration),
    );
  }
  return isMethodDeclaration(element) ? [element] : [];
};

const implementingElements = (
  context: FlowContext,
  signature: Node,
): ObjectLiteralElementLike[] => {
  const known = context.implementations.get(signature);
  if (known) {
    return known;
  }
  const name = nameOf(signature);
  if (name === undefined) {
    return [];
  }
  const { checker } = context;
  const elements = context.stores.elementsByName.get(name) ?? [];
  const found = elements.filter((element) => {
    const type = isObjectLiteralExpression(element.parent)
      ? checker.getContextualType(element.parent)
      : undefined;
    const property =
      type && checker.getPropertyOfType(checker.getNonNullableType(type), name);
    return property?.declarations?.some(
      (declaration) => declaration === signature,
    );
  });
  context.implementations.set(signature, found);
  return found;
};

const boundSources = (
  context: FlowContext,
  element: BindingElement,
): Node[] => {
  const name =
    element.propertyName && isIdentifier(element.propertyName)
      ? element.propertyName.text
      : nameOf(element);
  if (name === undefined) {
    return [];
  }
  const { checker } = context;
  const type = checker.getNonNullableType(
    checker.getTypeAtLocation(element.parent),
  );
  return (checker.getPropertyOfType(type, name)?.declarations ?? []).flatMap(
    (declaration) => context.trace('sources', declaration),
  );
};

export const ownSourcesOf = (
  context: FlowContext,
  declaration: Node,
): Node[] => {
  if (isFunctionNode(declaration)) {
    return [declaration];
  }
  if (
    isVariableDeclaration(declaration) ||
    isPropertyDeclaration(declaration)
  ) {
    return declaration.initializer ? [declaration.initializer] : [];
  }
  if (isParameter(declaration)) {
    const passed = context.paramArgs.get(declaration) ?? [];
    return declaration.initializer
      ? [declaration.initializer, ...passed]
      : passed;
  }
  if (
    isPropertyAssignment(declaration) ||
    isShorthandPropertyAssignment(declaration)
  ) {
    return valueOfElement(context, declaration);
  }
  if (isPropertySignature(declaration) || isMethodSignature(declaration)) {
    return implementingElements(context, declaration).flatMap((element) =>
      valueOfElement(context, element),
    );
  }
  return isBindingElement(declaration)
    ? boundSources(context, declaration)
    : [];
};

export const membersOf = (
  context: FlowContext,
  objects: Node[],
  name: string,
): Node[] => {
  const found: Node[] = [];
  const queue = [...new Set(objects)];
  const seen = new Set(queue);
  for (let position = 0; position < queue.length; position += 1) {
    const object = queue[position];
    if (!isObjectLiteralExpression(object)) {
      found.push(...(context.stores.elementStores.get(object) ?? []));
      continue;
    }
    for (const element of object.properties) {
      if (nameOf(element) === name) {
        found.push(...valueOfElement(context, element));
      }
      const spread = isSpreadAssignment(element)
        ? context.trace('objects', element.expression)
        : [];
      for (const next of spread.filter((source) => !seen.has(source))) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return found;
};
