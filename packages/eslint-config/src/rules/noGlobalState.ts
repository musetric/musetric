import { type Rule, type Scope } from 'eslint';

const ownership =
  'State is owned by whoever drives the work: it lives in that caller own variables and closure, and everything below receives what it needs as arguments and stays as pure as it reasonably can.';

const globalAliases = new Set(['globalThis', 'window', 'self', 'global']);

const isGlobalName = (scope: Scope.Scope, name: string): boolean => {
  let current: Scope.Scope | null = scope;
  while (current) {
    const variable = current.set.get(name);
    if (variable) {
      return variable.defs.length === 0;
    }
    current = current.upper;
  }
  return true;
};

const isPropertyName = (node: Rule.Node): boolean => {
  const { parent } = node;
  if (!parent) {
    return false;
  }
  if (parent.type === 'MemberExpression') {
    return parent.property === node && !parent.computed;
  }
  if (parent.type === 'Property') {
    return parent.key === node && !parent.computed;
  }
  return false;
};

export const noGlobalStateRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the global object as a place to keep, register or look up state',
    },
    messages: {
      globalThis: `Do not use globalThis. ${ownership} Stashing a value on the global object, or reaching into it for something this function was never given, turns the module into a service locator and hides the wiring from the caller. Pass the value down instead. When an identifier is genuinely provided by the platform or by the native host, declare that identifier in the file that reads it, read it once at the entry point that composes the app, and hand it to the code below.`,
      globalWrite: `Do not write onto the global object. ${ownership} A handler or a value parked under a global name is the same global state wearing another alias, so give it to the code that needs it instead of publishing it for anyone to find.`,
    },
    schema: [],
  },
  create: (context) => ({
    Identifier: (node) => {
      if (node.name !== 'globalThis' || isPropertyName(node)) {
        return;
      }
      if (!isGlobalName(context.sourceCode.getScope(node), node.name)) {
        return;
      }
      context.report({ node, messageId: 'globalThis' });
    },
    AssignmentExpression: (node) => {
      const target = node.left;
      if (target.type !== 'MemberExpression') {
        return;
      }
      const { object } = target;
      if (object.type !== 'Identifier' || !globalAliases.has(object.name)) {
        return;
      }
      if (!isGlobalName(context.sourceCode.getScope(node), object.name)) {
        return;
      }
      context.report({ node, messageId: 'globalWrite' });
    },
  }),
};
