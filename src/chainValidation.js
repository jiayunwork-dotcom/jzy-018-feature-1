// 河链请求体检查：空链、段结构、参数来源、汇入口区间入流，
// 全部在开演前查完；段级错误都带上 segmentIndex（0 起，与 segments 数组同序）。

import { AppError } from './errors.js';
import {
  assertBodyObject,
  assertInflowSeries,
  assertDtValue,
  assertInitialOutflowValue,
  resolveParamSource,
} from './validation.js';

/** 单段的区间入流（汇入口）：与主槽一样长、每点有限且非负 */
function assertLateralInflow(lateralInflow, segmentIndex, mainLength) {
  const at = `河链第 ${segmentIndex + 1} 段汇入口`;
  if (!Array.isArray(lateralInflow)) {
    throw new AppError('INVALID_LATERAL_INFLOW', `${at}的区间入流必须是数值数组`, 400, {
      segmentIndex,
      field: 'lateralInflow',
    });
  }
  if (lateralInflow.length !== mainLength) {
    throw new AppError(
      'LATERAL_INFLOW_LENGTH_MISMATCH',
      `${at}的区间入流必须与主槽过程一样长（${mainLength} 点），当前 ${lateralInflow.length} 点`,
      400,
      { segmentIndex, expected: mainLength, actual: lateralInflow.length },
    );
  }
  lateralInflow.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AppError('NOT_FINITE', `${at}的区间入流第 ${i} 个点不是有限数`, 400, { segmentIndex, index: i });
    }
    if (v < 0) {
      throw new AppError('NEGATIVE_LATERAL_INFLOW', `${at}的区间入流第 ${i} 个点为负（${v}），区间入流不得为负`, 400, {
        segmentIndex,
        index: i,
      });
    }
  });
  return lateralInflow;
}

function normalizeSegment(segment, segmentIndex, mainLength) {
  if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) {
    throw new AppError('INVALID_SEGMENT', `河链第 ${segmentIndex + 1} 段必须是 JSON 对象（reachName 或内联 K、X）`, 400, {
      segmentIndex,
    });
  }
  const { reachName, K, X, lateralInflow } = segment;
  const source = resolveParamSource({ reachName, K, X }, { segmentIndex });

  let lateral = null;
  if (lateralInflow !== undefined && lateralInflow !== null) {
    if (segmentIndex === 0) {
      throw new AppError('LATERAL_INFLOW_NOT_ALLOWED', '河链第一段直接吃上上游入流，没有汇入口，不得携带区间入流', 400, {
        segmentIndex,
      });
    }
    lateral = assertLateralInflow(lateralInflow, segmentIndex, mainLength);
  }

  return { ...source, lateralInflow: lateral };
}

/**
 * 校验河链请求体，返回归一化后的载荷：
 * { inflow, dt, initialOutflow, segments: [{ reachName, K, X, lateralInflow }] }
 * 档名解析（UNKNOWN_REACH）不在这里做，由 chainService 在开演前统一解析。
 */
export function validateChainPayload(body) {
  assertBodyObject(body);
  const { inflow, dt, initialOutflow, segments } = body;

  assertInflowSeries(inflow);
  assertDtValue(dt);
  const start = assertInitialOutflowValue(initialOutflow);

  if (segments === undefined || segments === null) {
    throw new AppError('MISSING_FIELD', '缺少河段序列 segments（按从上游到下游书写）', 400, { field: 'segments' });
  }
  if (!Array.isArray(segments)) {
    throw new AppError('INVALID_SEGMENTS', 'segments 必须是河段数组，按从上游到下游排列', 400, { field: 'segments' });
  }
  if (segments.length === 0) {
    throw new AppError('EMPTY_CHAIN', '河链至少需要一段，当前 segments 为空', 400, { field: 'segments' });
  }

  const normalized = segments.map((segment, i) => normalizeSegment(segment, i, inflow.length));

  return { inflow, dt, initialOutflow: start, segments: normalized };
}
