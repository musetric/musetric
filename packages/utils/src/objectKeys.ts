export const createObjectKeys =
  <ObjectType>() =>
  <const KeyList extends readonly (keyof ObjectType)[]>(
    keys: Exclude<keyof ObjectType, KeyList[number]> extends never
      ? KeyList
      : never,
  ) =>
    keys;
