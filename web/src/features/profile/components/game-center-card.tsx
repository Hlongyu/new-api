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
import { Link } from '@tanstack/react-router'
import { Gamepad2, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'

export function GameCenterCard() {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t('Game Center')}
      description={t('Classic desktop mini games')}
      icon={<Gamepad2 className='size-4' />}
      iconTone='warning'
      disableHoverEffect
      contentClassName='p-0'
    >
      <div className='h-40 overflow-hidden bg-black' aria-hidden='true'>
        <img
          src='/gold-miner/assets-hd-v3/bg_start_menu.png'
          alt=''
          className='h-full w-full object-contain'
        />
      </div>
      <div className='flex items-center justify-between gap-6 p-5'>
        <div className='min-w-0'>
          <h3 className='font-semibold'>{t('Gold Miner')}</h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Grab enough treasure before time runs out.')}
          </p>
        </div>
        <Button size='lg' render={<Link to='/games/gold-miner' />}>
          <Play data-icon='inline-start' aria-hidden='true' />
          {t('Start Game')}
        </Button>
      </div>
    </TitledCard>
  )
}
