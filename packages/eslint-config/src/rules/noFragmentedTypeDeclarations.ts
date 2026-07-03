/* eslint-disable musetric/no-fragmented-type-declarations --
   This file is the implementation of the rule; helper type declarations are
   tightly coupled and ordering each one strictly adjacent to a single consumer
   would require a separate file per type. */
import { type Rule } from 'eslint';

type Range = [number, number];

type AstNode = {
  type: string;
  range?: Range;
  typeName?: AstNode;
  id?: AstNode;
  body?: AstNode[] | AstNode;
  declaration?: AstNode;
  name?: unknown;
  expression?: AstNode;
  qualifier?: AstNode;
  [key: string]: unknown;
};

type SourceCode = Rule.RuleContext['sourceCode'];

const isObjectWithType = (value: unknown): value is { type: unknown } => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return 'type' in value;
};

const isAstNode = (value: unknown): value is AstNode =>
  isObjectWithType(value) && typeof value.type === 'string';

const isIdentifier = (node: AstNode): boolean => {
  if (node.type !== 'Identifier') {
    return false;
  }
  return typeof node.name === 'string';
};

const isTSTypeReference = (node: AstNode): boolean => {
  if (node.type !== 'TSTypeReference') {
    return false;
  }
  if (node.typeName === undefined) {
    return false;
  }
  return isIdentifier(node.typeName);
};

const unwrapExport = (node: AstNode): AstNode => {
  if (
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportDefaultDeclaration'
  ) {
    const inner = node.declaration;
    if (isAstNode(inner)) {
      return unwrapExport(inner);
    }
  }
  return node;
};

const isLocalTypeDeclaration = (node: AstNode): boolean => {
  const inner = unwrapExport(node);
  if (
    inner.type !== 'TSTypeAliasDeclaration' &&
    inner.type !== 'TSInterfaceDeclaration'
  ) {
    return false;
  }
  if (inner.id === undefined) {
    return false;
  }
  return isIdentifier(inner.id);
};

type ReferenceParentType =
  | 'TSTypeReference'
  | 'TSInterfaceHeritage'
  | 'TSClassImplements'
  | 'TSImportType';

const isReferenceParentType = (type: string): type is ReferenceParentType =>
  type === 'TSTypeReference' ||
  type === 'TSInterfaceHeritage' ||
  type === 'TSClassImplements' ||
  type === 'TSImportType';

type WalkerHelpers = { sourceCode: SourceCode };

type NodeVisitor = (node: AstNode, parent: AstNode | undefined) => boolean;

const isIdentifierInTypeReference = (
  child: AstNode,
  parent: AstNode | undefined,
  typeName: string,
): boolean => {
  if (parent === undefined) {
    return false;
  }
  if (!isReferenceParentType(parent.type)) {
    return false;
  }
  const matchesChild =
    parent.typeName === child ||
    parent.expression === child ||
    parent.qualifier === child;
  if (!matchesChild) {
    return false;
  }
  return isIdentifier(child) && child.name === typeName;
};

const getChildKeys = (
  sourceCode: SourceCode,
  type: string,
): readonly string[] => {
  const keys = sourceCode.visitorKeys[type];
  return Array.isArray(keys) ? keys : [];
};

/* eslint-disable max-depth --
   The walker recursively descends through the AST; extracting the inner loops
   would split the algorithm across mutually recursive helpers with no readability
   gain. The four-level depth is the natural shape of a recursive walk. */
const walk = (
  helpers: WalkerHelpers,
  root: unknown,
  visitor: NodeVisitor,
  parent: AstNode | undefined,
): boolean => {
  if (!isAstNode(root)) {
    return false;
  }
  if (visitor(root, parent)) {
    return true;
  }
  const keys = getChildKeys(helpers.sourceCode, root.type);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (walk(helpers, item, visitor, root)) {
          return true;
        }
      }
      continue;
    }
    if (walk(helpers, value, visitor, root)) {
      return true;
    }
  }
  return false;
};

const referencesTypeName = (
  helpers: WalkerHelpers,
  root: unknown,
  typeName: string,
): boolean => {
  let found = false;
  walk(
    helpers,
    root,
    (node, parent) => {
      if (isTSTypeReference(node)) {
        const tn = node.typeName;
        if (tn === undefined) {
          return false;
        }
        if (isIdentifier(tn) && tn.name === typeName) {
          found = true;
          return true;
        }
        return false;
      }
      if (isIdentifierInTypeReference(node, parent, typeName)) {
        found = true;
        return true;
      }
      return false;
    },
    undefined,
  );
  return found;
};

type TypeDeclarationEntry = {
  declaration: AstNode;
  containerIndex: number;
};

