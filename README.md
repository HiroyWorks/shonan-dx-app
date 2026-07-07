# Estimate management

個人事業主向けの見積管理・作成フロントエンドです。Vite + TypeScript + React で構成しています。

## 主な機能

- 見積明細の入力
- 品目マスタ選択による単価の自動反映
- 数量・単価変更時のリアルタイム集計
- 見積プレビュー表示
- PDF化 / 印刷
- 提出済み見積一覧
- 見積の提出、削除
- ステータス更新（返答待ち / 成約 / 請求済）
- 顧客やり取りメモの履歴管理
- localStorage による仮保存

## 開発コマンド

```bash
npm install
npm run dev
npm run lint
npm run build
```

## データ保存について

現在はDB接続前の仮実装として、提出済み見積・ステータス・顧客メモをブラウザの localStorage に保存しています。
DB化する場合は、`src/App.tsx` の `quotes` state 更新処理をAPI保存処理に置き換える想定です。

## 公開

GitHub Pages にデプロイします。`main` ブランチへ push すると `.github/workflows/deploy.yml` がビルドと公開を実行します。
