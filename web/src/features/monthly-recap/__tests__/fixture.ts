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
import type { MonthlyRecap } from '../types'

export const recapFixture: MonthlyRecap = {
  period: '2026-09',
  as_of: 1790730000,
  in_progress: true,
  groups: ['gpt-pro', 'gpt优惠'],
  quota_per_usd: 500000,
  requests: 3,
  input_tokens: 100,
  output_tokens: 20,
  cache_read_tokens: 60,
  cache_write_tokens: 0,
  quota: 1000,
  original_quota: 4000,
  priced_requests: 3,
  models: [
    {
      name: 'gpt-test',
      requests: 3,
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 60,
      cache_write_tokens: 0,
      quota: 1000,
      original_quota: 4000,
      priced_requests: 3,
    },
  ],
  days: [{ date: '2026-09-01', requests: 3, tokens: 120, quota: 1000 }],
  hours: [3, ...Array<number>(23).fill(0)],
  weekdays: [0, 0, 3, 0, 0, 0, 0],
  active_days: 1,
  longest_streak: 1,
  errors: 0,
  history_incomplete: false,
  unreadable_usage: 0,
}
