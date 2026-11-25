import {
  type CallExpression,
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isElementAccessExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isSpreadElement,
  type Node,
  type ParameterDeclaration,
  type Program,
  type SourceFile,
  SyntaxKind,
} from 'typescript';
import {
  createMemo,
  type FlowContext,
  type FlowKind,
  functionsBehind,
  type Memo,
  remember,
  returnsOf,
} from './flowContext.js';
import {
  type FunctionNode,
  isFunctionNode,
  skipOuter,
} from './functionNodes.js';
import { membersOf, ownSourcesOf } from './valueSources.js';
import { append, type CallNode, indexValueStores } from './valueStores.js';

const choiceOperators = new Set([
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.CommaToken,
]);
const keptElementMethods = new Set(['filter', 'slice', 'concat', 'toSorted']);
const nodeModulesPattern = /[\\/]node_modules[\\/]/;
const passLimit = 12;

export const getOwnSourceFiles = (program: Program): SourceFile[] =>
  program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile && !nodeModulesPattern.test(file.fileName),
    );

const elementsOfCall = (context: FlowContext, call: CallExpression): Node[] => {
  const { expression: callee } = call;
  const first = call.arguments.at(0);
  if (isPropertyAccessExpression(callee) && callee.name.text === 'map') {
    return first
      ? functionsBehind(context, first).flatMap((fn) => returnsOf(context, fn))
      : [];
  }
  if (
    isPropertyAccessExpression(callee) &&
    keptElementMethods.has(callee.name.text)
  ) {
    return context.trace('elements', callee.expression);
  }
  return functionsBehind(context, callee)
    .flatMap((fn) => returnsOf(context, fn))
    .flatMap((value) => context.trace('elements', value));
};

const traceElements = (context: FlowContext, node: Node): Node[] => {
  const expression = skipOuter(node);
  if (isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      isSpreadElement(element)
        ? context.trace('elements', element.expression)
        : [element],
    );
  }
  if (isCallExpression(expression)) {
    return elementsOfCall(context, expression);
  }
  if (!isIdentifier(expression) && !isPropertyAccessExpression(expression)) {
    return [];
  }
  return context.stores
    .declarationsAt(expression)
    .flatMap((declaration) => [
      ...(context.stores.elementStores.get(declaration) ?? []),
      ...context
        .trace('sources', declaration)
        .flatMap((source) => context.trace('elements', source)),
    ]);
};

const followReference = (
  context: FlowContext,
  kind: FlowKind,
  expression: Node,
): Node[] => {
  const found: Node[] = [];
  const follow = (node: Node) => context.trace(kind, node);
  if (isIdentifier(expression) || isPropertyAccessExpression(expression)) {
    for (const declaration of context.stores.declarationsAt(expression)) {
      if (kind === 'objects') {
        found.push(declaration);
      }
      found.push(...context.trace('sources', declaration).flatMap(follow));
    }
  }
  if (isPropertyAccessExpression(expression)) {
    const objects = context.trace('objects', expression.expression);
    const members = membersOf(context, objects, expression.name.text);
    found.push(...members.flatMap(follow));
  }
  if (isElementAccessExpression(expression)) {
    const elements = context.trace('elements', expression.expression);
    found.push(...elements.flatMap(follow));
  }
  return found;
};

const followChoice = (
  context: FlowContext,
  kind: FlowKind,
  expression: Node,
): Node[] | undefined => {
  const follow = (node: Node) => context.trace(kind, node);
  if (isConditionalExpression(expression)) {
    return [...follow(expression.whenTrue), ...follow(expression.whenFalse)];
  }
  if (
    isBinaryExpression(expression) &&
    choiceOperators.has(expression.operatorToken.kind)
  ) {
    const { kind: operator } = expression.operatorToken;
    const keepsLeft =
      operator === SyntaxKind.QuestionQuestionToken ||
      operator === SyntaxKind.BarBarToken;
    return keepsLeft
      ? [...follow(expression.left), ...follow(expression.right)]
      : follow(expression.right);
  }
  if (isCallExpression(expression)) {
    return functionsBehind(context, expression.expression)
      .flatMap((fn) => returnsOf(context, fn))
      .flatMap(follow);
  }
  return undefined;
};

const traceNode = (
  context: FlowContext,
  kind: FlowKind,
  node: Node,
): Node[] => {
  if (kind === 'sources') {
    const stored = context.stores.setStores.get(node) ?? [];
    return [...ownSourcesOf(context, node), ...stored];
  }
  if (kind === 'elements') {
    return traceElements(context, node);
  }
  const expression = skipOuter(node);
  const own =
    kind === 'objects'
      ? isObjectLiteralExpression(expression)
      : isFunctionNode(expression);
  if (own) {
    return [expression];
  }
  return (
    followChoice(context, kind, expression) ??
    followReference(context, kind, expression)
  );
};

const passArguments = (
  context: FlowContext,
  call: CallNode,
  next: Map<ParameterDeclaration, Node[]>,
) => {
  const targets = functionsBehind(context, call.expression);
  const args = call.arguments ?? [];
  if (targets.length === 0) {
    for (const argument of args) {
      functionsBehind(context, argument);
    }
    return;
  }
  for (const target of targets) {
    target.parameters.forEach((parameter, position) => {
      const argument = args.at(position);
      if (argument && !isSpreadElement(argument)) {
        append(next, parameter, argument);
      }
    });
  }
};

const countValues = (map: Map<unknown, Node[]>): number =>
  [...map.values()].reduce((sum, list) => sum + list.length, 0);

export type ValueFlow = {
  functionsOf: (node: Node) => FunctionNode[];
};

export const createValueFlow = (
  program: Program,
  sourceFiles: SourceFile[],
): ValueFlow => {
  const checker = program.getTypeChecker();
  const memos: Record<FlowKind, Memo> = {
    functions: createMemo(),
    objects: createMemo(),
    elements: createMemo(),
    sources: createMemo(),
  };
  const context: FlowContext = {
    checker,
    stores: indexValueStores(checker, sourceFiles),
    paramArgs: new Map(),
    implementations: new Map(),
    returns: new Map(),
    trace: (kind, node) =>
      remember(memos[kind], node, () => traceNode(context, kind, node)),
  };
  const measure = () =>
    Object.values(memos).reduce(
      (total, memo) => total + countValues(memo.current),
      countValues(context.paramArgs),
    );

  let size = -1;
  for (let pass = 0; pass < passLimit && size !== measure(); pass += 1) {
    size = measure();
    for (const memo of Object.values(memos)) {
      memo.previous = memo.current;
      memo.current = new Map();
    }
    const next = new Map<ParameterDeclaration, Node[]>();
    for (const call of context.stores.calls) {
      passArguments(context, call, next);
    }
    context.paramArgs = next;
  }

  return {
    functionsOf: (node) => functionsBehind(context, node),
  };
};
