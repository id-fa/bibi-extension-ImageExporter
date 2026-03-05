# Bibi Extension: Page Exporter

Bibi ePub Readerのネイティブ拡張。ページ画像保存・見開き結合保存・PDF変換機能を提供する。

## ファイル構成
- `page-exporter.js` — 全機能を1ファイルに実装

## 拡張登録
`bibi/presets/default.js` の `extensions` 配列に登録:
```javascript
{ "src": "../extensions/bibi-extension-ImageExporter/page-exporter.js" }
```

## Bibi内部API

### グローバル変数
- `R` — Reader: `R.Items[]`, `R.Pages[]`, `R.Current`
- `B` — Book: `B.Package.Metadata`, `B.Title`, `B.PPD` (page-progression-direction)
- `S` — Settings
- `E` — Events: `E.add("bibi:opened", handler)`
- `H` — Helper: `H.PageObserver`
- `I` — Interface

### Itemオブジェクト (R.Items[])
- `item.HTML` — iframe内の `<html>` 要素 (iframe要素そのものではない)
- `item.Body` — iframe内の `<body>` 要素
- `item.contentDocument` — iframeのdocument
- `item.Box` — メインドキュメント内のiframeを包む `<div>` (overflow: hidden)
- `item.Pages[]` — このItemが占めるページ配列
- `item.Columned` — boolean: CSSマルチカラムレイアウトかどうか
- `item.PrePaginated` — boolean: 固定レイアウトかどうか

### ページ構造
- 1つのItemが複数ページにまたがることがある (リフロー型でテキストが多い場合)
- `allPages[]` は `{ item, page, pageInItem, globalIndex }` のフラット配列として構築

## ページキャプチャ方式

### 判定ロジック (`getPageDrawable`)
1. **画像直接取得**: `<img>` がbody面積の30%以上 → Canvas.drawImage で直接描画
2. **SVG image取得**: `<svg>` 内の `<image>` → href取得してImage経由で描画
3. **html2canvas**: 上記に該当しない場合 → `captureWithHtml2Canvas()`

### html2canvasキャプチャ (`captureWithHtml2Canvas`)

#### 重要: iframe内でロードする
html2canvasはメインドキュメントからクロスドキュメント(iframe)のDOMをキャプチャできない。
**必ずiframe内の `doc.defaultView` (iframeWin) にscriptタグでロードし、`iframeWin.html2canvas()` で呼ぶ。**

#### Bibiのbody背景オーバーライド
Bibiは `body.style.background = "transparent"` をインラインで設定する。
キャプチャ前に一時的に `body.style.background = ""` に戻し、キャプチャ後に復元する。
これをしないと背景が透明→JPEG変換で黒くなる。

#### 単一カラム (非Columned) のリフロー型
```javascript
iframeWin.html2canvas(body, { scale: 2, backgroundColor: "#ffffff" })
```
標準レンダラーで問題なくキャプチャできる。

#### マルチカラム (Columned) のリフロー型 — 最大の技術課題
**html2canvasの標準レンダラーはCSS `columns` を正しく描画できない。**
テキストが最初のカラム領域に全て詰め込まれ、レイアウトが崩壊する。

**解決策: `foreignObjectRendering: true` + カラムクロップ**
1. `foreignObjectRendering: true` を指定してレンダリング (ブラウザのネイティブSVG foreignObjectレンダリングを使用するため、CSS columnsを正しく処理できる)
2. 全カラムを含むフルキャンバスが生成される
3. 対象ページのカラム位置を計算してクロップ

```javascript
// vertical-rl の場合: カラムは縦方向に積まれる
yOffset = pageInItem * (columnWidth + columnGap)
// horizontal-tb の場合: カラムは横方向に積まれる
xOffset = pageInItem * (columnWidth + columnGap)
```

**試行して失敗したアプローチ:**
- `onclone` コールバックでのmargin操作 → CSS columnsは負マージンに反応しない
- Canvas y/height オプション → レンダリングではなく出力のクロップのみ
- フルレンダリング後の手動クロップ (標準レンダラー) → コンテンツが最初のカラムに集約されてしまう
- メインドキュメントから `item.Box` をキャプチャ → iframe内テキストが描画されない

**注意点:**
- `foreignObjectRendering` は `scale: 1` のみ対応 (scale: 2だとブラウザ制限に当たる可能性)
- `html` 要素をターゲットにする (`body` ではなく)
- カラム寸法は `getComputedStyle(html)` の `columnWidth` / `columnGap` から取得

### writing-mode対応
- `vertical-rl` (日本語縦書き): カラムが縦方向に積まれる → yOffsetでクロップ
- `horizontal-tb`: カラムが横方向に積まれる → xOffsetでクロップ

## PDF生成

### ライブラリ
- jsPDF **3.0.1** (CDN動的ロード)
- `hotfixes: ["px_scaling"]` が必要

### 透明テキストレイヤー
PDFの検索可能性のため、各ページに不可視テキストを埋め込む:
```javascript
doc.internal.write("3 Tr"); // PDF text rendering mode 3 = invisible
doc.setFontSize(1);
doc.text(text, 0, 10);
doc.internal.write("0 Tr"); // reset to fill mode
```
位置情報は無視し、ページ全体のテキストを1箇所にまとめて埋め込む。

### 綴じ方向
```javascript
doc.viewerPreferences({ Direction: 'R2L', PageLayout: 'TwoPageRight' })
```
- `Direction: 'R2L'` — 右から左への読み方向
- `PageLayout: 'TwoPageRight'` — 表紙単独表示、2ページ目以降見開き

### iOS対応
`navigator.share()` でファイル名付き共有シート表示。
非対応時は MIME を `application/octet-stream` に変更してダウンロード
(`application/pdf` だとSafariがインライン表示して `a.download` を無視する)。

## 見開き結合 (2P)
- R2L (右綴じ): `[次ページ | 現ページ]`
- L2R (左綴じ): `[現ページ | 次ページ]`
- 最終ページで次ページがない場合はNG表示

## UI

### コンパクトパネル (デスクトップ・モバイル共通)
ボタン行: `◀ [N/M] ▶ DL 2P All PDF R2L X`

- デスクトップ: `top: 44px, left: 10px` (Bibiメニューバーの下)
- モバイル: `bottom: max(50px, calc(10px + env(safe-area-inset-bottom, 40px)))` (iOS Safe Area対応)

### トグルボタン
- パネルClose後、Bibiメニューバーがhover状態のとき表示 (MutationObserverで監視)
- フェードイン/アウトアニメーション (opacity transition 0.15s)

### イベント伝播防止
パネルとトグルボタンで `mousedown/mouseup/touchstart/touchend/pointerdown/pointerup` を `stopPropagation`。
Bibiビューアがdocumentレベルでイベントをキャプチャしてページ送りが誤動作するのを防止。

### ページ追従
1秒ポーリング (`setInterval`) で `getCurrentPageIndex()` を監視。
`R.Current.Pages[0]` → `allPages` 内の対応エントリを検索。

## ファイル名規則
- 画像: `[著者名(15)] タイトル(40)_NN.jpg`
- 見開き: `[著者名(15)] タイトル(40)_NN-MM.jpg`
- PDF: `[著者名(15)] タイトル(40).pdf`
- 禁止文字 `\/:*?"<>|` はアンダースコアに置換

## 外部依存 (CDN動的ロード)
- html2canvas 1.4.1: `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`
- jsPDF 3.0.1: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.1/jspdf.umd.min.js`

