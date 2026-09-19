import { test, before, after, describe } from 'node:test';
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
const jobCount = async () => (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs.length;
const chainCount = async () => (await app.inject({ method: 'GET', url: '/chains' })).json().chains.length;

const CONST_EIGHT = Array(8).fill(8);
const EPS = 1e-9;

describe('对账五组（甲–戊）', () => {
  test('甲：常数入流 8 过两段（K=2,X=0.2，无区间），出口八个点仍全是 8', async () => {
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }],
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    assert.equal(chain.segments.length, 2);
    assert.equal(chain.outflow.length, 8);
    chain.outflow.forEach((v, i) => {
      assert.ok(Math.abs(v - 8) < EPS, `出口第 ${i} 点 ${v} 偏离 8`);
    });
    // 各段出流也都是 8
    for (const seg of chain.segments) {
      seg.outflow.forEach((v) => assert.ok(Math.abs(v - 8) < EPS));
    }
    assert.ok(Math.abs(chain.volumeDifference) <= chain.closureTolerance, '甲应闭合');
  });

  test('乙：第二段汇入口加全 2 的区间入流，出口全是 10 且洪量对得上', async () => {
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [
        { K: 2, X: 0.2 },
        { K: 2, X: 0.2, localInflow: Array(8).fill(2) },
      ],
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    chain.outflow.forEach((v, i) => {
      assert.ok(Math.abs(v - 10) < EPS, `出口第 ${i} 点 ${v} 偏离 10`);
    });
    // 第二段真正吃到的入流 = 第一段出流(8) + 区间(2) = 10
    chain.segments[1].inflow.forEach((v) => assert.ok(Math.abs(v - 10) < EPS));
    assert.equal(chain.inflowVolume, 64, '上游洪量 8×8');
    assert.deepEqual(chain.localInflowVolumes, [0, 16], '第一段无汇入口，第二段区间洪量 2×8');
    assert.ok(Math.abs(chain.outflowVolume - 80) < EPS, '出口洪量 10×8');
    assert.ok(
      Math.abs(chain.volumeDifference) <= chain.closureTolerance,
      '出口洪量 = 上游洪量 + 区间洪量，差落在容差内',
    );
  });

  test('丙：示范同款三角入流作唯一一段，出流/峰现/洪量与示范作业逐项一致', async () => {
    const demo = (await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` })).json();

    const res = await postChain({
      inflow: TRIANGULAR_INFLOW,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }],
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    assert.equal(chain.segments.length, 1);
    const seg = chain.segments[0];

    assert.deepEqual(chain.inflow, demo.inflow);
    assert.deepEqual(seg.outflow, demo.outflow, '单段河链出流必须与示范作业逐点相同');
    assert.deepEqual(chain.outflow, demo.outflow);
    assert.equal(seg.inflowPeakIndex, demo.inflowPeakIndex);
    assert.equal(seg.outflowPeakIndex, demo.outflowPeakIndex);
    assert.equal(chain.outflowPeakIndex, demo.outflowPeakIndex);
    assert.equal(seg.inflowVolume, demo.inflowVolume);
    assert.ok(Math.abs(seg.outflowVolume - demo.outflowVolume) < EPS);
    assert.deepEqual(seg.coefficients, demo.coefficients);
  });

  test('丁：两段串联，第一段与示范一致，第二段等于把第一段出流再交单段入口', async () => {
    const demo = (await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` })).json();

    const res = await postChain({
      inflow: TRIANGULAR_INFLOW,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }],
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    const [seg1, seg2] = chain.segments;

    // 第一段与示范一致
    assert.deepEqual(seg1.outflow, demo.outflow);
    assert.equal(seg1.outflowPeakIndex, demo.outflowPeakIndex);

    // 把第一段出流拿到现有单段入口再演一次
    const singleRes = await postJob({ inflow: seg1.outflow, dt: 1, K: 2, X: 0.2 });
    assert.equal(singleRes.statusCode, 201);
    const single = singleRes.json();
    assert.deepEqual(seg2.outflow, single.outflow, '第二段出流必须与单段入口复算结果逐点相同');

    // 出口峰比第一段出流峰更矮，峰现不得早于第一段出流峰
    assert.ok(
      Math.max(...chain.outflow) < Math.max(...seg1.outflow),
      '再走一段削峰应更明显',
    );
    assert.ok(seg2.outflowPeakIndex >= seg1.outflowPeakIndex, '第二段峰现不得早于第一段出流峰');

    // 整链按「上游洪量对出口洪量」闭合
    assert.ok(Math.abs(chain.volumeDifference) <= chain.closureTolerance);
    assert.ok(Math.abs(chain.inflowVolume - demo.inflowVolume) < EPS);
  });

  test('戊：第二段 K=10,X=0.4 失稳，整链失败且指出是第二段，单段作业条数不增加', async () => {
    const before = await jobCount();
    const chainsBefore = await chainCount();

    const res = await postChain({
      inflow: SHORT_TRIANGLE,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { K: 10, X: 0.4 }],
    });
    assert.equal(res.statusCode, 422);
    const err = res.json().error;
    assert.equal(err.type, 'CHAIN_SEGMENT_FAILED');
    assert.equal(err.details.segment, 2, '必须看出是第二段失稳');
    assert.equal(err.details.reason, 'UNSTABLE_NEGATIVE_OUTFLOW');
    assert.ok(/第 2 段/.test(err.message));

    assert.equal(await jobCount(), before, '失败不得在单段作业表落下任何东西');
    assert.equal(await chainCount(), chainsBefore, '失败河链不得落河链记录');
  });
});

