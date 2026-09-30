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

import { toIntlLocale } from '@/i18n/languages'

import { recapHonorTitle } from '../lib'
import type { MonthlyRecap } from '../types'
import { Chapter } from './chapter'

export function HonorStory(props: { data: MonthlyRecap }) {
  const { t, i18n } = useTranslation()
  const honor = props.data.honor
  const awarded =
    honor?.status === 'awarded' && !!recapHonorTitle(honor.code, t)
  const number = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    maximumFractionDigits: 6,
  })
  const percent = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  let message = t(
    'This snapshot predates honors. An administrator can recalculate it to evaluate your title.'
  )
  if (honor?.status === 'unavailable') {
    message = t('Complete monthly usage records are needed to award a title.')
  }
  return (
    <Chapter
      id='honor'
      number='05'
      label={t('Your monthly honor')}
      className={awarded ? 'recap-honor-awarded' : undefined}
    >
      {awarded ? (
        <>
          <div className='recap-honor-seal' aria-hidden='true'>
            ✦
          </div>
          <p className='recap-caption'>{t('This month, you earned')}</p>
          <h2 id='honor-heading'>{recapHonorTitle(honor?.code, t)}</h2>
          <p className='recap-honor-message'>
            {honor.code === 'value_connoisseur'
              ? t('More possibilities with every credit.')
              : t('Your rhythm made this month yours.')}
          </p>
          {honor.code === 'value_connoisseur' && (
            <div className='recap-value-columns'>
              <div>
                <p>{t('Effective multiplier')}</p>
                <strong>{number.format(honor.effective_ratio ?? 0)}×</strong>
              </div>
              <div>
                <p>
                  {t('Saved against the {{baseline}}× baseline', {
                    baseline: number.format(honor.baseline),
                  })}
                </p>
                <strong>{percent.format(honor.savings_fraction ?? 0)}</strong>
              </div>
            </div>
          )}
          <div className='recap-keepsake-stats'>
            <span>
              {t('Active days (3+ requests)')}:{' '}
              <strong>{honor.active_days ?? 0}</strong>
            </span>
            <span>
              {t('Longest streak: {{count}} days', {
                count: honor.longest_streak ?? 0,
              })}
            </span>
            {(honor.code === 'explorer' ||
              honor.badges?.includes('versatile')) && (
              <span>
                {t('Deeply used models')}: <strong>{honor.deep_models}</strong>
              </span>
            )}
            {honor.code === 'trusted_partner' && (
              <span>
                {honor.dominant_model}:{' '}
                {percent.format(honor.dominant_share ?? 0)}
              </span>
            )}
            {honor.code === 'night_owl' && (
              <span>00:00–05:59: {percent.format(honor.night_share ?? 0)}</span>
            )}
            {honor.code === 'morning_companion' && (
              <span>
                06:00–11:59: {percent.format(honor.morning_share ?? 0)}
              </span>
            )}
          </div>
          {!!honor.badges?.length && (
            <ul className='recap-honor-badges'>
              {honor.badges.map((code) => (
                <li key={code}>{recapHonorTitle(code, t)}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h2 id='honor-heading'>{t('Your monthly honor')}</h2>
          <p className='recap-honor-message'>{message}</p>
        </>
      )}
      <p className='recap-footnote'>
        {t(
          'Honors prioritize value, consistency, exploration, then habits. Active days require at least 3 requests; a deeply used model needs 20 requests across 3 days.'
        )}
      </p>
      <p className='recap-footnote'>
        {t(
          'Value Connoisseur requires a monthly multiplier strictly below {{threshold}}×, with a {{baseline}}× baseline.',
          {
            threshold: number.format(honor?.threshold ?? 0.15),
            baseline: number.format(honor?.baseline ?? 0.25),
          }
        )}
      </p>
    </Chapter>
  )
}
