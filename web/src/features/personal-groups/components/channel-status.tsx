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

import { Badge } from '@/components/ui/badge'

import type { PersonalChannel } from '../types'

export function ChannelStatus(props: { channel: PersonalChannel }) {
  const { t } = useTranslation()
  const labels = {
    draft: t('Draft'),
    pending: t('Pending Review'),
    approved: t('Approved'),
    rejected: t('Rejected'),
    superseded: t('Superseded'),
  }
  return (
    <div className='flex flex-wrap gap-2'>
      <Badge variant='outline'>{labels[props.channel.revision.status]}</Badge>
      {props.channel.published_config?.enabled && (
        <Badge>{t('Published')}</Badge>
      )}
    </div>
  )
}
