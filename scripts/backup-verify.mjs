import fs from 'node:fs'
import { verifyRestore } from './backup-runtime.mjs'

const file = process.argv[2]
if (!file) { console.error('使い方: npm run backup:verify -- <全件バックアップJSON>'); process.exitCode = 1 }
else {
  try {
    const report = await verifyRestore(JSON.parse(fs.readFileSync(file, 'utf8')))
    console.log('隔離DBへの全件復元・全行比較・外部キー・原本保護・PDFハッシュ検証に成功しました。実DBには接続していません。')
    console.log(JSON.stringify(report, null, 2))
  } catch (e) { console.error(e instanceof Error ? e.message : '検証に失敗しました。'); process.exitCode = 1 }
}
