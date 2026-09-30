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

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import {
  downloadRecap,
  recapCSV,
  recapPoster,
  recapRatio,
  recapHonorTitle,
} from '../lib'
import type { MonthlyRecap } from '../types'
import { Chapter } from './chapter'
import { HonorStory } from './honor-story'

export function ValueStory(props: { data: MonthlyRecap; name: string }) {
  const { t, i18n } = useTranslation()
  const data = props.data
  const usd = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const number = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    maximumFractionDigits: 4,
  })
  const ratio = recapRatio(data)
  const hasOriginal =
    data.priced_requests === data.requests && data.original_quota > 0
  return (
    <>
      <Chapter
        id='value'
        number='04'
        label={t('Your month, in value')}
        className='recap-lime'
      >
        <h2 id='value-heading'>{t('More possibilities. Your price.')}</h2>
        <p className='recap-caption'>{t('Effective multiplier')}</p>
        <p className='recap-big-number'>
          {ratio === null ? '—' : number.format(ratio)}
          <span>×</span>
        </p>
        <div className='recap-value-columns'>
          <div>
            <p>{t('Estimated 1× price')}</p>
            <strong>
              {hasOriginal
                ? usd.format(data.original_quota / data.quota_per_usd)
                : '—'}
            </strong>
          </div>
          <div>
            <p>{t('Recorded consumption')}</p>
            <strong>{usd.format(data.quota / data.quota_per_usd)}</strong>
          </div>
        </div>
        <p className='recap-footnote'>
          {t(
            'Calculated from historical base unit prices and token usage, plus recorded tool fees. Group discounts and request multipliers are excluded. USD credit equivalents, not cash payments.'
          )}
        </p>
        {!hasOriginal && (
          <p role='status'>
            {t(
              'Some historical prices are unavailable. The overall multiplier is not calculated.'
            )}
          </p>
        )}
        <details className='recap-details'>
          <summary>{t('Model cost breakdown')}</summary>
          <div
            className='recap-table-scroll'
            tabIndex={0}
            role='region'
            aria-label={t('Model cost breakdown')}
          >
            <table>
              <thead>
                <tr>
                  <th>{t('Model')}</th>
                  <th>{t('Estimated 1× price')}</th>
                  <th>{t('Recorded consumption')}</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.name}>
                    <td>{model.name}</td>
                    <td>
                      {model.priced_requests === model.requests
                        ? usd.format(model.original_quota / data.quota_per_usd)
                        : '—'}
                    </td>
                    <td>{usd.format(model.quota / data.quota_per_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Chapter>
      <HonorStory data={data} />
      <Chapter
        id='keepsake'
        number='06'
        label={t('One month. Your signature.')}
      >
        <h2 id='keepsake-heading'>{t('Keep this chapter.')}</h2>
        <div className='recap-keepsake'>
          <p className='recap-eyebrow'>new-api / {data.period}</p>
          <h3>{props.name}</h3>
          {data.honor?.status === 'awarded' && (
            <p>{recapHonorTitle(data.honor?.code, t)}</p>
          )}
          <p className='recap-keepsake-number'>
            {number.format(data.requests)}
          </p>
          <p>{t('Requests')}</p>
          <div className='recap-keepsake-stats'>
            <span>
              {t('Active days')}: <strong>{data.active_days}</strong>
            </span>
            <span>
              {t('Most used model')}: <strong>{data.models[0]?.name}</strong>
            </span>
          </div>
          <p className='recap-caption'>
            {data.groups.join(' + ')} · {t('Beijing time')}
          </p>
        </div>
        <div className='recap-actions'>
          <Button
            size='lg'
            onClick={() =>
              downloadRecap(
                recapPoster(data, props.name, {
                  title: t('Your monthly recap'),
                  honor:
                    data.honor?.status === 'awarded'
                      ? recapHonorTitle(data.honor.code, t)
                      : undefined,
                  requests: t('Requests'),
                  days: t('Active days'),
                  favorite: t('Most used model'),
                  scope: `${data.groups.join(' + ')} · ${data.in_progress ? t('Month in progress') : t('Monthly recap')}`,
                }),
                'image/svg+xml;charset=utf-8',
                `new-api-${data.period}.svg`
              )
            }
          >
            {t('Save keepsake')}
          </Button>
          <Button
            variant='outline'
            size='lg'
            onClick={() =>
              downloadRecap(
                recapCSV(data),
                'text/csv;charset=utf-8',
                `new-api-${data.period}.csv`
              )
            }
          >
            {t('Download data')}
          </Button>
        </div>
        <p className='recap-footnote'>
          {t(
            'Your keepsake includes your name and usage, but no spending. Downloads stay on your device.'
          )}
        </p>
        <footer className='recap-footer'>new-api · QuantumNous</footer>
      </Chapter>
    </>
  )
}
