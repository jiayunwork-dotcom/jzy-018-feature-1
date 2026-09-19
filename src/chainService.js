// 河链编排：校验 → 全链档名一次解析完 → 从上游逐段演到下游 → 整链对账 → 落盘。
//
// 每一段仍走单段那一套演算（executeRouting）：同一套三联系数、同一步递推、
// 同一套失稳判定。任何一段失败，整链失败，已演完的上游段不落任何记录。

import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { executeRouting } from './jobService.js';
import { firstPeakIndex, volume } from './muskingum/hydrograph.js';
import { addPointwise, reconcileChainVolumes } from './muskingum/confluence.js';
import { validateChainPayload } from './chainValidation.js';

/**
 * 纯演算：给定已校验、档名已解析的输入，逐段下演，产出整条河链记录（不落盘）。
 * 任一段分母过小或递推出负值时抛 AppError（带 segmentIndex），整链失败。
 */
export function executeChain({ id, inflow, dt, segments, initialOutflow = null }) {
  const zeros = new Array(inflow.length).fill(0);
  const segmentResults = [];
  let mainChannel = inflow; // 进入本段的主槽过程：首段为上游入流，之后为上一段出流

  segments.forEach((segment, i) => {
    const lateral = i === 0 ? null : segment.lateralInflow;
    // 第一段直接吃上上游入流；从第二段起，主槽出流与区间入流逐点相加
    const segmentInflow = i === 0 ? inflow : addPointwise(mainChannel, lateral ?? zeros);
    // 第一段沿用单段规矩（给了就用，没给取入流首值）；从第二段起取实际入流首值
    const startOutflow = i === 0 ? initialOutflow ?? inflow[0] : segmentInflow[0];

    let result;
    try {
      result = executeRouting({
        inflow: segmentInflow,
        dt,
        K: segment.K,
        X: segment.X,
        reachName: segment.reachName,
        initialOutflow: startOutflow,
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw new AppError(err.type, `河链第 ${i + 1} 段演算失败：${err.message}`, err.statusCode, {
          ...err.details,
          segmentIndex: i,
        });
      }
      throw err;
    }

    segmentResults.push({
      reachName: segment.reachName,
      K: segment.K,
      X: segment.X,
      coefficients: result.coefficients,
      lateralInflow: lateral,
      lateralVolume: lateral ? volume(lateral, dt) : 0,
      inflow: segmentInflow,
      outflow: result.outflow,
      initialOutflow: result.initialOutflow,
      inflowPeakIndex: result.inflowPeakIndex,
      outflowPeakIndex: result.outflowPeakIndex,
      inflowVolume: result.inflowVolume,
      outflowVolume: result.outflowVolume,
    });
    mainChannel = result.outflow;
  });

  const outlet = segmentResults[segmentResults.length - 1].outflow;
  const inflowPeakIndex = firstPeakIndex(inflow);
  const outletPeakIndex = firstPeakIndex(outlet);
  const inflowVolume = volume(inflow, dt);
  const lateralVolumes = segmentResults.map((s) => s.lateralVolume);
  const outletVolume = volume(outlet, dt);
  const { volumeDifference, closureTolerance } = reconcileChainVolumes({ inflowVolume, lateralVolumes, outletVolume });

  return {
    id: id ?? randomUUID(),
    status: 'completed',
    dt,
    inflow,
    initialOutflow: segmentResults[0].initialOutflow,
    segments: segmentResults,
    outlet,
    inflowPeakIndex,
    outletPeakIndex,
    peakLagSteps: outletPeakIndex - inflowPeakIndex,
    inflowVolume,
    lateralVolumes,
    outletVolume,
    volumeDifference,
    closureTolerance,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 提交一条河链：校验载荷 → 把全链点到的档名一次解析完（任何一段缺档，
 * 整链当场拒绝，不演算、不落任何记录）→ 逐段下演 → 成功才落一条串联记录。
 */
export function submitChain(body, { reachRepo, chainRepo }) {
  const payload = validateChainPayload(body);

  const segments = payload.segments.map((segment, i) => {
    if (segment.reachName === null) return segment;
    const reach = reachRepo.get(segment.reachName);
    if (!reach) {
      throw new AppError('UNKNOWN_REACH', `河链第 ${i + 1} 段点名的河段档「${segment.reachName}」未登记，整链拒绝演算`, 400, {
        field: 'reachName',
        segmentIndex: i,
      });
    }
    return { ...segment, K: reach.K, X: reach.X };
  });

  const chain = executeChain({ ...payload, segments });
  chainRepo.insert(chain);
  return chain;
}
