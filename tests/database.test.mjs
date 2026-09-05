import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { loadTs } from './load-ts.mjs'

const { totals } = loadTs('src/lib/money.ts')
const { parseInvoiceSnapshot } = loadTs('src/lib/invoiceSnapshot.ts')

test('migration, issued-document protection, rounding and RLS', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  // Minimal Supabase Auth contract; all application schemas, grants and policies
  // below are the real migrations, not mocks. No production connection is used.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `)
  const migrations = fs.readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
  const latest = migrations.find((name) => name.endsWith('_protect_issued_invoices.sql'))
  for (const name of migrations.filter((name) => name !== latest)) {
    // gen_random_uuid is built into this PostgreSQL engine; pgcrypto itself is not bundled.
    await db.exec(fs.readFileSync(`supabase/migrations/${name}`, 'utf8').replace('create extension if not exists pgcrypto;', ''))
  }
  const admin = randomUUID(), member = randomUUID(), outsider = randomUUID()
  const company = randomUUID(), org = randomUUID(), otherOrg = randomUUID(), customer = randomUUID()
  for (const user of [admin, member, outsider]) {
    await db.query('insert into auth.users values ($1)', [user])
    await db.query('insert into public.profiles (id, display_name, email) values ($1, $2, $3)', [user, '検証ユーザー', `${user}@example.invalid`])
  }
  await db.query("insert into public.companies (id, name, plan, invoice_registration_no) values ($1, '発行時の会社', 'pro', 'T1234567890123')", [company])
  await db.query("insert into public.organizations (id, company_id, name) values ($1, $3, '営業部'), ($2, $3, '別組織')", [org, otherOrg, company])
  for (const [user, organization, role] of [[admin, org, 'admin'], [member, org, 'member'], [outsider, otherOrg, 'admin']]) {
    await db.query('insert into public.organization_memberships (user_id, organization_id, role) values ($1, $2, $3)', [user, organization, role])
  }
  await db.query("insert into public.customers (id, organization_id, name, address) values ($1, $2, '発行時の顧客', '神奈川県')", [customer, org])
  await db.query('insert into public.quote_number_settings (organization_id, year, next_sequence, tax_rate) values ($1, 2026, 999, 10)', [org])

  const asUser = async (user, fn, role = 'authenticated') => {
    await db.exec(`set role ${role}`)
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
    try { return await fn() } finally { await db.exec('reset role') }
  }
  const line = (price = 101, quantity = 1.4, taxKind = 'taxable') => ({
    id: randomUUID(), item_master_id: null, name: '制作費', unit: '式', unit_price: price, quantity, tax_kind: taxKind, sort_order: 0,
  })
  const save = async (id, lines = [line()]) => db.query(
    'select public.save_quote($1, $2, $3, $4, $5, $6::jsonb) as id',
    [org, id, customer, '検証案件', '発行時の備考', JSON.stringify(lines)],
  )
  const legacyId = randomUUID(), legacyUnissued = randomUUID()
  await asUser(admin, async () => {
    await save(legacyId, [line(10000, 1)])
    await db.query('select public.create_invoice($1)', [legacyId])
    await save(legacyUnissued, [line(101, 1.4)])
  })
  const before = (await db.query('select id, amount, invoice_no from public.invoices where quote_id = $1', [legacyId])).rows[0]
  await db.exec(fs.readFileSync(`supabase/migrations/${latest}`, 'utf8'))

  await t.test('legacy invoice amount retained, with no invented historical snapshot', async () => {
    const after = (await db.query('select id, amount, invoice_no, snapshot from public.invoices where quote_id = $1', [legacyId])).rows[0]
    assert.deepEqual(after, { ...before, snapshot: null })
    await asUser(admin, () => assert.rejects(db.query('select public.create_invoice($1)', [legacyUnissued]), /legacy quote requires/))
    await asUser(admin, () => assert.rejects(save(legacyId), /issued quote is immutable/))
  })

  const quoteId = randomUUID()
  await t.test('member can save with matching SQL/UI totals and 4-digit quote number', async () => {
    await asUser(member, () => save(quoteId))
    const saved = (await db.query('select quote_no, amount, tax_rate from public.quotes where id = $1', [quoteId])).rows[0]
    assert.equal(saved.amount, 155)
    assert.equal(Number(saved.tax_rate), 10)
    // Legacy 999 and broken 1000 -> 100 are retained; new counter value is not truncated.
    assert.equal(saved.quote_no, 'Q-2026-1001')
  })

  await t.test('rounding boundaries, exemptions, fractional quantities match actual SQL', async () => {
    for (const input of [[line(101, .5)], [line(5, 1), line(5, 1)], [line(100, .29)], [line(101, 1.4, 'exempt'), line(111, .99)]]) {
      const sql = (await db.query('select app_private.calculate_quote_totals($1::jsonb, 10) as value', [JSON.stringify(input)])).rows[0].value
      const ui = totals(input.map((x) => ({ unitPrice: x.unit_price, quantity: x.quantity, taxKind: x.tax_kind })), 10)
      assert.deepEqual(sql, ui)
    }
    await asUser(member, () => assert.rejects(save(randomUUID(), [line(101, 1.001)]), /invalid price/))
    await asUser(member, () => assert.rejects(save(randomUUID(), [line(1.5, 1)]), /invalid price/))
  })

  await t.test('member cannot issue invoice through RPC or directly', async () => {
    await asUser(member, () => assert.rejects(db.query('select public.create_invoice($1)', [quoteId]), /administrator permission/))
    await asUser(member, () => assert.rejects(db.query("insert into public.invoices (organization_id, quote_id, invoice_no, amount) values ($1, $2, 'FAKE', 0)", [org, quoteId]), /administrator permission|row-level security/))
  })

  await t.test('member deletion is denied, admin can delete an unissued estimate', async () => {
    const disposable = randomUUID()
    await asUser(member, () => save(disposable))
    const denied = await asUser(member, () => db.query('delete from public.quotes where id = $1 returning id', [disposable]))
    assert.equal(denied.rows.length, 0)
    const allowed = await asUser(admin, () => db.query('delete from public.quotes where id = $1 returning id', [disposable]))
    assert.equal(allowed.rows.length, 1)
  })

  await t.test('manual invoiced status without invoice is rejected', async () => {
    await asUser(admin, () => assert.rejects(db.query("select public.update_quote_status($1, 'invoiced')", [quoteId]), /cannot be changed manually/))
  })

  await t.test('checked save rejects a stale UI total and rolls back the entire write', async () => {
    const id = randomUUID()
    await asUser(member, () => assert.rejects(db.query(
      'select public.save_quote_checked($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [org, id, customer, '税率変更前の入力', '', JSON.stringify([line()]), 156],
    ), /quote total changed/))
    assert.equal((await db.query('select id from public.quotes where id = $1', [id])).rows.length, 0)
    await asUser(member, () => db.query('select public.save_quote_checked($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [org, id, customer, '金額確認済み', '', JSON.stringify([line()]), 155]))
  })

  await t.test('direct changes cannot desynchronize a verified estimate amount', async () => {
    await asUser(member, async () => {
      await assert.rejects(db.query('update public.quotes set amount = 1 where id = $1', [quoteId]), /does not match/)
      await assert.rejects(db.query('update public.quote_items set unit_price = 1 where quote_id = $1', [quoteId]), /does not match/)
      await assert.rejects(db.query('update public.quotes set tax_rate = null where id = $1', [quoteId]), /cannot be reset/)
    })
  })

  let issued
  await t.test('admin issues an immutable snapshot and idempotent retry reuses it', async () => {
    const year = new Date().getUTCFullYear()
    await db.query('insert into app_private.invoice_number_counters (organization_id, year, next_sequence) values ($1, $2, 999)', [org, year])
    const one = await asUser(admin, () => db.query('select public.create_invoice($1) as id', [quoteId]))
    const two = await asUser(admin, () => db.query('select public.create_invoice($1) as id', [quoteId]))
    assert.equal(one.rows[0].id, two.rows[0].id)
    issued = (await db.query('select * from public.invoices where id = $1', [one.rows[0].id])).rows[0]
    assert.equal(issued.invoice_no, `INV-${year}-999`)
    assert.equal(issued.snapshot.issuerName, '発行時の会社')
    assert.equal(issued.snapshot.customerName, '発行時の顧客')
    assert.equal(issued.amount, 155)
    assert.ok(parseInvoiceSnapshot(issued.snapshot, issued.amount))
    assert.equal((await db.query('select status from public.quotes where id = $1', [quoteId])).rows[0].status, 'invoiced')
    const next = randomUUID()
    await asUser(admin, async () => { await save(next); await db.query('select public.create_invoice($1)', [next]) })
    assert.equal((await db.query('select invoice_no from public.invoices where quote_id = $1', [next])).rows[0].invoice_no, `INV-${year}-1000`)
  })

  await t.test('master/settings changes leave issued content and amounts unchanged', async () => {
    await asUser(admin, () => db.query('select public.save_workspace_settings($1, $2, 2026, 1005, 8, $3)', [org, 'Q', 'T9999999999999']))
    await asUser(member, () => db.query("update public.customers set name = '変更後の顧客', address = '変更後住所' where id = $1", [customer]))
    await db.query("update public.companies set name = '変更後の会社' where id = $1", [company])
    const unchanged = (await db.query('select * from public.invoices where id = $1', [issued.id])).rows[0]
    assert.deepEqual(unchanged, issued)
  })

  await t.test('editing/deleting issued quote or its lines is rejected via direct API', async () => {
    await asUser(admin, async () => {
      await assert.rejects(save(quoteId), /immutable/)
      await assert.rejects(db.query('delete from public.quotes where id = $1', [quoteId]), /cannot be deleted/)
      await assert.rejects(db.query('update public.quotes set amount = 1 where id = $1', [quoteId]), /immutable/)
      await assert.rejects(db.query("select public.update_quote_status($1, 'pending')", [quoteId]), /cannot be changed manually/)
      await assert.rejects(db.query('update public.quote_items set unit_price = 1 where quote_id = $1', [quoteId]), /immutable/)
      await assert.rejects(db.query('delete from public.quote_items where quote_id = $1', [quoteId]), /immutable/)
      await assert.rejects(db.query('delete from public.invoices where id = $1', [issued.id]), /permission denied/)
      await assert.rejects(db.query("update public.invoices set snapshot = '{}'::jsonb where id = $1", [issued.id]), /permission denied/)
      // Non-economic interaction notes remain available after issuance.
      await db.query("select public.add_quote_note($1, '入金の連絡を受領')", [quoteId])
    })
    await assert.rejects(db.query('delete from public.invoices where id = $1', [issued.id]), /cannot be updated or deleted/)
  })

  await t.test('direct invoice insert cannot forge a snapshot, amount, number or date', async () => {
    const id = randomUUID()
    await asUser(admin, () => save(id))
    const row = await asUser(admin, () => db.query("insert into public.invoices (organization_id, quote_id, invoice_no, amount, snapshot, created_at) values ($1, $2, 'FORGED', 0, '{}'::jsonb, '2000-01-01') returning *", [org, id]))
    assert.notEqual(row.rows[0].invoice_no, 'FORGED')
    assert.notEqual(row.rows[0].amount, 0)
    assert.ok(parseInvoiceSnapshot(row.rows[0].snapshot, row.rows[0].amount))
    assert.notEqual(new Date(row.rows[0].created_at).getUTCFullYear(), 2000)
  })

  await t.test('other organization/unauthenticated access rejected', async () => {
    await asUser(outsider, async () => {
      assert.equal((await db.query('select * from public.invoices where id = $1', [issued.id])).rows.length, 0)
      await assert.rejects(db.query('select public.create_invoice($1)', [quoteId]), /quote not found/)
      await assert.rejects(save(randomUUID()), /membership is required/)
    })
    await asUser(null, () => assert.rejects(db.query('select public.create_invoice($1)', [quoteId]), /permission denied/), 'anon')
  })

  await t.test('destructive JSON restore is blocked with existing data preserved', async () => {
    await asUser(admin, () => assert.rejects(db.query("select public.import_organization_backup($1, '{}'::jsonb)", [org]), /restore is temporarily disabled/))
    assert.equal((await db.query('select count(*)::integer as n from public.invoices where id = $1', [issued.id])).rows[0].n, 1)
  })

  await t.test('saved quote keeps recorded rate after defaults change, legacy quote requires explicit resave', async () => {
    await asUser(admin, () => save(legacyUnissued, [line(100, 1)]))
    assert.equal(Number((await db.query('select tax_rate from public.quotes where id = $1', [legacyUnissued])).rows[0].tax_rate), 8)
    await asUser(admin, () => db.query('select public.save_workspace_settings($1, $2, 2026, 2000, 10, $3)', [org, 'Q', 'T9999999999999']))
    await asUser(member, () => save(legacyUnissued, [line(100, 1)]))
    const row = (await db.query('select amount, tax_rate from public.quotes where id = $1', [legacyUnissued])).rows[0]
    assert.equal(Number(row.tax_rate), 8)
    assert.equal(row.amount, 108)
  })

  await t.test('new private counter has RLS and no client table grant', async () => {
    const row = (await db.query("select relrowsecurity, has_table_privilege('authenticated', 'app_private.invoice_number_counters', 'UPDATE') as writable from pg_class where oid = 'app_private.invoice_number_counters'::regclass")).rows[0]
    assert.equal(row.relrowsecurity, true)
    assert.equal(row.writable, false)
  })
})
