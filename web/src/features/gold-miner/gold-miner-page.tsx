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
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { GoldMinerGame } from './components/gold-miner-game'

type GoldMinerPageProps = {
  autoStart?: boolean
  standalone?: boolean
}

export function GoldMinerPage(props: GoldMinerPageProps) {
  const { t } = useTranslation()

  return (
    <Main
      className={
        props.standalone
          ? 'h-svh bg-black text-white'
          : 'bg-black text-white'
      }
    >
      <header className='flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950 px-3'>
        <Button
          variant='ghost'
          render={<Link to='/games' />}
          className='text-white hover:bg-white/10 hover:text-white'
        >
          <ArrowLeft data-icon='inline-start' aria-hidden='true' />
          {t('Game Center')}
        </Button>
        <div className='h-4 w-px bg-white/15' aria-hidden='true' />
        <h1 className='text-sm font-medium'>{t('Gold Miner')}</h1>
      </header>
      <div className='min-h-0 flex-1 overflow-hidden p-3'>
        <GoldMinerGame autoStart={props.autoStart} />
      </div>
    </Main>
  )
}
