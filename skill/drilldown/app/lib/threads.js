// スレッドとセッションの木。
// 新しいスレッドはメインのセッションから fork し、続きの質問は同じ fork に積み、
// 子スレッドは親スレッドの最新セッションから fork する。
import crypto from 'node:crypto';
import { buildPrompt } from './prompts.js';
import { buildClaudeArgs, runClaude, ClaudeError } from './claude.js';

const RUN_ACTIONS = ['question', 'detail', 'term', 'diagram'];

export function createThreadManager({
  store, run = runClaude, bin, mainSessionId, cwd, timeoutMs,
  uuid = () => crypto.randomUUID(), useSessionId = true,
}) {
  const { state } = store;
  // リクエスト由来の ID は自前のキーだけを引く（__proto__ や constructor を引かない）
  const own = (obj, key) => (typeof key === 'string' && Object.hasOwn(obj, key) ? obj[key] : undefined);
  const chains = new Map(); // threadId -> そのスレッドの最後の回が終わると解決する Promise（失敗しない）
  const pending = new Set(); // 終わっていない回の Promise
  const controllers = new Set();
  const errors = []; // 保存の失敗など、回の結果に載せられない内部エラー（標準出力には出さない）

  const now = () => new Date().toISOString();
  const noteSession = (id) => {
    if (id && id !== mainSessionId && !state.createdSessionIds.includes(id)) state.createdSessionIds.push(id);
  };

  async function execute(turn, thread, quote, signal, parentGate) {
    try {
      // fork するとき（自分のセッションがまだ無いとき）だけ、親の未完了の回を待つ
      const fork = !thread.sessionId;
      if (fork) await parentGate;
      if (signal.aborted) throw new ClaudeError('aborted', '処理が中断されました。');
      let resumeId = thread.sessionId;
      let newSessionId;
      if (fork) {
        const parent = thread.parentThreadId ? own(state.threads, thread.parentThreadId) : null;
        resumeId = parent?.sessionId || mainSessionId;
        if (useSessionId) {
          newSessionId = uuid();
          // 実行前に記録する（途中で落ちても消し忘れない）
          noteSession(newSessionId);
          store.save();
        }
      }
      const args = buildClaudeArgs({ resumeId, fork, newSessionId, effort: true });
      const stdin = buildPrompt(turn.action, quote, turn.question);
      const { result, sessionId } = await run({ bin, args, stdin, cwd, timeoutMs, signal });
      thread.sessionId = sessionId;
      noteSession(sessionId);
      turn.status = 'done';
      turn.answerMd = result;
    } catch (e) {
      turn.status = 'error';
      turn.error = e instanceof Error ? e.message : String(e);
    }
    turn.finishedAt = now();
    try {
      store.save();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function ask({ threadId, parentThreadId, parentTurnId, quote, action, question } = {}) {
    if (action !== 'memo' && !RUN_ACTIONS.includes(action)) throw new Error(`知らない操作です：${action}`);
    const userText = typeof question === 'string' ? question : '';
    if (action === 'question' && !userText.trim()) throw new Error('質問が空です。');
    if (action === 'memo' && !userText.trim()) throw new Error('メモが空です。');

    let thread;
    if (threadId) {
      thread = own(state.threads, threadId);
      if (!thread) throw new Error(`スレッドが見つかりません：${threadId}`);
    } else if (parentThreadId) {
      const parent = own(state.threads, parentThreadId);
      if (!parent) throw new Error(`親のスレッドが見つかりません：${parentThreadId}`);
      if (parentTurnId && own(state.turns, parentTurnId)?.threadId !== parentThreadId) {
        throw new Error(`親のスレッドに該当する回がありません：${parentTurnId}`);
      }
    }

    // 続きの質問（threadId あり）は引用を省けて、そのスレッドの引用を使う。新しいスレッドは引用が必須。
    const hasQuote = typeof quote === 'string' && quote.trim() !== '';
    if (!thread && !hasQuote) throw new Error('引用する文が空です。');
    const usedQuote = hasQuote ? quote : thread.quote;

    if (!thread) {
      const id = store.newId('t');
      thread = {
        id,
        parentThreadId: parentThreadId || null,
        parentTurnId: parentThreadId ? (parentTurnId || null) : null,
        quote,
        sessionId: null,
        carryBack: false,
        note: '',
        decisionIds: [],
        turnIds: [],
        createdAt: now(),
      };
      state.threads[id] = thread;
    }

    const turn = {
      id: store.newId('u'),
      threadId: thread.id,
      action,
      quote: usedQuote,
      question: action === 'question' || action === 'memo' ? userText : '',
      status: action === 'memo' ? 'done' : 'running',
      answerMd: null,
      error: null,
      startedAt: now(),
      finishedAt: action === 'memo' ? now() : null,
    };
    state.turns[turn.id] = turn;
    thread.turnIds.push(turn.id);
    store.save();

    if (action === 'memo') return { threadId: thread.id, turnId: turn.id };

    // 親の未完了の回が終わるのを待つ（親の最後の回を、いま捕まえておく）
    const parentGate = thread.parentThreadId ? chains.get(thread.parentThreadId) : undefined;
    const controller = new AbortController();
    controllers.add(controller);
    const tail = (chains.get(thread.id) ?? Promise.resolve()).catch(() => {});
    const p = tail.then(() => execute(turn, thread, usedQuote, controller.signal, parentGate)).finally(() => {
      controllers.delete(controller);
      pending.delete(p);
    });
    chains.set(thread.id, p);
    pending.add(p);
    return { threadId: thread.id, turnId: turn.id };
  }

  return {
    ask,
    errors,
    getTurn: (turnId) => own(state.turns, turnId),
    isBusy: () => pending.size > 0,
    abortAll() {
      for (const c of controllers) c.abort();
    },
    async idle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
