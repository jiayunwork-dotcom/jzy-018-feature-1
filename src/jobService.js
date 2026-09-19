// 演算作业编排：校验 → 解析 K/X → 三联系数 → 逐步递推 → 峰现与洪量 → 落盘。

import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { computeCoefficients } from './muskingum/coefficients.js';
import { routeHydrograph } from './muskingum/routing.js';
import { firstPeakIndex, volume } from './muskingum/hydrograph.js';
import { validateJobPayload } from './validation.js';
import { COEFFICIENT_SUM_TOLERANCE, VOLUME_CLOSURE_RELATIVE_TOLERANCE } from './config.js';

/**
 * 纯演算：给定已校验的输入，产出完整作业结果（不落盘）。
 * 演算失败（分母过小、失稳负出流）时抛 AppError。
 */
export function executeRouting({ id, inflow, dt, K, X, reachName = null, initialOutflow = null }) {
  const coeffs = computeCoefficients(K, X, dt);

  // 未给出起始出流时取入流首值：演算开始时河段处于恒定流
  const startOutflow = initialOutflow ?? inflow[0];
  const outflow = routeHydrograph(inflow, coeffs, startOutflow);

  const inflowPeakIndex = firstPeakIndex(inflow);
  const outflowPeakIndex = firstPeakIndex(outflow);
  const inflowVolume = volume(inflow, dt);
  const outflowVolume = volume(outflow, dt);
  const closureTolerance = VOLUME_CLOSURE_RELATIVE_TOLERANCE * Math.max(1, Math.abs(inflowVolume));

  return {
    id: id ?? randomUUID(),
    status: 'completed',
    reachName,
    K,
    X,
    dt,
    coefficients: { C0: coeffs.c0, C1: coeffs.c1, C2: coeffs.c2, sum: coeffs.sum },
    inflow,
    outflow,
    initialOutflow: startOutflow,
    inflowPeakIndex,
    outflowPeakIndex,
    peakLagSteps: outflowPeakIndex - inflowPeakIndex,
    inflowVolume,
    outflowVolume,
    volumeDifference: outflowVolume - inflowVolume,
    closureTolerance,
    coefficientSumTolerance: COEFFICIENT_SUM_TOLERANCE,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 提交一条演算作业：校验载荷、解析参数来源、演算、落盘，返回整份结果。
 */
export function submitJob(body, { reachRepo, jobRepo }) {
  const payload = validateJobPayload(body);

  let { K, X } = payload;
  const { reachName } = payload;
  if (reachName !== null) {
    const reach = reachRepo.get(reachName);
    if (!reach) {
      throw new AppError('UNKNOWN_REACH', `河段档「${reachName}」未登记，拒绝演算`, 400, { field: 'reachName' });
    }
    K = reach.K;
    X = reach.X;
  }

  const job = executeRouting({ ...payload, K, X, reachName });
  jobRepo.insert(job);
  return job;
}
