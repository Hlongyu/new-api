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

import type { UserSubscription } from '../types'

interface Props {
  subscription: UserSubscription
  fallbackTitle?: string
}

export function SubscriptionOrigin(props: Props) {
  const { t } = useTranslation()
  let source = t('Subscription entitlement')
  switch (props.subscription.source) {
    case 'admin':
    case 'admin_custom':
      source = t('Administrator grant')
      break
    case 'monthly_rebate':
      source = t('Monthly consumption rebate')
      break
    case 'lottery_reward':
    case 'weekly_lottery_reward':
      source = t('Activity reward')
      break
    case 'order':
    case 'balance':
      source = t('Subscription purchase')
      break
  }
  const reason = props.subscription.title || props.fallbackTitle || source
  return (
    <div className='text-muted-foreground mt-1.5 space-y-1 text-xs'>
      <p>
        {t('Source')}: {source}
      </p>
      <p className='break-words'>
        {t('Grant reason')}: {reason}
      </p>
    </div>
  )
}
