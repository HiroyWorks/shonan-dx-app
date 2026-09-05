# Estimate Management

個人事業主・小規模法人向けの見積管理フロントエンドです。Vite + TypeScript + React で構成しています。

## 実装済み機能

- 顧客マスタの追加・編集・削除
- 品目マスタの追加・編集・削除
- 見積の提出、編集、複製、削除
- 見積番号ルール、消費税率、Free/Proプラン表示
- 運営管理者だけが変更できる会社別契約プラン管理
- 検索、ステータス別フィルタ、並び替え
- 顧客やり取りメモの履歴管理
- 見積書プレビュー、PDF化/印刷
- 見積から請求書への変換
- Supabase Google認証
- Supabase上の顧客・品目・見積・請求書・更新履歴・設定CRUD
- 組織所属に基づくRLSと、管理者限定の設定・見積削除・請求書化
- 見積・請求書のトランザクション採番
- 請求書の発行時内容固定と、発行済み書類の編集・削除防止
- 明細・税額の丸め統一と、画面/DBの合計金額検証

請求書保護の変更には `20260905162914_protect_issued_invoices.sql` の適用が必要です。DB移行前にこのブランチのフロントエンドだけを本番へ配信しないでください。既存書類と切替手順は [優先課題修正・第一段階](docs/優先課題修正_2026-09-06.md) を参照してください。

## 開発コマンド

```bash
npm install
npm run dev
npm run lint
npm run build
npm test
```

## Supabase設定

1. `npm install` で固定済みのSupabase CLIを導入します。
2. `npx supabase login` でCLIを認証します。
3. `npx supabase link --project-ref <project-ref>` で対象プロジェクトへ接続します。
4. `npx supabase migration list --linked` でローカルとリモートの履歴が一致することを確認します。
5. `.env.example` を参考に `.env.local` を作成します。
6. Supabase AuthでGoogle providerを有効化し、Google CloudのOAuth Client ID/Secretを設定します。
7. Site URLとRedirect URLにローカルURL、GitHub Pages URL、本番URLを追加します。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_APP_FREE_QUOTE_LIMIT=20
```

DBスキーマの正本は `supabase/migrations/` です。変更時は `npx supabase migration new <変更名>` でファイルを作成し、内容を確認してから `npx supabase db push --linked` で反映します。`supabase/schema.sql` は参照用の旧スナップショットです。最新の変更はmigrationを確認してください。

### 初回データ作成

1. アプリからGoogleログインし、Supabase Authに管理者ユーザーを1件作成します。
2. `supabase/initial_setup.sql` の `v_admin_email`、`v_admin_display_name`、`v_company_name`、`v_organization_name` を実運用の値に変更します。
3. 変更したSQLをSupabase SQL Editorで実行します。
4. `profiles`、`platform_admins`、`companies`、`organizations`、`organization_memberships`、`quote_number_settings` が作成されたことを確認します。

`supabase/schema.sql` は、SupabaseのData API向けに `authenticated` への明示的な `GRANT`、全テーブルのRLS、組織所属ベースのpolicyを含みます。契約プランは `companies.plan` を正とし、一般ユーザーは参照のみ、`platform_admins` の運営管理者だけがRPC経由で変更できます。

### 業務データとバックアップ

顧客、品目、見積、請求書、更新履歴、見積番号・税率設定はSupabaseへ保存されます。見積保存、ステータス変更、メモ追加、請求書化、設定保存はDB関数内のトランザクションで処理します。

設定画面では取得済みデータをJSONへ書き出せますが、履歴は最大200件であり、全件バックアップではありません。発行原本を保護するため、全削除を伴う旧JSON復元・localStorageからの移行はUI/DBで停止しています。旧localStorage自体は削除しません。本番切替前にはDB全件の退避と復元検証が必要です。

### 組織参加フロー

1. 初回セットアップで作成されるユーザーは、対象組織の唯一の `admin` になります。
2. 追加ユーザーはGoogleログイン後、自分の `profiles` を作成して `organization_join_requests` に参加申請を作成します。
3. `admin` は申請内容を確認し、承認する場合は申請を `approved` に更新してから `organization_memberships` に `member` として追加します。
4. 拒否する場合は申請を `rejected` に更新します。申請者本人は未承認の申請を `canceled` にできます。

`organization_memberships` は組織ごとに `admin` を1人だけ許可します。ブラウザ権限では `admin` 行を追加・変更・削除できないため、通常運用で追加されるユーザーは必ず `member` になります。

## データモデル方針

基本階層は `会社 -> 組織 -> ユーザー -> ロール` です。見積、顧客、品目、請求書は組織に紐づき、RLSで所属組織以外を参照できない設計にしています。

## 公開

`main` ブランチへpushするとGitHub ActionsでGitHub Pagesへデプロイされます。

## 改善計画

現状の課題、優先順位、段階的な修正計画は [改善課題ウォークスルー](docs/改善課題ウォークスルー.md) を参照してください。

## Google検索への登録

公開後、Google Search Consoleで `https://app.shonan-dx.com/` の所有権を確認し、`https://app.shonan-dx.com/sitemap.xml` を送信する。トップページはURL検査からインデックス登録をリクエストする。
