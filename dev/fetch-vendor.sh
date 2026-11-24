#!/usr/bin/env bash
# 画面用ライブラリ（marked / DOMPurify / mermaid）を npm の tarball から取り直す。
# 取ったものは信頼しないデータとして扱う：展開するだけで、中のスクリプトは実行しない。
# npm install はしない（npm pack でtarballを取るだけ）。
set -euo pipefail

MARKED_VER=18.3.0
PURIFY_VER=3.5.0
MERMAID_VER=12.3.0

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/skill/drilldown/app/public/vendor"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/drilldown-vendor.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fetch() { # name version
  local name="$1" ver="$2" tgz
  mkdir -p "$WORK/$name"
  # 作業用フォルダの中で pack する（カレントはそのフォルダ）
  tgz="$(cd "$WORK/$name" && npm pack "$name@$ver" --silent --ignore-scripts | tail -n 1)"
  tar -xzf "$WORK/$name/$tgz" -C "$WORK/$name"
}

fetch marked "$MARKED_VER"
fetch dompurify "$PURIFY_VER"
fetch mermaid "$MERMAID_VER"

mkdir -p "$DEST"
cp "$WORK/marked/package/lib/marked.esm.js"      "$DEST/marked.esm.js"
cp "$WORK/marked/package/LICENSE"             "$DEST/LICENSE-marked"
cp "$WORK/dompurify/package/dist/purify.es.mjs"  "$DEST/purify.es.mjs"
cp "$WORK/dompurify/package/LICENSE"             "$DEST/LICENSE-dompurify"
cp "$WORK/mermaid/package/dist/mermaid.min.js"   "$DEST/mermaid.min.js"
cp "$WORK/mermaid/package/LICENSE"               "$DEST/LICENSE-mermaid"

echo "vendor/ を更新しました: $DEST"
echo "VERSIONS.md の sha256 を確かめてください。"
