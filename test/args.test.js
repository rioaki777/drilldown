import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../skill/drilldown/app/lib/args.js';

test('展開されなかった session は null', () => assert.equal(parseArgs(['--dir', '/t', '--session', '${CLAUDE_SESSION_ID}']).session, null));
test('--dir が無いと例外', () => assert.throws(() => parseArgs([]), /--dir/));
test('--dir が無いときのメッセージは日本語', () => assert.throws(() => parseArgs([]), { message: '--dir が必要です' }));
test('--dir の値が無くても例外', () => assert.throws(() => parseArgs(['--dir']), /--dir/));
test('session 未指定は null', () => assert.equal(parseArgs(['--dir', '/t']).session, null));
test('session 空文字は null', () => assert.equal(parseArgs(['--dir', '/t', '--session', '']).session, null));
test('session はそのまま返る', () => assert.equal(parseArgs(['--dir', '/t', '--session', 'abc-123']).session, 'abc-123'));
test('--cwd 未指定は process.cwd()', () => assert.equal(parseArgs(['--dir', '/t']).cwd, process.cwd()));
test('--cwd 指定', () => {
  const r = parseArgs(['--dir', '/t', '--cwd', '/w']);
  assert.deepEqual(r, { dir: '/t', session: null, cwd: '/w' });
});
