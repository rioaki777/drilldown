// 既定のブラウザで URL を開く。
import { spawn } from 'node:child_process';

export function openCommand(platform, url) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url] };
  return { cmd: 'xdg-open', args: [url] };
}

// 開けなくても例外にしない（失敗は onError に渡す）。
export function openBrowser(url, { platform = process.platform, onError = () => {} } = {}) {
  try {
    const { cmd, args } = openCommand(platform, url);
    // win32 では空の題名 "" を引用符つきのまま渡すため、引数を加工させない
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: platform === 'win32',
    });
    child.on('error', onError);
    child.unref();
  } catch (e) {
    onError(e);
  }
}
