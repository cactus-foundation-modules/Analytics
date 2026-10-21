export function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function whole(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

export function percent(part: number, whole: number): string {
  if (!whole) return '-'
  const p = (part / whole) * 100
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  // A cell starting with = + - @ is read as a formula by spreadsheet software.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