describe('开演前拒绝（不算任何一段，不留下记录）', () => {
  test('空链（缺 segments 与空数组）都被拒', async () => {
    for (const payload of [
      { inflow: [1, 2, 1], dt: 1 },
      { inflow: [1, 2, 1], dt: 1, segments: [] },
      { inflow: [1, 2, 1], dt: 1, segments: null },
    ]) {
      const res = await postChain(payload);
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.type, 'CHAIN_NO_SEGMENTS');
    }
  });

  test('某段只给 K 没给 X：拒绝并指出第几段', async () => {
    const res = await postChain({
      inflow: [1, 2, 1],
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { K: 2 }],
    });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.type, 'MISSING_FIELD');
    assert.equal(err.details.segment, 2);
    assert.equal(err.details.field, 'X');
  });

  test('同一段点名与内联 K/X 同时出现：拒绝并指出第几段', async () => {
    const res = await postChain({
      inflow: [1, 2, 1],
      dt: 1,
      segments: [{ K: 2, X: 0.2, reachName: '随便', localInflow: null }],
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.type, 'CONFLICTING_PARAMETERS');
    assert.equal(res.json().error.details.segment, 1);
  });

  test('第二段点名不存在的档：开演前拒绝，指出第二段，不先落成第一段', async () => {
    const jobsBefore = await jobCount();
    const chainsBefore = await chainCount();
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { reachName: '从没登记过的中游段' }],
    });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.type, 'UNKNOWN_REACH');
    assert.equal(err.details.segment, 2);
    assert.equal(await jobCount(), jobsBefore, '已算完的第一段不得落成成功的单段作业');
    assert.equal(await chainCount(), chainsBefore);
  });

  test('区间入流少一个点：类型区别于 INFLOW_TOO_SHORT，标明汇入口段号', async () => {
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [
        { K: 2, X: 0.2 },
        { K: 2, X: 0.2, localInflow: Array(7).fill(1) },
      ],
    });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.type, 'LOCAL_INFLOW_LENGTH_MISMATCH');
    assert.notEqual(err.type, 'INFLOW_TOO_SHORT');
    assert.equal(err.details.segment, 2);
    assert.equal(err.details.expectedLength, 8);
    assert.equal(err.details.actualLength, 7);
  });

  test('区间入流出现负数：类型区别于 NEGATIVE_INFLOW，标明汇入口段号与下标', async () => {
    const local = Array(8).fill(1);
    local[3] = -0.5;
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2, localInflow: local }],
    });
    assert.equal(res.statusCode, 400);
    const err = res.json().error;
    assert.equal(err.type, 'LOCAL_INFLOW_NEGATIVE');
    assert.notEqual(err.type, 'NEGATIVE_INFLOW');
    assert.equal(err.details.segment, 2);
    assert.equal(err.details.index, 3);
  });

  test('第一段带区间入流：拒绝（最上游段没有汇入口）', async () => {
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [{ K: 2, X: 0.2, localInflow: Array(8).fill(0) }],
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.type, 'LOCAL_INFLOW_ON_FIRST_SEGMENT');
    assert.equal(res.json().error.details.segment, 1);
  });

  test('上游入流仍走单段同一套：太短/为负被原有类型拒绝', async () => {
    const tooShort = await postChain({ inflow: [5], dt: 1, segments: [{ K: 2, X: 0.2 }] });
    assert.equal(tooShort.statusCode, 400);
    assert.equal(tooShort.json().error.type, 'INFLOW_TOO_SHORT');

    const neg = await postChain({ inflow: [3, -1, 2], dt: 1, segments: [{ K: 2, X: 0.2 }] });
    assert.equal(neg.statusCode, 400);
    assert.equal(neg.json().error.type, 'NEGATIVE_INFLOW');
  });
});

