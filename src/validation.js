// 入参检查：缺项、非有限数、越界、负流量等都在演算前退回，
// 并以带类型的错误指出是哪一项不合规。

import { AppError } from './errors.js';

function assertFiniteNumber(value, field, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('NOT_FINITE', `${label}必须是有限数，收到 ${JSON.stringify(value)}`, 400, { field });
  }
}

function assertPositiveK(K, detailsExtra = {}) {
  if (typeof K !== 'number' || !Number.isFinite(K)) {
    throw new AppError('NOT_FINITE', `槽蓄时间 K 必须是有限数，收到 ${JSON.stringify(K)}`, 400, { field: 'K', ...detailsExtra });
  }
  if (K <= 0) {
    throw new AppError('INVALID_K', `K 必须为正数，收到 ${K}`, 400, { field: 'K', ...detailsExtra });
  }
}

function assertXInRange(X, detailsExtra = {}) {
  if (typeof X !== 'number' || !Number.isFinite(X)) {
    throw new AppError('NOT_FINITE', `流量权重 X 必须是有限数，收到 ${JSON.stringify(X)}`, 400, { field: 'X', ...detailsExtra });
  }
  if (X < 0 || X > 0.5) {
    throw new AppError('INVALID_X', `X 必须落在 [0, 0.5] 闭区间，收到 ${X}`, 400, { field: 'X', ...detailsExtra });
  }
}

function assertBodyObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('MISSING_FIELD', '请求体必须是 JSON 对象', 400);
  }
}

/**
 * 校验一条非负、有限的过程线。
 * 长度不足、非有限、为负分别用调用方给好的错误类型，使单段入口与
 * 河链汇入口能给出彼此区分得开的错误。
 */
function assertHydrograph(values, { field, tooShortType, notFiniteType, negativeType, label, detailsExtra = {} }) {
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AppError(notFiniteType, `${label}第 ${i} 个点不是有限数`, 400, { field, index: i, ...detailsExtra });
    }
    if (v < 0) {
      throw new AppError(negativeType, `${label}第 ${i} 个点为负（${v}），不得为负`, 400, { field, index: i, ...detailsExtra });
    }
  });
  if (values.length < 2) {
    throw new AppError(tooShortType, `${label}至少需要两个点，当前只有 ${values.length} 个`, 400, { field, ...detailsExtra });
  }
}

/**
 * 校验演算作业请求体，返回归一化后的载荷。
 * 参数来源二选一：点名已登记河段档 reachName，或内联 K 与 X（用完即止）。
 */
