import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { DEMO_JOB_ID } from '../src/config.js';
import { TRIANGULAR_INFLOW, SHORT_TRIANGLE } from './helpers.js';

let app;

before(async () => {
  app = buildApp({ dbPath: ':memory:' });
  await app.ready();
});

after(async () => {
  await app.close();
});

const postJob = (payload) => app.inject({ method: 'POST', url: '/jobs', payload });

test('提交作业：返回整份结果并可用编号取回', async () => {
  const res = await postJob({ inflow: TRIANGULAR_INFLOW, dt: 1, K: 2, X: 0.2 });
  assert.equal(res.statusCode, 201);
  const job = res.json();

  assert.equal(job.status, 'completed');
  assert.equal(job.reachName, null);
  assert.equal(job.K, 2);
  assert.equal(job.X, 0.2);
  assert.equal(job.dt, 1);
  assert.deepEqual(job.inflow, TRIANGULAR_INFLOW);
  assert.equal(job.outflow.length, TRIANGULAR_INFLOW.length);
  assert.ok(Math.abs(job.coefficients.C0 + job.coefficients.C1 + job.coefficients.C2 - 1) <= 1e-9);
  assert.equal(job.initialOutflow, TRIANGULAR_INFLOW[0], '缺省起始出流取入流首值');
  assert.equal(job.peakLagSteps, job.outflowPeakIndex - job.inflowPeakIndex);
  assert.ok(job.closureTolerance > 0);
  assert.ok(job.coefficientSumTolerance > 0);
  assert.ok(Math.abs(job.volumeDifference) <= job.closureTolerance, '示范参数下洪量应闭合');

  const got = await app.inject({ method: 'GET', url: `/jobs/${job.id}` });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.json(), job, '取回的结果应与落盘的一致');
});

test('取不存在的作业：404 NOT_FOUND', async () => {
  const res = await app.inject({ method: 'GET', url: '/jobs/no-such-id' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.type, 'NOT_FOUND');
});

test('X 越界被拒（>0.5 与 <0 都退回，并指出是 X）', async () => {
  for (const X of [0.6, -0.1, 1]) {
    const res = await postJob({ inflow: [1, 2, 1], dt: 1, K: 2, X });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.type, 'INVALID_X');
    assert.equal(err.details.field, 'X');
  }
  // 闭区间端点合法
  for (const X of [0, 0.5]) {
    const res = await postJob({ inflow: [1, 2, 1], dt: 2, K: 2, X });
    assert.equal(res.statusCode, 201, `X=${X} 应被接受`);
  }
});

test('K 或步长不是正数被拒', async () => {
  for (const K of [0, -3]) {
    const res = await postJob({ inflow: [1, 2, 1], dt: 1, K, X: 0.2 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.type, 'INVALID_K');
  }
  for (const dt of [0, -1]) {
    const res = await postJob({ inflow: [1, 2, 1], dt, K: 2, X: 0.2 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.type, 'INVALID_DT');
  }
});

test('缺项被拒：无入流、无参数来源、K/X 只给一个、档名与内联混用', async () => {
  let res = await postJob({ dt: 1, K: 2, X: 0.2 });
  assert.equal(res.json().error.type, 'MISSING_FIELD');

  res = await postJob({ inflow: [1, 2, 1], dt: 1 });
  assert.equal(res.json().error.type, 'MISSING_FIELD');

  res = await postJob({ inflow: [1, 2, 1], dt: 1, K: 2 });
  assert.equal(res.json().error.type, 'MISSING_FIELD');
  assert.equal(res.json().error.details.field, 'X');

  res = await postJob({ inflow: [1, 2, 1], dt: 1, K: 2, X: 0.2, reachName: 'whatever' });
  assert.equal(res.json().error.type, 'CONFLICTING_PARAMETERS');
});

test('入流短于两点被拒', async () => {
  const res = await postJob({ inflow: [5], dt: 1, K: 2, X: 0.2 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'INFLOW_TOO_SHORT');
});

test('负入流被拒', async () => {
  const res = await postJob({ inflow: [3, -1, 2], dt: 1, K: 2, X: 0.2 });
  assert.equal(res.statusCode, 400);
  const err = res.json().error;
  assert.equal(err.type, 'NEGATIVE_INFLOW');
  assert.equal(err.details.index, 1);
});

test('非有限数被拒（JSON 里的 1e999 解析为 Infinity）', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: { 'content-type': 'application/json' },
    payload: '{"inflow":[1e999,2,1],"dt":1,"K":2,"X":0.2}',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'NOT_FINITE');
});

test('未知档名当场拒绝，不自行找相近档顶上', async () => {
  const res = await postJob({ inflow: [1, 2, 1], dt: 1, reachName: '不存在的河段' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'UNKNOWN_REACH');
});

test('河段档：登记、列出、点名演算、重名拒绝', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/reaches',
    payload: { name: '上游甲段', K: 3, X: 0.1 },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), { name: '上游甲段', K: 3, X: 0.1 });

  const list = await app.inject({ method: 'GET', url: '/reaches' });
  assert.ok(list.json().reaches.some((r) => r.name === '上游甲段' && r.K === 3 && r.X === 0.1));

  const dup = await app.inject({
    method: 'POST',
    url: '/reaches',
    payload: { name: '上游甲段', K: 9, X: 0.1 },
  });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.type, 'REACH_EXISTS');

  const res = await postJob({ inflow: TRIANGULAR_INFLOW, dt: 1, reachName: '上游甲段' });
  assert.equal(res.statusCode, 201);
  const job = res.json();
  assert.equal(job.reachName, '上游甲段');
  assert.equal(job.K, 3);
  assert.equal(job.X, 0.1);
});

