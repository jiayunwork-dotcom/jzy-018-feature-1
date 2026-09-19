// 汇入口与整链对账：主槽过程与区间入流逐点相加；出口洪量对上游与区间之和闭合。

import { VOLUME_CLOSURE_RELATIVE_TOLERANCE } from '../config.js';

/**
 * 主槽过程 + 区间入流，逐点相加，得到该段真正的入流。
 * 两条过程必须一样长（长度检查在 chainValidation 开演前完成）。
 */
export function addPointwise(mainChannel, lateralInflow) {
  return mainChannel.map((v, i) => v + lateralInflow[i]);
}

/**
 * 整链洪量对账：出口洪量 −（上游入流洪量 + 全部区间洪量）。
 * 闭合容差沿用单段同一套规矩：相对容差 × max(1, |本次进入全链的总水量|)。
 */
export function reconcileChainVolumes({ inflowVolume, lateralVolumes, outletVolume }) {
  const lateralTotal = lateralVolumes.reduce((acc, v) => acc + v, 0);
  const totalInputVolume = inflowVolume + lateralTotal;
  return {
    totalInputVolume,
    volumeDifference: outletVolume - totalInputVolume,
    closureTolerance: VOLUME_CLOSURE_RELATIVE_TOLERANCE * Math.max(1, Math.abs(totalInputVolume)),
  };
}
