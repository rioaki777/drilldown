// 利用者が終えたときに、このサーバーが作った分岐セッションを消す。
import fs from 'node:fs';
import { sessionFile } from './paths.js';

const ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

// 消した（実在していた）パスを返す。ID が不正なもの・メインのセッション・無いものは飛ばす。
export function deleteSessions({ homeDir, cwd, ids, mainSessionId, platform }) {
  // メインのセッションが分からないまま消すと、メインを消すおそれがある。分からなければ何も消さない。
  if (typeof mainSessionId !== 'string' || mainSessionId.trim() === '') {
    throw new Error('メインのセッション ID が分からないため、分岐のセッションは消しませんでした。');
  }
  const removed = [];
  const main = mainSessionId.toLowerCase();
  for (const id of new Set(Array.isArray(ids) ? ids : [])) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) continue;
    if (id.toLowerCase() === main) continue;
    const file = sessionFile(homeDir, cwd, id, platform);
    for (const target of [file, file.slice(0, -'.jsonl'.length)]) {
      try {
        fs.lstatSync(target);
      } catch {
        continue;
      }
      try {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(target);
      } catch {
        // 消せなかった（使用中など）ものは返さない
      }
    }
  }
  return removed;
}
