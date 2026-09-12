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
- 自分用の見積下書き、改訂履歴、古い版からの新規複製、競合保存の拒否
- 支払期限・振込先の発行時固定、部分入金・入金取消・未回収残高・期限超過一覧
- 原本を残す請求取消、別見積からの訂正請求書発行と関連付け
- 非公開StorageへのPDF保管、原本照合記録、SHA-256再検証、保管PDFのメール送付履歴
- メールアドレスを指定した招待、確認済みAuthメール照合、参加申請・原子的承認
- 組織内の全件・全履歴・PDF本体のバックアップ、隔離DB復元検証、空の復旧先への管理用復元

上記は作業ブランチの実装です。本番適用・既存原本の照合完了を意味しません。第一段階と今回の計3件のmigration、Storage、メール用Edge Functionの準備が必要です。DB移行前にフロントエンドだけを本番へ配信しないでください。[追加業務機能・導入と復旧手順](docs/追加業務機能_2026-09-12.md)を参照してください。

## 開発コマンド

```bash
npm install
npm run dev
npm run lint
npm run build
npm test
npm run check:edge
npm run backup:verify -- backups/backup.json
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

設定画面の管理者向けバックアップは、単一DBスナップショットから組織内の全件を取得し、保管PDF本体も含めるv2形式です。履歴200件・API行数上限による欠落を防ぎ、件数・金額・PDFハッシュ・全体チェックサムを検証します。大容量時や取得失敗時は部分バックアップを出力せず停止します。ブラウザ出力のPDF合計上限は150MBです。

`npm run backup:verify -- <JSON>` は本番に接続せず、隔離DBへ復元し、全行一致・外部キー・金額・原本保護を確認します。`npm run backup:restore -- <JSON> --confirm-empty-recovery <組織UUID>` は、別途指定する**空の復旧専用DB**にだけ復元する管理コマンドです。DB/Storageの復旧先一致、元のAuthユーザーID、適用済みschemaが必要です。既存データを持つ復旧先は拒否します。認証パスワード、OAuth設定、APIキー、他組織のデータは含みません。

旧JSON復元・localStorage移行は停止したままです。旧localStorage自体は削除しません。新形式のバックアップが、過去の不完全なJSONを完全なバックアップへ変換することはありません。

### 組織参加フロー

1. 初回セットアップで作成されるユーザーは、対象組織の唯一の `admin` になります。
2. 管理者が設定画面でGoogleアカウントのメールを指定して招待します。招待は7日間有効で、メールの自動送信はしません。アプリURLを別途共有してください。
3. 追加ユーザーはGoogleログイン後、「自分宛ての招待」から参加申請を送ります。確認済みのAuthメールと一致する招待だけを利用できます。
4. 管理者が画面で承認すると、申請更新と`member`追加が同一トランザクションで行われます。却下・招待失効・担当者の組織アクセス取消も可能です。

`organization_memberships` は組織ごとに `admin` を1人だけ許可します。ブラウザ権限では `admin` 行を追加・変更・削除できないため、通常運用で追加されるユーザーは必ず `member` になります。

## データモデル方針

基本階層は `会社 -> 組織 -> ユーザー -> ロール` です。見積、顧客、品目、請求書は組織に紐づき、RLSで所属組織以外を参照できない設計にしています。

## 公開

`main` ブランチへpushするとGitHub ActionsでGitHub Pagesへデプロイされます。

## 改善計画

現状の課題、優先順位、段階的な修正計画は [改善課題ウォークスルー](docs/改善課題ウォークスルー.md) を参照してください。

## Google検索への登録

公開後、Google Search Consoleで `https://app.shonan-dx.com/` の所有権を確認し、`https://app.shonan-dx.com/sitemap.xml` を送信する。トップページはURL検査からインデックス登録をリクエストする。
