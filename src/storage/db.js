// 进程内 SQLite：不起独立数据库容器。

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS reaches (
      name       TEXT PRIMARY KEY,
      k          REAL NOT NULL CHECK (k > 0),
      x          REAL NOT NULL CHECK (x >= 0 AND x <= 0.5),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id                       TEXT PRIMARY KEY,
      status                   TEXT NOT NULL,
      reach_name               TEXT,
      k                        REAL NOT NULL,
      x                        REAL NOT NULL,
      dt                       REAL NOT NULL,
      inflow                   TEXT NOT NULL,
      outflow                  TEXT NOT NULL,
      initial_outflow          REAL NOT NULL,
      c0                       REAL NOT NULL,
      c1                       REAL NOT NULL,
      c2                       REAL NOT NULL,
      c_sum                    REAL NOT NULL,
      inflow_peak_index        INTEGER NOT NULL,
      outflow_peak_index       INTEGER NOT NULL,
      inflow_volume            REAL NOT NULL,
      outflow_volume           REAL NOT NULL,
      volume_difference        REAL NOT NULL,
      closure_tolerance        REAL NOT NULL,
      coefficient_sum_tolerance REAL NOT NULL,
      created_at               TEXT NOT NULL
    );
  `);
  return db;
}
