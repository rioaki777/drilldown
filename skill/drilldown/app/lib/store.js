import fs from 'node:fs';
import path from 'node:path';

const RESTART_ERROR = 'サーバーが再起動しました';

const freshState = () => ({ version: 1, nextId: 1, threads: {}, turns: {}, decisions: {}, createdSessionIds: [] });

export function createStore(dir) {
  const file = path.join(dir, 'state.json');
  const warnings = [];
  let state = freshState();

  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state.json がオブジェクトではありません');
      state = { ...freshState(), ...parsed };
    } catch (e) {
      const broken = `${file}.broken-${Date.now()}`;
      fs.renameSync(file, broken);
      warnings.push(`state.json を読み込めなかったため ${path.basename(broken)} に退避し、新規に開始します: ${e.message}`);
      state = freshState();
    }
  }

  for (const turn of Object.values(state.turns)) {
    if (turn.status === 'running') {
      turn.status = 'error';
      turn.error = RESTART_ERROR;
      turn.finishedAt = new Date().toISOString();
    }
  }

  return {
    state,
    warnings,
    newId(prefix) {
      return `${prefix}${state.nextId++}`;
    },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    },
    initDecisions(decisions) {
      for (const { id } of decisions) {
        if (!state.decisions[id]) state.decisions[id] = { status: '未決', judgement: '', reason: '', threadIds: [] };
      }
    },
  };
}
