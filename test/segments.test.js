import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRange } from '../skill/drilldown/app/public/lib/segments.mjs';

test('1つの節の中', () => {
  assert.deepEqual(splitRange([5, 5], 1, 3), [{ index: 0, start: 1, end: 3 }]);
});
test('節をまたぐと節ごとに分かれる', () => {
  assert.deepEqual(splitRange([3, 2, 4], 2, 7), [
    { index: 0, start: 2, end: 3 },
    { index: 1, start: 0, end: 2 },
    { index: 2, start: 0, end: 2 },
  ]);
});
test('境界ちょうどは含めない・空の節は飛ばす', () => {
  assert.deepEqual(splitRange([3, 0, 3], 3, 6), [{ index: 2, start: 0, end: 3 }]);
});
test('範囲が空・範囲外なら空', () => {
  assert.deepEqual(splitRange([3], 2, 2), []);
  assert.deepEqual(splitRange([3], 5, 9), []);
});
