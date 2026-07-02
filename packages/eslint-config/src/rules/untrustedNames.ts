import { type Node } from 'estree';

export const rawNamePattern = /^raw(?:$|[A-Z])/;

export const getCheckedValueName = (node: Node): string | undefined => {
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier'
  ) {
    return node.property.name;
  }
  return undefined;
};

export const isTestFile = (filename: string): boolean =>
  filename.split(/[\\/]/).includes('__test__');
