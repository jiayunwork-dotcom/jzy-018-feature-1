// 河段档存取：具名档里钉死 K 和 X。

import { AppError } from '../errors.js';

export function createReachRepo(db) {
  const insertStmt = db.prepare('INSERT INTO reaches (name, k, x, created_at) VALUES (?, ?, ?, ?)');
  const byNameStmt = db.prepare('SELECT name, k, x, created_at FROM reaches WHERE name = ?');
  const listStmt = db.prepare('SELECT name, k, x, created_at FROM reaches ORDER BY name');

  const toReach = (row) => ({ name: row.name, K: row.k, X: row.x, createdAt: row.created_at });

  return {
    /** 登记具名档；重名抛 REACH_EXISTS */
    add(name, K, X) {
      try {
        insertStmt.run(name, K, X, new Date().toISOString());
      } catch (err) {
        if (String(err.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
          throw new AppError('REACH_EXISTS', `河段档「${name}」已登记，不能重复占用该名字`, 409, { field: 'name' });
        }
        throw err;
      }
      return { name, K, X };
    },

    /** 精确点名；不存在返回 null（绝不自行找相近档顶上） */
    get(name) {
      const row = byNameStmt.get(name);
      return row ? toReach(row) : null;
    },

    list() {
      return listStmt.all().map(toReach);
    },
  };
}
