import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import test from 'node:test'
import { createIsolatedDatabase, verifyRestore, restoreIntoEmptyDatabase } from '../scripts/backup-runtime.mjs'
import { loadTs } from './load-ts.mjs'

const { checksum, validateFullBackup, parseBackupEnvelope } = loadTs('src/lib/backupFormat.ts')
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10)

test('complete document workflows, tenant security and full restore', async (t) => {
  const db = await createIsolatedDatabase()
  t.after(() => db.close())
  const admin = randomUUID(), member = randomUUID(), outsider = randomUUID(), applicant = randomUUID(), wrongEmail = randomUUID()
  const company = randomUUID(), org = randomUUID(), other = randomUUID(), customer = randomUUID()
  for (const user of [admin, member, outsider, applicant, wrongEmail]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [user, `${user}@example.invalid`])
    await db.query('insert into public.profiles(id,display_name,email) values($1,$2,$3)', [user, '検証担当者', `${user}@example.invalid`])
  }
  await db.query("insert into public.companies(id,name,plan) values($1,'検証会社','pro')", [company])
  await db.query("insert into public.organizations(id,company_id,name) values($1,$3,'営業部'),($2,$3,'別部門')", [org, other, company])
  for (const [u, o, role] of [[admin, org, 'admin'], [member, org, 'member'], [outsider, other, 'admin']]) await db.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)', [o, u, role])
  await db.query("insert into public.customers(id,organization_id,name,address) values($1,$2,'原本顧客','神奈川県')", [customer, org])
  const asUser = async (user, fn, role = 'authenticated') => {
    await db.exec(`set role ${role}`)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ''])
    try { return await fn() } finally { await db.exec('reset role') }
  }
  const line = (price = 1000) => ({ id: randomUUID(), item_master_id: null, name: '開発費', unit: '式', unit_price: price, quantity: 1, tax_kind: 'taxable', sort_order: 0 })
  const save = async (id, price = 1000, revision = 0) => asUser(member, () => db.query('select public.save_quote_versioned($1,$2,$3,$4,$5,$6,$7,$8)', [org, id, customer, '開発案件', '見積備考', JSON.stringify([line(price)]), price + Math.round(price / 10), revision]))
  const q = randomUUID()

  await t.test('new tables have RLS, no anonymous access and immutable ledgers', async () => {
    const rows = (await db.query("select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('quote_drafts','quote_revisions','invoice_payments','invoice_cancellations','invoice_documents','invoice_deliveries','organization_invitations')")).rows
    assert.equal(rows.length, 7)
    for (const row of rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.anon_read, false) }
    for (const table of ['quote_revisions', 'invoice_payments', 'invoice_cancellations', 'invoice_documents', 'invoice_deliveries']) {
      const perms = (await db.query(`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE') as writable`)).rows[0]
      assert.equal(perms.writable, false)
    }
    const insecure = (await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")).rows
    assert.equal(insecure.length, 0)
    const unsafe = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app_private' and p.prosecdef and (has_function_privilege('anon',p.oid,'EXECUTE') or not ('search_path=""'=any(p.proconfig)))`)).rows
    assert.deepEqual(unsafe, [])
    const missingIndexes = (await db.query(`select c.conrelid::regclass::text as table_name from pg_constraint c
      where c.contype='f' and c.conrelid in ('public.quote_drafts'::regclass,'public.quote_revisions'::regclass,'public.invoice_payments'::regclass,'public.invoice_cancellations'::regclass,'public.invoice_documents'::regclass,'public.invoice_deliveries'::regclass,'public.organization_invitations'::regclass)
      and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indkey[0]=c.conkey[1])`)).rows
    assert.deepEqual(missingIndexes, [])
  })

  await t.test('member edits customer/item, but cannot delete them', async () => {
    const item = randomUUID()
    await asUser(member, async () => {
      await db.query("update public.customers set contact='担当者変更' where id=$1", [customer])
      await db.query("insert into public.item_masters(id,organization_id,name,unit_price) values($1,$2,'品目',100)", [item, org])
      await db.query('update public.item_masters set unit_price=200 where id=$1', [item])
      assert.equal((await db.query('delete from public.item_masters where id=$1 returning id', [item])).rows.length, 0)
      assert.equal((await db.query('delete from public.customers where id=$1 returning id', [customer])).rows.length, 0)
    })
  })

  await t.test('drafts are private, versioned and do not consume quote numbers', async () => {
    const id = randomUUID(), content = { customerId: customer, project: '下書き', memo: '', lines: [] }
    await asUser(member, () => db.query('select public.save_quote_draft($1,$2,$3,$4,0)', [org, id, '下書き', content]))
    await asUser(member, () => assert.rejects(db.query('select public.save_quote_draft($1,$2,$3,$4,0)', [org, randomUUID(), '不正な下書き', {}]), /invalid draft/))
    await asUser(admin, async () => {
      assert.equal((await db.query('select id from public.quote_drafts where id=$1', [id])).rows.length, 0)
      await assert.rejects(db.query('select public.save_quote_draft($1,$2,$3,$4,1)', [org, id, '盗用', content]), /draft access denied/)
    })
    await asUser(member, () => db.query('select public.save_quote_draft($1,$2,$3,$4,1)', [org, id, '下書き第2版', content]))
    await asUser(member, () => assert.rejects(db.query('select public.save_quote_draft($1,$2,$3,$4,1)', [org, id, '古い版', content]), /draft changed/))
    assert.equal((await db.query('select count(*)::integer as n from public.quotes')).rows[0].n, 0)
  })

  await t.test('revisions preserve final lines and stale saves roll back', async () => {
    await save(q)
    let revisions = (await db.query('select * from public.quote_revisions where quote_id=$1 order by revision', [q])).rows
    assert.equal(revisions.length, 1); assert.equal(revisions[0].content.quote.amount, 1100)
    await save(q, 2000, 1)
    await assert.rejects(save(q, 3000, 1), /revision changed/)
    revisions = (await db.query('select * from public.quote_revisions where quote_id=$1 order by revision', [q])).rows
    assert.equal(revisions.length, 2); assert.equal(revisions[0].content.lines[0].unit_price, 1000); assert.equal(revisions[1].content.quote.amount, 2200)
  })

  let invoice
  await t.test('issuing records immutable payment conditions, and members cannot issue', async () => {
    await asUser(member, () => assert.rejects(db.query('select public.issue_invoice($1,$2,$3,2200,2)', [q, tomorrow, '銀行情報']), /administrator permission/))
    await asUser(admin, () => assert.rejects(db.query('select public.issue_invoice($1,$2,$3,2200,2)', [q, tomorrow, '']), /bank details/))
    await asUser(admin, () => assert.rejects(db.query('select public.issue_invoice($1,$2,$3,1100,1)', [q, tomorrow, '銀行情報']), /changed before invoicing/))
    const result = await asUser(admin, () => db.query('select public.issue_invoice($1,$2,$3,2200,2) as id', [q, tomorrow, '銀行 営業支店 普通12345 名義テスト']))
    invoice = (await db.query('select * from public.invoices where id=$1', [result.rows[0].id])).rows[0]
    assert.equal(invoice.due_date.toISOString().slice(0, 10), tomorrow); assert.match(invoice.bank_details, /12345/)
    await asUser(admin, () => assert.rejects(db.query("update public.invoices set bank_details='差替え' where id=$1", [invoice.id]), /permission denied/))
    assert.equal((await asUser(admin, () => db.query('select public.issue_invoice($1,$2,$3,2200,2) as id', [q, tomorrow, invoice.bank_details]))).rows[0].id, invoice.id)
    await asUser(admin, () => assert.rejects(db.query('select public.issue_invoice($1,$2,$3,2200,2)', [q, tomorrow, '異なる振込先']), /different conditions/))
  })

  await t.test('partial payments, idempotency, reversals, overpayment and role denial', async () => {
    const id = randomUUID()
    const args = [invoice.id, id, 1000, today, '振込A']
    await asUser(member, () => assert.rejects(db.query('select public.record_invoice_payment($1,$2,$3,$4,$5)', args), /administrator permission/))
    await asUser(admin, () => db.query('select public.record_invoice_payment($1,$2,$3,$4,$5)', args))
    await asUser(admin, () => db.query('select public.record_invoice_payment($1,$2,$3,$4,$5)', args))
    assert.equal((await db.query('select sum(amount)::integer as n from public.invoice_payments where invoice_id=$1', [invoice.id])).rows[0].n, 1000)
    await asUser(admin, () => assert.rejects(db.query('select public.record_invoice_payment($1,$2,$3,$4,$5)', [invoice.id, id, 2000, today, '異なる入力']), /different input/))
    await asUser(admin, () => assert.rejects(db.query('select public.record_invoice_payment($1,$2,$3,$4,$5)', [invoice.id, randomUUID(), 1201, today, '超過']), /outstanding balance/))
    await asUser(admin, () => assert.rejects(db.query('select public.cancel_or_correct_invoice($1,$2)', [invoice.id, '取消']), /reverse payments/))
    await asUser(admin, () => db.query('select public.record_invoice_payment($1,$2,null,$3,$4,$5)', [invoice.id, randomUUID(), today, '記帳誤りの取消', id]))
    await asUser(admin, () => assert.rejects(db.query('select public.record_invoice_payment($1,$2,null,$3,$4,$5)', [invoice.id, randomUUID(), today, '二重取消', id]), /not reversible/))
  })

  const pdf = Buffer.from('%PDF-1.4\nsynthetic backup integrity fixture\n%%EOF'), docId = randomUUID()
  const file = { path: `${org}/${invoice?.id ?? 'pending'}/${docId}.pdf`, base64: pdf.toString('base64'), sha256: createHash('sha256').update(pdf).digest('hex'), byteSize: pdf.length }
  await t.test('private immutable PDF registration verifies invoice and uploaded size', async () => {
    file.path = `${org}/${invoice.id}/${docId}.pdf`
    await asUser(outsider, () => assert.rejects(db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['invoice-originals', file.path, { size: pdf.length }]), /row-level security/))
    await asUser(admin, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['invoice-originals', file.path, { size: pdf.length }]))
    const args = [docId, invoice.id, file.sha256, pdf.length, '原本.pdf', '原本と宛先・税率・金額を照合', invoice.invoice_no, invoice.amount]
    await asUser(admin, () => assert.rejects(db.query('select public.register_invoice_document($1,$2,$3,$4,$5,$6,$7,$8)', [...args.slice(0, 7), invoice.amount + 1]), /does not match/))
    await asUser(admin, () => db.query('select public.register_invoice_document($1,$2,$3,$4,$5,$6,$7,$8)', args))
    await asUser(member, async () => {
      assert.equal((await db.query('select id from storage.objects where name=$1', [file.path])).rows.length, 1)
      assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning id", [file.path])).rows.length, 0)
      assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [file.path])).rows.length, 0)
    })
    await asUser(admin, () => assert.rejects(db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['invoice-originals', `${org}/${invoice.id}/${randomUUID()}.pdf`, { size: 6 }]), /row-level security/))
  })

  await t.test('delivery requires archived PDF/admin, is claimed once, and blocks cancellation while uncertain', async () => {
    const id = randomUUID(), args = [id, invoice.id, 'client@example.invalid', '請求書', '本文']
    await asUser(member, () => assert.rejects(db.query('select public.queue_invoice_delivery($1,$2,$3,$4,$5)', args), /administrator permission/))
    await asUser(admin, () => db.query('select public.queue_invoice_delivery($1,$2,$3,$4,$5)', args))
    await asUser(admin, () => db.query('select public.queue_invoice_delivery($1,$2,$3,$4,$5)', args))
    await asUser(admin, () => assert.rejects(db.query('select public.cancel_or_correct_invoice($1,$2)', [invoice.id, '取消']), /pending delivery/))
    await asUser(admin, () => assert.rejects(db.query('select public.claim_invoice_delivery($1)', [id]), /permission denied/))
    const claimed = await asUser(null, () => db.query('select * from public.claim_invoice_delivery($1)', [id]), 'service_role')
    assert.equal(claimed.rows.length, 1)
    assert.equal((await asUser(null, () => db.query('select * from public.claim_invoice_delivery($1)', [id]), 'service_role')).rows.length, 0)
    await asUser(admin, () => assert.rejects(db.query('select public.resolve_invoice_delivery($1,false,$2)', [id, '確認']), /cannot be manually/))
    await db.query("update public.invoice_deliveries set status='unknown' where id=$1", [id])
    await asUser(admin, () => db.query('select public.resolve_invoice_delivery($1,false,$2)', [id, 'メールサービス管理画面で未送信を確認']))
  })

  await t.test('correction creates a separate numbered original and cancellation is atomic', async () => {
    const replacement = randomUUID()
    await save(replacement, 1500)
    await asUser(admin, () => assert.rejects(db.query('select public.cancel_or_correct_invoice($1,$2,$3,$4,$5,1650,1)', [invoice.id, '', replacement, tomorrow, '振込先']), /check constraint/))
    assert.equal((await db.query('select id from public.invoices where quote_id=$1', [replacement])).rows.length, 0)
    const result = await asUser(admin, () => db.query('select public.cancel_or_correct_invoice($1,$2,$3,$4,$5,1650,1) as id', [invoice.id, '明細訂正', replacement, tomorrow, '振込先']))
    assert.ok(result.rows[0].id)
    assert.deepEqual((await db.query('select * from public.invoices where id=$1', [invoice.id])).rows[0], invoice)
    await asUser(admin, () => assert.rejects(db.query('select public.record_invoice_payment($1,$2,1,$3,$4)', [invoice.id, randomUUID(), today, '取消後']), /canceled/))
    await asUser(admin, () => assert.rejects(db.query('select public.queue_invoice_delivery($1,$2,$3,$4,$5)', [randomUUID(), invoice.id, 'x@example.invalid', '件名', '本文']), /canceled/))
  })

  await t.test('invitation email identity cannot be forged in editable profile; atomic approval grants member only', async () => {
    const invite = (await asUser(admin, () => db.query('select public.invite_organization_member($1,$2) as id', [org, `${applicant}@example.invalid`]))).rows[0].id
    await asUser(wrongEmail, () => db.query('update public.profiles set email=$1 where id=$2', [`${applicant}@example.invalid`, wrongEmail]))
    await asUser(wrongEmail, () => assert.rejects(db.query('select public.request_organization_membership($1)', [invite]), /confirmed email/))
    const request = (await asUser(applicant, () => db.query('select public.request_organization_membership($1) as id', [invite]))).rows[0].id
    await asUser(member, () => assert.rejects(db.query('select public.review_organization_membership($1,true)', [request]), /administrator permission/))
    await asUser(admin, () => assert.rejects(db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'member')", [org, wrongEmail]), /permission denied/))
    await asUser(admin, () => db.query('select public.review_organization_membership($1,true)', [request]))
    assert.equal((await db.query('select role from public.organization_memberships where organization_id=$1 and user_id=$2', [org, applicant])).rows[0].role, 'member')
    assert.equal((await db.query('select status from public.organization_join_requests where id=$1', [request])).rows[0].status, 'approved')
    assert.equal((await asUser(applicant, () => db.query('select public.list_my_invitations() as invitations'))).rows[0].invitations.length, 0)
  })

  let backup
  await t.test('all-record export includes 1105 activities, private drafts, counter and PDF manifest; members denied', async () => {
    await db.query("insert into public.activity_logs(organization_id,actor_id,kind,title) select $1,$2,'memo-added','検証履歴 ' || n from generate_series(1,1105) n", [org, admin])
    await asUser(member, () => assert.rejects(db.query('select public.export_organization_backup($1)', [org]), /administrator permission/))
    await asUser(outsider, () => assert.rejects(db.query('select public.export_organization_backup($1)', [org]), /administrator permission/))
    const raw = (await asUser(admin, () => db.query('select public.export_organization_backup($1) as backup', [org]))).rows[0].backup
    const envelope = parseBackupEnvelope(raw), payload = { ...envelope, files: [file] }
    backup = { ...payload, checksum: await checksum(payload) }
    await validateFullBackup(backup)
    assert.ok(backup.counts.activity_logs >= 1105)
    assert.equal(backup.counts.quote_drafts, 1); assert.equal(backup.counts.invoice_documents, 1)
    assert.ok(backup.counts.invoice_number_counters > 0)
  })

  await t.test('full restore into isolated DB preserves every row and rejects populated destinations', async () => {
    const report = await verifyRestore(backup)
    assert.equal(report.pdfCount, 1)
    assert.equal(report.counts.invoices, 2)
    await assert.rejects(restoreIntoEmptyDatabase(db, backup), /既存データ/)
    assert.deepEqual((await db.query('select * from public.invoices where id=$1', [invoice.id])).rows[0], invoice)
  })

  await t.test('restore compares timestamp instants across timezones without losing microseconds or changing text', async () => {
    const copy = structuredClone(backup)
    copy.data.companies[0].created_at = '2026-09-01T12:34:56.123456+00:00'
    copy.data.customers[0].memo = '2026-09-01T12:34:56.123456+00:00'
    const { checksum: previous, ...payload } = copy
    void previous
    copy.checksum = await checksum(payload)
    const recovery = await createIsolatedDatabase()
    try {
      await recovery.exec("set timezone='Asia/Tokyo'")
      for (const p of copy.data.profiles) await recovery.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [p.id,p.email])
      await restoreIntoEmptyDatabase(recovery, copy)
      const time = (await recovery.query("select to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') value from public.companies")).rows[0].value
      assert.equal(time, '2026-09-01 12:34:56.123456')
      assert.equal((await recovery.query('select memo from public.customers')).rows[0].memo, copy.data.customers[0].memo)
    } finally { await recovery.close() }
  })

  await t.test('tampered/missing PDFs, counts, invoice amount and dangling references fail verification', async () => {
    const copy = () => structuredClone(backup)
    let x = copy(); x.files[0].base64 = Buffer.from('tampered').toString('base64'); await assert.rejects(validateFullBackup(x), /ハッシュ|サイズ/)
    x = copy(); x.files = []; await assert.rejects(validateFullBackup(x), /不足/)
    x = copy(); x.counts.quotes++; await assert.rejects(validateFullBackup(x), /件数/)
    x = copy(); x.data.invoices[0].amount++; await assert.rejects(validateFullBackup(x), /発行原本/)
    x = copy(); x.data.invoice_payments[0].invoice_id = randomUUID(); const { checksum: ignored, ...payload } = x; void ignored; x.checksum = await checksum(payload)
    await assert.rejects(verifyRestore(x), /foreign key/)
  })
})
