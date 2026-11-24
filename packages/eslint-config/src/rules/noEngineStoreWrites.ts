import { createRestrictedSyntaxRule } from './createRestrictedSyntaxRule.js';

export const noEngineStoreWritesRule = createRestrictedSyntaxRule(
  "Disallow writing the engine's store from outside the engine",
  [
    {
      selector:
        "CallExpression[callee.property.name='update'][callee.object.property.name='store'][callee.object.object.name='engine']",
      message:
        "Do not write the engine's store from outside the engine. A store write that doubles as a command leaves the order of messages to the order of subscriptions. Call a command of engine.player or engine.view instead, and add one to the engine where none fits.",
    },
  ],
);
