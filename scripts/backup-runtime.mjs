import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { loadTs } from '../tests/load-ts.mjs'

const { backupTables, canonicalJson, validateFullBackup } = loadTs('src/lib/backupFormat.ts')
export const restoreTables = backupTables.filter((t) => t !== 'storage_files')
const qualified = (t) => `${t === 'invoice_number_counters' ? 'app_private' : 'public'}."${t}"`

export async function createIsolatedDatabase() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,service_role;
      grant select,insert,update,delete on storage.objects to authenticated,service_role;
    `)
    for (const name of fs.readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(`supabase/migrations/${name}`, 'utf8').replace('create extension if not exists pgcrypto;', ''))
    }
    return db
  } catch (e) { await db.close(); throw e }
}

export async function assertBusinessIntegrity(db) {
  const queries = [
    `select p.id from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.organization_id<>i.organization_id`,
    `select c.invoice_id from public.invoice_cancellations c join public.invoices i on i.id=c.invoice_id left join public.invoices r on r.id=c.replacement_invoice_id where c.organization_id<>i.organization_id or (r.id is not null and r.organization_id<>i.organization_id)`,
    `select d.id from public.invoice_documents d join public.invoices i on i.id=d.invoice_id where d.organization_id<>i.organization_id`,
    `select d.id from public.invoice_deliveries d join public.invoices i on i.id=d.invoice_id join public.invoice_documents f on f.id=d.document_id where d.organization_id<>i.organization_id or f.invoice_id<>i.id`,
    `select p.id from public.invoice_payments p join public.invoice_payments r on r.id=p.reverses_id where r.invoice_id<>p.invoice_id or r.amount<=0 or p.amount<>-r.amount`,
    `select i.id from public.invoices i left join public.invoice_payments p on p.invoice_id=i.id group by i.id having coalesce(sum(p.amount),0)<0 or coalesce(sum(p.amount),0)>i.amount`,
    `select c.invoice_id from public.invoice_cancellations c join public.invoice_payments p on p.invoice_id=c.invoice_id group by c.invoice_id having sum(p.amount)<>0`,
  ]
  for (const query of queries) if ((await db.query(query)).rows.length) throw new Error('復元データの組織・入金・訂正参照に不整合があります。')
}

// Requires an entirely empty application DB. Never truncates/deletes/overwrites rows.
// Disabling USER triggers is confined to this owner-controlled recovery transaction,
// not exposed through any public RPC. FK constraints remain active throughout.
export async function restoreIntoEmptyDatabase(db, backup, beforeCommit = async () => {}) {
  await validateFullBackup(backup)
  await db.query('begin isolation level serializable')
  try {
    await db.query("set local lock_timeout='5s'")
    await db.query(`lock table ${restoreTables.map(qualified).join(',')} in access exclusive mode`)
    for (const table of restoreTables) {
      if (Number((await db.query(`select count(*) as n from ${qualified(table)}`)).rows[0].n) !== 0) throw new Error('復旧先に既存データがあります。上書き復元を拒否しました。')
    }
    const users = new Set((await db.query('select id from auth.users')).rows.map((r) => r.id))
    if (backup.data.profiles.some((p) => !users.has(p.id))) throw new Error('元のAuthユーザーIDが復旧先にありません。先に認証基盤を復元してください。パスワードやOAuth設定は本バックアップに含まれません。')
    for (const table of restoreTables) await db.query(`alter table ${qualified(table)} disable trigger user`)
    for (const table of restoreTables) {
      const columnDetails = (await db.query("select attname, atttypid='timestamptz'::regtype as timezone_aware from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped", [qualified(table)])).rows
      const columns = new Set(columnDetails.map((r) => r.attname))
      const timestampColumns = columnDetails.filter((r) => r.timezone_aware).map((r) => r.attname)
      let rows = backup.data[table]
      if (rows.some((r) => Object.keys(r).some((k) => !columns.has(k)) || Object.keys(r).length !== columns.size)) throw new Error(`${table} のスキーマが一致しません。別バージョンの復元は行いません。`)
      // Positive entries must exist before reversal FKs are checked.
      if (table === 'invoice_payments') rows = [...rows].sort((a, b) => Number(b.amount > 0) - Number(a.amount > 0))
      for (let i = 0; i < rows.length; i += 500) await db.query(`insert into ${qualified(table)} select * from jsonb_populate_recordset(null::${qualified(table)},$1::jsonb)`, [JSON.stringify(rows.slice(i, i + 500))])
      const rowJson = table === 'invoice_number_counters' ? "to_jsonb(t)||jsonb_build_object('next_sequence',t.next_sequence::text)" : 'to_jsonb(t)'
      const restored = (await db.query(`select ${rowJson} as row from ${qualified(table)} t`)).rows.map((r) => r.row)
      // timestamptz JSON uses the destination session's timezone. Normalize only
      // typed timestamp columns; preserve microseconds and leave JSON/text values exact.
      let expected = rows
      if (timestampColumns.length && rows.length) {
        const normalized = (await db.query(`select to_jsonb(t)-'ordinality' as row from jsonb_populate_recordset(null::${qualified(table)},$1::jsonb) with ordinality t order by ordinality`, [JSON.stringify(rows)])).rows.map((r) => r.row)
        expected = rows.map((row, i) => ({ ...row, ...Object.fromEntries(timestampColumns.map((key) => [key, normalized[i][key]])) }))
      }
      const stable = (values) => values.map(canonicalJson).sort()
      if (JSON.stringify(stable(restored)) !== JSON.stringify(stable(expected))) throw new Error(`${table} の復元前後の全行比較が一致しません。`)
    }
    await assertBusinessIntegrity(db)
    for (const table of restoreTables) await db.query(`alter table ${qualified(table)} enable trigger user`)
    await db.query('set constraints all immediate')
    await beforeCommit()
    await db.query('commit')
  } catch (e) { await db.query('rollback'); throw e }
}

export async function verifyRestore(value) {
  const backup = await validateFullBackup(value), db = await createIsolatedDatabase()
  try {
    for (const p of backup.data.profiles) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [p.id, p.email])
    await restoreIntoEmptyDatabase(db, backup)
    // Verify that trigger protections have been re-enabled after restoration.
    const disabled = (await db.query("select tgname from pg_trigger where tgrelid='public.invoices'::regclass and not tgisinternal and tgenabled='D'")).rows
    if (disabled.length) throw new Error('原本保護トリガーが無効です。')
    return { organizationId: backup.organizationId, tables: restoreTables.length, counts: backup.counts, pdfCount: backup.files.length, checksum: backup.checksum }
  } finally { await db.close() }
}
