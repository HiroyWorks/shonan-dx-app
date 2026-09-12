import { useEffect, useState } from 'react'
import { allRows, rpc } from '../lib/workflowRepository'
import { records, str } from '../lib/dataShape'
import { supabase } from '../lib/supabase'
import type { Organization } from '../types'

type Invitation = { id: string; company: string; organization: string; expiresAt: string; requested: boolean }
export function MembershipInbox({ onRefresh }: { onRefresh: () => void }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const load = async () => {
    const data = records(await rpc('list_my_invitations'))
    setInvitations(data.map((r) => ({ id: str(r.id), company: str(r.company_name), organization: str(r.organization_name), expiresAt: str(r.expires_at), requested: r.requested === true })))
  }
  useEffect(() => { let active = true; void rpc('list_my_invitations').then((data) => {
    if (active) setInvitations(records(data).map((r) => ({ id: str(r.id), company: str(r.company_name), organization: str(r.organization_name), expiresAt: str(r.expires_at), requested: r.requested === true })))
  }).catch((e: Error) => { if (active) setMessage(e.message) }); return () => { active = false } }, [])
  return <section className="workflow-box"><h3>自分宛ての招待</h3><p>管理者が指定したメールアドレスのGoogleアカウントでログインすると、招待が表示されます。参加申請後、管理者の承認が必要です。</p>
    {invitations.length === 0 && <p>有効な招待はありません。組織管理者にログイン中のメールアドレスでの招待を依頼してください。</p>}
    <ul className="workflow-list">{invitations.map((i) => <li key={i.id}><span>{i.company} / {i.organization}<br />期限：{new Date(i.expiresAt).toLocaleString('ja-JP')}</span><button disabled={busy || i.requested} onClick={() => {
      setBusy(true); void rpc('request_organization_membership', { p_invitation: i.id, p_message: 'アプリからの参加申請' }).then(load).then(() => setMessage('参加申請を送りました。管理者の承認をお待ちください。')).catch((e: Error) => setMessage(e.message)).finally(() => setBusy(false))
    }}>{i.requested ? '参加承認待ち' : '参加を申請'}</button></li>)}</ul>
    <button disabled={busy} onClick={() => { void load().catch((e: Error) => setMessage(e.message)); onRefresh() }}>招待・参加状況を再確認</button>{message && <p role="status">{message}</p>}
  </section>
}

export default function MembershipPanel({ organization }: { organization: Organization }) {
  const [email, setEmail] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [invitations, setInvitations] = useState<Record<string, unknown>[]>([]), [requests, setRequests] = useState<Record<string, unknown>[]>([]), [members, setMembers] = useState<Record<string, unknown>[]>([])
  const load = async () => {
    const [i, r, m] = await Promise.all([allRows('organization_invitations', organization.id), allRows('organization_join_requests', organization.id), rpc('list_organization_members', { p_org: organization.id })])
    setInvitations(i); setRequests(r); setMembers(records(m))
  }
  useEffect(() => {
    if (organization.role !== 'admin') return
    let active = true
    void Promise.all([allRows('organization_invitations', organization.id), allRows('organization_join_requests', organization.id), rpc('list_organization_members', { p_org: organization.id })]).then(([i, r, m]) => { if (active) { setInvitations(i); setRequests(r); setMembers(records(m)) } }).catch((e: Error) => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [organization.id, organization.role])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { await action(); await load(); setMessage('メンバー管理情報を更新しました。') } catch (e) { setMessage(e instanceof Error ? e.message : '更新できませんでした。') } finally { setBusy(false) }
  }
  if (organization.role !== 'admin') return <section className="settings-card"><h3>メンバー管理</h3><p>招待・参加承認・メンバー削除は組織管理者が行います。担当者も顧客・品目を追加・編集できます。</p></section>
  return <section className="settings-card"><h3>メンバー管理</h3><p>招待は7日間有効です。対象者にこのアプリのURLを伝えてください。招待メールの自動送信は行いません。</p>
    <form className="workflow-actions" onSubmit={(e) => { e.preventDefault(); void run(() => rpc('invite_organization_member', { p_org: organization.id, p_email: email })).then(() => setEmail('')) }}><label><span>招待先Googleアカウント</span><input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="btn primary" disabled={busy}>招待を登録・再発行</button></form>
    {message && <p role="status">{message}</p>}<h4>招待一覧</h4><ul className="workflow-list">{invitations.map((i) => <li key={str(i.id)}><span>{str(i.email)} / {i.revoked_at ? '失効' : `期限 ${new Date(str(i.expires_at)).toLocaleString('ja-JP')}`}</span>{!i.revoked_at && <button disabled={busy} onClick={() => void run(() => rpc('invite_organization_member', { p_org: organization.id, p_email: i.email, p_revoke: true }))}>招待を失効</button>}</li>)}</ul>
    <h4>参加申請</h4><ul className="workflow-list">{requests.map((r) => <li key={str(r.id)}><span>{str(r.requester_display_name)} / {str(r.requester_email)} / {str(r.status)}<br />{str(r.message)}</span>{r.status === 'pending' && <div className="workflow-actions"><button disabled={busy} onClick={() => { if (window.confirm(`${str(r.requester_email)} を担当者として参加承認しますか？`)) void run(() => rpc('review_organization_membership', { p_request: r.id, p_approve: true })) }}>承認</button><button disabled={busy} onClick={() => void run(() => rpc('review_organization_membership', { p_request: r.id, p_approve: false }))}>却下</button></div>}</li>)}</ul>
    <h4>所属メンバー</h4><ul className="workflow-list">{members.map((m) => <li key={str(m.id)}><span>{str(m.display_name)} / {str(m.email)} / {m.role === 'admin' ? '管理者' : '担当者'}</span>{m.role === 'member' && <button disabled={busy} onClick={() => {
      if (window.confirm(`${str(m.email)} の組織アクセスを取り消しますか？ 作成済みの帳票は残ります。`)) void run(async () => {
        const result = await supabase.from('organization_memberships').delete().eq('id', str(m.id)).eq('organization_id', organization.id).eq('role', 'member').select('id')
        if (result.error || !result.data?.length) throw new Error(result.error?.message || '削除権限がありません。')
      })
    }}>組織から外す</button>}</li>)}</ul>
  </section>
}
