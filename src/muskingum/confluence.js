// 汇入口工具：区间入流与主槽出流逐点相加，以及河链洪量对账。
//
// 河链从第二段起可带一条区间入流：它与上一段出流（本段主槽入流）
// 逐点相加之后才是本段真正喂给 Muskingum 递推的入流。长度一致、
// 有限、非负这些约束在 validation 阶段已经拦过，这里只做算术。

/**
 * 主槽入流与区间入流逐点相加。不带区间入流时直接返回主槽入流。
 * @param {number[]} mainInflow 上一段出流（本段主槽入流）
 * @param {number[] | null} localInflow 本段汇入口的区间入流（null 表示全程为零）
 * @returns {number[]} 本段真正的入流过程
 */
export function mergeInflowAtConfluence(mainInflow, localInflow) {
  if (localInflow === null || localInflow === undefined) return mainInflow;
  const merged = new Array(mainInflow.length);
  for (let i = 0; i < mainInflow.length; i += 1) {
    merged[i] = mainInflow[i] + localInflow[i];
  }
  return merged;
}

/**
 * 河链洪量对账：出口洪量 −（上游入流洪量 + 全部汇入口区间洪量）。
 * @returns {{ totalInflowVolume: number, outflowVolume: number, difference: number, closureTolerance: number }}
 */
export function reconcileChainVolumes({ inflowVolume, localVolumes, outflowVolume, tolerance }) {
  let totalInflowVolume = inflowVolume;
  for (const v of localVolumes) totalInflowVolume += v;
  return {
    totalInflowVolume,
    outflowVolume,
    difference: outflowVolume - totalInflowVolume,
    closureTolerance: tolerance,
  };
}