describe('记录、隔离与持久化', () => {
  test('河链成功落一条自己的记录，编号可取回整份；记录字段齐全', async () => {
    // 先登记一个档，让第一段点名
    await app.inject({ method: 'POST', url: '/reaches', payload: { name: '链用-上游档', K: 2, X: 0.2 } });
    const res = await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [
        { reachName: '链用-上游档' },
        { K: 2, X: 0.2, localInflow: Array(8).fill(2) },
      ],
    });
    assert.equal(res.statusCode, 201);
    const chain = res.json();
    assert.equal(chain.kind, 'chain');
    assert.ok(typeof chain.id === 'string' && chain.id.length > 0);

    const gotRes = await app.inject({ method: 'GET', url: `/chains/${chain.id}` });
    assert.equal(gotRes.statusCode, 200);
    const got = gotRes.json();
    assert.deepEqual(got, chain);

    // 字段齐全：各段实际 K/X（点名的记档名）、三联系数、全过程、峰下标
    assert.equal(got.segments[0].reachName, '链用-上游档');
    assert.equal(got.segments[0].K, 2);
    assert.equal(got.segments[0].X, 0.2);
    assert.equal(got.segments[1].reachName, null);
    for (const seg of got.segments) {
      assert.ok(Math.abs(seg.coefficients.C0 + seg.coefficients.C1 + seg.coefficients.C2 - 1) <= 1e-9);
      assert.equal(seg.outflow.length, 8);
      assert.equal(seg.inflow.length, 8);
      assert.ok(typeof seg.inflowPeakIndex === 'number');
      assert.ok(typeof seg.outflowPeakIndex === 'number');
    }
    // 出口、滞后、洪量、对账、容差
    assert.equal(got.outflow.length, 8);
    assert.equal(got.peakLagSteps, got.outflowPeakIndex - got.inflowPeakIndex);
    assert.ok(Math.abs(got.inflowVolume - 64) < EPS);
    assert.deepEqual(got.localInflowVolumes, [0, 16]);
    assert.ok(Math.abs(got.outflowVolume - 80) < EPS);
    assert.ok(Math.abs(got.volumeDifference) <= got.closureTolerance);
    assert.ok(got.closureTolerance > 0);
  });

  test('河链记录不出现在单段作业列表里，也不能用单段编号取出', async () => {
    const chain = (await postChain({
      inflow: CONST_EIGHT,
      dt: 1,
      segments: [{ K: 2, X: 0.2 }],
    })).json();

    const jobs = (await app.inject({ method: 'GET', url: '/jobs' })).json().jobs;
    assert.ok(!jobs.some((j) => j.id === chain.id), '河链不得混进单段作业列表');

    const asJob = await app.inject({ method: 'GET', url: `/jobs/${chain.id}` });
    assert.equal(asJob.statusCode, 404, '单段入口不能把河链当单段取出');
    assert.equal(asJob.json().error.type, 'NOT_FOUND');
  });

  test('河链失败/成功都不动既有单段作业：示范作业仍在，条数与内容不变', async () => {
    const demoBefore = (await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` })).json();
    const before = await jobCount();

    // 一次失败（戊同款）加一次成功
    await postChain({ inflow: SHORT_TRIANGLE, dt: 1, segments: [{ K: 2, X: 0.2 }, { K: 10, X: 0.4 }] });
    await postChain({ inflow: CONST_EIGHT, dt: 1, segments: [{ K: 2, X: 0.2 }] });

    assert.equal(await jobCount(), before, '单段作业条数不变（含示范那条）');
    const demoAfter = (await app.inject({ method: 'GET', url: `/jobs/${DEMO_JOB_ID}` })).json();
    assert.deepEqual(demoAfter, demoBefore, '示范作业内容不变');
  });

  test('取不存在的河链：404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/chains/no-such-chain' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.type, 'NOT_FOUND');
  });

  test('服务重启后河链记录仍在（进程内 SQLite 落盘）', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'muskingum-chain-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'chain.db');

    const appA = buildApp({ dbPath });
    await appA.ready();
    const created = (await appA.inject({
      method: 'POST',
      url: '/chains',
      payload: { inflow: CONST_EIGHT, dt: 1, segments: [{ K: 2, X: 0.2 }, { K: 2, X: 0.2 }] },
    })).json();
    await appA.close();

    const appB = buildApp({ dbPath });
    await appB.ready();
    const got = (await appB.inject({ method: 'GET', url: `/chains/${created.id}` })).json();
    assert.equal(got.id, created.id);
    assert.equal(got.segments.length, 2);
    assert.deepEqual(got.outflow, created.outflow);
    await appB.close();
  });

  test('两条不同河链并发提交：各段过程、系数互不串号', async () => {
    const N = 10;
    const payloads = Array.from({ length: N }, (_, i) => ({
      inflow: TRIANGULAR_INFLOW.map((v) => v * (i + 1)),
      dt: 1,
      segments: [
        { K: 2, X: 0.2 },
        { K: 3, X: 0.1, localInflow: TRIANGULAR_INFLOW.map((v) => v * (i + 1) * 0.5) },
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
      assert.deepEqual(got.inflow, payloads[i].inflow, `河链 ${i} 上游入流串号`);
      assert.deepEqual(got.segments[1].localInflow, payloads[i].segments[1].localInflow, `河链 ${i} 区间入流串号`);
      assert.deepEqual(got.segments[0].outflow, chain.segments[0].outflow, `河链 ${i} 第一段出流串号`);
      assert.deepEqual(got.outflow, chain.outflow, `河链 ${i} 出口出流串号`);
      assert.equal(got.segments[0].K, 2);
      assert.equal(got.segments[1].K, 3);
      assert.equal(got.segments[1].X, 0.1);
    }));
  });
});
