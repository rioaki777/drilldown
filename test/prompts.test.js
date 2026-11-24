import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_APPEND, ACTION_PROMPTS, buildPrompt } from '../skill/drilldown/app/lib/prompts.js';
import { buildClaudeArgs, resolveClaudeBin } from '../skill/drilldown/app/lib/claude.js';

test('プロンプトは引用になる', () => assert.match(buildPrompt('term', 'A\nB'), /> A\n> B/));
test('memo は claude を呼ばない', () => assert.throws(() => buildPrompt('memo', 'x')));
test('未知の action はエラー', () => assert.throws(() => buildPrompt('nope', 'x')));
test('question は質問文がそのまま入る', () => {
  const p = buildPrompt('question', '引用', 'なぜ $& ですか？');
  assert.equal(p, '解説のこの部分について質問です。\n> 引用\n\nなぜ $& ですか？');
});
test('detail・term・diagram の文言', () => {
  assert.equal(buildPrompt('detail', 'x'), '解説のこの部分を、もう一段詳しく説明してください。前提・仕組み・具体例の順で。\n> x');
  assert.equal(buildPrompt('diagram', 'x'), 'この部分を mermaid の図1つで説明し、図の読み方を2〜3文で添えてください。\n> x');
  assert.equal(buildPrompt('term', 'x'), 'この部分に出てくる用語を、この文書の文脈での意味で短く説明してください。\n> x');
});
test('ACTION_PROMPTS は4つ、SYSTEM_APPEND は日本語', () => {
  assert.deepEqual(Object.keys(ACTION_PROMPTS).sort(), ['detail', 'diagram', 'question', 'term']);
  assert.match(SYSTEM_APPEND, /分岐して質問に答える/);
  assert.match(SYSTEM_APPEND, /解説の訂正/);
});

test('新しいスレッドの引数', () => {
  const a = buildClaudeArgs({ resumeId: 'M', fork: true, newSessionId: 'N' });
  assert.deepEqual(a.slice(0, 6), ['-p', '--resume', 'M', '--fork-session', '--session-id', 'N']);
  assert.ok(a.includes('--permission-mode') && a[a.indexOf('--permission-mode') + 1] === 'default');
  assert.ok(!a.includes('--strict-mcp-config'));
  const i = a.indexOf('--disallowedTools');
  assert.deepEqual(a.slice(i, i + 4), ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit']);
  assert.equal(a[a.indexOf('--append-system-prompt') + 1], SYSTEM_APPEND);
  assert.deepEqual(a.slice(a.indexOf('--output-format'), a.indexOf('--output-format') + 2), ['--output-format', 'json']);
});
test('続けて質問は fork しない', () => {
  const a = buildClaudeArgs({ resumeId: 'S', fork: false });
  assert.ok(!a.includes('--fork-session'));
  assert.ok(!a.includes('--session-id'));
  assert.ok(!a.includes('--effort'));
});
test('effort を付ける', () => {
  const a = buildClaudeArgs({ resumeId: 'S', fork: false, effort: true });
  assert.deepEqual(a.slice(-2), ['--effort', 'low']);
});

test('resolveClaudeBin', () => {
  assert.deepEqual(resolveClaudeBin({}), { cmd: 'claude', prefixArgs: [] });
  assert.deepEqual(resolveClaudeBin({ DRILLDOWN_CLAUDE_BIN: '/x/claude2' }), { cmd: '/x/claude2', prefixArgs: [] });
  assert.deepEqual(resolveClaudeBin({ DRILLDOWN_CLAUDE_BIN: '/x/mock.js' }), { cmd: process.execPath, prefixArgs: ['/x/mock.js'] });
});
