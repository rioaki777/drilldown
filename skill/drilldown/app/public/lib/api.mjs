// 画面から本体の API を呼ぶ小さなクライアント。
// 全部に X-Drilldown-Token を付け、2xx 以外は本文の error を message にした Error を投げる。
export function createApi(token, fetchImpl = (...a) => globalThis.fetch(...a)) {
  async function call(method, path, body) {
    const headers = { 'X-Drilldown-Token': token };
    const init = { headers };
    if (method !== 'GET') init.method = method;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(path, init);
    } catch (e) {
      throw new Error(`通信に失敗しました：${e?.message ?? e}`);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      if (res.ok) throw new Error('サーバーの返事を読めませんでした');
      throw new Error(`サーバーがエラーを返しました（状態 ${res.status}）`);
    }
    if (!res.ok) throw new Error(data?.error || `サーバーがエラーを返しました（状態 ${res.status}）`);
    return data;
  }
  const id = encodeURIComponent;
  return {
    getDoc: () => call('GET', '/api/doc'),
    getState: () => call('GET', '/api/state'),
    ask: (body) => call('POST', '/api/ask', body),
    getTurn: (turnId) => call('GET', `/api/turn/${id(turnId)}`),
    putDecision: (decisionId, body) => call('PUT', `/api/decision/${id(decisionId)}`, body),
    putThread: (threadId, body) => call('PUT', `/api/thread/${id(threadId)}`, body),
    finish: (body) => call('POST', '/api/finish', body),
  };
}
