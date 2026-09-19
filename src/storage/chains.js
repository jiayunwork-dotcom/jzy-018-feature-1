// 河链记录存取：串联演算记录单独成表，绝不混进现有单段作业表。
//
// 河链记录整体（各段过程线、系数、峰现、洪量、对账）作为 JSON 落盘，
// 另取少量列方便检索与摘要。河链编号与单段作业编号互不通用：
// GET /jobs/:id 查的是 jobs 表，查不到 chains 表里的河链。

export function createChainRepo(db) {
  const insertStmt = db.prepare(
    'INSERT INTO chains (id, status, segment_count, record, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byIdStmt = db.prepare('SELECT record FROM chains WHERE id = ?');
  const listStmt = db.prepare(
    'SELECT id, status, segment_count, created_at FROM chains ORDER BY rowid',
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM chains');

  return {
    /** 整份河链记录落盘（better-sqlite3 同步写入，天然逐条串行） */
    insert(chain) {
      insertStmt.run(
        chain.id,
        chain.status,
        chain.segments.length,
        JSON.stringify(chain),
        chain.createdAt,
      );
      return chain;
    },

    getById(id) {
      const row = byIdStmt.get(id);
      return row ? JSON.parse(row.record) : null;
    },

    /** 摘要列表（不含完整过程线），与单段作业列表各自独立 */
    list() {
      return listStmt.all().map((row) => ({
        id: row.id,
        kind: 'chain',
        status: row.status,
        segmentCount: row.segment_count,
        createdAt: row.created_at,
      }));
    },

    count() {
      return countStmt.get().n;
    },
  };
}
