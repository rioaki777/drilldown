#!/usr/bin/env bash
# drilldown のインストーラ。skill/drilldown/ を ~/.claude/skills/drilldown にコピーする。
#   bash install.sh
# 消すのは ~/.claude/skills/drilldown だけ（すでに入っている同名のスキルは作り直される）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/skill/drilldown"

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  echo "エラー: HOME が空か「/」です。ホームフォルダが分からないので中止します。" >&2
  exit 1
fi
DEST="$HOME/.claude/skills/drilldown"

# 1. Node 18 以上
if ! command -v node >/dev/null 2>&1; then
  echo "エラー: node が見つかりません。Node.js 18 以上を入れてから、もう一度実行してください。" >&2
  exit 1
fi
NODE_VER="$(node -v)"
NODE_MAJOR="${NODE_VER#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt 18 ]; then
  echo "エラー: Node.js 18 以上が必要です（いまは ${NODE_VER}）。入れ直してから、もう一度実行してください。" >&2
  exit 1
fi

# 2. claude コマンド（なくてもコピーはする）
if ! command -v claude >/dev/null 2>&1; then
  echo "注意: claude コマンドが見つかりません。Claude Code を入れて、PATH が通っていることを確かめてください。" >&2
fi

# 3. コピー元の確認
if [ ! -f "$SRC/SKILL.md" ]; then
  echo "エラー: コピー元が見つかりません（${SRC}）。install.sh は、このリポジトリの直下から実行してください。" >&2
  exit 1
fi

# 4. 消してよい場所か確かめる（~/.claude/skills/drilldown 以外は消さない）
case "$DEST" in
  */.claude/skills/drilldown) ;;
  *)
    echo "エラー: コピー先が想定と違うので中止します（${DEST}）。" >&2
    exit 1
    ;;
esac
if [ -L "$DEST" ]; then
  # シンボリックリンクなら、リンク先ではなくリンクそのものを外す
  rm -f "$DEST"
fi
if [ -e "$DEST" ]; then
  REAL="$(cd "$DEST" && pwd -P)"
  case "$REAL" in
    */.claude/skills/drilldown) ;;
    *)
      echo "エラー: コピー先の実体が想定と違うので中止します（${REAL}）。" >&2
      exit 1
      ;;
  esac
fi

# 5. 作り直してコピー
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

echo "インストールしました: ${DEST}"
echo
echo "次のステップ"
echo "  1. Claude Code を開き直す（すでに開いているなら /clear か再起動）"
echo "  2. /drilldown と打つ（例: /drilldown このPRを理解したい）"
echo "  3. 画面が開いたら、わからない文を選んで質問する"
echo "  4. 終わったら画面で「閉じる」か「判断・指摘を持ち帰る」を押し、Claude Code で「終わった」と伝える"
echo
echo "Mac で動作を確かめる手順は dev/mac-check.md にあります。"
