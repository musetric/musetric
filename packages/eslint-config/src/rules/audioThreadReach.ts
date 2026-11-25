import { relative, sep } from 'node:path';
import {
  type ClassDeclaration,
  type ClassExpression,
  forEachChild,
  isBinaryExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isFunctionDeclaration,
  isMethodDeclaration,
  isNewExpression,
  isPropertyAccessExpression,
  type Node,
  type Program,
  type SourceFile,
  type TypeChecker,
} from 'typescript';
import { describeAllocation } from './allocationKinds.js';
import {
  forEachInBody,
  forEachInTree,
  type FunctionNode,
  isFunctionNode,
  nameOf,
} from './functionNodes.js';
import {
  createValueFlow,
  getOwnSourceFiles,
  type ValueFlow,
} from './valueFlow.js';
import { append, type CallNode } from './valueStores.js';

const processorBase = 'AudioWorkletProcessor';
const directivePattern = /eslint-disable-(next-line|line)\s+(.*)/;

const toFileKey = (fileName: string): string =>
  fileName.replaceAll('\\', '/').toLowerCase();

const fileOf = (node: Node): string => toFileKey(node.getSourceFile().fileName);

const calleeName = (callee: Node): string =>
  isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();

const functionName = (fn: FunctionNode): string => {
  const { parent } = fn;
  if (isFunctionDeclaration(fn)) {
    return fn.name?.text ?? 'function';
  }
  if (isMethodDeclaration(fn)) {
    const owner =
      isClassDeclaration(parent) || isClassExpression(parent)
        ? `${parent.name?.text ?? 'class'}.`
        : '';
    return `${owner}${fn.name.getText()}`;
  }
  if (isBinaryExpression(parent)) {
    return calleeName(parent.left);
  }
  if (isCallExpression(parent)) {
    return `callback of ${calleeName(parent.expression)}`;
  }
  return nameOf(parent) ?? 'inner function';
};

const processorClassOf = (
  node: Node,
): ClassDeclaration | ClassExpression | undefined => {
  if (!isClassDeclaration(node) && !isClassExpression(node)) {
    return undefined;
  }
  const extendsProcessor = node.heritageClauses?.some((clause) =>
    clause.types.some((type) => type.getText() === processorBase),
  );
  return extendsProcessor ? node : undefined;
};

const findRoots = (sourceFiles: SourceFile[]): FunctionNode[] => {
  const roots: FunctionNode[] = [];
  const visit = (node: Node): void => {
    for (const member of processorClassOf(node)?.members ?? []) {
      if (
        isMethodDeclaration(member) &&
        isFunctionNode(member) &&
        member.name.getText() === 'process'
      ) {
        roots.push(member);
      }
    }
    forEachChild(node, visit);
  };
  for (const file of sourceFiles) {
    if (file.text.includes(processorBase)) {
      forEachChild(file, visit);
    }
  }
  return roots;
};

const directiveLines = (file: SourceFile, ruleId: string): Set<number> => {
  const lines = new Set<number>();
  file.text.split('\n').forEach((text, line) => {
    const match = directivePattern.exec(text);
    if (!match) {
      return;
    }
    const [names] = match[2].replace('*/', '').split(' --');
    if (names.split(',').some((name) => name.trim() === ruleId)) {
      lines.add(match[1] === 'line' ? line : line + 1);
    }
  });
  return lines;
};

const createCutCheck = (ruleId: string) => {
  const linesByFile = new Map<SourceFile, Set<number>>();
  return (call: CallNode): boolean => {
    const file = call.getSourceFile();
    const lines = linesByFile.get(file) ?? directiveLines(file, ruleId);
    linesByFile.set(file, lines);
    return lines.has(file.getLineAndCharacterOfPosition(call.getStart()).line);
  };
};

type Allocation = {
  node: Node;
  what: string;
};

type Scan = {
  allocations: Allocation[];
  calls: CallNode[];
  cuts: CallNode[];
};

type Scanner = {
  checker: TypeChecker;
  scanOf: (fn: FunctionNode) => Scan;
  scanInside: (call: CallNode) => Scan;
  targetsOf: (call: CallNode) => FunctionNode[];
};

const createScanner = (
  checker: TypeChecker,
  flow: ValueFlow,
  isCut: (call: CallNode) => boolean,
): Scanner => {
  const collect = (walk: (visit: (node: Node) => boolean) => void): Scan => {
    const scan: Scan = { allocations: [], calls: [], cuts: [] };
    walk((node) => {
      const call = isCallExpression(node) || isNewExpression(node);
      if (call && isCut(node)) {
        scan.cuts.push(node);
        return false;
      }
      if (call) {
        scan.calls.push(node);
      }
      const what = describeAllocation(checker, node);
      if (what !== undefined) {
        scan.allocations.push({ node, what });
      }
      return true;
    });
    return scan;
  };
  const scans = new Map<FunctionNode, Scan>();
  return {
    checker,
    scanOf: (fn) => {
      const scan =
        scans.get(fn) ??
        collect((visit) => {
          forEachInBody(fn, visit);
        });
      scans.set(fn, scan);
      return scan;
    },
    scanInside: (call) =>
      collect((visit) => {
        forEachInTree(call, visit);
      }),
    targetsOf: (call) => {
      const targets = flow.functionsOf(call.expression);
      return targets.length > 0
        ? targets
        : (call.arguments ?? []).flatMap(flow.functionsOf);
    },
  };
};

