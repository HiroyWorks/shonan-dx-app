# Estimate management

個人事業主・小規模法人向けの見積管理フロントエンドです。Vite + TypeScript + React で構成しています。

## 実装済み機能

- 顧客マスタの追加・編集・削除
- 品目マスタの追加・編集・削除
- 見積の提出、編集、複製、削除
- 見積番号ルール、消費税率、Free/Proプラン設定
- 検索、ステータス別フィルタ、並び替え
- 顧客やり取りメモの履歴管理
- 見積書プレビュー、PDF化/印刷
- 見積から請求書への変換
- Supabase Google認証の接続準備
- Supabase RLS前提のDBスキーマ

## 開発コマンド

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Supabase設定

1. Supabaseでプロジェクトを作成します。
2. `supabase/schema.sql` をSQL Editorで実行します。
3. `.env.example` を参考に `.env.local` を作成します。
4. Supabase AuthでGoogle providerを有効化し、Google CloudのOAuth Client ID/Secretを設定します。
5. Site URLとRedirect URLにローカルURL、GitHub Pages URL、本番URLを追加します。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_APP_FREE_QUOTE_LIMIT=20
```

## データモデル方針

基本階層は `会社 -> 組織 -> ユーザー -> ロール` です。見積、顧客、品目、請求書は組織に紐づき、RLSで所属組織以外を参照できない設計にしています。

## 公開

`main` ブランチへpushするとGitHub ActionsでGitHub Pagesへデプロイされます。
