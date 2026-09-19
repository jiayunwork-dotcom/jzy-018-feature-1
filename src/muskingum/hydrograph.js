// 过程线工具：峰现下标与洪量。

/**
 * 峰现时刻的下标：序列里流量最大的那个下标；
 * 若有一段平台，取最先达到该最大值的下标。
 */
export function firstPeakIndex(series) {
  let peak = 0;
  for (let i = 1; i < series.length; i += 1) {
    if (series[i] > series[peak]) peak = i;
  }
  return peak;
}

/** 洪量 = 流量 × 时间步长，对整条过程求和 */
export function volume(series, dt) {
  let sum = 0;
  for (const v of series) sum += v;
  return sum * dt;
}
