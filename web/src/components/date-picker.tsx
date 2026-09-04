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
import { Calendar as CalendarIcon } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { enUS, fr, ja, ru, vi, zhCN } from 'react-day-picker/locale'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

const calendarLocales = {
  en: enUS,
  zh: zhCN,
  'zh-TW': zhCN,
  fr,
  ru,
  ja,
  vi,
} as const

type DatePickerProps = {
  id?: string
  selected: Date | undefined
  onSelect: (date: Date | undefined) => void
  placeholder?: string
  disabled?: ComponentProps<typeof Calendar>['disabled']
  startMonth?: Date
  endMonth?: Date
  invalid?: boolean
  className?: string
}

export function DatePicker(props: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const placeholderText = props.placeholder ?? t('Pick a date')
  const calendarLocale =
    calendarLocales[i18n.language as keyof typeof calendarLocales] ?? enUS
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={props.id}
            type='button'
            variant='outline'
            aria-invalid={props.invalid}
            data-empty={!props.selected}
            className={cn(
              'data-[empty=true]:text-muted-foreground w-full justify-start text-start font-normal',
              props.className
            )}
          />
        }
      >
        {props.selected ? (
          dayjs(props.selected).format('YYYY-MM-DD')
        ) : (
          <span>{placeholderText}</span>
        )}
        <CalendarIcon className='ms-auto size-4 opacity-50' />
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar
          mode='single'
          captionLayout='dropdown'
          selected={props.selected}
          onSelect={(date) => {
            props.onSelect(date)
            if (date) setOpen(false)
          }}
          locale={calendarLocale}
          startMonth={props.startMonth}
          endMonth={props.endMonth}
          disabled={
            props.disabled ??
            ((date: Date) => date > new Date() || date < new Date('1900-01-01'))
          }
        />
      </PopoverContent>
    </Popover>
  )
}
