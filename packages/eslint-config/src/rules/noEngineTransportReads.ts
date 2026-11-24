import { type Rule } from 'eslint';
import { type Expression, type ObjectPattern, type Super } from 'estree';
import { type Node, type Program, type Type } from 'typescript';

const stateTypeName = 'EngineState';
const transportFields = new Set(['session', 'take', 'motion']);
const packagePattern = /[\\/]packages[\\/]([^\\/]+)[\\/]/;

const getPackageName = (fileName: string): string | undefined =>
  packagePattern.exec(fileName)?.[1];

type ReadNode = Expression | Super | ObjectPattern;

type TsParserServices = {
  program?: Program;
  esTreeNodeToTSNodeMap?: {
    get: (node: ReadNode) => Node | undefined;
  };
};

export const noEngineTransportReadsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow reading the fields of the engine's transport from outside the engine",
    },
    messages: {
      transportRead:
        "Do not read '{{name}}' of the engine's state outside the engine. The session machine owns the transport's states and may change them; read the transport through isPlaying, isRecording, isTransportBusy and isBuffering of @musetric/engine, and add a reading there where none fits.",
    },
    schema: [],
  },
  create: (context) => {
    const services: TsParserServices | undefined =
      context.sourceCode.parserServices;
    const program = services?.program;
    const nodeMap = services?.esTreeNodeToTSNodeMap;
    if (!program || !nodeMap) {
      return {};
    }
    const checker = program.getTypeChecker();
    const ownPackage = getPackageName(context.filename);

    const isForeignEngineState = (node: ReadNode): boolean => {
      const tsNode = nodeMap.get(node);
      if (!tsNode) {
        return false;
      }
      const type: Type = checker.getNonNullableType(
        checker.getTypeAtLocation(tsNode),
      );
      const alias = type.aliasSymbol;
      if (alias?.name !== stateTypeName) {
        return false;
      }
      return (alias.declarations ?? []).some(
        (declaration) =>
          getPackageName(declaration.getSourceFile().fileName) !== ownPackage,
      );
    };

    const report = (node: Rule.Node, name: string): void => {
      context.report({ node, messageId: 'transportRead', data: { name } });
    };

    return {
      MemberExpression: (node) => {
        if (
          node.computed ||
          node.property.type !== 'Identifier' ||
          !transportFields.has(node.property.name) ||
          !isForeignEngineState(node.object)
        ) {
          return;
        }
        report(node, node.property.name);
      },
      ObjectPattern: (node) => {
        const names = node.properties.flatMap((property) =>
          property.type === 'Property' &&
          !property.computed &&
          property.key.type === 'Identifier' &&
          transportFields.has(property.key.name)
            ? [property.key.name]
            : [],
        );
        if (names.length === 0 || !isForeignEngineState(node)) {
          return;
        }
        for (const name of names) {
          report(node, name);
        }
      },
    };
  },
};