const collectLocalTypes = (program: AstNode): TypeDeclarationEntry[] => {
  if (!Array.isArray(program.body)) {
    return [];
  }
  const result: TypeDeclarationEntry[] = [];
  for (let index = 0; index < program.body.length; index += 1) {
    const node = program.body[index];
    if (isLocalTypeDeclaration(node)) {
      result.push({ declaration: node, containerIndex: index });
    }
  }
  return result;
};

type ConsumerSearch = { sourceCode: SourceCode; program: AstNode };

const findFirstConsumerIndex = (
  args: ConsumerSearch,
  typeIndex: number,
  typeName: string,
): number => {
  const { program } = args;
  if (!Array.isArray(program.body)) {
    return -1;
  }
  for (let i = typeIndex + 1; i < program.body.length; i += 1) {
    if (referencesTypeName(args, program.body[i], typeName)) {
      return i;
    }
  }
  return -1;
};

const hasInterveningUnrelatedStatement = (
  args: ConsumerSearch,
  typeIndex: number,
  consumerIndex: number,
  typeName: string,
): boolean => {
  const { program } = args;
  if (!Array.isArray(program.body)) {
    return false;
  }
  for (let i = typeIndex + 1; i < consumerIndex; i += 1) {
    const candidate = unwrapExport(program.body[i]);
    if (referencesTypeName(args, candidate, typeName)) {
      continue;
    }
    if (isLocalTypeDeclaration(candidate)) {
      continue;
    }
    return true;
  }
  return false;
};

const findLineStart = (text: string, position: number): number => {
  let cursor = position;
  while (cursor > 0 && text[cursor - 1] !== '\n') {
    cursor -= 1;
  }
  return cursor;
};

const findLineEnd = (text: string, position: number, max: number): number => {
  let cursor = position;
  while (cursor < max && text[cursor] !== '\n') {
    cursor += 1;
  }
  return cursor;
};

const skipTrailingWhitespace = (
  text: string,
  start: number,
  max: number,
): number => {
  let cursor = start;
  while (
    cursor < max &&
    (text[cursor] === '\n' || text[cursor] === ' ' || text[cursor] === '\t')
  ) {
    cursor += 1;
  }
  return cursor;
};

export const noFragmentedTypeDeclarationsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Disallow type declarations that are separated from their consumers by unrelated top-level statements',
    },
    messages: {
      fragmentedType:
        'Move this type declaration to sit immediately before its first in-file consumer; do not let unrelated top-level statements separate them.',
    },
    schema: [],
  },
  create: (context) => {
    const { sourceCode } = context;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const programAst = sourceCode.ast as unknown as AstNode;
    if (!isAstNode(programAst)) {
      return {};
    }
    const typesToCheck = collectLocalTypes(programAst);
    if (typesToCheck.length === 0) {
      return {};
    }
    const searchArgs: ConsumerSearch = { sourceCode, program: programAst };
    const topLevelNodes = Array.isArray(programAst.body) ? programAst.body : [];

    return {
      'Program:exit': () => {
        for (const entry of typesToCheck) {
          const declaration = unwrapExport(entry.declaration);
          if (declaration.id === undefined) {
            continue;
          }
          if (!isIdentifier(declaration.id)) {
            continue;
          }
          const typeName = declaration.id.name;
          if (typeof typeName !== 'string') {
            continue;
          }
          const typeIndex = entry.containerIndex;
          if (typeIndex < 0) {
            continue;
          }
          const consumerIndex = findFirstConsumerIndex(
            searchArgs,
            typeIndex,
            typeName,
          );
          if (consumerIndex < 0) {
            continue;
          }
          if (
            !hasInterveningUnrelatedStatement(
              searchArgs,
              typeIndex,
              consumerIndex,
              typeName,
            )
          ) {
            continue;
          }

          const declarationRange = entry.declaration.range;
          const consumerRange = topLevelNodes[consumerIndex].range;
          if (!declarationRange || !consumerRange) {
            continue;
          }

          context.report({
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            node: declaration as unknown as Rule.Node,
            messageId: 'fragmentedType',
            fix: (fixer) => {
              const { text } = sourceCode;
              const removeStart = findLineStart(text, declarationRange[0]);
              const lineEnd = findLineEnd(
                text,
                declarationRange[1],
                text.length,
              );
              const removeEnd = skipTrailingWhitespace(
                text,
                lineEnd,
                text.length,
              );
              if (removeEnd <= removeStart) {
                // eslint-disable-next-line musetric/no-null-literal
                return null;
              }
              const movedText = text.slice(
                declarationRange[0],
                declarationRange[1],
              );

              return [
                fixer.removeRange([removeStart, removeEnd]),
                fixer.insertTextBeforeRange(consumerRange, `${movedText}\n\n`),
              ];
            },
          });
        }
      },
    };
  },
};
