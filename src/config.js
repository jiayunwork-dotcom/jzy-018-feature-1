// 服务级常量：钉死的浮点容差与运行配置。

/** 三联系数 C0+C1+C2 与 1 之间允许的最大偏差 */
export const COEFFICIENT_SUM_TOLERANCE = 1e-9;

/** 洪量闭合相对容差：本次作业的闭合容差 = 该值 × max(1, |入流洪量|) */
export const VOLUME_CLOSURE_RELATIVE_TOLERANCE = 1e-6;

/** 内置三角入流示范作业的固定编号 */
export const DEMO_JOB_ID = 'demo-triangular';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? 'data/muskingum.db',
};
