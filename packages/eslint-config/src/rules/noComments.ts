import { type Rule } from 'eslint';

const directiveComment =
  /^(eslint-|global\s|globals\s|exported\s|@ts-(expect-error|ignore|nocheck|check)|\/\s*<reference)/;

const referenceComment = /^@(see|todo|fixme)(\s|$)/;

const isAllowedComment = (value: string): boolean =>
  directiveComment.test(value) || referenceComment.test(value);

export const noCommentsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow comments',
    },
    schema: [],
  },
  create: (context) => ({
    Program: () => {
      const comments = context.sourceCode.getAllComments();
      for (const comment of comments) {
        if (isAllowedComment(comment.value.trim())) {
          continue;
        }
        if (!comment.loc) {
          continue;
        }
        context.report({
          loc: comment.loc,
          message: 'Do not use comments',
        });
      }
    },
  }),
};
