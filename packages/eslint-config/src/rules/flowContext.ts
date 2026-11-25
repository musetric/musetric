import {
  isBlock,
  isReturnStatement,
  type Node,
  type ObjectLiteralElementLike,
  type ParameterDeclaration,
  type TypeChecker,
} from 'typescript';
import {
  forEachInBody,
  type FunctionNode,
  isFunctionNode,
} from './functionNodes.js';
import { type ValueStores } from './valueStores.js';

export type Memo = {
  current: Map<Node, Node[]>;
  previous: Map<Node, Node[]>;
  active: Set<Node>;
};

export const createMemo = (): Memo => ({
  current: new Map(),
  previous: new Map(),
  active: new Set(),
});

export const remember = (
  memo: Memo,
  node: Node,
  compute: () => Node[],
): Node[] => {
  const known = memo.current.get(node);
  if (known) {
    return known;
  }
  if (memo.active.has(node)) {
    return memo.previous.get(node) ?? [];
  }
  memo.active.add(node);
  const result = [...new Set(compute())];
  memo.active.delete(node);
  memo.current.set(node, result);
  return result;
};

export type FlowKind = 'functions' | 'objects' | 'elements' | 'sources';

export type FlowContext = {
  checker: TypeChecker;
  stores: ValueStores;
  paramArgs: Map<ParameterDeclaration, Node[]>;
  implementations: Map<Node, ObjectLiteralElementLike[]>;
  returns: Map<FunctionNode, Node[]>;
  trace: (kind: FlowKind, node: Node) => Node[];
};

export const functionsBehind = (
  context: FlowContext,
  node: Node,
): FunctionNode[] => context.trace('functions', node).filter(isFunctionNode);

export const returnsOf = (context: FlowContext, fn: FunctionNode): Node[] => {
  const known = context.returns.get(fn);
  if (known) {
    return known;
  }
  const found: Node[] = [];
  if (fn.body && !isBlock(fn.body)) {
    found.push(fn.body);
  } else {
    forEachInBody(fn, (node) => {
      if (isReturnStatement(node) && node.expression) {
        found.push(node.expression);
      }
      return true;
    });
  }
  context.returns.set(fn, found);
  return found;
};
