import { type Rule } from 'eslint';
import {
  type ArrowFunctionExpression,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Pattern,
} from 'estree';

type WrapperFunction =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression;

const getReturnExpression = (
  body: WrapperFunction['body'],
): Expression | undefined => {
  if (body.type !== 'BlockStatement') {
    return body;
  }
  if (body.body.length !== 1) {
    return undefined;
  }
  const [statement] = body.body;
  if (statement.type !== 'ReturnStatement' || !statement.argument) {
    return undefined;
  }
  return statement.argument;
};

const forwardsParametersUnchanged = (
  parameters: Pattern[],
  args: CallExpression['arguments'],
): boolean => {
  if (parameters.length < 1 || parameters.length !== args.length) {
    return false;
  }
  return parameters.every((parameter, index) => {
    const argument = args[index];
    return (
      parameter.type === 'Identifier' &&
      argument.type === 'Identifier' &&
      argument.name === parameter.name
    );
  });
};

export const noTrivialFunctionWrappersRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow trivial function wrappers that only forward their parameters to another call',
    },
    messages: {
      trivialWrapper:
        'Do not create trivial function wrappers; call the target directly instead of forwarding the same parameters unchanged.',
    },
    schema: [],
  },
  create: (context) => {
    const reportTrivialWrapper = (node: WrapperFunction): void => {
      const returnExpression = getReturnExpression(node.body);
      if (
        !returnExpression ||
        returnExpression.type !== 'CallExpression' ||
        !forwardsParametersUnchanged(node.params, returnExpression.arguments)
      ) {
        return;
      }
      context.report({ node, messageId: 'trivialWrapper' });
    };

    return {
      ArrowFunctionExpression: reportTrivialWrapper,
      FunctionDeclaration: reportTrivialWrapper,
      FunctionExpression: reportTrivialWrapper,
    };
  },
};
