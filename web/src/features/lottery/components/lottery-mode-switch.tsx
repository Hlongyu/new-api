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
import { buttonVariants } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { cn } from '@/lib/utils'

type LotteryModeSwitchProps = {
  rechargeHref?: string
}

export function LotteryModeSwitch(props: LotteryModeSwitchProps) {
  const rechargeHref = props.rechargeHref ?? '/lottery/'

  return (
    <nav aria-label='抽奖类型' className='flex justify-center'>
      <ButtonGroup className='grid h-9 w-full max-w-[236px] grid-cols-2'>
        <span
          data-slot='button'
          aria-current='page'
          className={cn(
            buttonVariants({ variant: 'secondary' }),
            'h-9 min-w-0 w-full border-border bg-clip-border px-3 text-xs leading-none'
          )}
        >
          周榜抽奖
        </span>
        <a
          data-slot='button'
          href={rechargeHref}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-9 min-w-0 w-full px-3 text-xs leading-none'
          )}
        >
          充值抽奖
        </a>
      </ButtonGroup>
    </nav>
  )
}
