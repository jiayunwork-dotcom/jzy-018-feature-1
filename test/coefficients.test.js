import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoefficients } from '../src/muskingum/coefficients.js';
import { COEFFICIENT_SUM_TOLERANCE } from '../src/config.js';

test('三联系数与手算值一致（K=2, X=0.2, dt=1）', () => {
  const { c0, c1, c2, denominator } = computeCoefficients(2, 0.2, 1);
  assert.equal(denominator, 2 * 2 * (1 - 0.2) + 1);
  assert.ok(Math.abs(c0 - 0.2 / 4.2) < 1e-15);
  assert.ok(Math.abs(c1 - 1.8 / 4.2) < 1e-15);
  assert.ok(Math.abs(c2 - 2.2 / 4.2) < 1e-15);
});

test('任意合法参数下 C0+C1+C2 之和为 1（钉死容差内）', () => {
  const cases = [
    [2, 0.2, 1], [1, 0, 1], [1, 0.5, 1], [10, 0.4, 8],
    [0.5, 0.1, 0.25], [100, 0.49, 3], [3, 0.3, 2],
  ];
  // 再加一批伪随机合法组合
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 200; i += 1) {
    cases.push([0.001 + rand() * 1000, rand() * 0.5, 0.001 + rand() * 1000]);
  }
  for (const [K, X, dt] of cases) {
    const { c0, c1, c2, sum } = computeCoefficients(K, X, dt);
    assert.ok(Math.abs(c0 + c1 + c2 - 1) <= COEFFICIENT_SUM_TOLERANCE, `K=${K} X=${X} dt=${dt}`);
    assert.ok(Math.abs(sum - 1) <= COEFFICIENT_SUM_TOLERANCE);
  }
});

test('分母无法安全相除时抛 DENOMINATOR_TOO_SMALL，不硬除出 Infinity/NaN', () => {
  assert.throws(
    () => computeCoefficients(1e308, 0.5, 1e308),
    (err) => err.type === 'DENOMINATOR_TOO_SMALL' && err.statusCode === 422,
  );
});
