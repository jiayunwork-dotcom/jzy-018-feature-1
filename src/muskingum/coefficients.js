// Muskingum 三联系数：槽蓄写成柱形与楔形的加权。
//
// 共用分母 D = 2·K·(1 − X) + dt
//   C0 = (dt − 2KX) / D
//   C1 = (dt + 2KX) / D
//   C2 = (2K(1 − X) − dt) / D
// 三者之和必须等于 1（只允许服务钉死的浮点容差）。

import { AppError } from '../errors.js';
import { COEFFICIENT_SUM_TOLERANCE } from '../config.js';

/**
 * 计算三联系数。分母过小、无法安全相除时抛错，绝不硬除出 Infinity / NaN。
 * @returns {{ c0: number, c1: number, c2: number, sum: number, denominator: number }}
 */
export function computeCoefficients(K, X, dt) {
  const denominator = 2 * K * (1 - X) + dt;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new AppError(
      'DENOMINATOR_TOO_SMALL',
      `分母 2K(1−X)+dt 无法安全相除（K=${K}, X=${X}, dt=${dt}，计算值 ${denominator}）`,
      422,
    );
  }

  const c0 = (dt - 2 * K * X) / denominator;
  const c1 = (dt + 2 * K * X) / denominator;
  const c2 = (2 * K * (1 - X) - dt) / denominator;

  if (!Number.isFinite(c0) || !Number.isFinite(c1) || !Number.isFinite(c2)) {
    throw new AppError(
      'DENOMINATOR_TOO_SMALL',
      `分母 ${denominator} 过小，相除得到非有限系数，演算终止`,
      422,
    );
  }

  const sum = c0 + c1 + c2;
  if (Math.abs(sum - 1) > COEFFICIENT_SUM_TOLERANCE) {
    throw new AppError(
      'COEFFICIENT_SUM_MISMATCH',
      `C0+C1+C2 = ${sum}，偏离 1 超过钉死容差 ${COEFFICIENT_SUM_TOLERANCE}`,
      422,
    );
  }

  return { c0, c1, c2, sum, denominator };
}
