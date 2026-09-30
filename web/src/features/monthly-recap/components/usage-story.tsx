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
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'

import type { MonthlyRecap } from '../types'
import { Chapter } from './chapter'

export function UsageStory(props: { data: MonthlyRecap }) {
  const { t, i18n } = useTranslation()
  const data = props.data
  const number = new Intl.NumberFormat(toIntlLocale(i18n.language))
  const compact = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    notation: 'compact',
    maximumFractionDigits: 2,
  })
  const favorite = data.models[0]
  const peakHour = data.hours.indexOf(Math.max(...data.hours))
  const busiest = data.days.reduce(
    (best, day) => (day.requests > best.requests ? day : best),
    data.days[0]
  )
  const maxDay = Math.max(1, ...data.days.map((day) => day.requests))
  const maxHour = Math.max(1, ...data.hours)
  const cacheRate =
    data.input_tokens > 0
      ? Math.min(100, (100 * data.cache_read_tokens) / data.input_tokens)
      : 0
  return (
    <>
      <Chapter id='models' number='01' label={t('Your model lineup')}>
        <h2 id='models-heading'>{t('The one you came back to.')}</h2>
        <div className='recap-favorite'>
          <div className='recap-record recap-record-small' aria-hidden='true'>
            <span>01</span>
          </div>
          <div className='min-w-0'>
            <p className='recap-caption'>{t('Most used model')}</p>
            <h3>{favorite?.name}</h3>
            <p>
              {t('{{count}} requests', { count: favorite?.requests ?? 0 })} ·{' '}
              {number.format(
                Math.round(((favorite?.requests ?? 0) / data.requests) * 100)
              )}
              %
            </p>
          </div>
        </div>
        <ol className='recap-tracklist'>
          {data.models.map((model, index) => (
            <li key={model.name}>
              <span className='recap-track-number'>
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className='min-w-0 flex-1'>
                <span className='recap-model-name'>{model.name}</span>
                <div className='recap-track-bar' aria-hidden='true'>
                  <span
                    style={{
                      width: `${(model.requests / data.requests) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className='recap-track-count'>
                <strong>{number.format(model.requests)}</strong>
                <span>{t('Requests')}</span>
              </div>
            </li>
          ))}
        </ol>
      </Chapter>
      <Chapter
        id='rhythm'
        number='02'
        label={t('Your monthly rhythm')}
        className='recap-paper'
      >
        <h2 id='rhythm-heading'>{t('You kept showing up.')}</h2>
        <div className='recap-rhythm-layout'>
          <div>
            <p className='recap-big-number'>
              {data.active_days}
              <span>/ {data.days.length}</span>
            </p>
            <p>{t('Active days')}</p>
            <p className='recap-streak'>
              {t('Longest streak: {{count}} days', {
                count: data.longest_streak,
              })}
            </p>
          </div>
          <div className='recap-calendar' aria-label={t('Daily requests')}>
            {data.days.map((day) => (
              <div
                key={day.date}
                className='recap-calendar-day'
                data-active={day.requests > 0}
                style={
                  { '--day-intensity': day.requests / maxDay } as CSSProperties
                }
                title={`${day.date}: ${number.format(day.requests)}`}
              >
                <span>{Number(day.date.slice(-2))}</span>
                <span className='sr-only'>
                  {t('{{count}} requests', { count: day.requests })}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className='recap-rhythm-notes'>
          <div>
            <p className='recap-caption'>{t('Busiest day')}</p>
            <strong>{busiest?.date}</strong>
            <p>{t('{{count}} requests', { count: busiest?.requests ?? 0 })}</p>
          </div>
          <div>
            <p className='recap-caption'>{t('Peak hour')}</p>
            <strong>
              {String(peakHour).padStart(2, '0')}:00–
              {String(peakHour + 1).padStart(2, '0')}:00
            </strong>
            <p>{t('Beijing time')}</p>
          </div>
        </div>
        <div
          className='recap-hours'
          role='img'
          aria-label={t('Hourly requests')}
        >
          {data.hours
            .map((count, hour) => ({
              count,
              hour: String(hour).padStart(2, '0'),
            }))
            .map(({ count, hour }) => (
              <div key={hour} title={`${hour}:00 · ${number.format(count)}`}>
                <span
                  style={{ height: `${Math.max(2, (count / maxHour) * 100)}%` }}
                />
                <span className='sr-only'>
                  {hour}:00: {number.format(count)}
                </span>
              </div>
            ))}
        </div>
        <div className='recap-hour-labels' aria-hidden='true'>
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </Chapter>
      <Chapter id='tokens' number='03' label={t('A little less repetition')}>
        <h2 id='tokens-heading'>{t('Your context, remembered.')}</h2>
        <div className='recap-cache-layout'>
          <div
            className='recap-cache-disc'
            style={
              { '--cache-angle': `${cacheRate * 3.6}deg` } as CSSProperties
            }
          >
            <div>
              <strong>
                {number.format(Number(cacheRate.toFixed(1)))}
                <small>%</small>
              </strong>
              <span>{t('Cache hit share')}</span>
            </div>
          </div>
          <dl className='recap-token-list'>
            <div>
              <dt>{t('Input tokens')}</dt>
              <dd title={number.format(data.input_tokens)}>
                {compact.format(data.input_tokens)}
              </dd>
            </div>
            <div>
              <dt>{t('Cache read tokens')}</dt>
              <dd title={number.format(data.cache_read_tokens)}>
                {compact.format(data.cache_read_tokens)}
              </dd>
            </div>
            <div>
              <dt>{t('Output tokens')}</dt>
              <dd title={number.format(data.output_tokens)}>
                {compact.format(data.output_tokens)}
              </dd>
            </div>
            <div>
              <dt>{t('Cache write tokens')}</dt>
              <dd title={number.format(data.cache_write_tokens)}>
                {compact.format(data.cache_write_tokens)}
              </dd>
            </div>
          </dl>
        </div>
        <p className='recap-footnote'>
          {t(
            'Cached tokens are included in input. Counts reflect the usage reported in retained logs.'
          )}
        </p>
      </Chapter>
    </>
  )
}
