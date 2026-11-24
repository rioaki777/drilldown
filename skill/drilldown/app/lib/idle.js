// 放置による自動終了のタイマー。tickMs ごとに確かめ、isBusy() の間は最終操作時刻を今に寄せる。
export function createIdleTimer({ ms, isBusy, onIdle, now = Date.now, tickMs = 60000 }) {
  let last = now();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    if (isBusy()) {
      last = now();
      return;
    }
    if (now() - last >= ms) {
      stopped = true;
      clearInterval(timer);
      onIdle();
    }
  }, tickMs);
  timer.unref();
  return {
    touch() {
      last = now();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
