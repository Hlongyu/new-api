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
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

type ApiKeyRateLimitProgressProps = {
  used: number
  limit: number
  resetAt: number
}

export function ApiKeyRateLimitProgress(props: ApiKeyRateLimitProgressProps) {
  const { t } = useTranslation()
  const percentage =
    props.limit > 0 ? Math.min(100, (props.used / props.limit) * 100) : 0
  const resetTime =
    props.resetAt > 0
      ? t('Reset time: {{time}}', {
          time: formatTimestampToDate(props.resetAt),
        })
      : t('Reset time: starts after first use')

  return (
    <div className='flex flex-col gap-1.5 pt-1'>
      <div className='text-muted-foreground flex justify-between text-xs tabular-nums'>
        <span>{formatQuota(props.used)}</span>
        <span>{formatQuota(props.limit)}</span>
      </div>
      <Progress value={percentage} className='h-1.5' />
      <div className='text-muted-foreground text-xs tabular-nums'>
        {resetTime}
      </div>
    </div>
  )
}
