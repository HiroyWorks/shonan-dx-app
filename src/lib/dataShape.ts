export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('データ形式を確認できませんでした。')
  return value as Record<string, unknown>
}
export function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('一覧データの形式が不正です。')
  return value.map(record)
}
export function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('文字列データが不正です。')
  return value
}
export function num(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value))) throw new Error('数値データが不正です。')
  return Number(value)
}
export function nullableStr(value: unknown): string | null { return value == null ? null : str(value) }