test('同一入流用不同档各开一条作业，结果分别保存', async () => {
  await app.inject({ method: 'POST', url: '/reaches', payload: { name: '对照-缓', K: 2, X: 0.1 } });
  await app.inject({ method: 'POST', url: '/reaches', payload: { name: '对照-陡', K: 4, X: 0.1 } });

  const a = (await postJob({ inflow: TRIANGULAR_INFLOW, dt: 1, reachName: '对照-缓' })).json();
  const b = (await postJob({ inflow: TRIANGULAR_INFLOW, dt: 1, reachName: '对照-陡' })).json();
  assert.notEqual(a.id, b.id);
  assert.ok(b.outflowPeakIndex > a.outflowPeakIndex, 'K 更大的档峰现更晚');
  assert.notDeepEqual(a.outflow, b.outflow);
});

test('失稳出现负出流：作业失败且不落盘，绝不夹零冒充闭合', async () => {
  const before = (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs.length;
  const res = await postJob({ inflow: SHORT_TRIANGLE, dt: 1, K: 10, X: 0.4 });
  assert.equal(res.statusCode, 422);
  const err = res.json().error;
  assert.equal(err.type, 'UNSTABLE_NEGATIVE_OUTFLOW');
  assert.ok(err.message.includes('失稳'));
  assert.equal(res.json().outflow, undefined, '不得给出一条看起来完整其实算错的出流');

  const afterLen = (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs.length;
  assert.equal(afterLen, before, '失败作业不得落盘');
});

test('分母无法安全相除：作业失败', async () => {
  const res = await postJob({ inflow: [1, 2, 1], dt: 1e308, K: 1e308, X: 0.5 });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.type, 'DENOMINATOR_TOO_SMALL');
});

test('内置三角入流示范作业：峰更矮更晚，洪量闭合', async () => {
  const res = await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` });
  assert.equal(res.statusCode, 200);
  const demo = res.json();
  assert.ok(Math.max(...demo.outflow) < Math.max(...demo.inflow), '出流峰更矮');
  assert.ok(demo.outflowPeakIndex > demo.inflowPeakIndex, '峰现更晚');
  assert.ok(Math.abs(demo.volumeDifference) <= demo.closureTolerance, '洪量闭合');
});

test('同时执行的作业结果不串号', async () => {
  const N = 12;
  const payloads = Array.from({ length: N }, (_, i) => ({
    inflow: TRIANGULAR_INFLOW.map((v) => v * (i + 1)),
    dt: 1,
    K: 2,
    X: 0.2,
  }));

  const responses = await Promise.all(payloads.map((p) => postJob(p)));
  const jobs = responses.map((r) => {
    assert.equal(r.statusCode, 201);
    return r.json();
  });

  const ids = new Set(jobs.map((j) => j.id));
  assert.equal(ids.size, N, '作业编号不得重复');

  await Promise.all(jobs.map(async (job, i) => {
    const got = (await app.inject({ method: 'GET', url: `/jobs/${job.id}` })).json();
    assert.deepEqual(got.inflow, payloads[i].inflow, `作业 ${i} 的入流串号`);
    assert.deepEqual(got.outflow, job.outflow, `作业 ${i} 的出流串号`);
    const expectedPeak = Math.max(...payloads[i].inflow);
    assert.ok(Math.abs(Math.max(...got.outflow) - job.outflow[job.outflowPeakIndex]) < 1e-12);
    assert.ok(Math.max(...got.inflow) === expectedPeak);
  }));
});
