import { type Rule } from 'eslint';
import { type Program } from 'typescript';
import { type AudioThreadReach, reachAudioThread } from './audioThreadReach.js';

const reaches = new WeakMap<Program, AudioThreadReach | undefined>();

const getReach = (
  program: Program,
  ruleId: string,
): AudioThreadReach | undefined => {
  if (!reaches.has(program)) {
    reaches.set(program, reachAudioThread(program, ruleId));
  }
  return reaches.get(program);
};

const capitalize = (text: string): string =>
  /^(?:a|an|array) /.test(text)
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    : text;

const remedy =
  'Make it once at setup and reuse it. When this line runs once per event, such as a message, rather than on every quantum, disable this rule on it and say why; the rule does not follow a disabled call further.';

export const noAudioThreadAllocationsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow allocations in the code that process() of an AudioWorkletProcessor runs on every quantum',
    },
    messages: {
      allocation: `{{what}} allocates on the audio thread: {{path}} runs this code on every quantum it reaches. ${remedy}`,
      closure: `A closure is made here on every call of {{owner}}, and the variables it captures make {{owner}} allocate their context on every call, even when this line does not run: {{path}} runs {{owner}} on every quantum it reaches. ${remedy}`,
      call: `This call allocates on the audio thread through {{what}} at {{where}}: {{path}} runs it on every quantum it reaches. ${remedy}`,
    },
    schema: [],
  },
  create: (context) => {
    const program: Program | undefined =
      context.sourceCode.parserServices?.program;
    if (!program) {
      return {};
    }
    const { sourceCode } = context;
    return {
      'Program:exit': () => {
        const reach = getReach(program, context.id);
        for (const finding of reach?.findingsIn(context.filename) ?? []) {
          const { node, kind, what, where, path, owner } = finding;
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(node.getStart()),
              end: sourceCode.getLocFromIndex(node.getEnd()),
            },
            messageId: kind,
            data: {
              what: kind === 'allocation' ? capitalize(what) : what,
              where,
              path,
              owner,
            },
          });
        }
      },
    };
  },
};
