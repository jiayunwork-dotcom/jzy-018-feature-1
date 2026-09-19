import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const postChain = (payload) => app.inject({ method: 'POST', url: '/chains', payload });
const postJob = (payload) => app.inject({ method: 'POST', url: '/jobs', payload });
const getDemo = async () => (await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` })).json();
const jobCount = async () => (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs.length;
const chainCount = async () => (await app.inject({ method: 'GET', url: '/chains' })).json().chains.length;

// —— 甲：常数入流两段串联，出口仍是常数 ——
test('甲：八点全 8 的入流经两段 K=2、X=0.2，出口八点仍全是 8', async () => {
  const res = await postChain({
    inflow: Array(8).fill(8),
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }],
  });
  assert.equal(res.statusCode, 201);
  const chain = res.json();
  assert.equal(chain.outlet.length, 8);
  for (const v of chain.outlet) {
    assert.ok(Math.abs(v - 8) < 1e-9, `出口 ${v} 偏离常数 8`);
  }
  for (const seg of chain.segments) {
    for (const v of seg.outflow) assert.ok(Math.abs(v - 8) < 1e-9);
  }
});

// —— 乙：第二段汇入常数区间入流，出口抬升且整链洪量闭合 ——
test('乙：第二段汇入口加八点全 2 的区间入流，出口八点全是 10，洪量对得上', async () => {
  const res = await postChain({
    inflow: Array(8).fill(8),
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, lateralInflow: Array(8).fill(2) }],
  });
  assert.equal(res.statusCode, 201);
  const chain = res.json();
  for (const v of chain.outlet) {
    assert.ok(Math.abs(v - 10) < 1e-9, `出口 ${v} 偏离 10`);
  }
  assert.ok(Math.abs(chain.inflowVolume - 64) < 1e-12, '上游洪量 = 8×8×1');
  assert.equal(chain.lateralVolumes.length, 2, '各汇入口区间洪量与段序对齐');
  assert.ok(Math.abs(chain.lateralVolumes[0]) < 1e-12, '第一段没有汇入口');
  assert.ok(Math.abs(chain.lateralVolumes[1] - 16) < 1e-12, '区间洪量 = 2×8×1');
  assert.ok(Math.abs(chain.segments[1].lateralVolume - 16) < 1e-12);
  assert.ok(Math.abs(chain.outletVolume - 80) < 1e-9, '出口洪量 = 10×8×1');
  assert.ok(
    Math.abs(chain.volumeDifference - (chain.outletVolume - chain.inflowVolume - 16)) < 1e-9,
    '差 = 出口洪量 −（上游洪量 + 区间洪量）',
  );
  assert.ok(Math.abs(chain.volumeDifference) <= chain.closureTolerance, '差落在闭合容差内');
});

// —— 丙：示范同款单段河链，与示范作业逐项一致 ——
test('丙：示范三角入流作唯一一段，出流、峰现、进出洪量与示范作业逐项相同', async () => {
  const demo = await getDemo();
  const res = await postChain({ inflow: demo.inflow, dt: 1, segments: [{ K: 2, X: 0.2 }] });
  assert.equal(res.statusCode, 201);
  const chain = res.json();

  assert.equal(chain.segments.length, 1);
  const seg = chain.segments[0];
  assert.deepEqual(seg.outflow, demo.outflow, '该段出流与示范逐点相同');
  assert.equal(seg.inflowPeakIndex, demo.inflowPeakIndex);
  assert.equal(seg.outflowPeakIndex, demo.outflowPeakIndex);
  assert.equal(seg.inflowVolume, demo.inflowVolume);
  assert.equal(seg.outflowVolume, demo.outflowVolume);
  assert.deepEqual(chain.outlet, demo.outflow, '出口过程即该段出流');
  assert.equal(chain.inflowVolume, demo.inflowVolume);
  assert.equal(chain.outletVolume, demo.outflowVolume);
  assert.equal(chain.peakLagSteps, demo.peakLagSteps);
});

// —— 丁：两段同款参数串联，第二段与「首段出流再交单段入口」逐点一致 ——
test('丁：第二段出流与首段出流再交单段入口一致，出口峰更矮不更早，整链闭合', async () => {
  const demo = await getDemo();
  const res = await postChain({
    inflow: demo.inflow,
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }],
  });
  assert.equal(res.statusCode, 201);
  const chain = res.json();

  assert.deepEqual(chain.segments[0].outflow, demo.outflow, '第一段出流仍与示范一致');

  const reJobRes = await postJob({ inflow: chain.segments[0].outflow, dt: 1, K: 2, X: 0.2 });
  assert.equal(reJobRes.statusCode, 201);
  const reJob = reJobRes.json();
  assert.deepEqual(chain.segments[1].outflow, reJob.outflow, '第二段出流与单段重交逐点相同');
  assert.deepEqual(chain.outlet, reJob.outflow);

  assert.ok(
    Math.max(...chain.outlet) < Math.max(...chain.segments[0].outflow),
    '出口峰比第一段出流峰更矮',
  );
  assert.ok(
    chain.segments[1].outflowPeakIndex >= chain.segments[0].outflowPeakIndex,
    '出口峰现下标不得早于第一段出流峰',
  );
  assert.ok(Math.abs(chain.volumeDifference) <= chain.closureTolerance, '上游洪量对出口洪量闭合');
});

// —— 戊：第二段失稳，整链失败，单段作业条数不增加 ——
test('戊：第二段 K=10、X=0.4 失稳，整链失败且不落任何记录', async () => {
  const jobsBefore = await jobCount();
  const chainsBefore = await chainCount();

  const res = await postChain({
    inflow: SHORT_TRIANGLE,
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 10, X: 0.4 }],
  });
  assert.equal(res.statusCode, 422);
  const err = res.json().error;
  assert.equal(err.type, 'UNSTABLE_NEGATIVE_OUTFLOW');
  assert.equal(err.details.segmentIndex, 1, '看得出是第二段（下标 1）失稳');
  assert.ok(err.message.includes('失稳'));

  assert.equal(await jobCount(), jobsBefore, '单段作业条数不得增加');
  assert.equal(await chainCount(), chainsBefore, '失败河链不落串联记录');
});

// —— 开演前拒绝：空链、缺段、段结构不合规 ——
test('空链、缺 segments、段不是对象，都在开演前拒绝', async () => {
  let res = await postChain({ inflow: [1, 2, 1], dt: 1, segments: [] });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'EMPTY_CHAIN');

  res = await postChain({ inflow: [1, 2, 1], dt: 1 });
  assert.equal(res.json().error.type, 'MISSING_FIELD');

  res = await postChain({ inflow: [1, 2, 1], dt: 1, segments: 'not-an-array' });
  assert.equal(res.json().error.type, 'INVALID_SEGMENTS');

  res = await postChain({ inflow: [1, 2, 1], dt: 1, segments: [42] });
  assert.equal(res.json().error.type, 'INVALID_SEGMENT');
  assert.equal(res.json().error.details.segmentIndex, 0);
});

test('某段只给 K 没给 X、档名与内联混用，都在开演前拒绝并指出第几段', async () => {
  let res = await postChain({
    inflow: [1, 2, 1],
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 2 }],
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'MISSING_FIELD');
  assert.equal(res.json().error.details.field, 'X');
  assert.equal(res.json().error.details.segmentIndex, 1);

  res = await postChain({
    inflow: [1, 2, 1],
    dt: 1,
    segments: [{ reachName: '某档', K: 2, X: 0.2 }],
  });
  assert.equal(res.json().error.type, 'CONFLICTING_PARAMETERS');
  assert.equal(res.json().error.details.segmentIndex, 0);
});

test('第二段点名不存在的档：整链当场拒绝，上游段不落成单段作业', async () => {
  const jobsBefore = await jobCount();
  const chainsBefore = await chainCount();

  const res = await postChain({
    inflow: TRIANGULAR_INFLOW,
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { reachName: '不存在的河段' }],
  });
  assert.equal(res.statusCode, 400);
  const err = res.json().error;
  assert.equal(err.type, 'UNKNOWN_REACH');
  assert.equal(err.details.segmentIndex, 1);

  assert.equal(await jobCount(), jobsBefore, '已算完的上游段不得落成单段作业');
  assert.equal(await chainCount(), chainsBefore);
});

test('区间入流少一个点、出现负值：开演前拒绝，错误类型与单段入流区分', async () => {
  const base = { inflow: Array(8).fill(8), dt: 1 };

  let res = await postChain({
    ...base,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, lateralInflow: Array(7).fill(2) }],
  });
  assert.equal(res.statusCode, 400);
  let err = res.json().error;
  assert.equal(err.type, 'LATERAL_INFLOW_LENGTH_MISMATCH');
  assert.notEqual(err.type, 'INFLOW_TOO_SHORT');
  assert.equal(err.details.segmentIndex, 1);
  assert.equal(err.details.expected, 8);
  assert.equal(err.details.actual, 7);

  res = await postChain({
    ...base,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, lateralInflow: [2, 2, -1, 2, 2, 2, 2, 2] }],
  });
  assert.equal(res.statusCode, 400);
  err = res.json().error;
  assert.equal(err.type, 'NEGATIVE_LATERAL_INFLOW');
  assert.notEqual(err.type, 'NEGATIVE_INFLOW');
  assert.equal(err.details.segmentIndex, 1);
  assert.equal(err.details.index, 2);

  res = await postChain({
    ...base,
    segments: [{ K: 2, X: 0.2, lateralInflow: Array(8).fill(1) }],
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.type, 'LATERAL_INFLOW_NOT_ALLOWED', '第一段没有汇入口');
});

// —— 档名解析与记录内容 ——
test('点名的段记下档名与档的 K、X；各段系数、峰现、洪量齐全', async () => {
  await app.inject({ method: 'POST', url: '/reaches', payload: { name: '河链-缓段', K: 3, X: 0.1 } });

  const res = await postChain({
    inflow: TRIANGULAR_INFLOW,
    dt: 1,
    segments: [{ reachName: '河链-缓段' }, { K: 2, X: 0.2, lateralInflow: Array(TRIANGULAR_INFLOW.length).fill(1) }],
  });
  assert.equal(res.statusCode, 201);
  const chain = res.json();

  assert.equal(chain.segments[0].reachName, '河链-缓段');
  assert.equal(chain.segments[0].K, 3);
  assert.equal(chain.segments[0].X, 0.1);
  assert.equal(chain.segments[1].reachName, null);

  for (const seg of chain.segments) {
    assert.ok(Math.abs(seg.coefficients.C0 + seg.coefficients.C1 + seg.coefficients.C2 - 1) <= 1e-9);
    assert.equal(seg.coefficients.sum, seg.coefficients.C0 + seg.coefficients.C1 + seg.coefficients.C2);
    assert.equal(seg.outflow.length, TRIANGULAR_INFLOW.length);
    assert.equal(seg.inflow.length, TRIANGULAR_INFLOW.length);
    assert.ok(Number.isInteger(seg.inflowPeakIndex));
    assert.ok(Number.isInteger(seg.outflowPeakIndex));
  }
  // 第二段实际入流 = 第一段出流 + 区间入流，逐点相加
  chain.segments[1].inflow.forEach((v, i) => {
    assert.ok(Math.abs(v - (chain.segments[0].outflow[i] + 1)) < 1e-12);
  });
  assert.deepEqual(chain.outlet, chain.segments[1].outflow, '出口过程即最后一段出流');
  assert.equal(chain.peakLagSteps, chain.outletPeakIndex - chain.inflowPeakIndex);
  assert.ok(chain.closureTolerance > 0);
});

test('第一段起始出流：给了就用，没给取上游入流首值；第二段起取实际入流首值', async () => {
  let res = await postChain({
    inflow: [5, 8, 5],
    dt: 1,
    initialOutflow: 6,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, lateralInflow: [1, 1, 1] }],
  });
  assert.equal(res.statusCode, 201);
  let chain = res.json();
  assert.equal(chain.initialOutflow, 6, '给了起始出流就用');
  assert.equal(chain.segments[0].initialOutflow, 6);
  assert.equal(chain.segments[0].outflow[0], 6);
  assert.equal(chain.segments[1].initialOutflow, chain.segments[1].inflow[0], '第二段取实际入流首值');
  assert.equal(chain.segments[1].initialOutflow, chain.segments[0].outflow[0] + 1);

  res = await postChain({ inflow: [5, 8, 5], dt: 1, segments: [{ K: 2, X: 0.2 }] });
  assert.equal(res.json().segments[0].initialOutflow, 5, '没给就取上游入流首值');
});

// —— 与单段作业的隔离 ——
test('河链记录不进单段列表，也不能用单段编号入口取出；单段编号、条数不动', async () => {
  const jobsBefore = (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs;

  const res = await postChain({
    inflow: Array(8).fill(8),
    dt: 1,
    segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }],
  });
  assert.equal(res.statusCode, 201);
  const chain = res.json();

  const jobsAfter = (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs;
  assert.equal(jobsAfter.length, jobsBefore.length, '单段列表条数不变');
  assert.ok(!jobsAfter.some((j) => j.id === chain.id), '河链编号不出现在单段列表');

  const viaJobs = await app.inject({ method: 'GET', url: `/jobs/${chain.id}` });
  assert.equal(viaJobs.statusCode, 404, '河链不能从单段入口取出');

  const viaChains = await app.inject({ method: 'GET', url: `/chains/${chain.id}` });
  assert.equal(viaChains.statusCode, 200);
  assert.deepEqual(viaChains.json(), chain, '按河链自己的编号取回整份记录');

  const list = await app.inject({ method: 'GET', url: '/chains' });
  const summary = list.json().chains.find((c) => c.id === chain.id);
  assert.ok(summary, '河链列表能列到这条链');
  assert.equal(summary.segmentCount, 2);

  const missing = await app.inject({ method: 'GET', url: '/chains/no-such-chain' });
  assert.equal(missing.statusCode, 404);
});

// —— 并发：两条河链同时提交，各段过程与落盘互不串号 ——
test('多条河链同时提交，结果与落盘互不串号', async () => {
  const N = 8;
  const payloads = Array.from({ length: N }, (_, i) => ({
    inflow: TRIANGULAR_INFLOW.map((v) => v * (i + 1)),
    dt: 1,
    segments: [
      { K: 2, X: 0.2 },
      { K: 3, X: 0.1, lateralInflow: Array(TRIANGULAR_INFLOW.length).fill(i + 1) },
    ],
  }));

  const responses = await Promise.all(payloads.map((p) => postChain(p)));
  const chains = responses.map((r) => {
    assert.equal(r.statusCode, 201);
    return r.json();
  });

  const ids = new Set(chains.map((c) => c.id));
  assert.equal(ids.size, N, '河链编号不得重复');

  await Promise.all(chains.map(async (chain, i) => {
    const got = (await app.inject({ method: 'GET', url: `/chains/${chain.id}` })).json();
    assert.deepEqual(got.inflow, payloads[i].inflow, `河链 ${i} 的上游入流串号`);
    assert.deepEqual(got.segments[0].outflow, chain.segments[0].outflow, `河链 ${i} 第一段出流串号`);
    assert.deepEqual(got.segments[1].lateralInflow, payloads[i].segments[1].lateralInflow, `河链 ${i} 区间入流串号`);
    assert.deepEqual(got.outlet, chain.outlet, `河链 ${i} 出口过程串号`);
    assert.ok(Math.abs(got.outletVolume - got.segments[1].outflowVolume) < 1e-9);
  }));
});

// —— 重启后河链记录仍在 ——
test('服务重启后河链记录仍在，且示范作业与单段条数不动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'muskingum-chain-'));
  const dbPath = join(dir, 'test.db');
  try {
    const app1 = buildApp({ dbPath });
    await app1.ready();
    const res = await app1.inject({
      method: 'POST',
      url: '/chains',
      payload: {
        inflow: TRIANGULAR_INFLOW,
        dt: 1,
        segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, lateralInflow: Array(TRIANGULAR_INFLOW.length).fill(0.5) }],
      },
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    await app1.close();

    const app2 = buildApp({ dbPath });
    await app2.ready();
    const got = await app2.inject({ method: 'GET', url: `/chains/${chain.id}` });
    assert.equal(got.statusCode, 200);
    assert.deepEqual(got.json(), chain, '重启后按编号取回同一份河链记录');

    const jobs = (await app2.inject({ method: 'GET', url: '/jobs' })).json().jobs;
    assert.equal(jobs.length, 1, '单段作业仍只有示范那一条');
    assert.equal(jobs[0].id, DEMO_JOB_ID);
    await app2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
