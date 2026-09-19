// 内置三角入流示范作业：启动时播种一次，出流峰更矮更晚，且洪量闭合。

import { DEMO_JOB_ID } from './config.js';
import { executeRouting } from './jobService.js';

export const DEMO_INFLOW = [
  0, 5, 10, 15, 20, 25, 30, 25, 20, 15, 10, 5, 0,
  ...Array(27).fill(0), // 长尾让槽蓄泄空，洪量闭合
];

export const DEMO_K = 2;
export const DEMO_X = 0.2;
export const DEMO_DT = 1;

/** 幂等播种：已存在则跳过 */
export function seedDemoJob(jobRepo) {
  if (jobRepo.getById(DEMO_JOB_ID)) return false;
  const job = executeRouting({
    id: DEMO_JOB_ID,
    inflow: DEMO_INFLOW,
    dt: DEMO_DT,
    K: DEMO_K,
    X: DEMO_X,
  });
  jobRepo.insert(job);
  return true;
}
