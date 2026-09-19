import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeInflowAtConfluence, reconcileChainVolumes } from '../src/muskingum/confluence.js';

test('汇入口：区间入流与主槽入流逐点相加', () => {
  const main = [1, 4, 9, 4, 1];
  const local = [0, 1, 2, 1, 0];
  assert.deepEqual(mergeInflowAtConfluence(main, local), [1, 5, 11, 5, 1]);
});

test('不带区间入流（null/undefined）时直接返回主槽入流', () => {
  const main = [1, 4, 9];
  assert.equal(mergeInflowAtConfluence(main, null), main);
  assert.equal(mergeInflowAtConfluence(main, undefined), main);
});

test('逐点相加不改变长度，且结果各点有限非负由上游校验保证', () => {
  const main = [0, 0, 0];
  const local = [2, 2, 2];
  const merged = mergeInflowAtConfluence(main, local);
  assert.equal(merged.length, main.length);
  assert.ok(merged.every((v) => Number.isFinite(v) && v >= 0));
});

test('洪量对账：出口洪量 −（上游洪量 + 全部区间洪量）', () => {
  const r = reconcileChainVolumes({
    inflowVolume: 100,
    localVolumes: [0, 40],
    outflowVolume: 140,
    tolerance: 1e-4,
  });
  assert.equal(r.totalInflowVolume, 140);
  assert.equal(r.outflowVolume, 140);
  assert.equal(r.difference, 0);
  assert.equal(r.closureTolerance, 1e-4);
});

test('洪量对账：有差额时带符号报出差额与容差', () => {
  const r = reconcileChainVolumes({
    inflowVolume: 100,
    localVolumes: [10, 20],
    outflowVolume: 129.5,
    tolerance: 1e-6,
  });
  assert.equal(r.totalInflowVolume, 130);
  assert.ok(Math.abs(r.difference - (-0.5)) < 1e-12);
});
