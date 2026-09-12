import fs from 'node:fs'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { restoreIntoEmptyDatabase, verifyRestore } from './backup-runtime.mjs'
import { loadTs } from '../tests/load-ts.mjs'

const { validateFullBackup, base64ToBytes, digest } = loadTs('src/lib/backupFormat.ts')
const [file, flag, confirmation] = process.argv.slice(2)
if (!file || flag !== '--confirm-empty-recovery' || !confirmation) {
  console.error('使い方: npm run backup:restore -- <JSON> --confirm-empty-recovery <組織UUID>\n空の復旧専用DB、同じAuthユーザーID、適用済みの全マイグレーションが必要です。READMEの復元手順を参照してください。')
  process.exitCode = 1
} else {
  let db
  try {
    const backup = await validateFullBackup(JSON.parse(fs.readFileSync(file, 'utf8')))
    if (confirmation !== backup.organizationId) throw new Error('確認用の組織IDが一致しません。')
    await verifyRestore(backup)
    const databaseUrl = process.env.BACKUP_DATABASE_URL, url = process.env.BACKUP_SUPABASE_URL, key = process.env.BACKUP_SERVICE_ROLE_KEY
    if (!databaseUrl || !url || !key) throw new Error('BACKUP_DATABASE_URL、BACKUP_SUPABASE_URL、BACKUP_SERVICE_ROLE_KEYを安全な環境変数で指定してください。')
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('復旧先のSupabase URLが不正です。')
    const target = new URL(url), connection = new URL(databaseUrl), project = target.hostname.split('.')[0]
    const username = decodeURIComponent(connection.username)
    if (!['postgres:', 'postgresql:'].includes(connection.protocol) ||
      !(connection.hostname === `db.${project}.supabase.co` || (connection.hostname.endsWith('.pooler.supabase.com') && username.endsWith(`.${project}`)))) {
      throw new Error('DB接続先とStorageのSupabaseプロジェクトが一致しません。対応する直接接続またはSupavisor URLを指定してください。')
    }
    db = new pg.Client({ host: connection.hostname, port: Number(connection.port || 5432), user: username, password: decodeURIComponent(connection.password), database: connection.pathname.slice(1) || 'postgres', ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
    await db.connect()
    const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from('invoice-originals')
    await restoreIntoEmptyDatabase(db, backup, async () => {
      for (const f of backup.files) {
        const bytes = base64ToBytes(f.base64)
        const result = await storage.upload(f.path, bytes, { contentType: 'application/pdf', upsert: false })
        if (result.error) {
          const existing = await storage.download(f.path)
          if (existing.error || await digest(await existing.data.arrayBuffer()) !== f.sha256) throw new Error('復旧先PDFの競合またはアップロード失敗。DB復元はロールバックします。')
        }
        const downloaded = await storage.download(f.path)
        if (downloaded.error || await digest(await downloaded.data.arrayBuffer()) !== f.sha256) throw new Error('復旧先PDFの検証に失敗しました。DB復元はロールバックします。')
      }
    })
    console.log('空の復旧先へのDB復元とPDF再取得検証が完了しました。公開前にログイン・RLS・原本表示を受入確認してください。メール待機履歴は自動送信されません。')
  } catch (e) { console.error(e instanceof Error ? e.message : '復元に失敗しました。'); process.exitCode = 1 }
  finally { if (db) await db.end() }
}
