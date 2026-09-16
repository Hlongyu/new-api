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
import { ExternalLink, Gamepad2, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function preloadGoldMiner(): void {
  void import('@/features/gold-miner/gold-miner-page').catch(() => undefined)
  void import('@/features/gold-miner/lib/game-assets')
    .then((module) => module.loadGoldMinerAssets())
    .catch(() => undefined)
}

export function GameCenterPage() {
  const { t } = useTranslation()

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl'>
          <header className='mb-7'>
            <div className='flex items-center gap-3'>
              <Gamepad2 className='text-primary size-6' aria-hidden='true' />
              <h1 className='text-2xl font-semibold'>{t('Game Center')}</h1>
            </div>
            <p className='text-muted-foreground mt-2 text-sm'>
              {t('Classic desktop mini games')}
            </p>
          </header>

          <div className='grid grid-cols-[repeat(auto-fill,minmax(320px,420px))] gap-6'>
            <Card
              className='gap-0 overflow-hidden py-0'
              onPointerEnter={preloadGoldMiner}
              onFocusCapture={preloadGoldMiner}
            >
              <div className='aspect-4/3 overflow-hidden bg-black'>
                <img
                  src='/gold-miner/assets-hd-v3/bg_start_menu.png'
                  alt=''
                  className='size-full object-cover transition-transform duration-300 group-hover/card:scale-[1.02]'
                />
              </div>
              <CardHeader className='p-5'>
                <CardTitle className='text-lg'>{t('Gold Miner')}</CardTitle>
                <CardDescription>
                  {t('Grab enough treasure before time runs out.')}
                </CardDescription>
              </CardHeader>
              <CardFooter className='justify-end p-4'>
                <Button
                  size='lg'
                  render={<Link to='/games/gold-miner' />}
                  onPointerEnter={preloadGoldMiner}
                  onFocus={preloadGoldMiner}
                >
                  <Play data-icon='inline-start' aria-hidden='true' />
                  {t('Start Game')}
                </Button>
              </CardFooter>
            </Card>
            <Card className='gap-0 overflow-hidden py-0'>
              <div className='aspect-4/3 overflow-hidden bg-black'>
                <img
                  src='/game-assets/d2r.png'
                  alt=''
                  width={1254}
                  height={1254}
                  loading='lazy'
                  decoding='async'
                  className='size-full object-contain'
                />
              </div>
              <CardHeader className='p-5'>
                <CardTitle className='text-lg'>{t('ECLIPSE II')}</CardTitle>
                <CardDescription>
                  {t(
                    'Explore dark worlds, battle monsters, and collect epic loot.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardFooter className='mt-auto justify-end p-4'>
                <Button
                  size='lg'
                  render={
                    <a
                      href='https://d2r.xxcd.top'
                      target='_blank'
                      rel='noopener noreferrer'
                    />
                  }
                >
                  <ExternalLink data-icon='inline-start' aria-hidden='true' />
                  {t('Start Game')}
                  <span className='sr-only'> ({t('Open in new tab')})</span>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </Main>
  )
}
