// state から スレッドの木を作る。Node = {thread, turns, children}
const list = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
const cmp = (a, b) => {
  const x = a.createdAt;
  const y = b.createdAt;
  if (x === y) return 0;
  if (x === undefined || x === null) return 1;
  if (y === undefined || y === null) return -1;
  return x < y ? -1 : 1;
};

export function buildThreadTree(state) {
  const threads = list(state?.threads);
  const turnsById = new Map(list(state?.turns).map((t) => [t.id, t]));
  // 同じ createdAt なら元の並びを保つ（Array.prototype.sort は安定）
  const sorted = [...threads].sort(cmp);
  const nodes = new Map(
    sorted.map((thread) => [
      thread.id,
      { thread, turns: (thread.turnIds ?? []).map((id) => turnsById.get(id)).filter(Boolean), children: [] },
    ]),
  );
  const roots = [];
  for (const thread of sorted) {
    const node = nodes.get(thread.id);
    const parent = thread.parentThreadId != null && thread.parentThreadId !== thread.id ? nodes.get(thread.parentThreadId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // 親が無い・見つからないものは根
  }
  // 循環（互いが親）で根から辿れないものも落とさない
  const seen = new Set();
  const walk = (n) => {
    if (seen.has(n.thread.id)) return;
    seen.add(n.thread.id);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  for (const thread of sorted) {
    if (seen.has(thread.id)) continue;
    const node = nodes.get(thread.id);
    const p = nodes.get(thread.parentThreadId);
    if (p) p.children = p.children.filter((c) => c !== node);
    roots.push(node);
    walk(node);
  }
  return roots;
}

// まだ回答待ち（running）の回の ID。画面が見張りを付け直すのに使う。
export function runningTurnIds(state) {
  return list(state?.turns).filter((t) => t && t.status === 'running' && typeof t.id === 'string').map((t) => t.id);
}