export function validateJobPayload(body) {
  assertBodyObject(body);
  const { inflow, dt, reachName, K, X, initialOutflow } = body;

  // —— 入流过程线 ——
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

  // —— 时间步长（与 K 同一时间单位） ——
  if (dt === undefined || dt === null) {
    throw new AppError('MISSING_FIELD', '缺少时间步长 dt', 400, { field: 'dt' });
  }
  assertFiniteNumber(dt, 'dt', '时间步长 dt ');
  if (dt <= 0) {
    throw new AppError('INVALID_DT', `时间步长必须为正数，收到 ${dt}`, 400, { field: 'dt' });
  }

  // —— 参数来源：reachName 与内联 K/X 二选一 ——
  const hasReach = reachName !== undefined && reachName !== null;
  const hasK = K !== undefined && K !== null;
  const hasX = X !== undefined && X !== null;
  if (hasReach && (hasK || hasX)) {
    throw new AppError('CONFLICTING_PARAMETERS', 'reachName 与内联 K、X 只能二选一，不可同时给出', 400);
  }
  if (!hasReach && hasK !== hasX) {
    throw new AppError('MISSING_FIELD', `内联参数需要同时给出 K 和 X，缺少 ${hasK ? 'X' : 'K'}`, 400, { field: hasK ? 'X' : 'K' });
  }
  if (!hasReach && !hasK) {
    throw new AppError('MISSING_FIELD', '必须点名已登记河段档 reachName，或内联给出 K 与 X', 400);
  }
  if (hasReach && (typeof reachName !== 'string' || reachName.trim() === '')) {
    throw new AppError('INVALID_REACH_NAME', 'reachName 必须是非空字符串', 400, { field: 'reachName' });
  }
  if (hasK) assertPositiveK(K);
  if (hasX) assertXInRange(X);

  // —— 起始出流（可缺省，缺省时取入流首值，表示恒定流） ——
  let start = null;
  if (initialOutflow !== undefined && initialOutflow !== null) {
    assertFiniteNumber(initialOutflow, 'initialOutflow', '起始出流 ');
    if (initialOutflow < 0) {
      throw new AppError('NEGATIVE_INITIAL_OUTFLOW', `起始出流不得为负，收到 ${initialOutflow}`, 400, { field: 'initialOutflow' });
    }
    start = initialOutflow;
  }

  return {
    inflow,
    dt,
    reachName: hasReach ? reachName.trim() : null,
    K: hasK ? K : null,
    X: hasX ? X : null,
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

/**
 * 校验河链请求体，返回归一化后的河链载荷（尚未解析档名、尚未演算）。
 * 河链 = 一条最上游入流 + 按书写顺序从上游到下游排好的若干段河。
 */
export function validateChainPayload(body) {
  assertBodyObject(body);
  const { inflow, dt, segments, initialOutflow } = body;

  // —— 最上游入流：规则与单段同一套 ——
  if (inflow === undefined || inflow === null) {
    throw new AppError('MISSING_FIELD', '缺少最上游入流过程 inflow', 400, { field: 'inflow' });
  }
  if (!Array.isArray(inflow)) {
    throw new AppError('INVALID_INFLOW', 'inflow 必须是数值数组（整条过程线）', 400, { field: 'inflow' });
  }
  assertHydrograph(inflow, {
    field: 'inflow',
    tooShortType: 'INFLOW_TOO_SHORT',
    notFiniteType: 'NOT_FINITE',
    negativeType: 'NEGATIVE_INFLOW',
    label: '最上游入流',
  });

  // —— 全链共用一个时间步长 ——
  if (dt === undefined || dt === null) {
    throw new AppError('MISSING_FIELD', '缺少时间步长 dt', 400, { field: 'dt' });
  }
  assertFiniteNumber(dt, 'dt', '时间步长 dt ');
  if (dt <= 0) {
    throw new AppError('INVALID_DT', `时间步长必须为正数，收到 ${dt}`, 400, { field: 'dt' });
  }

  // —— 起始出流（只作用于第一段，可缺省） ——
  let start = null;
  if (initialOutflow !== undefined && initialOutflow !== null) {
    assertFiniteNumber(initialOutflow, 'initialOutflow', '第一段起始出流 ');
    if (initialOutflow < 0) {
      throw new AppError('NEGATIVE_INITIAL_OUTFLOW', `起始出流不得为负，收到 ${initialOutflow}`, 400, { field: 'initialOutflow' });
    }
    start = initialOutflow;
  }

  // —— 河段序列：至少一段 ——
  if (segments === undefined || segments === null) {
    throw new AppError('CHAIN_NO_SEGMENTS', '缺少河段序列 segments（河链至少包含一段）', 400, { field: 'segments' });
  }
  if (!Array.isArray(segments)) {
    throw new AppError('CHAIN_NO_SEGMENTS', 'segments 必须是数组（按上游到下游排好的若干段河）', 400, { field: 'segments' });
  }
  if (segments.length === 0) {
    throw new AppError('CHAIN_NO_SEGMENTS', '河链至少需要一段，当前为空链', 400, { field: 'segments' });
  }

  const normalized = segments.map((segment, idx) => validateChainSegment(segment, idx, inflow.length));

  return { inflow, dt, segments: normalized, initialOutflow: start };
}

/**
 * 校验河链中的一段。segmentIndex 为该段在链中的书写位置（从 0 起），
 * 所有错误详情都带上 segment 段号（对外报第几段，从 1 起数）。
 */
function validateChainSegment(segment, segmentIndex, inflowLength) {
  const ordinal = segmentIndex + 1;
  const segDetails = { segment: ordinal };
  if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) {
    throw new AppError('CHAIN_INVALID_SEGMENT', `第 ${ordinal} 段必须是 JSON 对象`, 400, segDetails);
  }

  const { reachName, K, X, localInflow } = segment;
  const hasReach = reachName !== undefined && reachName !== null;
  const hasK = K !== undefined && K !== null;
  const hasX = X !== undefined && X !== null;

  // —— 参数来源：同一段上点名与内联 K/X 不能同时出现 ——
  if (hasReach && (hasK || hasX)) {
    throw new AppError(
      'CONFLICTING_PARAMETERS',
      `第 ${ordinal} 段的 reachName 与内联 K、X 只能二选一，不可同时给出`,
      400,
      segDetails,
    );
  }
  if (!hasReach && hasK !== hasX) {
    throw new AppError(
      'MISSING_FIELD',
      `第 ${ordinal} 段内联参数需要同时给出 K 和 X，只给了 ${hasK ? 'K 没给 X' : 'X 没给 K'}`,
      400,
      { field: hasK ? 'X' : 'K', ...segDetails },
    );
  }
  if (!hasReach && !hasK) {
    throw new AppError(
      'MISSING_FIELD',
      `第 ${ordinal} 段必须点名已登记河段档 reachName，或内联给出 K 与 X`,
      400,
      segDetails,
    );
  }
  if (hasReach) {
    if (typeof reachName !== 'string' || reachName.trim() === '') {
      throw new AppError('INVALID_REACH_NAME', `第 ${ordinal} 段的 reachName 必须是非空字符串`, 400, segDetails);
    }
  } else {
    assertPositiveK(K, segDetails);
    assertXInRange(X, segDetails);
  }

  // —— 区间入流：只有汇入口（第二段起）能带；第一段没有汇入口 ——
  const hasLocal = localInflow !== undefined && localInflow !== null;
  if (segmentIndex === 0 && hasLocal) {
    throw new AppError(
      'LOCAL_INFLOW_ON_FIRST_SEGMENT',
      '第一段是最上游段，没有汇入口，不能带区间入流 localInflow',
      400,
      segDetails,
    );
  }
  let normalizedLocal = null;
  if (hasLocal) {
    if (!Array.isArray(localInflow)) {
      throw new AppError(
        'INVALID_LOCAL_INFLOW',
        `第 ${ordinal} 段汇入口的区间入流必须是数值数组`,
        400,
        { field: 'localInflow', ...segDetails },
      );
    }
    if (localInflow.length !== inflowLength) {
      throw new AppError(
        'LOCAL_INFLOW_LENGTH_MISMATCH',
        `第 ${ordinal} 段汇入口的区间入流有 ${localInflow.length} 个点，与主槽入流 ${inflowLength} 个点对不上`,
        400,
        { field: 'localInflow', expectedLength: inflowLength, actualLength: localInflow.length, ...segDetails },
      );
    }
    assertHydrograph(localInflow, {
      field: 'localInflow',
      // 汇入口的错误类型刻意与单段的 INFLOW_TOO_SHORT / NEGATIVE_INFLOW 区分开。
      // 长度已在上面单独拦过，这里 tooShort 只是兜底。
      tooShortType: 'LOCAL_INFLOW_LENGTH_MISMATCH',
      notFiniteType: 'LOCAL_INFLOW_NOT_FINITE',
      negativeType: 'LOCAL_INFLOW_NEGATIVE',
      label: `第 ${ordinal} 段汇入口的区间入流`,
      detailsExtra: segDetails,
    });
    normalizedLocal = localInflow;
  }

  return {
    reachName: hasReach ? reachName.trim() : null,
    K: hasK ? K : null,
    X: hasX ? X : null,
    localInflow: normalizedLocal,
  };
}
