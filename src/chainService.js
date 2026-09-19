// 河链编排：把上中下游接成一条河来演。
//
// 流程：校验载荷 → 一次性解析链里点到的全部档名（任何一个没登记，
// 整链当场拒绝，指出第几段，绝不先演后报）→ 从上游到下游逐段演算：
// 上一段出流整条成为下一段主槽入流，汇入口区间入流逐点相加后再喂
// 给现有的单段 Muskingum 规则。任一段失败（分母过小、递推负出流）
// 整条链失败并指出第几段、什么原因，已经演完的上游段绝不落成单段
// 作业；只有整条链成功才落一条河链记录。

import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { computeCoefficients } from './muskingum/coefficients.js';
import { routeHydrograph } from './muskingum/routing.js';
import { firstPeakIndex, volume } from './muskingum/hydrograph.js';
import { mergeInflowAtConfluence, reconcileChainVolumes } from './muskingum/confluence.js';
import { validateChainPayload } from './validation.js';
import { COEFFICIENT_SUM_TOLERANCE, VOLUME_CLOSURE_RELATIVE_TOLERANCE } from './config.js';

/**
 * 把演算期错误包成「河链第几段失败」，错误类型与原因单独留档，
 * 不破坏原始 AppError 的类型与状态码语义（演算期一律 422）。
 */
function failSegment(ordinal, cause) {
  return new AppError(
    'CHAIN_SEGMENT_FAILED',
    `河链第 ${ordinal} 段演算失败：${cause.message}`,
    cause.statusCode ?? 422,
    {
      segment: ordinal,
      reason: cause.type,
      ...(cause.details !== undefined ? { causeDetails: cause.details } : {}),
    },
  );
}

/**
 * 纯演算：给定已校验的河链载荷，逐段往下演，产出完整河链记录（不落盘）。
 * 档名解析失败或任一段演算失败时抛 AppError，且不产生任何单段作业。
 */
export function executeChain({ id, inflow, dt, segments, initialOutflow = null, reachRepo }) {
  // —— 开演前先把整条链点到的档名全部解析完 ——
  // 任何一段点到没登记的名字，整链当场拒绝，指出是第几段，绝不演到那才报。
  const resolved = segments.map((segment, idx) => {
    const ordinal = idx + 1;
    if (segment.reachName !== null) {
      const reach = reachRepo.get(segment.reachName);
      if (!reach) {
        throw new AppError(
          'UNKNOWN_REACH',
          `河链第 ${ordinal} 段点到的河段档「${segment.reachName}」未登记，整链拒绝演算`,
          400,
          { segment: ordinal, field: 'reachName' },
        );
      }
      return { ...segment, K: reach.K, X: reach.X };
    }
    return segment;
  });

  const upstreamInflow = inflow;
  const upstreamInflowPeakIndex = firstPeakIndex(upstreamInflow);
  const upstreamInflowVolume = volume(upstreamInflow, dt);

  const segmentResults = [];
  let mainInflow = upstreamInflow; // 当前段接到的主槽入流（上一段出流）
  let firstSegmentStart = initialOutflow; // null 表示取入流首值

  for (let idx = 0; idx < resolved.length; idx += 1) {
    const ordinal = idx + 1;
    const segment = resolved[idx];

    // 汇入口：区间入流与主槽出流逐点相加，才是本段真正的入流。
    // 长度/有限/非负已在 validation 阶段对每段统一拦过，这里只做算术。
    const segmentInflow = mergeInflowAtConfluence(mainInflow, segment.localInflow);

    // 第一段起始出流：给了就用，没给取最上游入流首值（与单段同规矩）；
    // 从第二段起，取它实际接到的那条（合并后的）入流的第一个值。
    let startOutflow;
    if (idx === 0) {
      startOutflow = firstSegmentStart ?? upstreamInflow[0];
    } else {
      startOutflow = segmentInflow[0];
    }

    // 每一段仍走现有单段同一套规则：同系数、同步递推、同负出流失败判定。
    let coeffs;
    try {
      coeffs = computeCoefficients(segment.K, segment.X, dt);
    } catch (err) {
      if (err instanceof AppError) throw failSegment(ordinal, err);
      throw err;
    }

    let outflow;
    try {
      outflow = routeHydrograph(segmentInflow, coeffs, startOutflow);
    } catch (err) {
      if (err instanceof AppError) throw failSegment(ordinal, err);
      throw err;
    }

    const localVolume = segment.localInflow !== null ? volume(segment.localInflow, dt) : 0;

    segmentResults.push({
      segment: ordinal,
      reachName: segment.reachName,
      K: segment.K,
      X: segment.X,
      coefficients: { C0: coeffs.c0, C1: coeffs.c1, C2: coeffs.c2, sum: coeffs.sum },
      localInflow: segment.localInflow,
      inflow: segmentInflow,
      outflow,
      initialOutflow: startOutflow,
      inflowPeakIndex: firstPeakIndex(segmentInflow),
      outflowPeakIndex: firstPeakIndex(outflow),
      localInflowVolume: localVolume,
      inflowVolume: volume(segmentInflow, dt),
      outflowVolume: volume(outflow, dt),
    });

    mainInflow = outflow; // 上一段出流整条成为下一段主槽入流
  }

  const last = segmentResults[segmentResults.length - 1];
  const outflowHydrograph = last.outflow; // 出口过程 = 最后一段出流
  const outflowVolume = last.outflowVolume;
  const totalLocalVolume = segmentResults.reduce((acc, s) => acc + s.localInflowVolume, 0);

  const closure = reconcileChainVolumes({
    inflowVolume: upstreamInflowVolume,
    localVolumes: segmentResults.map((s) => s.localInflowVolume),
    outflowVolume,
    tolerance:
      VOLUME_CLOSURE_RELATIVE_TOLERANCE *
      Math.max(1, Math.abs(upstreamInflowVolume + totalLocalVolume)),
  });

  return {
    id: id ?? randomUUID(),
    kind: 'chain',
    status: 'completed',
    dt,
    inflow: upstreamInflow,
    segments: segmentResults,
    outflow: outflowHydrograph,
    inflowPeakIndex: upstreamInflowPeakIndex,
    outflowPeakIndex: last.outflowPeakIndex,
    peakLagSteps: last.outflowPeakIndex - upstreamInflowPeakIndex,
    inflowVolume: upstreamInflowVolume,
    localInflowVolumes: segmentResults.map((s) => s.localInflowVolume),
    totalInflowVolume: closure.totalInflowVolume,
    outflowVolume,
    volumeDifference: closure.difference,
    closureTolerance: closure.closureTolerance,
    coefficientSumTolerance: COEFFICIENT_SUM_TOLERANCE,
    initialOutflow: segmentResults[0].initialOutflow,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 提交一条河链：校验 → 解析档名 → 逐段演算 → 成功才落盘。
 * 失败时不写任何记录（也绝不产生单段作业）。
 */
export function submitChain(body, { reachRepo, chainRepo }) {
  const payload = validateChainPayload(body);
  const chain = executeChain({ ...payload, reachRepo });
  chainRepo.insert(chain);
  return chain;
}
