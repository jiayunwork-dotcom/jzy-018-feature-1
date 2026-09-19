// Muskingum 逐步递推：O[i+1] = C0·I[i+1] + C1·I[i] + C2·O[i]。
//
// 一旦出现负的出流，视为参数与步长搭配失稳：抛错失败，
// 绝不把负数改写成零再声称洪量闭合。

import { AppError } from '../errors.js';

/**
 * @param {number[]} inflow 入流过程（已校验：长度 ≥ 2、有限、非负）
 * @param {{ c0: number, c1: number, c2: number }} coeffs 三联系数
 * @param {number} initialOutflow 起始出流 O[0]
 * @returns {number[]} 出流过程，长度与入流相同
 */
export function routeHydrograph(inflow, { c0, c1, c2 }, initialOutflow) {
  const outflow = new Array(inflow.length);
  outflow[0] = initialOutflow;

  for (let i = 0; i < inflow.length - 1; i += 1) {
    const next = c0 * inflow[i + 1] + c1 * inflow[i] + c2 * outflow[i];
    if (!Number.isFinite(next)) {
      throw new AppError(
        'NON_FINITE_OUTFLOW',
        `第 ${i + 1} 步递推得到非有限出流，演算终止`,
        422,
        { index: i + 1 },
      );
    }
    if (next < 0) {
      throw new AppError(
        'UNSTABLE_NEGATIVE_OUTFLOW',
        `第 ${i + 1} 步出现负出流 ${next}：该组 K、X 与步长搭配失稳，作业失败`,
        422,
        { index: i + 1, value: next },
      );
    }
    outflow[i + 1] = next;
  }

  return outflow;
}
