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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { fetchPersonalModels } from '../api'

export function PersonalModelPicker(props: {
  channelId: number
  type: number
  baseURL: string
  apiKey: string
  hasSavedKey: boolean
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState('')
  const currentSource = `${props.type}\n${props.baseURL}\n${props.apiKey}`
  const source = useRef(currentSource)
  source.current = currentSource
  const [loadedSource, setLoadedSource] = useState('')
  const selected = props.value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const selectedSet = new Set(selected)
  const available = loadedSource === currentSource ? models : []
  const options = [...new Set([...selected, ...available])].filter((name) =>
    name.toLowerCase().includes(search.toLowerCase())
  )
  async function fetchModels() {
    const requestedSource = currentSource
    setLoading(true)
    setError('')
    try {
      const result = await fetchPersonalModels({
        channel_id: props.channelId,
        type: props.type,
        base_url: props.baseURL,
        key: props.apiKey,
      })
      if (source.current !== requestedSource) return
      setModels(result)
      setLoadedSource(requestedSource)
      setFetched(true)
    } catch (error) {
      if (source.current === requestedSource) {
        setError(
          error instanceof Error ? error.message : t('Failed to fetch models')
        )
      }
    } finally {
      setLoading(false)
    }
  }
  return (
    <section aria-label={t('Models')} className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Label>
          {t('Models')} ({selected.length}/200)
        </Label>
        <Button
          type='button'
          variant='outline'
          disabled={
            loading || !props.baseURL || (!props.apiKey && !props.hasSavedKey)
          }
          onClick={() => void fetchModels()}
        >
          {loading ? t('Loading...') : t('Fetch Models')}
        </Button>
      </div>
      <p className='text-muted-foreground text-sm'>
        {t('Fetch upstream models, then select the models to offer.')}
      </p>
      <Input
        aria-label={t('Search models')}
        placeholder={t('Search models')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className='flex gap-2'>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          disabled={
            !options.length || new Set([...selected, ...options]).size > 200
          }
          onClick={() =>
            props.onChange([...new Set([...selected, ...options])].join(','))
          }
        >
          {t('Select All')}
        </Button>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          disabled={!selected.length}
          onClick={() => props.onChange('')}
        >
          {t('Clear')}
        </Button>
      </div>
      <div
        role='group'
        aria-label={t('Available models')}
        aria-invalid={props.invalid}
        className='max-h-64 overflow-y-auto rounded-lg border p-2'
      >
        {options.map((name) => (
          <Label
            key={name}
            className='hover:bg-muted flex min-h-9 cursor-pointer items-center gap-3 rounded-md p-2'
          >
            <Checkbox
              checked={selectedSet.has(name)}
              disabled={!selectedSet.has(name) && selected.length >= 200}
              onCheckedChange={(checked) =>
                props.onChange(
                  (checked
                    ? [...selected, name]
                    : selected.filter((value) => value !== name)
                  ).join(',')
                )
              }
            />
            <span className='min-w-0 font-mono text-xs break-all'>{name}</span>
          </Label>
        ))}
        {!options.length && (
          <p className='text-muted-foreground p-3 text-sm'>
            {fetched && loadedSource === currentSource
              ? t('No models found')
              : t('Fetch upstream models, then select the models to offer.')}
          </p>
        )}
      </div>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {props.invalid && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Select at least one model.')}
        </p>
      )}
    </section>
  )
}
