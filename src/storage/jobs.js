// 演算作业存取：每条作业独立落盘，互不串号。

const COLUMNS = `
  id, status, reach_name, k, x, dt, inflow, outflow, initial_outflow,
  c0, c1, c2, c_sum, inflow_peak_index, outflow_peak_index,
  inflow_volume, outflow_volume, volume_difference,
  closure_tolerance, coefficient_sum_tolerance, created_at
`;

export function createJobRepo(db) {
  const insertStmt = db.prepare(
    `INSERT INTO jobs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM jobs ORDER BY rowid');

  const toJob = (row) => ({
    id: row.id,
    status: row.status,
    reachName: row.reach_name,
    K: row.k,
    X: row.x,
    dt: row.dt,
    coefficients: { C0: row.c0, C1: row.c1, C2: row.c2, sum: row.c_sum },
    inflow: JSON.parse(row.inflow),
    outflow: JSON.parse(row.outflow),
    initialOutflow: row.initial_outflow,
    inflowPeakIndex: row.inflow_peak_index,
    outflowPeakIndex: row.outflow_peak_index,
    peakLagSteps: row.outflow_peak_index - row.inflow_peak_index,
    inflowVolume: row.inflow_volume,
    outflowVolume: row.outflow_volume,
    volumeDifference: row.volume_difference,
    closureTolerance: row.closure_tolerance,
    coefficientSumTolerance: row.coefficient_sum_tolerance,
    createdAt: row.created_at,
  });

  return {
    /** 整份结果落盘（better-sqlite3 同步写入，天然逐条串行） */
    insert(job) {
      insertStmt.run(
        job.id,
        job.status,
        job.reachName,
        job.K,
        job.X,
        job.dt,
        JSON.stringify(job.inflow),
        JSON.stringify(job.outflow),
        job.initialOutflow,
        job.coefficients.C0,
        job.coefficients.C1,
        job.coefficients.C2,
        job.coefficients.sum,
        job.inflowPeakIndex,
        job.outflowPeakIndex,
        job.inflowVolume,
        job.outflowVolume,
        job.volumeDifference,
        job.closureTolerance,
        job.coefficientSumTolerance,
        job.createdAt,
      );
      return job;
    },

    getById(id) {
      const row = byIdStmt.get(id);
      return row ? toJob(row) : null;
    },

    /** 摘要列表（不含完整过程线） */
    list() {
      return listStmt.all().map((row) => ({
        id: row.id,
        status: row.status,
        reachName: row.reach_name,
        K: row.k,
        X: row.x,
        dt: row.dt,
        inflowPeakIndex: row.inflow_peak_index,
        outflowPeakIndex: row.outflow_peak_index,
        peakLagSteps: row.outflow_peak_index - row.inflow_peak_index,
        createdAt: row.created_at,
      }));
    },
  };
}
