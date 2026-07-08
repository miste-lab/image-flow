# Image Flow — プロジェクト引き継ぎメモ

## これは何か
gpt-image-2 (OpenAIの画像生成モデル) をノードベースUIで操作するブラウザツール。
ComfyUI / Flora 系の「ノードを線でつないで実行する」体験を個人利用向けに再現したもの。
Claude.aiのチャットで設計〜v0.2まで開発し、ここ(Claude Code)に引き継いだ。

## ユーザーについて
- Windows使用。開発は初心者寄りなので、専門用語は噛み砕いて説明する
- 会話は日本語で行う
- UIは相談しながら細かく改修していきたい意向。変更→確認のループを短く保つこと

## 現在の構成 (v0.2 / GitHub Pages版)
- **完全静的**: Vite + React + @xyflow/react (React Flow v12)。サーバーなし
- ブラウザから直接 api.openai.com を叩く (src/api.js)
- APIキーはツールバー右上のKeyPanelで入力し、localStorageにのみ保存
- `base: "./"` 設定済みで GitHub Pages のサブパス配信に対応
- `.github/workflows/deploy.yml` で main への push 時に自動ビルド&デプロイ
- リポジトリはPublic前提(キーはコードに含まれない設計)

### 変更履歴(過去の構成)
- v0.1はExpressプロキシ+`.env`でキーを守るローカル構成だった
- ユーザーが「GitHubで管理して公開URLで確認したい・ローカル確認不要」と
  希望したため、BYOK(キーはユーザーのブラウザ内)の静的構成に移行した
- Expressに戻す場合の考慮は不要

## ノードの仕様
- **prompt** (PromptNode): テキスト入力。複数接続時は改行で結合される
- **imageInput** (ImageInputNode): ローカル画像をdataURLで保持
- **generate** (GenerateNode):
  - 入力エッジからプロンプト/画像を収集して生成
  - 画像入力あり → /v1/images/edits、なし → /v1/images/generations
  - 上流のgenerateノードのresultsも参照画像としてチェーン可能
  - アスペクト比13種 (RatioSelect.jsx。各値はgpt-image-2の制約
    「辺が16の倍数・最小総ピクセル」を満たすピクセル値にマップ済み)
  - 品質 auto/low/medium/high、枚数1〜4 (ステッパー)
  - 複数枚は2列グリッド表示、ホバーで個別保存ボタン
- **エッジ**: DeletableEdge。ホバーでハサミボタンが出現、クリックで切断

## デザイントークン (src/styles.css 冒頭)
- 暗色キャンバス #0b0e14 / ノード面 #141926 / アクセント青 #7aa2ff / 琥珀 #f0b35c
- UIテキストは日本語。トーンは簡潔・実務的
- 参考にしたのはユーザー提供のスクショ(Flora風の暗いノードエディタ)

## 未着手のアイデア(ユーザーと相談して優先度を決める)
- ノードの右クリックメニュー
- 生成履歴パネル
- キャンバスの保存/読込 (JSONエクスポート・localStorage自動保存)
- 生成コストの概算表示
- ドラッグでキャンバスに画像を直接ドロップしてimageInputノード化

## 運用ルール
- 変更したら動作確認のうえ main に push すれば、1〜2分でPagesに反映される
- コミットメッセージは日本語でよい
- gpt-image-2は透過背景非対応。生成は最大2分かかることがある点をUIで配慮済み
