/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { MonthlyRecap } from './types'

export function beijingMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`
}
export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}
export function recapRatio(data: MonthlyRecap): number | null {
  if (
    data.priced_requests !== data.requests ||
    data.original_quota <= 0 ||
    data.history_incomplete
  ) {
    return null
  }
  return data.quota / data.original_quota
}
export function recapCSV(data: MonthlyRecap): string {
  const rows: (string | number)[][] = [
    [
      'month',
      'groups',
      'model',
      'requests',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'recorded_usd',
      'estimated_original_usd',
      'priced_requests',
    ],
    ...data.models.map((model) => [
      data.period,
      data.groups.join(' + '),
      model.name,
      model.requests,
      model.input_tokens,
      model.output_tokens,
      model.cache_read_tokens,
      model.cache_write_tokens,
      model.quota / data.quota_per_usd,
      model.priced_requests === model.requests
        ? model.original_quota / data.quota_per_usd
        : '',
      model.priced_requests,
    ]),
  ]
  // Spreadsheet applications interpret formula prefixes even inside quoted CSV.
  return `\uFEFF${rows
    .map((row) =>
      row
        .map((cell) => {
          let value = String(cell)
          if (typeof cell === 'string' && /^[=+\-@\t\r\n]/.test(value)) {
            value = `'${value}`
          }
          return `"${value.replaceAll('"', '""')}"`
        })
        .join(',')
    )
    .join('\r\n')}`
}

export function downloadRecap(
  contents: string,
  type: string,
  filename: string
) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function recapPoster(
  data: MonthlyRecap,
  name: string,
  labels: {
    title: string
    requests: string
    days: string
    favorite: string
    scope: string
  }
): string {
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  const favorite = data.models[0]?.name ?? '—'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440" role="img" aria-label="${escape(labels.title)}">
  <rect width="1080" height="1440" fill="#12261f"/>
  <g fill="none" stroke="#c6ef82" stroke-opacity=".22" stroke-width="2">
  ${[260, 290, 320, 350, 380, 410].map((r) => `<circle cx="880" cy="270" r="${r}"/>`).join('')}</g>
  <g font-family="Arial, sans-serif" fill="#f4f3e9">
  <text x="80" y="105" font-size="25" letter-spacing="5">new-api / MONTHLY RECAP</text>
  <text x="80" y="245" font-size="100" font-weight="700">${escape(data.period)}</text>
  <text x="80" y="330" font-size="38">${escape(name.slice(0, 24))}</text>
  <text x="80" y="440" font-size="48">${escape(labels.title)}</text>
  <text x="70" y="690" font-size="145" fill="#c6ef82" font-weight="700">${data.requests.toLocaleString('en-US')}</text>
  <text x="80" y="755" font-size="32">${escape(labels.requests)}</text>
  <path d="M80 825H1000" stroke="#f4f3e9" stroke-opacity=".3"/>
  <text x="80" y="940" font-size="70">${data.active_days}</text>
  <text x="80" y="995" font-size="29">${escape(labels.days)}</text>
  <text x="80" y="1120" font-size="45">${escape(favorite.slice(0, 35))}</text>
  <text x="80" y="1175" font-size="29">${escape(labels.favorite)}</text>
  <text x="80" y="1310" font-size="23">${escape(labels.scope)}</text>
  <text x="80" y="1360" font-size="20" opacity=".7">new-api · QuantumNous</text>
  </g></svg>`
}
