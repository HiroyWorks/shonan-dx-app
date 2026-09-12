import { useState } from 'react'
import type { Organization } from '../types'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/workflowRepository'
import { bytesToBase64, checksum, digest, parseBackupEnvelope, validateFullBackup, type BackupFile } from '../lib/backupFormat'
import { downloadBlob } from '../lib/documentArchive'
import { str } from '../lib/dataShape'

export default function BackupPanel({ organization }: { organization: Organization }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : 'バックアップ処理に失敗しました。') } finally { setBusy(false) } }
  return <section className="settings-card backup-card"><h3>組織の全件バックアップ・復元検証</h3>
    <p>顧客・品目・見積・請求書・全履歴・下書き・入金・送付・メンバー管理情報と保管PDFを含めて保存します。画面の表示件数制限は適用しません。ファイルには個人情報・取引情報が含まれるため、安全な場所に保管してください。</p>
    <p>認証パスワード・OAuth設定・APIキーは含みません。復元は隔離DBで事前検証し、空の復旧先に管理用コマンドで行います。既存データを上書きするブラウザ復元は提供しません。</p>
    <div className="workflow-actions"><button className="btn primary" disabled={busy || organization.role !== 'admin'} onClick={() => void run(async () => {
      const envelope = parseBackupEnvelope(await rpc('export_organization_backup', { p_org: organization.id })), files: BackupFile[] = []
      let totalBytes = 0
      for (const f of envelope.data.storage_files) {
        const path = str(f.name)
        setMessage(`PDFを取得しています（${files.length + 1}/${envelope.data.storage_files.length}）`)
        const { data, error } = await supabase.storage.from('invoice-originals').download(path)
        if (error) throw new Error(`PDF ${path} を取得できません。部分バックアップは出力しません。`)
        const bytes = await data.arrayBuffer(); totalBytes += bytes.byteLength
        if (totalBytes > 150 * 1024 * 1024) throw new Error('PDF合計が150MBを超えています。管理者によるサーバー側バックアップを利用してください。部分出力は行いません。')
        files.push({ path, base64: bytesToBase64(new Uint8Array(bytes)), byteSize: bytes.byteLength, sha256: await digest(bytes) })
      }
      const payload = { ...envelope, files }, backup = { ...payload, checksum: await checksum(payload) }
      await validateFullBackup(backup)
      downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `estimate-management-full-${organization.id}-${new Date().toISOString().slice(0, 10)}.json`)
      setMessage(`全件バックアップを作成・整合性検証しました。見積${envelope.counts.quotes}件、請求書${envelope.counts.invoices}件、履歴${envelope.counts.activity_logs}件、PDF${files.length}件。復元DB検証は npm run backup:verify -- ファイル名 を実行してください。`)
    })}>{busy ? '処理中…' : '全件＋PDFをバックアップ'}</button>
      <label className="btn ghost"><span>バックアップファイルを検証（書込なし）</span><input type="file" accept="application/json,.json" disabled={busy || organization.role !== 'admin'} onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = ''
        if (file) void run(async () => {
          if (file.size > 250 * 1024 * 1024) throw new Error('大きなバックアップは管理用検証コマンドを利用してください。')
          const backup = await validateFullBackup(JSON.parse(await file.text()))
          setMessage(`ファイルの件数・金額・PDFハッシュの検証に成功しました。組織 ${backup.organizationId}、請求書${backup.counts.invoices}件。DBへの復元はまだ行っていません。隔離DBでの復元検証コマンドも実行してください。`)
        })
      }} /></label></div>{message && <p role="status" className="workflow-notice">{message}</p>}
  </section>
}
