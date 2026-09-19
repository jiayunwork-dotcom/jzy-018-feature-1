// 河链串联记录存取：与单段作业分表，互不混列、互不串号。

const COLUMNS = `
  id, status, dt, inflow, initial_outflow, segments, outlet,
  inflow_peak_index, outlet_peak_index, peak_lag_steps,
  inflow_volume, lateral_volumes, outlet_volume, volume_difference,
  closure_tolerance, created_at
`;

export function createChainRepo(db) {
  const insertStmt = db.prepare(
    `INSERT INTO chains (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM chains WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM chains ORDER BY rowid');

  const toChain = (row) => ({
    id: row.id,
    status: row.status,
    dt: row.dt,
    inflow: JSON.parse(row.inflow),
    initialOutflow: row.initial_outflow,
    segments: JSON.parse(row.segments),
    outlet: JSON.parse(row.outlet),
    inflowPeakIndex: row.inflow_peak_index,
    outletPeakIndex: row.outlet_peak_index,
    peakLagSteps: row.peak_lag_steps,
    inflowVolume: row.inflow_volume,
    lateralVolumes: JSON.parse(row.lateral_volumes),
    outletVolume: row.outlet_volume,
    volumeDifference: row.volume_difference,
    closureTolerance: row.closure_tolerance,
    createdAt: row.created_at,
  });

  return {
    /** 整份河链记录落盘（better-sqlite3 同步写入，天然逐条串行） */
    insert(chain) {
      insertStmt.run(
        chain.id,
        chain.status,
        chain.dt,
        JSON.stringify(chain.inflow),
        chain.initialOutflow,
        JSON.stringify(chain.segments),
        JSON.stringify(chain.outlet),
        chain.inflowPeakIndex,
        chain.outletPeakIndex,
        chain.peakLagSteps,
        chain.inflowVolume,
        JSON.stringify(chain.lateralVolumes),
        chain.outletVolume,
        chain.volumeDifference,
        chain.closureTolerance,
        chain.createdAt,
      );
      return chain;
    },

    getById(id) {
      const row = byIdStmt.get(id);
      return row ? toChain(row) : null;
    },

    /** 摘要列表（不含完整过程线与各段明细） */
    list() {
      return listStmt.all().map((row) => ({
        id: row.id,
        status: row.status,
        dt: row.dt,
        segmentCount: JSON.parse(row.segments).length,
        inflowPeakIndex: row.inflow_peak_index,
        outletPeakIndex: row.outlet_peak_index,
        peakLagSteps: row.peak_lag_steps,
        createdAt: row.created_at,
      }));
    },
  };
}
