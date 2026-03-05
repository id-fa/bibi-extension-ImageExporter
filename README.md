# Bibi Extension: Page Exporter

An extension for [Bibi](https://bibi.epub.link/) EPUB Reader.
Export pages as images (single / spread) or PDF.

[Bibi](https://bibi.epub.link/) ePub Reader用の拡張機能です。
ページ画像の保存・見開き結合保存・PDF変換機能を提供します。

[DEMO](https://id-fa.github.io/bibi-extension-ImageExporter/DEMO/)

## Features / 機能

- **Single page download** — Save the current page as JPEG / 現在のページをJPEGで保存
- **Spread (2P) download** — Combine two pages side-by-side and save / 見開き2ページを結合して保存
- **Download all** — Save all pages sequentially / 全ページを連続保存
- **PDF export** — Generate a single PDF with invisible text layer for searchability / 透明テキストレイヤー付きPDFを生成（テキスト検索可能）
- **R2L / L2R toggle** — Switch binding direction / 綴じ方向の切り替え

## Installation / インストール

### English

Register the extension in `bibi/presets/default.js` by adding it to the `extensions` array:

```javascript
{
  "extensions": [
    { "src": "../extensions/bibi-extension-ImageExporter/page-exporter.js" }
  ]
}
```

### 日本語

`bibi/presets/default.js` の `extensions` 配列に登録してください:

```javascript
{
  "extensions": [
    { "src": "../extensions/bibi-extension-ImageExporter/page-exporter.js" }
  ]
}
```

## External Dependencies / 外部依存

Loaded dynamically from CDN at runtime (no manual installation required):

実行時にCDNから動的にロードされます（手動インストール不要）:

- [html2canvas](https://html2canvas.hertzen.com/) 1.4.1
- [jsPDF](https://github.com/parallax/jsPDF) 3.0.1

## License

See [LICENSE](LICENSE).