type Reached = Map<FunctionNode, FunctionNode | undefined>;

const reachFrom = (scanner: Scanner, roots: FunctionNode[]): Reached => {
  const reached: Reached = new Map(roots.map((root) => [root, undefined]));
  const queue = [...roots];
  for (let position = 0; position < queue.length; position += 1) {
    const fn = queue[position];
    for (const target of scanner.scanOf(fn).calls.flatMap(scanner.targetsOf)) {
      if (!reached.has(target)) {
        reached.set(target, fn);
        queue.push(target);
      }
    }
  }
  return reached;
};

const firstAllocation = (
  scanner: Scanner,
  found: Allocation[],
  starts: FunctionNode[],
  allow: (fn: FunctionNode) => boolean,
): Allocation | undefined => {
  const first = found.at(0);
  if (first) {
    return first;
  }
  const pending = [...new Set(starts.filter(allow))];
  const seen = new Set(pending);
  for (let position = 0; position < pending.length; position += 1) {
    const scan = scanner.scanOf(pending[position]);
    const allocation = scan.allocations.at(0);
    if (allocation) {
      return allocation;
    }
    for (const target of scan.calls.flatMap(scanner.targetsOf)) {
      if (!seen.has(target) && allow(target)) {
        seen.add(target);
        pending.push(target);
      }
    }
  }
  return undefined;
};

const allocationBehindCut = (
  scanner: Scanner,
  call: CallNode,
): Allocation | undefined => {
  const inside = scanner.scanInside(call);
  const own = describeAllocation(scanner.checker, call);
  const found =
    own === undefined
      ? inside.allocations
      : [{ node: call, what: own }, ...inside.allocations];
  const calls = [call, ...inside.calls, ...inside.cuts];
  return firstAllocation(
    scanner,
    found,
    calls.flatMap(scanner.targetsOf),
    () => true,
  );
};

const pathTo = (reached: Reached, fn: FunctionNode): string => {
  const names = [functionName(fn)];
  for (let from = reached.get(fn); from; from = reached.get(from)) {
    names.unshift(functionName(from));
  }
  return names.join(' > ');
};

const locate = (program: Program, node: Node): string => {
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  const path = relative(program.getCurrentDirectory(), file.fileName);
  return `${path.replaceAll(sep, '/')}:${line + 1}`;
};

export type Finding = {
  node: Node;
  kind: 'allocation' | 'closure' | 'call';
  what: string;
  where: string;
  path: string;
  owner: string;
};

const findingsOf = (
  program: Program,
  scanner: Scanner,
  reached: Reached,
  isOwn: (node: Node) => boolean,
): Map<string, Finding[]> => {
  const findings = new Map<string, Finding[]>();
  const add = (finding: Finding) => {
    append(findings, fileOf(finding.node), finding);
  };
  for (const fn of [...reached.keys()].filter(isOwn)) {
    const scan = scanner.scanOf(fn);
    const context = { path: pathTo(reached, fn), owner: functionName(fn) };
    for (const { node, what } of scan.allocations) {
      const kind = isFunctionNode(node) ? 'closure' : 'allocation';
      add({ node, kind, what, where: locate(program, node), ...context });
    }
    const behind = [
      ...scan.calls.map((call) => ({
        call,
        allocation: firstAllocation(
          scanner,
          [],
          scanner.targetsOf(call),
          (target) => !isOwn(target),
        ),
      })),
      ...scan.cuts.map((call) => ({
        call,
        allocation: allocationBehindCut(scanner, call),
      })),
    ];
    for (const { call, allocation } of behind) {
      if (allocation) {
        const where = locate(program, allocation.node);
        add({
          node: call,
          kind: 'call',
          what: allocation.what,
          where,
          ...context,
        });
      }
    }
  }
  return findings;
};

export type AudioThreadReach = {
  findingsIn: (fileName: string) => Finding[];
};

export const reachAudioThread = (
  program: Program,
  ruleId: string,
): AudioThreadReach | undefined => {
  const sourceFiles = getOwnSourceFiles(program);
  const roots = findRoots(sourceFiles);
  if (roots.length === 0) {
    return undefined;
  }
  const scanner = createScanner(
    program.getTypeChecker(),
    createValueFlow(program, sourceFiles),
    createCutCheck(ruleId),
  );
  const ownFiles = new Set(program.getRootFileNames().map(toFileKey));
  const findings = findingsOf(
    program,
    scanner,
    reachFrom(scanner, roots),
    (node) => ownFiles.has(fileOf(node)),
  );
  return {
    findingsIn: (fileName) => findings.get(toFileKey(fileName)) ?? [],
  };
};
