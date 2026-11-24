# 同梱ライブラリ

取り直す手順: `dev/fetch-vendor.sh`（npm の tarball から必要なファイルだけを取り出す）。ビルドはしない。

| ライブラリ | 版 | tarball 内のパス | 同梱ファイル | sha256 |
| --- | --- | --- | --- | --- |
| marked | 18.3.0 | `package/lib/marked.esm.js` | `marked.esm.js` | `4d2d824f3035e79b6887380d88c6c9ca0958215d1f4f6c053c562d60babc7172` |
| DOMPurify | 3.5.0 | `package/dist/purify.es.mjs` | `purify.es.mjs` | `5e8c53cd086a012531fc754ee6a7ad7a02e8a06fc4dadd805b912e128c3f6c58` |
| mermaid | 12.3.0 | `package/dist/mermaid.min.js` | `mermaid.min.js` | `336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3` |

- marked は ESM で `marked` を export する。
- DOMPurify は ESM で `DOMPurify` を default export する。
- mermaid は単一ファイルの通常スクリプトで、読み込むと `window.mermaid` を作る（`<script src>` で読む）。
- ライセンスは各 tarball の LICENSE をそのまま `LICENSE-marked` / `LICENSE-dompurify` / `LICENSE-mermaid` に置いた。
