// 入参检查：缺项、非有限数、越界、负流量等都在演算前退回，
// 并以带类型的错误指出是哪一项不合规。
//
// 单段作业与河链共用这里的底层检查；河链段级错误会额外带上 segmentIndex。

import { AppError } from './errors.js';

function assertFiniteNumber(value, field, label, extra) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('NOT_FINITE', `${label}必须是有限数，收到 ${JSON.stringify(value)}`, 400, { field, ...extra });
  }
}

function assertPositiveK(K, extra) {
  assertFiniteNumber(K, 'K', '槽蓄时间 K ', extra);
  if (K <= 0) {
    throw new AppError('INVALID_K', `K 必须为正数，收到 ${K}`, 400, { field: 'K', ...extra });
  }
}

function assertXInRange(X, extra) {
  assertFiniteNumber(X, 'X', '流量权重 X ', extra);
  if (X < 0 || X > 0.5) {
    throw new AppError('INVALID_X', `X 必须落在 [0, 0.5] 闭区间，收到 ${X}`, 400, { field: 'X', ...extra });
  }
}

export function assertBodyObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('MISSING_FIELD', '请求体必须是 JSON 对象', 400);
  }
}

/** 入流过程线：至少两点、每个点有限且非负 */
export function assertInflowSeries(inflow) {
  if (inflow === undefined || inflow === null) {
    throw new AppError('MISSING_FIELD', '缺少入流过程 inflow', 400, { field: 'inflow' });
  }
  if (!Array.isArray(inflow)) {
    throw new AppError('INVALID_INFLOW', 'inflow 必须是数值数组（整条过程线）', 400, { field: 'inflow' });
  }
  if (inflow.length < 2) {
    throw new AppError('INFLOW_TOO_SHORT', `入流至少需要两个点，当前只有 ${inflow.length} 个`, 400, { field: 'inflow' });
  }
  inflow.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AppError('NOT_FINITE', `入流第 ${i} 个点不是有限数`, 400, { field: 'inflow', index: i });
    }
    if (v < 0) {
      throw new AppError('NEGATIVE_INFLOW', `入流第 ${i} 个点为负（${v}），入流不得为负`, 400, { field: 'inflow', index: i });
    }
  });
  return inflow;
}

/** 时间步长（与 K 同一时间单位） */
export function assertDtValue(dt) {
  if (dt === undefined || dt === null) {
    throw new AppError('MISSING_FIELD', '缺少时间步长 dt', 400, { field: 'dt' });
  }
  assertFiniteNumber(dt, 'dt', '时间步长 dt ');
  if (dt <= 0) {
    throw new AppError('INVALID_DT', `时间步长必须为正数，收到 ${dt}`, 400, { field: 'dt' });
  }
  return dt;
}

/** 起始出流：可缺省（返回 null），缺省时取入流首值，表示恒定流 */
export function assertInitialOutflowValue(initialOutflow) {
  if (initialOutflow === undefined || initialOutflow === null) return null;
  assertFiniteNumber(initialOutflow, 'initialOutflow', '起始出流 ');
  if (initialOutflow < 0) {
    throw new AppError('NEGATIVE_INITIAL_OUTFLOW', `起始出流不得为负，收到 ${initialOutflow}`, 400, { field: 'initialOutflow' });
  }
  return initialOutflow;
}

/**
 * 参数来源二选一：点名已登记河段档 reachName，或内联 K 与 X（用完即止）。
 * extraDetails 会并入错误 details（河链用来带上 segmentIndex）。
 */
export function resolveParamSource({ reachName, K, X }, extraDetails = undefined) {
  const withExtra = (details) => (extraDetails ? { ...details, ...extraDetails } : details);

  const hasReach = reachName !== undefined && reachName !== null;
  const hasK = K !== undefined && K !== null;
  const hasX = X !== undefined && X !== null;
  if (hasReach && (hasK || hasX)) {
    throw new AppError('CONFLICTING_PARAMETERS', 'reachName 与内联 K、X 只能二选一，不可同时给出', 400, withExtra(undefined));
  }
  if (!hasReach && hasK !== hasX) {
    throw new AppError(
      'MISSING_FIELD',
      `内联参数需要同时给出 K 和 X，缺少 ${hasK ? 'X' : 'K'}`,
      400,
      withExtra({ field: hasK ? 'X' : 'K' }),
    );
  }
  if (!hasReach && !hasK) {
    throw new AppError('MISSING_FIELD', '必须点名已登记河段档 reachName，或内联给出 K 与 X', 400, withExtra(undefined));
  }
  if (hasReach && (typeof reachName !== 'string' || reachName.trim() === '')) {
    throw new AppError('INVALID_REACH_NAME', 'reachName 必须是非空字符串', 400, withExtra({ field: 'reachName' }));
  }
  if (hasK) assertPositiveK(K, extraDetails);
  if (hasX) assertXInRange(X, extraDetails);

  return {
    reachName: hasReach ? reachName.trim() : null,
    K: hasK ? K : null,
    X: hasX ? X : null,
  };
}

/**
 * 校验演算作业请求体，返回归一化后的载荷。
 */
export function validateJobPayload(body) {
  assertBodyObject(body);
  const { inflow, dt, reachName, K, X, initialOutflow } = body;

  assertInflowSeries(inflow);
  assertDtValue(dt);
  const source = resolveParamSource({ reachName, K, X });
  const start = assertInitialOutflowValue(initialOutflow);

  return {
    inflow,
    dt,
    reachName: source.reachName,
    K: source.K,
    X: source.X,
    initialOutflow: start,
  };
}

/** 校验河段档登记请求体 */
export function validateReachPayload(body) {
  assertBodyObject(body);
  const { name, K, X } = body;
  if (name === undefined || name === null || typeof name !== 'string' || name.trim() === '') {
    throw new AppError('MISSING_FIELD', '缺少河段档名 name（非空字符串）', 400, { field: 'name' });
  }
  if (K === undefined || K === null) {
    throw new AppError('MISSING_FIELD', '缺少槽蓄时间 K', 400, { field: 'K' });
  }
  if (X === undefined || X === null) {
    throw new AppError('MISSING_FIELD', '缺少流量权重 X', 400, { field: 'X' });
  }
  assertPositiveK(K);
  assertXInRange(X);
  return { name: name.trim(), K, X };
}
