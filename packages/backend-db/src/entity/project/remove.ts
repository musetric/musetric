import { type DatabaseSync } from 'node:sqlite';

export const remove = (database: DatabaseSync) => {
  const statement = database.prepare(`DELETE FROM Project WHERE id = ?`);

  return async (projectId: number): Promise<boolean> => {
    const result = await Promise.resolve(statement.run(projectId));
    return result.changes !== 0;
  };
};
