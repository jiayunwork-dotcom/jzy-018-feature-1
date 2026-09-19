import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeRouting } from '../src/jobService.js';
import { firstPeakIndex, volume } from '../src/muskingum/hydrograph.js';
import { TRIANGULAR_INFLOW, SHORT_TRIANGLE } from './helpers.js';

test('三角入流：出流峰更矮，且峰现下标不早于入流峰', () => {
  const job = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 1, K: 2, X: 0.2 });
  assert.ok(Math.max(...job.outflow) < Math.max(...job.inflow), '出流峰必须更矮');
  assert.ok(job.outflowPeakIndex >= job.inflowPeakIndex, '峰现下标不得提前');
  assert.ok(job.outflowPeakIndex > job.inflowPeakIndex, '本组参数下峰现应更晚');
});

test('进出洪量之差落在钉死容差内', () => {
  const job = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 1, K: 2, X: 0.2 });
  assert.ok(Math.abs(job.volumeDifference) <= job.closureTolerance);
  assert.ok(job.closureTolerance > 0);
});

test('只加大 K（X、步长、入流不动），出流峰现更晚', () => {
  const small = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 1, K: 2, X: 0.1 });
  const large = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 1, K: 4, X: 0.1 });
  assert.ok(large.outflowPeakIndex > small.outflowPeakIndex);
});

test('X=0 仍削峰，但与 X=0.3 的过程对不齐', () => {
  const linear = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 2, K: 3, X: 0 });
  const wedge = executeRouting({ inflow: TRIANGULAR_INFLOW, dt: 2, K: 3, X: 0.3 });
  assert.ok(Math.max(...linear.outflow) < Math.max(...linear.inflow), '线性水库仍应削峰');
  assert.ok(
    linear.outflow.some((v, i) => Math.abs(v - wedge.outflow[i]) > 1e-9),
    '线性水库与带楔形槽蓄不是同一条线',
  );
});

test('常数入流 + 起始出流取该常数：出流全程保持该常数', () => {
  const inflow = Array(10).fill(7.5);
  const job = executeRouting({ inflow, dt: 1, K: 2, X: 0.2, initialOutflow: 7.5 });
  for (const o of job.outflow) {
    assert.ok(Math.abs(o - 7.5) < 1e-9, `出流 ${o} 偏离常数`);
  }
  // 缺省起始出流时取入流首值，同样保持常数
  const jobDefault = executeRouting({ inflow, dt: 1, K: 2, X: 0.2 });
  assert.equal(jobDefault.initialOutflow, 7.5);
  for (const o of jobDefault.outflow) {
    assert.ok(Math.abs(o - 7.5) < 1e-9);
  }
});

test('失稳出现负出流：抛 UNSTABLE_NEGATIVE_OUTFLOW，而不是夹零', () => {
  assert.throws(
    () => executeRouting({ inflow: SHORT_TRIANGLE, dt: 1, K: 10, X: 0.4 }),
    (err) => {
      assert.equal(err.type, 'UNSTABLE_NEGATIVE_OUTFLOW');
      assert.equal(err.statusCode, 422);
      assert.ok(err.details.value < 0, '错误里应带着那个负出流值');
      return true;
    },
  );
});

test('峰现下标：平台取最先达到最大值的下标', () => {
  assert.equal(firstPeakIndex([0, 5, 5, 5, 2]), 1);
  assert.equal(firstPeakIndex([1, 2, 9, 3]), 2);
  assert.equal(firstPeakIndex([4, 4]), 0);
});

test('洪量 = 流量 × 步长求和', () => {
  assert.equal(volume([1, 2, 3], 0.5), 3);
});
