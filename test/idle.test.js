import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdleTimer } from '../skill/drilldown/app/lib/idle.js';
import { openCommand } from '../skill/drilldown/app/lib/open-browser.js';

const SIX_HOURS = 21600000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('6時間で onIdle', async () => {
  let t = 1000;
  let fired = 0;
  const timer = createIdleTimer({ ms: SIX_HOURS, isBusy: () => false, onIdle: () => { fired++; }, now: () => t, tickMs: 5 });
  await sleep(30);
  assert.equal(fired, 0);
  t += SIX_HOURS - 1;
  await sleep(30);
  assert.equal(fired, 0);
  t += 1;
  await sleep(30);
  assert.equal(fired, 1);
  await sleep(30);
  assert.equal(fired, 1, '一度だけ');
  timer.stop();
});

test('busy の間は数えない', async () => {
  let t = 0;
  let busy = true;
  let fired = 0;
  const timer = createIdleTimer({ ms: 1000, isBusy: () => busy, onIdle: () => { fired++; }, now: () => t, tickMs: 5 });
  t += 5000;
  await sleep(30);
  assert.equal(fired, 0, 'busy の間は最終操作時刻が今に寄る');
  busy = false;
  t += 999;
  await sleep(30);
  assert.equal(fired, 0);
  t += 1;
  await sleep(30);
  assert.equal(fired, 1);
  timer.stop();
});

test('touch で延びる', async () => {
  let t = 0;
  let fired = 0;
  const timer = createIdleTimer({ ms: 1000, isBusy: () => false, onIdle: () => { fired++; }, now: () => t, tickMs: 5 });
  t = 900;
  timer.touch();
  t = 1800;
  await sleep(30);
  assert.equal(fired, 0);
  t = 1900;
  await sleep(30);
  assert.equal(fired, 1);
  timer.stop();
});

test('stop したら onIdle は呼ばれない', async () => {
  let t = 0;
  let fired = 0;
  const timer = createIdleTimer({ ms: 10, isBusy: () => false, onIdle: () => { fired++; }, now: () => t, tickMs: 5 });
  timer.stop();
  t = 1000;
  await sleep(30);
  assert.equal(fired, 0);
});

test('openCommand はプラットフォームごと', () => {
  assert.deepEqual(openCommand('darwin', 'http://x'), { cmd: 'open', args: ['http://x'] });
  assert.deepEqual(openCommand('linux', 'http://x'), { cmd: 'xdg-open', args: ['http://x'] });
  assert.deepEqual(openCommand('win32', 'http://x'), { cmd: 'cmd', args: ['/c', 'start', '""', 'http://x'] });
});
