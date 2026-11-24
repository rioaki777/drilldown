// コマンドライン引数の解釈。
// --dir（必須）、--session（任意）、--cwd（任意）だけを受け付ける。

function valueOf(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return undefined;
  return v;
}

export function parseArgs(argv) {
  const dir = valueOf(argv, '--dir');
  if (!dir) throw new Error('--dir が必要です');

  let session = valueOf(argv, '--session');
  // 空文字、またはスキルの置換が行われず ${CLAUDE_SESSION_ID} のまま渡された場合は「未指定」とみなす。
  if (!session || session === '${CLAUDE_SESSION_ID}') session = null;

  const cwd = valueOf(argv, '--cwd') || process.cwd();

  return { dir, session, cwd };
}
